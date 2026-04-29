import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import {
  buildAccessPolicyFromAllowedIds,
  evaluateInboundAccessPolicy,
  namespaceChannelIdentity,
  namespaceChannelRoom,
  namespaceChannelUser,
  normalizeSlackInboundEvent,
  normalizeTelegramInboundUpdate,
  parseNamespacedChannelIdentity,
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
  const stateDir = mkdtempSync(join(tmpdir(), "nobie-task012-channel-"))
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

describe("task012 channel continuation, identity, and policy", () => {
  it("resolves Telegram reply_to_message and Slack thread_ts through the common continuation lookup", () => {
    insertChannelMessageRef({
      source: "telegram",
      session_id: "session-telegram",
      root_run_id: "run-telegram",
      request_group_id: "request-telegram",
      external_chat_id: "-100100",
      external_thread_id: "7",
      external_message_id: "300",
      role: "assistant",
      created_at: 1_710_000_000_000,
    })
    insertChannelMessageRef({
      source: "slack",
      session_id: "session-slack",
      root_run_id: "run-slack",
      request_group_id: "request-slack",
      external_chat_id: "C_APPROVAL",
      external_thread_id: "1710000100.000100",
      external_message_id: "1710000100.000100",
      role: "assistant",
      created_at: 1_710_000_000_100,
    })

    const [telegramReply] = normalizeTelegramInboundUpdate({
      message: {
        message_id: 314,
        message_thread_id: 7,
        date: 1_710_000_030,
        text: "continue",
        from: { id: 77, first_name: "Operator" },
        chat: { id: -100100, type: "supergroup", title: "Ops" },
        reply_to_message: { message_id: 300, message_thread_id: 7 },
      },
    })
    const [slackReply] = normalizeSlackInboundEvent({
      team_id: "T123",
      type: "event_callback",
      event: {
        type: "message",
        user: "U_OPERATOR",
        channel: "C_APPROVAL",
        text: "continue",
        ts: "1710000100.000200",
        thread_ts: "1710000100.000100",
        event_ts: "1710000100.000200",
      },
    })

    expect(resolveChannelContinuation({ envelope: telegramReply! })).toMatchObject({
      status: "resolved",
      selected: {
        runId: "run-telegram",
        requestGroupId: "request-telegram",
        source: "message_ref_parent",
      },
    })
    expect(resolveChannelContinuation({ envelope: slackReply! })).toMatchObject({
      status: "resolved",
      selected: {
        runId: "run-slack",
        requestGroupId: "request-slack",
      },
    })
  })

  it("requires confirmation instead of randomly attaching ambiguous room window candidates", () => {
    insertChannelMessageRef({
      source: "telegram",
      session_id: "session-a",
      root_run_id: "run-a",
      request_group_id: "request-a",
      external_chat_id: "42120565",
      external_thread_id: null,
      external_message_id: "100",
      role: "assistant",
      created_at: 10_000,
    })
    insertChannelMessageRef({
      source: "telegram",
      session_id: "session-b",
      root_run_id: "run-b",
      request_group_id: "request-b",
      external_chat_id: "42120565",
      external_thread_id: null,
      external_message_id: "200",
      role: "assistant",
      created_at: 20_000,
    })

    const [message] = normalizeTelegramInboundUpdate({
      message: {
        message_id: 300,
        date: 30,
        text: "이어서 처리해줘",
        from: { id: 42120565, first_name: "Tester" },
        chat: { id: 42120565, type: "private", first_name: "Tester" },
      },
    })
    const result = resolveChannelContinuation({ envelope: message!, lookupWindowMs: 30_000 })

    expect(result.status).toBe("ambiguous")
    expect(result.confirmationRequired).toBe(true)
    expect(result.candidates.map((candidate) => candidate.requestGroupId).sort()).toEqual([
      "request-a",
      "request-b",
    ])
    expect(result.confirmationPrompt).toContain("2")
  })

  it("namespaces provider identities with optional team scope and ignores display name changes", () => {
    expect(namespaceChannelUser({ provider: "slack", teamId: "T123", userId: "U123" })).toBe(
      "slack:team:T123:user:U123",
    )
    expect(namespaceChannelRoom({ provider: "slack", teamId: "T123", roomId: "C999" })).toBe(
      "slack:team:T123:room:C999",
    )
    expect(namespaceChannelIdentity("telegram", "user", 42)).toBe("telegram:user:42")
    expect(parseNamespacedChannelIdentity("slack:team:T123:user:U123")).toEqual({
      provider: "slack",
      kind: "user",
      providerIdentityId: "U123",
    })

    const policy = buildAccessPolicyFromAllowedIds({
      provider: "slack",
      teamId: "T123",
      allowedUserIds: ["U123"],
      requireAllowedPrincipal: true,
      emptyAllowlistAllows: false,
    })
    const baseEnvelope = {
      channelId: "slack:workspace",
      provider: "slack" as const,
      connectionId: "slack:primary",
      messageId: "1710000100.000300",
      sender: { id: "U123", displayName: "Before", providerType: "user" as const },
      room: { id: "C999", type: "channel" as const },
      workspace: { id: "T123" },
      text: "hello",
      attachments: [],
      mentions: [],
      timestamp: 1_710_000_300_000,
      rawPayloadRef: {
        storage: "none" as const,
        redactionState: "not_stored" as const,
        provider: "slack" as const,
        createdAt: 1_710_000_300_000,
      },
      dedupeKey: "slack:C999:1710000100.000300",
    }

    expect(evaluateInboundAccessPolicy({ envelope: baseEnvelope, policy }).allowed).toBe(true)
    expect(evaluateInboundAccessPolicy({
      envelope: {
        ...baseEnvelope,
        sender: { ...baseEnvelope.sender, displayName: "After" },
      },
      policy,
    }).allowed).toBe(true)
  })

  it("blocks allowlist mismatches before a run is started", () => {
    const [message] = normalizeSlackInboundEvent({
      team_id: "T123",
      type: "event_callback",
      event: {
        type: "message",
        user: "U_BLOCKED",
        channel: "C_ALLOWED",
        text: "run this",
        ts: "1710000100.000400",
        event_ts: "1710000100.000400",
      },
    })

    const result = evaluateInboundAccessPolicy({
      envelope: message!,
      workspaceId: "T123",
      policy: buildAccessPolicyFromAllowedIds({
        provider: "slack",
        teamId: "T123",
        allowedUserIds: ["U_ALLOWED"],
        allowedRoomIds: ["C_ALLOWED"],
        requireAllowedPrincipal: true,
        emptyAllowlistAllows: false,
      }),
    })

    expect(result.allowed).toBe(false)
    expect(result.policy.reasonCode).toBe("blocked_user")
    expect(result.responseText).toContain("not allowed")
    expect(result.envelope.accessPolicy).toMatchObject({
      decision: "blocked",
      reasonCode: "blocked_user",
    })
  })
})
