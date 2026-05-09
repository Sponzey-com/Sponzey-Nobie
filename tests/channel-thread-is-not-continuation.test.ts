import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import {
  normalizeSlackInboundEvent,
  normalizeTelegramInboundUpdate,
  resolveChannelContinuation,
} from "../packages/core/src/channels/index.ts"
import { reloadConfig } from "../packages/core/src/config/index.js"
import {
  closeDb,
  insertChannelMessageRef,
} from "../packages/core/src/db/index.js"

const previousStateDir = process.env["NOBIE_STATE_DIR"]
const previousConfig = process.env["NOBIE_CONFIG"]
const tempDirs: string[] = []

function useTempState(): void {
  closeDb()
  const stateDir = mkdtempSync(join(tmpdir(), "nobie-channel-thread-isolation-"))
  tempDirs.push(stateDir)
  process.env["NOBIE_STATE_DIR"] = stateDir
  delete process.env["NOBIE_CONFIG"]
  reloadConfig()
}

beforeEach(() => {
  useTempState()
})

afterEach(() => {
  closeDb()
  if (previousStateDir === undefined) delete process.env["NOBIE_STATE_DIR"]
  else process.env["NOBIE_STATE_DIR"] = previousStateDir
  if (previousConfig === undefined) delete process.env["NOBIE_CONFIG"]
  else process.env["NOBIE_CONFIG"] = previousConfig
  reloadConfig()
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()
    if (dir) rmSync(dir, { recursive: true, force: true })
  }
})

describe("channel thread is not continuation", () => {
  it("does not resolve a Slack thread reply as continuation without an explicit target", () => {
    insertChannelMessageRef({
      source: "slack",
      session_id: "session-slack-root",
      root_run_id: "run-slack-root",
      request_group_id: "group-slack-root",
      external_chat_id: "C_MARKET",
      external_thread_id: "1710000100.000100",
      external_message_id: "1710000100.000100",
      role: "assistant",
      created_at: 1_710_000_100_000,
    })

    const [message] = normalizeSlackInboundEvent({
      team_id: "T123",
      type: "event_callback",
      event: {
        type: "message",
        user: "U_OPERATOR",
        channel: "C_MARKET",
        text: "현재 시점의 코스피, 미국 나스닥 지수 확인해서 알려줘",
        ts: "1710000100.000200",
        thread_ts: "1710000100.000100",
        event_ts: "1710000100.000200",
      },
    })

    expect(message?.threadId).toBe("1710000100.000100")
    expect(message?.replyToMessageId).toBeUndefined()
    expect(message?.continuationContext).toBeUndefined()
    expect(resolveChannelContinuation({ envelope: message! })).toMatchObject({
      status: "not_found",
      confirmationRequired: false,
      reasonCode: "no_candidates",
    })
  })

  it("does not use same Telegram chat recency as continuation evidence", () => {
    insertChannelMessageRef({
      source: "telegram",
      session_id: "session-telegram-market",
      root_run_id: "run-prev-market",
      request_group_id: "group-prev-market",
      external_chat_id: "42120565",
      external_thread_id: null,
      external_message_id: "100",
      role: "assistant",
      created_at: 10_000,
    })

    const [message] = normalizeTelegramInboundUpdate({
      message: {
        message_id: 101,
        date: 11,
        text: "현재 시점의 코스피, 미국 나스닥 지수 확인해서 알려줘",
        from: { id: 42120565, first_name: "Tester" },
        chat: { id: 42120565, type: "private", first_name: "Tester" },
      },
    })

    expect(message?.replyToMessageId).toBeUndefined()
    expect(resolveChannelContinuation({ envelope: message!, lookupWindowMs: 30_000 })).toMatchObject({
      status: "not_found",
      confirmationRequired: false,
      reasonCode: "no_candidates",
    })
  })

  it("still resolves an explicit Telegram reply to a previous Nobie message", () => {
    insertChannelMessageRef({
      source: "telegram",
      session_id: "session-telegram-reply",
      root_run_id: "run-reply-target",
      request_group_id: "group-reply-target",
      external_chat_id: "-100100",
      external_thread_id: "7",
      external_message_id: "300",
      role: "assistant",
      created_at: 20_000,
    })

    const [message] = normalizeTelegramInboundUpdate({
      message: {
        message_id: 301,
        message_thread_id: 7,
        date: 21,
        text: "이 결과를 다시 검증해줘",
        from: { id: 77, first_name: "Operator" },
        chat: { id: -100100, type: "supergroup", title: "Ops" },
        reply_to_message: { message_id: 300, message_thread_id: 7 },
      },
    })

    expect(resolveChannelContinuation({ envelope: message! })).toMatchObject({
      status: "resolved",
      selected: {
        runId: "run-reply-target",
        requestGroupId: "group-reply-target",
        source: "message_ref_parent",
      },
      confirmationRequired: false,
    })
  })
})
