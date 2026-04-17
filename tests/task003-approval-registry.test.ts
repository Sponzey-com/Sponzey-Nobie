import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { reloadConfig } from "../packages/core/src/config/index.js"
import { closeDb, getDb, insertSession } from "../packages/core/src/db/index.js"
import { eventBus } from "../packages/core/src/events/index.js"
import {
  consumeApprovalRegistryDecision,
  createApprovalRegistryRequest,
  getApprovalRegistryRow,
  resolveApprovalRegistryDecision,
} from "../packages/core/src/runs/approval-registry.ts"
import { createRootRun } from "../packages/core/src/runs/store.js"
import { ToolDispatcher } from "../packages/core/src/tools/dispatcher.ts"

const previousStateDir = process.env["NOBIE_STATE_DIR"]
const previousConfig = process.env["NOBIE_CONFIG"]
const tempDirs: string[] = []

function useTempConfig(): void {
  closeDb()
  const stateDir = mkdtempSync(join(tmpdir(), "nobie-task003-approval-"))
  tempDirs.push(stateDir)
  const configPath = join(stateDir, "config.json5")
  writeFileSync(configPath, `{
    security: {
      approvalMode: "always",
      approvalTimeout: 60,
      approvalTimeoutFallback: "deny"
    },
    webui: { enabled: true, host: "127.0.0.1", port: 0, auth: { enabled: false } }
  }`, "utf-8")
  process.env["NOBIE_STATE_DIR"] = stateDir
  process.env["NOBIE_CONFIG"] = configPath
  reloadConfig()
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

describe("task003 approval registry", () => {
  it("stores approval lifecycle and prevents consumed approval reuse", () => {
    const approval = createApprovalRegistryRequest({
      id: "approval-once",
      runId: "run-approval-once",
      requestGroupId: "group-approval-once",
      channel: "webui",
      toolName: "file_write",
      riskLevel: "moderate",
      kind: "approval",
      params: { path: "memo.txt", content: "hello" },
      expiresAt: Date.now() + 60_000,
    })

    expect(approval.status).toBe("requested")

    const decided = resolveApprovalRegistryDecision({
      approvalId: approval.id,
      decision: "allow_once",
      decisionBy: "tester",
      decisionSource: "webui",
    })
    expect(decided).toMatchObject({ accepted: true, status: "approved_once", decision: "allow_once" })

    const consumed = consumeApprovalRegistryDecision(approval.id)
    expect(consumed).toMatchObject({ accepted: true, status: "consumed", decision: "allow_once" })

    const reused = consumeApprovalRegistryDecision(approval.id)
    expect(reused).toMatchObject({ accepted: false, status: "consumed", reason: "already_consumed" })
  })

  it("keeps timeout distinct from user denial and rejects late approval", () => {
    const approval = createApprovalRegistryRequest({
      id: "approval-expired",
      runId: "run-expired",
      channel: "telegram",
      toolName: "screen_capture",
      riskLevel: "safe",
      kind: "approval",
      params: { extensionId: "yeonjang-main" },
      expiresAt: Date.now() - 1,
    })

    const late = resolveApprovalRegistryDecision({
      approvalId: approval.id,
      decision: "allow_once",
      decisionBy: "tester",
      decisionSource: "telegram",
    })

    expect(late).toMatchObject({ accepted: false, status: "expired", reason: "late" })
    expect(getApprovalRegistryRow(approval.id)?.status).toBe("expired")
    expect(getApprovalRegistryRow(approval.id)?.decision_source).toBe("timeout")
  })

  it("supersedes previous requested approval for the same run and tool", () => {
    const first = createApprovalRegistryRequest({
      id: "approval-first",
      runId: "run-supersede",
      channel: "slack",
      toolName: "shell_exec",
      riskLevel: "dangerous",
      kind: "approval",
      params: { command: "date" },
    })
    const second = createApprovalRegistryRequest({
      id: "approval-second",
      runId: "run-supersede",
      channel: "slack",
      toolName: "shell_exec",
      riskLevel: "dangerous",
      kind: "approval",
      params: { command: "pwd" },
    })

    expect(getApprovalRegistryRow(first.id)).toMatchObject({ status: "superseded", superseded_by: second.id })
    expect(getApprovalRegistryRow(second.id)?.status).toBe("requested")
  })

  it("requires a consumed registry decision before executing an approval-required tool", async () => {
    insertSession({
      id: "session-dispatch-approval",
      source: "webui",
      source_id: null,
      created_at: Date.now(),
      updated_at: Date.now(),
      summary: null,
    })
    createRootRun({
      id: "run-dispatch-approval",
      sessionId: "session-dispatch-approval",
      prompt: "write a file",
      source: "webui",
    })

    const dispatcher = new ToolDispatcher()
    const execute = vi.fn(async () => ({ success: true, output: "executed" }))
    dispatcher.register({
      name: "file_write",
      description: "requires approval",
      parameters: { type: "object", properties: {} },
      riskLevel: "moderate",
      requiresApproval: true,
      execute,
    })

    const off = eventBus.on("approval.request", ({ approvalId, resolve }) => {
      expect(approvalId).toMatch(/^[0-9a-f-]{36}$/)
      resolve("allow_once", "user")
    })

    const result = await dispatcher.dispatch(
      "file_write",
      { path: "memo.txt", content: "hello" },
      {
        sessionId: "session-dispatch-approval",
        runId: "run-dispatch-approval",
        requestGroupId: "run-dispatch-approval",
        workDir: process.cwd(),
        userMessage: "write a file",
        source: "webui",
        allowWebAccess: false,
        onProgress: () => undefined,
        signal: new AbortController().signal,
      },
    )
    off()

    expect(result).toMatchObject({ success: true, output: "executed" })
    expect(execute).toHaveBeenCalledTimes(1)
    const row = getDb().prepare<[], { status: string }>("SELECT status FROM approval_registry WHERE run_id = 'run-dispatch-approval'").get()
    expect(row?.status).toBe("consumed")
  })
})
