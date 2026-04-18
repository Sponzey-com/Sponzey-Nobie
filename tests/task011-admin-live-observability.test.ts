import { createRequire } from "node:module"
import { mkdtempSync, rmSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { registerAdminRoute } from "../packages/core/src/api/routes/admin.ts"
import { reloadConfig } from "../packages/core/src/config/index.js"
import { recordControlEvent } from "../packages/core/src/control-plane/timeline.ts"
import { closeDb, insertSession } from "../packages/core/src/db/index.js"
import { eventBus } from "../packages/core/src/events/index.js"
import { recordMessageLedgerEvent } from "../packages/core/src/runs/message-ledger.ts"
import { createRootRun, updateRunStatus } from "../packages/core/src/runs/store.ts"

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
  const stateDir = mkdtempSync(join(tmpdir(), "nobie-admin-live-"))
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

function seedRun(): { runId: string; requestGroupId: string; sessionKey: string } {
  const now = Date.now()
  const runId = "run-task011-live"
  const requestGroupId = "group-task011-live"
  const sessionKey = "session-task011-live"
  insertSession({
    id: sessionKey,
    source: "telegram",
    source_id: "chat-task011",
    created_at: now,
    updated_at: now,
    summary: "task011 live test session",
  })
  createRootRun({
    id: runId,
    sessionId: sessionKey,
    requestGroupId,
    prompt: "메신저 전달 흐름을 추적해줘",
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

describe("task011 admin live observability", () => {
  it("emits sanitized control events for live subscribers", async () => {
    const received = new Promise<any>((resolve) => {
      eventBus.once("control.event", (payload) => resolve(payload))
    })

    recordControlEvent({
      eventType: "tool.failed",
      component: "tool.dispatcher",
      runId: "run-task011-stream",
      requestGroupId: "group-task011-stream",
      sessionKey: "session-task011-stream",
      severity: "warning",
      summary: "tool failed with Bearer sk-task011-secret-1234567890",
      detail: { apiKey: "sk-task011-api-secret-1234567890", nested: { token: "xoxb-task011-secret-1234567890" } },
    })

    const payload = await received
    expect(payload).toEqual(expect.objectContaining({
      eventType: "tool.failed",
      component: "tool.dispatcher",
      requestGroupId: "group-task011-stream",
      severity: "warning",
    }))
    expect(JSON.stringify(payload)).not.toMatch(/sk-task011|xoxb-task011|Bearer sk-/i)
  })

  it("returns timeline, run lifecycle, delivery ledger, duplicates, and stream health", async () => {
    const { runId, requestGroupId, sessionKey } = seedRun()
    recordControlEvent({ eventType: "tool.failed", component: "tool.web", runId, severity: "warning", summary: "web tool retry needed" })
    recordControlEvent({ eventType: "delivery.failed", component: "delivery.telegram", runId, severity: "error", summary: "telegram delivery failed" })
    recordControlEvent({ eventType: "recovery.stopped", component: "recovery", runId, severity: "warning", summary: "recovery path stopped" })
    recordMessageLedgerEvent({
      runId,
      eventKind: "text_delivery_failed",
      deliveryKey: "text:telegram:chat-task011:answer",
      idempotencyKey: "ledger-task011-delivery-failed",
      status: "failed",
      summary: "first delivery failed",
      detail: { channelTarget: "chat-task011" },
    })
    recordMessageLedgerEvent({
      runId,
      eventKind: "text_delivered",
      deliveryKey: "text:telegram:chat-task011:answer",
      idempotencyKey: "ledger-task011-delivered",
      status: "delivered",
      summary: "answer delivered later",
      detail: { channelTarget: "chat-task011" },
    })
    updateRunStatus(runId, "completed", "answer delivered after retry", false)

    const app = Fastify({ logger: false })
    registerAdminRoute(app)
    await app.ready()
    try {
      const response = await app.inject({ method: "GET", url: `/api/admin/live?requestGroupId=${encodeURIComponent(requestGroupId)}&limit=100` })
      expect(response.statusCode).toBe(200)
      const body = response.json()
      expect(body.stream.reconnect).toEqual(expect.objectContaining({ supported: true, eventType: "control.event" }))
      expect(body.stream.backpressure).toEqual(expect.objectContaining({ totalQueues: expect.any(Number), affectedQueues: expect.any(Number) }))
      expect(body.timeline.events.map((event: any) => event.eventType)).toEqual(expect.arrayContaining(["tool.failed", "delivery.failed", "recovery.stopped"]))
      expect(body.runsInspector.runs).toHaveLength(1)
      expect(body.runsInspector.runs[0]).toEqual(expect.objectContaining({
        id: runId,
        requestGroupId,
        sessionKey,
        status: "completed",
        failureReversal: true,
      }))
      expect(body.runsInspector.runs[0].lifecycle.map((stage: any) => stage.key)).toEqual(["ingress", "planning", "tool_call", "approval", "delivery", "recovery", "completion"])
      expect(body.runsInspector.runs[0].delivery).toEqual(expect.objectContaining({ status: "partial_success", failureReason: "first delivery failed" }))
      expect(body.messageLedger.duplicates).toEqual(expect.arrayContaining([
        expect.objectContaining({ kind: "delivery", key: "text:telegram:chat-task011:answer", count: 2 }),
      ]))
      expect(body.messageLedger.events.map((event: any) => event.channelTarget)).toContain("chat-task011")
      expect(body.messageLedger.summary).toEqual(expect.objectContaining({ delivered: 1, deliveryFailures: 1, duplicates: 1 }))
    } finally {
      await app.close()
    }
  })

  it("filters message ledger independently from run completion", async () => {
    const { runId, requestGroupId } = seedRun()
    recordMessageLedgerEvent({
      runId,
      eventKind: "artifact_delivery_failed",
      deliveryKey: "artifact:telegram:chat-task011:file",
      idempotencyKey: "ledger-task011-artifact-failed",
      status: "failed",
      summary: "artifact failed",
      detail: { channelTarget: "chat-task011" },
    })
    updateRunStatus(runId, "completed", "text response completed", false)

    const app = Fastify({ logger: false })
    registerAdminRoute(app)
    await app.ready()
    try {
      const response = await app.inject({ method: "GET", url: `/api/admin/live?requestGroupId=${encodeURIComponent(requestGroupId)}&status=failed&eventKind=artifact_delivery_failed` })
      expect(response.statusCode).toBe(200)
      const body = response.json()
      expect(body.runsInspector.runs[0]).toEqual(expect.objectContaining({ status: "completed" }))
      expect(body.runsInspector.runs[0].delivery).toEqual(expect.objectContaining({ status: "failed" }))
      expect(body.messageLedger.events).toHaveLength(1)
      expect(body.messageLedger.events[0]).toEqual(expect.objectContaining({ eventKind: "artifact_delivery_failed", status: "failed" }))
    } finally {
      await app.close()
    }
  })
})
