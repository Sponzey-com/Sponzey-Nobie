import { createRequire } from "node:module"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { registerAdminRoute } from "../packages/core/src/api/routes/admin.ts"
import { reloadConfig } from "../packages/core/src/config/index.js"
import { recordControlEvent } from "../packages/core/src/control-plane/timeline.ts"
import {
  CONTRACT_SCHEMA_VERSION,
  buildDeliveryKey,
  buildPayloadHash,
  buildScheduleIdentityKey,
  toCanonicalJson,
  type ScheduleContract,
} from "../packages/core/src/contracts/index.ts"
import {
  closeDb,
  enqueueMemoryWritebackCandidate,
  insertChannelMessageRef,
  insertMemoryEmbeddingIfMissing,
  insertSchedule,
  insertScheduleDeliveryReceipt,
  insertScheduleRun,
  insertSession,
  recordMemoryAccessLog,
  storeMemoryDocument,
} from "../packages/core/src/db/index.js"
import { recordMessageLedgerEvent } from "../packages/core/src/runs/message-ledger.ts"
import { createRootRun } from "../packages/core/src/runs/store.ts"

const require = createRequire(import.meta.url)
const Fastify = require("../packages/core/node_modules/fastify") as (options: { logger: boolean }) => {
  ready(): Promise<void>
  close(): Promise<void>
  inject(options: { method: string; url: string; payload?: unknown }): Promise<{ statusCode: number; json(): any }>
}

const tempDirs: string[] = []
const previousStateDir = process.env["NOBIE_STATE_DIR"]
const previousAdminUi = process.env["NOBIE_ADMIN_UI"]
const previousConfig = process.env["NOBIE_CONFIG"]
const previousNodeEnv = process.env["NODE_ENV"]

function useTempState(): void {
  closeDb()
  const stateDir = mkdtempSync(join(tmpdir(), "nobie-task013-admin-inspectors-"))
  tempDirs.push(stateDir)
  process.env["NOBIE_STATE_DIR"] = stateDir
  process.env["NOBIE_ADMIN_UI"] = "1"
  delete process.env["NOBIE_CONFIG"]
  delete process.env["NODE_ENV"]
  reloadConfig()
}

function restoreEnv(): void {
  closeDb()
  if (previousStateDir === undefined) delete process.env["NOBIE_STATE_DIR"]
  else process.env["NOBIE_STATE_DIR"] = previousStateDir
  if (previousAdminUi === undefined) delete process.env["NOBIE_ADMIN_UI"]
  else process.env["NOBIE_ADMIN_UI"] = previousAdminUi
  if (previousConfig === undefined) delete process.env["NOBIE_CONFIG"]
  else process.env["NOBIE_CONFIG"] = previousConfig
  if (previousNodeEnv === undefined) delete process.env["NODE_ENV"]
  else process.env["NODE_ENV"] = previousNodeEnv
  reloadConfig()
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()
    if (dir) rmSync(dir, { recursive: true, force: true })
  }
}

function scheduleContract(): ScheduleContract {
  return {
    schemaVersion: CONTRACT_SCHEMA_VERSION,
    kind: "recurring",
    time: {
      cron: "*/5 * * * *",
      timezone: "Asia/Seoul",
      missedPolicy: "catch_up_once",
    },
    payload: {
      kind: "literal_message",
      literalText: "TASK013 scheduled delivery",
    },
    delivery: {
      schemaVersion: CONTRACT_SCHEMA_VERSION,
      mode: "channel_message",
      channel: "telegram",
      sessionId: "session-task013",
      threadId: "thread-task013",
    },
    source: {
      originRunId: "run-task013",
      originRequestGroupId: "group-task013",
    },
    displayName: "TASK013 contract schedule",
  }
}

function seedRun(): { runId: string; requestGroupId: string; sessionKey: string } {
  const now = Date.now()
  const runId = "run-task013"
  const requestGroupId = "group-task013"
  const sessionKey = "session-task013"
  insertSession({
    id: sessionKey,
    source: "telegram",
    source_id: "chat-task013",
    created_at: now,
    updated_at: now,
    summary: "task013 admin runtime inspector session",
  })
  createRootRun({
    id: runId,
    sessionId: sessionKey,
    requestGroupId,
    prompt: "메모리 예약 채널 흐름 확인",
    source: "telegram",
  })
  return { runId, requestGroupId, sessionKey }
}

beforeEach(() => {
  useTempState()
})

afterEach(() => {
  restoreEnv()
})

describe("task013 admin memory scheduler channel inspectors", () => {
  it("links memory, schedule contracts, channel mapping, approvals, and ledger receipts", async () => {
    const { runId, requestGroupId, sessionKey } = seedRun()
    const stored = storeMemoryDocument({
      scope: "long-term",
      ownerId: "global",
      sourceType: "user_fact",
      sourceRef: "prompts/user.md",
      title: "TASK013 memory document",
      rawText: "TASK013_MEMORY_DOCUMENT should be visible in admin inspector",
      checksum: "task013-memory-checksum",
      metadata: { runId, requestGroupId },
      chunks: [
        {
          ordinal: 0,
          tokenEstimate: 8,
          content: "TASK013_MEMORY_DOCUMENT should be visible in admin inspector",
          checksum: "task013-memory-chunk",
          metadata: { runId, requestGroupId },
        },
      ],
    })
    insertMemoryEmbeddingIfMissing({
      chunkId: stored.chunkIds[0]!,
      provider: "test-provider",
      model: "test-model",
      dimensions: 2,
      textChecksum: "task013-memory-chunk",
      vector: Buffer.from([1, 2, 3, 4]),
    })
    recordMemoryAccessLog({
      runId,
      sessionId: sessionKey,
      requestGroupId,
      documentId: stored.documentId,
      chunkId: stored.chunkIds[0],
      sourceChecksum: "task013-memory-checksum",
      scope: "long-term",
      query: "TASK013_MEMORY_DOCUMENT sk-task013-secret-1234567890",
      resultSource: "fts",
      score: 0.95,
      latencyMs: 17,
      reason: "accepted_retrieval_candidate",
    })
    enqueueMemoryWritebackCandidate({
      scope: "long-term",
      ownerId: "global",
      sourceType: "conversation_summary",
      content: "TASK013_WRITEBACK_PENDING Bearer sk-task013-secret-1234567890",
      metadata: { requestGroupId },
      runId,
    })
    recordControlEvent({
      eventType: "memory.writeback.failed",
      component: "memory",
      runId,
      requestGroupId,
      sessionKey,
      severity: "warning",
      summary: "memory writeback retry required",
    })

    const contract = scheduleContract()
    insertSchedule({
      id: "schedule-task013",
      name: "TASK013 schedule",
      cron_expression: contract.time.cron ?? "*/5 * * * *",
      timezone: contract.time.timezone,
      prompt: "TASK013 scheduled delivery",
      enabled: 1,
      target_channel: "telegram",
      target_session_id: sessionKey,
      execution_driver: "internal",
      origin_run_id: runId,
      origin_request_group_id: requestGroupId,
      model: null,
      max_retries: 2,
      timeout_sec: 300,
      contract,
      created_at: Date.now(),
      updated_at: Date.now(),
    })
    insertScheduleRun({
      id: "schedule-run-task013",
      schedule_id: "schedule-task013",
      started_at: Date.now() - 2_000,
      finished_at: Date.now() - 1_000,
      success: 1,
      summary: "delivered",
      error: null,
      execution_success: 1,
      delivery_success: 1,
      delivery_dedupe_key: buildDeliveryKey(contract.delivery),
      delivery_error: null,
    })
    insertScheduleDeliveryReceipt({
      dedupe_key: "schedule-delivery-task013",
      schedule_id: "schedule-task013",
      schedule_run_id: "schedule-run-task013",
      due_at: new Date(Date.now() - 5_000).toISOString(),
      target_channel: "telegram",
      target_session_id: sessionKey,
      payload_hash: buildPayloadHash(contract.payload),
      delivery_status: "delivered",
      summary: "TASK013 delivered",
      error: null,
    })
    expect(buildScheduleIdentityKey(contract)).toBeTypeOf("string")
    expect(toCanonicalJson(contract)).toContain("TASK013")

    insertChannelMessageRef({
      source: "telegram",
      session_id: sessionKey,
      root_run_id: runId,
      request_group_id: requestGroupId,
      external_chat_id: "chat-task013",
      external_thread_id: "thread-task013",
      external_message_id: "message-task013",
      role: "user",
      created_at: Date.now(),
    })
    recordMessageLedgerEvent({
      runId,
      eventKind: "ingress_received",
      status: "received",
      summary: "telegram inbound",
      detail: { chatId: "chat-task013", userId: "user-task013", messageId: "message-task013" },
    })
    recordMessageLedgerEvent({
      runId,
      eventKind: "approval_requested",
      status: "pending",
      summary: "approval requested",
      detail: { approvalId: "approval-task013", callbackId: "callback-task013", buttonPayload: "approve_once", chatId: "chat-task013", userId: "user-task013" },
    })
    recordMessageLedgerEvent({
      runId,
      eventKind: "approval_received",
      status: "succeeded",
      summary: "approval received",
      detail: { approvalId: "approval-task013", callbackId: "callback-task013", buttonPayload: "approve_once", chatId: "chat-task013", userId: "user-task013" },
    })
    recordMessageLedgerEvent({
      runId,
      eventKind: "final_answer_delivered",
      status: "delivered",
      summary: "answer delivered",
      deliveryKey: "delivery-task013",
      idempotencyKey: "idem-task013",
      detail: { chatId: "chat-task013", threadId: "thread-task013", messageId: "answer-task013" },
    })

    const app = Fastify({ logger: false })
    registerAdminRoute(app)
    await app.ready()
    try {
      const response = await app.inject({ method: "GET", url: `/api/admin/runtime-inspectors?requestGroupId=${encodeURIComponent(requestGroupId)}&limit=100` })
      expect(response.statusCode).toBe(200)
      const body = response.json()

      expect(body.memory.summary.documents).toBeGreaterThanOrEqual(1)
      expect(body.memory.summary.writebackPending).toBe(1)
      expect(body.memory.summary.retrievalTraces).toBe(1)
      expect(body.memory.summary.linkedFailures).toBe(1)
      expect(body.memory.documents.items[0]).toEqual(expect.objectContaining({
        id: stored.documentId,
        ownerKind: "user",
        ftsStatus: "available",
        vectorStatus: "available",
        requestGroupId,
      }))
      expect(JSON.stringify(body.memory)).not.toMatch(/sk-task013-secret|Bearer sk-/i)

      const schedule = body.scheduler.schedules.find((item: any) => item.id === "schedule-task013")
      expect(schedule).toEqual(expect.objectContaining({
        queueState: "idle",
        contract: expect.objectContaining({
          hasContract: true,
          payloadKind: "literal_message",
          deliveryChannel: "telegram",
          missedPolicy: "catch_up_once",
        }),
      }))
      expect(schedule.receipts[0]).toEqual(expect.objectContaining({ dedupeKey: "schedule-delivery-task013", status: "delivered" }))
      expect(body.scheduler.fieldChecks).toEqual(expect.objectContaining({
        comparisonMode: "contract_fields",
        naturalLanguageMatchingAllowed: false,
      }))

      const telegram = body.channels.mappings.find((item: any) => item.channel === "telegram")
      expect(telegram).toEqual(expect.objectContaining({
        inboundCount: expect.any(Number),
        outboundCount: expect.any(Number),
        approvalCount: 2,
        receiptCount: expect.any(Number),
      }))
      expect(body.channels.ledgerReceipts.some((item: any) => item.deliveryKey === "delivery-task013" && item.chatId === "chat-task013")).toBe(true)
      expect(body.channels.approvalCallbacks.some((item: any) => item.approvalId === "approval-task013" && item.buttonPayload === "approve_once")).toBe(true)
    } finally {
      await app.close()
    }
  })
})
