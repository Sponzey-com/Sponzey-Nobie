import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { closeDb, getDb } from "../packages/core/src/db/index.js"
import { buildMemoryJournalContext, closeMemoryJournalDb, insertMemoryJournalRecord } from "../packages/core/src/memory/journal.js"
import { buildMemoryContext, storeMemoryDocument } from "../packages/core/src/memory/store.ts"
import { selectRequestGroupContextMessages } from "../packages/core/src/agent/request-group-context.ts"
import { rememberRunFailure, rememberRunSuccess } from "../packages/core/src/runs/start-support.ts"
import { reloadConfig } from "../packages/core/src/config/index.js"
import type { DbRequestGroupMessage } from "../packages/core/src/db/index.js"

const tempDirs: string[] = []
const previousStateDir = process.env["NOBIE_STATE_DIR"]
const previousConfig = process.env["NOBIE_CONFIG"]

function useTempState(): void {
  closeDb()
  closeMemoryJournalDb()
  const stateDir = mkdtempSync(join(tmpdir(), "nobie-memory-task003-"))
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
  closeMemoryJournalDb()
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

describe("task003 memory scope guard and prompt injection", () => {
  it("limits injected chunks and keeps diagnostic memory out unless explicitly requested", async () => {
    for (let index = 0; index < 6; index++) {
      await storeMemoryDocument({
        rawText: `anchor-global-memory-${index} ${"본문".repeat(300)}`,
        scope: "global",
        sourceType: "test",
      })
    }
    await storeMemoryDocument({
      rawText: "DIAGNOSTIC_ONLY anchor failure detail",
      scope: "diagnostic",
      ownerId: "group-a",
      sourceType: "test_failure",
    })

    const defaultContext = await buildMemoryContext({
      query: "anchor",
      sessionId: "session-a",
      requestGroupId: "group-a",
      runId: "run-a",
      budget: { maxChunks: 2, maxChars: 700, maxChunkChars: 160 },
    })
    const injectedLines = defaultContext.split("\n").filter((line) => line.startsWith("- ["))
    expect(injectedLines.length).toBeLessThanOrEqual(2)
    expect(defaultContext).not.toContain("DIAGNOSTIC_ONLY")
    expect(defaultContext.length).toBeLessThanOrEqual(760)

    const diagnosticContext = await buildMemoryContext({
      query: "DIAGNOSTIC_ONLY",
      sessionId: "session-a",
      requestGroupId: "group-a",
      runId: "run-a",
      includeDiagnostic: true,
      budget: { maxChunks: 2, maxChars: 700, maxChunkChars: 160 },
    })
    expect(diagnosticContext).toContain("DIAGNOSTIC_ONLY")
  })

  it("finds task journal handoff by request group while hiding other task scopes", () => {
    insertMemoryJournalRecord({
      kind: "instruction",
      scope: "task",
      content: "handoff-visible summary",
      summary: "handoff-visible summary",
      sessionId: "session-a",
      runId: "child-a",
      requestGroupId: "group-a",
      source: "webui",
    })
    insertMemoryJournalRecord({
      kind: "failure",
      scope: "task",
      content: "hidden-child failure",
      summary: "hidden-child failure",
      sessionId: "session-a",
      runId: "child-other",
      requestGroupId: "group-other",
      source: "webui",
    })

    const context = buildMemoryJournalContext("handoff-visible", {
      sessionId: "session-a",
      requestGroupId: "group-a",
      runId: "child-b",
    })
    const hidden = buildMemoryJournalContext("hidden-child", {
      sessionId: "session-a",
      requestGroupId: "group-a",
      runId: "child-b",
    })

    expect(context).toContain("handoff-visible")
    expect(hidden).not.toContain("hidden-child")
  })

  it("does not pass sibling child tool results through request-group context", () => {
    const messages: DbRequestGroupMessage[] = [
      createMessage({ id: "root-user", runId: "group-a", role: "user", content: "원 요청" }),
      createMessage({ id: "root-assistant", runId: "group-a", role: "assistant", content: "root summary" }),
      createMessage({ id: "child-a-tool", runId: "child-a", role: "user", content: "SIBLING_TOOL_RESULT", toolCalls: "[{\"type\":\"tool_result\",\"content\":\"SIBLING_TOOL_RESULT\"}]" }),
      createMessage({ id: "child-a-assistant", runId: "child-a", role: "assistant", content: "child private result" }),
    ]

    const selected = selectRequestGroupContextMessages(messages)
    expect(selected.map((message) => message.id)).toEqual(["root-user", "root-assistant"])
    expect(selected.map((message) => message.content).join("\n")).not.toContain("SIBLING_TOOL_RESULT")
  })

  it("writes run completion candidates silently without promoting diagnostics to global memory", () => {
    rememberRunSuccess({
      runId: "run-success",
      sessionId: "session-a",
      source: "webui",
      text: "성공 결과 본문",
      summary: "성공 요약",
    })
    rememberRunFailure({
      runId: "run-failure",
      sessionId: "session-a",
      source: "webui",
      summary: "실패 요약",
      detail: "상세 실패 원인",
      title: "test_failure",
    })

    const rows = getDb()
      .prepare<[], { scope: string; source_type: string }>(
        `SELECT scope, source_type FROM memory_writeback_queue ORDER BY created_at ASC`,
      )
      .all()
    const snapshot = getDb()
      .prepare<[string], { summary: string }>(`SELECT summary FROM session_snapshots WHERE session_id = ?`)
      .get("session-a")

    expect(rows).toEqual([
      { scope: "session", source_type: "success" },
      { scope: "diagnostic", source_type: "test_failure" },
    ])
    expect(snapshot?.summary).toBe("성공 요약")
  })
})

function createMessage(params: {
  id: string
  runId: string
  role: "user" | "assistant"
  content: string
  toolCalls?: string | null
}): DbRequestGroupMessage {
  return {
    id: params.id,
    session_id: "session-a",
    root_run_id: params.runId,
    role: params.role,
    content: params.content,
    tool_calls: params.toolCalls ?? null,
    tool_call_id: null,
    created_at: Date.now(),
    run_prompt: "원 요청",
    run_request_group_id: "group-a",
    run_worker_session_id: params.runId === "group-a" ? null : "worker-a",
    run_context_mode: params.runId === "group-a" ? "full" : "request_group",
  }
}
