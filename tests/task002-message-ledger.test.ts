import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { reloadConfig } from "../packages/core/src/config/index.js"
import { listAuditEvents } from "../packages/core/src/api/routes/audit.js"
import { closeDb, getDb, insertSession, listMessageLedgerEvents } from "../packages/core/src/db/index.js"
import {
  findDuplicateToolCall,
  recordMessageLedgerEvent,
} from "../packages/core/src/runs/message-ledger.js"
import { createRootRun, getRootRun, updateRunStatus } from "../packages/core/src/runs/store.js"
import { ToolDispatcher } from "../packages/core/src/tools/dispatcher.js"

const previousStateDir = process.env["NOBIE_STATE_DIR"]
const previousConfig = process.env["NOBIE_CONFIG"]
const tempDirs: string[] = []

function useTempConfig(): void {
  closeDb()
  const stateDir = mkdtempSync(join(tmpdir(), "nobie-task002-ledger-"))
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

function createTestRun(id = "run-ledger-1") {
  insertSession({
    id: "session-ledger",
    source: "webui",
    source_id: null,
    created_at: Date.now(),
    updated_at: Date.now(),
    summary: null,
  })
  return createRootRun({
    id,
    sessionId: "session-ledger",
    prompt: "ledger 테스트",
    source: "webui",
  })
}

beforeEach(() => {
  useTempConfig()
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

describe("task002 message ledger and delivery finalizer", () => {
  it("creates and reconstructs message ledger events without leaking secrets", () => {
    const run = createTestRun()
    recordMessageLedgerEvent({
      runId: run.id,
      eventKind: "tool_started",
      idempotencyKey: "ledger-test-secret-redaction",
      status: "started",
      summary: "secret redaction test",
      detail: { apiKey: "sk-secret", nested: { token: "xoxb-secret", visible: "ok" } },
    })

    const table = getDb()
      .prepare<[], { name: string }>("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'message_ledger'")
      .get()
    const events = listMessageLedgerEvents({ requestGroupId: run.requestGroupId })
    const auditEvents = listAuditEvents({ requestGroupId: run.requestGroupId, kind: "message_ledger" }).items
    const serialized = JSON.stringify(events)

    expect(table?.name).toBe("message_ledger")
    expect(events.map((event) => event.event_kind)).toEqual(expect.arrayContaining(["ingress_received", "tool_started"]))
    expect(auditEvents.map((event) => event.kind)).toContain("message_ledger")
    expect(serialized).toContain("[redacted]")
    expect(serialized).not.toContain("sk-secret")
    expect(serialized).not.toContain("xoxb-secret")
  })

  it("keeps a run completed when a later failure happens after text delivery", () => {
    const run = createTestRun("run-finalizer")
    recordMessageLedgerEvent({
      runId: run.id,
      eventKind: "final_answer_generated",
      status: "generated",
      summary: "final answer generated",
    })
    recordMessageLedgerEvent({
      runId: run.id,
      channel: "telegram",
      eventKind: "text_delivered",
      deliveryKey: "text:telegram:test",
      status: "delivered",
      summary: "text delivered",
    })
    recordMessageLedgerEvent({
      runId: run.id,
      channel: "telegram",
      eventKind: "artifact_delivery_failed",
      deliveryKey: "artifact:telegram:test",
      status: "failed",
      summary: "artifact failed",
    })

    const updated = updateRunStatus(run.id, "failed", "messenger fallback failed", false)
    const events = listMessageLedgerEvents({ requestGroupId: run.requestGroupId })

    expect(updated?.status).toBe("completed")
    expect(updated?.summary).toContain("이미 전달")
    expect(events.some((event) => event.event_kind === "delivery_finalized" && event.status === "degraded")).toBe(true)
  })

  it("suppresses duplicate tool calls in the same request group unless repeat is explicit", async () => {
    const run = createTestRun("run-dedupe")
    const dispatcher = new ToolDispatcher()
    let executionCount = 0
    dispatcher.register({
      name: "web_fetch",
      description: "test fetch",
      parameters: { type: "object", properties: {} },
      riskLevel: "safe",
      requiresApproval: false,
      async execute() {
        executionCount += 1
        return { success: true, output: `fetch-${executionCount}` }
      },
    })
    const ctx = {
      sessionId: run.sessionId,
      runId: run.id,
      requestGroupId: run.requestGroupId,
      workDir: process.cwd(),
      userMessage: "fetch once",
      source: "webui" as const,
      allowWebAccess: true,
      onProgress: () => undefined,
      signal: new AbortController().signal,
    }

    const first = await dispatcher.dispatch("web_fetch", { url: "https://example.test/a" }, ctx)
    const duplicate = await dispatcher.dispatch("web_fetch", { url: "https://example.test/a" }, ctx)
    const repeated = await dispatcher.dispatch("web_fetch", { url: "https://example.test/a", allowRepeatReason: "pagination" }, ctx)
    const events = listMessageLedgerEvents({ requestGroupId: run.requestGroupId })
    const duplicateEvent = findDuplicateToolCall({
      runId: run.id,
      requestGroupId: run.requestGroupId,
      toolName: "web_fetch",
      params: { url: "https://example.test/a" },
    })

    expect(first.output).toBe("fetch-1")
    expect(duplicate.success).toBe(true)
    expect(duplicate.output).toContain("중복 호출")
    expect(repeated.output).toBe("fetch-2")
    expect(executionCount).toBe(2)
    expect(duplicateEvent?.event_kind).toMatch(/tool_(started|done)/)
    expect(events.some((event) => event.event_kind === "tool_skipped" && event.status === "skipped")).toBe(true)
    expect(getRootRun(run.id)?.status).toBe("queued")
  })
})
