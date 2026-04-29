import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { DeliveryReceipt } from "../packages/core/src/channels/contracts.ts"
import { reloadConfig } from "../packages/core/src/config/index.js"
import {
  closeDb,
  findChannelMessageRef,
  insertSession,
  listMessageLedgerEvents,
} from "../packages/core/src/db/index.js"
import { commitFinalDelivery } from "../packages/core/src/runs/channel-finalizer.ts"
import {
  deliverChunk,
  deliverTrackedChunk,
  resetDeliveryOutboxForTest,
  setDeliveryOutboxTestHooks,
  type SuccessfulFileDelivery,
  type SuccessfulTextDelivery,
} from "../packages/core/src/runs/delivery.ts"
import { createRootRun } from "../packages/core/src/runs/store.ts"

const tempDirs: string[] = []
const previousStateDir = process.env["NOBIE_STATE_DIR"]
const previousConfig = process.env["NOBIE_CONFIG"]
const baseNow = Date.UTC(2026, 3, 27, 0, 0, 0)

function setupRun(input: {
  runId?: string
  sessionId?: string
  source?: "webui" | "slack" | "telegram"
} = {}): void {
  const sessionId = input.sessionId ?? "session:task011"
  insertSession({
    id: sessionId,
    source: input.source ?? "slack",
    source_id: sessionId,
    created_at: baseNow,
    updated_at: baseNow,
    summary: "task011",
  })
  createRootRun({
    id: input.runId ?? "run:task011",
    sessionId,
    requestGroupId: "group:task011",
    prompt: "task011 delivery outbox",
    source: input.source ?? "slack",
  })
}

function slackReceipt(input: {
  status?: DeliveryReceipt["status"]
  retryAfterMs?: number
  messageId?: string
} = {}): DeliveryReceipt {
  return {
    channelId: "slack:workspace",
    provider: "slack",
    connectionId: "slack:primary",
    target: { roomId: "C_TASK011", threadId: "T_TASK011" },
    status: input.status ?? "sent",
    timestamp: baseNow,
    idempotencyKey: `slack:receipt:${input.messageId ?? "1710000100.000100"}`,
    ...(input.messageId ? { messageId: input.messageId } : {}),
    threadId: "T_TASK011",
    ...(input.retryAfterMs !== undefined ? { retryAfterMs: input.retryAfterMs } : {}),
    ...(input.status === "rate_limited" ? { errorCode: "slack_rate_limited" } : {}),
  }
}

beforeEach(() => {
  closeDb()
  resetDeliveryOutboxForTest()
  const stateDir = mkdtempSync(join(tmpdir(), "nobie-task011-outbox-"))
  tempDirs.push(stateDir)
  process.env["NOBIE_STATE_DIR"] = stateDir
  process.env["NOBIE_CONFIG"] = join(stateDir, "config.json5")
  reloadConfig()
})

afterEach(() => {
  resetDeliveryOutboxForTest()
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

describe("task011 delivery outbox and finalizer integration", () => {
  it("records delivery attempts, receipts, and channel message refs from provider receipts", async () => {
    setupRun()
    const successfulFileDeliveries: SuccessfulFileDelivery[] = []
    const successfulTextDeliveries: SuccessfulTextDelivery[] = []
    const appendEvent = vi.fn()
    const receipt = slackReceipt({ messageId: "1710000100.000100" })

    await deliverTrackedChunk({
      onChunk: async () => ({
        textDeliveries: [{
          channel: "slack",
          text: "task011 done",
          messageIds: ["1710000100.000100"],
          deliveryReceipts: [receipt],
        }],
      }),
      chunk: { type: "done", totalTokens: 0 },
      runId: "run:task011",
      source: "slack",
      targetKey: "C_TASK011:T_TASK011",
      successfulFileDeliveries,
      successfulTextDeliveries,
      appendEvent,
    })

    expect(findChannelMessageRef({
      source: "slack",
      externalChatId: "C_TASK011",
      externalThreadId: "T_TASK011",
      externalMessageId: "1710000100.000100",
    })).toMatchObject({
      root_run_id: "run:task011",
      request_group_id: "group:task011",
      role: "assistant",
    })
    expect(listMessageLedgerEvents({ runId: "run:task011", limit: 100 }).map((event) => event.event_kind))
      .toEqual(expect.arrayContaining(["delivery_attempted", "delivery_receipted", "text_delivered"]))
  })

  it("applies provider retry-after backoff before the next send on the same target", async () => {
    setupRun()
    let now = baseNow
    const slept: number[] = []
    setDeliveryOutboxTestHooks({
      now: () => now,
      sleep: async (delayMs) => {
        slept.push(delayMs)
        now += delayMs
      },
    })

    await deliverChunk({
      onChunk: async () => ({
        textDeliveries: [{
          channel: "slack",
          text: "rate limited",
          deliveryReceipts: [slackReceipt({ status: "rate_limited", retryAfterMs: 5_000 })],
        }],
      }),
      chunk: { type: "done", totalTokens: 0 },
      runId: "run:task011",
      source: "slack",
      targetKey: "C_TASK011:T_TASK011",
    })
    await deliverChunk({
      onChunk: async () => undefined,
      chunk: { type: "done", totalTokens: 0 },
      runId: "run:task011",
      source: "slack",
      targetKey: "C_TASK011:T_TASK011",
    })

    expect(slept).toEqual([5_000])
    expect(listMessageLedgerEvents({ runId: "run:task011", limit: 100 })).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          event_kind: "delivery_backoff_scheduled",
          status: "pending",
        }),
        expect.objectContaining({
          event_kind: "delivery_receipted",
          status: "degraded",
        }),
      ]),
    )
  })

  it("scopes final delivery idempotency by run, channel, and target session", async () => {
    setupRun({ runId: "run:task011-final", sessionId: "session:task011:webui", source: "webui" })
    insertSession({
      id: "session:task011:slack",
      source: "slack",
      source_id: "session:task011:slack",
      created_at: baseNow,
      updated_at: baseNow,
      summary: "task011 slack target",
    })

    const webui = await commitFinalDelivery({
      parentRunId: "run:task011-final",
      sessionId: "session:task011:webui",
      source: "webui",
      text: "final answer",
      onChunk: async () => undefined,
      deliveryDependencies: { writeReplyLog: () => undefined },
    })
    const duplicateWebui = await commitFinalDelivery({
      parentRunId: "run:task011-final",
      sessionId: "session:task011:webui",
      source: "webui",
      text: "final answer retry",
      onChunk: async () => undefined,
      deliveryDependencies: { writeReplyLog: () => undefined },
    })
    const slack = await commitFinalDelivery({
      parentRunId: "run:task011-final",
      sessionId: "session:task011:slack",
      source: "slack",
      text: "final answer for slack",
      onChunk: async () => undefined,
      deliveryDependencies: { writeReplyLog: () => undefined },
    })

    expect(webui.status).toBe("delivered")
    expect(duplicateWebui.status).toBe("duplicate_suppressed")
    expect(slack.status).toBe("delivered")
    expect(webui.idempotencyKey).not.toBe(slack.idempotencyKey)
    expect(webui.deliveryKey).not.toBe(slack.deliveryKey)
    expect(
      listMessageLedgerEvents({ runId: "run:task011-final", limit: 200 })
        .filter((event) => event.event_kind === "final_answer_delivered"),
    ).toHaveLength(2)
  })
})
