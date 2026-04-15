import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { listAuditEvents } from "../packages/core/src/api/routes/audit.ts"
import { reloadConfig } from "../packages/core/src/config/index.js"
import { closeDb, insertAuditLog, insertDiagnosticEvent, insertSession } from "../packages/core/src/db/index.js"
import { appendRunEvent, createRootRun } from "../packages/core/src/runs/store.ts"

const previousStateDir = process.env["NOBIE_STATE_DIR"]
const previousConfig = process.env["NOBIE_CONFIG"]
const tempDirs: string[] = []

function useTempState(): void {
  closeDb()
  const stateDir = mkdtempSync(join(tmpdir(), "nobie-audit-route-"))
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

describe("audit route", () => {
  it("returns a run-linked sanitized operational timeline", async () => {
    insertSession({
      id: "session-audit",
      source: "slack",
      source_id: "channel-a",
      created_at: 1_000,
      updated_at: 1_000,
      summary: null,
    })
    createRootRun({ id: "run-audit", sessionId: "session-audit", requestGroupId: "group-audit", prompt: "capture", source: "slack" })
    appendRunEvent("run-audit", "screen_capture 승인 요청")
    insertAuditLog({
      timestamp: 2_000,
      session_id: "session-audit",
      run_id: "run-audit",
      request_group_id: "group-audit",
      channel: "slack",
      source: "agent",
      tool_name: "screen_capture",
      params: JSON.stringify({ display: 1, accessToken: "secret-token" }),
      output: "<!doctype html><html><script>secret</script><body>403 Forbidden</body></html>",
      result: "failed",
      duration_ms: 42,
      approval_required: 1,
      approved_by: "user:allow_once",
      error_code: "Bearer abc.def.ghi",
      retry_count: 1,
      stop_reason: "raw token secret-token",
    })
    insertDiagnosticEvent({
      kind: "provider_auth_failed",
      summary: "모델 호출 실패",
      runId: "run-audit",
      sessionId: "session-audit",
      requestGroupId: "group-audit",
      detail: { refreshToken: "hidden-refresh-token", hint: "oauth" },
    })

    const body = listAuditEvents({ requestGroupId: "group-audit", limit: "20" }) as { items: Array<{ kind: string; runId: string | null; requestGroupId: string | null; params: unknown; output: string | null; errorCode: string | null }> }
    expect(body.items.map((item) => item.kind)).toEqual(expect.arrayContaining(["tool_call", "diagnostic", "run_event"]))
    expect(body.items.every((item) => item.runId === "run-audit" || item.requestGroupId === "group-audit")).toBe(true)

    const serialized = JSON.stringify(body)
    expect(serialized).not.toContain("secret-token")
    expect(serialized).not.toContain("hidden-refresh-token")
    expect(serialized).not.toContain("<html")
    expect(serialized).not.toContain("<script")
    expect(serialized).not.toContain("abc.def.ghi")

    const runBody = listAuditEvents({ runId: "run-audit", limit: "20" })
    expect(runBody.items.map((item) => item.summary).join("\n")).toContain("screen_capture")
  })
})
