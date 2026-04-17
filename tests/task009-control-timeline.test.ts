import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { reloadConfig } from "../packages/core/src/config/index.js"
import { closeDb, getDb, insertSession, listControlEvents } from "../packages/core/src/db/index.js"
import { eventBus } from "../packages/core/src/events/index.js"
import {
  exportControlTimeline,
  getControlTimeline,
  installControlEventProjection,
  recordControlEvent,
  resetControlEventProjectionForTest,
} from "../packages/core/src/control-plane/timeline.js"
import { runDoctor } from "../packages/core/src/diagnostics/doctor.js"
import { recordMessageLedgerEvent } from "../packages/core/src/runs/message-ledger.js"
import { createRootRun } from "../packages/core/src/runs/store.js"

const previousStateDir = process.env["NOBIE_STATE_DIR"]
const previousConfig = process.env["NOBIE_CONFIG"]
const tempDirs: string[] = []

function useTempConfig(): void {
  closeDb()
  resetControlEventProjectionForTest()
  const stateDir = mkdtempSync(join(tmpdir(), "nobie-task009-control-"))
  tempDirs.push(stateDir)
  const configPath = join(stateDir, "config.json5")
  writeFileSync(configPath, `{
    ai: { connection: { provider: "ollama", endpoint: "http://127.0.0.1:11434", model: "llama3.2" } },
    webui: { enabled: true, host: "127.0.0.1", port: 18181, auth: { enabled: false } },
    security: { approvalMode: "off" },
    memory: { searchMode: "fts", sessionRetentionDays: 30 },
    scheduler: { enabled: false, timezone: "Asia/Seoul" }
  }`, "utf-8")
  process.env["NOBIE_STATE_DIR"] = stateDir
  process.env["NOBIE_CONFIG"] = configPath
  reloadConfig()
}

function createTestRun(id = "run-control-1") {
  insertSession({
    id: "session-control",
    source: "webui",
    source_id: null,
    created_at: Date.now(),
    updated_at: Date.now(),
    summary: null,
  })
  return createRootRun({
    id,
    sessionId: "session-control",
    requestGroupId: "request-control",
    prompt: "control timeline test",
    source: "webui",
  })
}

beforeEach(() => {
  useTempConfig()
})

afterEach(() => {
  resetControlEventProjectionForTest()
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

describe("task009 control-plane timeline", () => {
  it("stores control events as append-only rows and lists them by request group", () => {
    const table = getDb()
      .prepare<[], { name: string }>("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'control_events'")
      .get()

    const first = recordControlEvent({
      eventType: "channel.ingress",
      component: "channel:telegram",
      requestGroupId: "request-append",
      correlationId: "corr-append",
      severity: "info",
      summary: "telegram ingress",
    })
    const second = recordControlEvent({
      eventType: "channel.ingress",
      component: "channel:telegram",
      requestGroupId: "request-append",
      correlationId: "corr-append",
      severity: "info",
      summary: "telegram ingress retry",
    })
    const rows = listControlEvents({ requestGroupId: "request-append" })

    expect(table?.name).toBe("control_events")
    expect(first).toEqual(expect.any(String))
    expect(second).toEqual(expect.any(String))
    expect(first).not.toBe(second)
    expect(rows.map((row) => row.event_type)).toEqual(["channel.ingress", "channel.ingress"])
  })

  it("projects gateway, channel, run, tool, yeonjang, and doctor events without blocking the run", () => {
    installControlEventProjection()
    eventBus.emit("gateway.started", { host: "127.0.0.1", port: 19191 })
    eventBus.emit("channel.connected", { channel: "webui", sessionId: "session-control", detail: { transport: "http" } })
    eventBus.emit("message.inbound", { source: "webui", sessionId: "session-control", content: "hello", userId: "user-1" })

    const run = createTestRun("run-projection")
    eventBus.emit("tool.before", { sessionId: run.sessionId, runId: run.id, toolName: "web_search", params: { q: "동천동 날씨" } })
    eventBus.emit("tool.after", { sessionId: run.sessionId, runId: run.id, toolName: "web_search", success: true, durationMs: 42 })
    eventBus.emit("approval.request", { approvalId: "approval-1", runId: run.id, toolName: "screen_capture", params: {}, resolve: () => undefined })
    eventBus.emit("yeonjang.heartbeat", { extensionId: "yeonjang-main", state: "offline", message: "mqtt disconnected", lastSeenAt: Date.now(), methodCount: 12 })
    const doctor = runDoctor({ mode: "quick", includeEnvironment: false, includeReleasePackage: false })

    const rows = listControlEvents({ limit: 100 }).map((row) => row.event_type)

    expect(doctor.kind).toBe("nobie.doctor.report")
    expect(rows).toEqual(expect.arrayContaining([
      "gateway.started",
      "channel.connected",
      "channel.ingress",
      "run.created",
      "tool.dispatched",
      "tool.completed",
      "approval.requested",
      "yeonjang.heartbeat",
      "doctor.checked",
    ]))
  })

  it("keeps projection failures diagnostic-only", () => {
    getDb().exec("DROP TABLE control_events")

    expect(() => recordControlEvent({
      eventType: "tool.dispatched",
      component: "tool",
      correlationId: "corr-fail",
      summary: "projection should not throw",
    })).not.toThrow()

    const diagnostic = getDb()
      .prepare<[], { kind: string; summary: string }>("SELECT kind, summary FROM diagnostic_events ORDER BY created_at DESC LIMIT 1")
      .get()

    expect(diagnostic?.kind).toBe("control_event_projection_degraded")
    expect(diagnostic?.summary).toContain("control event projection failed")
  })

  it("reconstructs duplicate tool, answer, delivery, and recovery events", () => {
    const run = createTestRun("run-duplicates")

    for (const eventType of ["tool.dispatched", "tool.dispatched"] as const) {
      recordControlEvent({
        eventType,
        component: "tool",
        runId: run.id,
        summary: "web_search dispatched",
        detail: { toolName: "web_search", paramsHash: "same-query" },
      })
    }
    recordControlEvent({ eventType: "completion.generated", component: "finalizer", runId: run.id, summary: "answer 1" })
    recordControlEvent({ eventType: "completion.generated", component: "finalizer", runId: run.id, summary: "answer 2" })
    recordMessageLedgerEvent({ runId: run.id, channel: "telegram", eventKind: "text_delivery_failed", deliveryKey: "telegram:text:1", status: "failed", summary: "delivery failed" })
    recordMessageLedgerEvent({ runId: run.id, channel: "telegram", eventKind: "text_delivery_failed", deliveryKey: "telegram:text:1", status: "failed", summary: "delivery failed again" })
    recordControlEvent({ eventType: "recovery.stopped", component: "recovery", runId: run.id, summary: "recovery stopped", detail: { recoveryKey: "recovery:same" } })
    recordControlEvent({ eventType: "recovery.stopped", component: "recovery", runId: run.id, summary: "recovery stopped again", detail: { recoveryKey: "recovery:same" } })

    const timeline = getControlTimeline({ requestGroupId: run.requestGroupId })
    const duplicateKinds = timeline.events.map((event) => event.duplicate?.kind).filter(Boolean)

    expect(timeline.summary.duplicateToolCount).toBe(1)
    expect(timeline.summary.duplicateAnswerCount).toBe(1)
    expect(timeline.summary.deliveryRetryCount).toBe(1)
    expect(timeline.summary.recoveryReentryCount).toBe(1)
    expect(duplicateKinds).toEqual(expect.arrayContaining(["tool", "answer", "delivery", "recovery"]))
  })

  it("separates user and developer exports while auditing export actions", () => {
    recordControlEvent({
      eventType: "recovery.stopped",
      component: "recovery",
      requestGroupId: "request-export",
      correlationId: "corr-export",
      severity: "warning",
      summary: "provider returned <html><body>403</body></html>",
      detail: {
        recoveryKey: "ai:openai:chatgpt-oauth:403",
        localPath: "/Users/dongwooshin/.nobie/secrets/report.json",
        accessToken: "Bearer sk-secret-token-value",
        providerRawResponse: "<html><body>403 forbidden</body></html>",
      },
    })

    const userExport = exportControlTimeline({ requestGroupId: "request-export", audience: "user", format: "json" })
    const developerExport = exportControlTimeline({ requestGroupId: "request-export", audience: "developer", format: "json" })
    const userSerialized = JSON.stringify(userExport)
    const developerSerialized = JSON.stringify(developerExport)
    const auditRows = getDb()
      .prepare<[], { tool_name: string }>("SELECT tool_name FROM audit_logs WHERE source = 'control-plane' ORDER BY timestamp ASC")
      .all()
      .map((row) => row.tool_name)

    expect(userSerialized).not.toContain("/Users/dongwooshin")
    expect(userSerialized).not.toContain("sk-secret-token-value")
    expect(userSerialized).not.toContain("<html>")
    expect(developerSerialized).toContain("ai:openai:chatgpt-oauth:403")
    expect(developerSerialized).not.toContain("sk-secret-token-value")
    expect(auditRows).toEqual(expect.arrayContaining(["control_timeline_user_export", "control_timeline_developer_export"]))
  })
})
