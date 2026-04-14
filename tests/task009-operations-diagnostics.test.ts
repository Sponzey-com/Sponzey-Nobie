import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { reloadConfig } from "../packages/core/src/config/index.js"
import { closeDb, getDb, insertSession } from "../packages/core/src/db/index.js"
import { buildOperationsSummary } from "../packages/core/src/runs/operations.ts"
import { cleanupStaleRunStates, createRootRun, deleteRunHistory, getRootRun, updateRunStatus } from "../packages/core/src/runs/store.ts"
import type { TaskModel } from "../packages/core/src/runs/task-model.ts"
import type { RootRun } from "../packages/core/src/runs/types.ts"

const previousStateDir = process.env["NOBIE_STATE_DIR"]
const previousConfig = process.env["NOBIE_CONFIG"]
const tempDirs: string[] = []

function useTempState(): void {
  closeDb()
  const stateDir = mkdtempSync(join(tmpdir(), "nobie-task009-ops-"))
  tempDirs.push(stateDir)
  process.env["NOBIE_STATE_DIR"] = stateDir
  delete process.env["NOBIE_CONFIG"]
  reloadConfig()
}

function seedSession(id: string): void {
  insertSession({
    id,
    source: "webui",
    source_id: null,
    created_at: Date.now(),
    updated_at: Date.now(),
    summary: null,
  })
}

function makeRun(overrides: Partial<RootRun> & Pick<RootRun, "id" | "requestGroupId" | "prompt">): RootRun {
  return {
    id: overrides.id,
    sessionId: overrides.sessionId ?? "session-ops",
    requestGroupId: overrides.requestGroupId,
    lineageRootRunId: overrides.lineageRootRunId ?? overrides.requestGroupId,
    runScope: overrides.runScope ?? "root",
    title: overrides.title ?? overrides.prompt,
    prompt: overrides.prompt,
    source: overrides.source ?? "webui",
    status: overrides.status ?? "completed",
    taskProfile: overrides.taskProfile ?? "general_chat",
    contextMode: overrides.contextMode ?? "full",
    delegationTurnCount: overrides.delegationTurnCount ?? 0,
    maxDelegationTurns: overrides.maxDelegationTurns ?? 5,
    currentStepKey: overrides.currentStepKey ?? "completed",
    currentStepIndex: overrides.currentStepIndex ?? 9,
    totalSteps: overrides.totalSteps ?? 9,
    summary: overrides.summary ?? overrides.prompt,
    canCancel: overrides.canCancel ?? false,
    createdAt: overrides.createdAt ?? 1,
    updatedAt: overrides.updatedAt ?? 1,
    steps: overrides.steps ?? [],
    recentEvents: overrides.recentEvents ?? [],
  }
}

function makeTask(overrides: Partial<TaskModel> & Pick<TaskModel, "id" | "requestGroupId" | "anchorRunId">): TaskModel {
  return {
    id: overrides.id,
    requestGroupId: overrides.requestGroupId,
    sessionId: overrides.sessionId ?? "session-ops",
    source: overrides.source ?? "webui",
    anchorRunId: overrides.anchorRunId,
    latestAttemptId: overrides.latestAttemptId ?? overrides.anchorRunId,
    runIds: overrides.runIds ?? [overrides.anchorRunId],
    title: overrides.title ?? "Task",
    requestText: overrides.requestText ?? "Task",
    summary: overrides.summary ?? "Task",
    status: overrides.status ?? "completed",
    canCancel: overrides.canCancel ?? false,
    createdAt: overrides.createdAt ?? 1,
    updatedAt: overrides.updatedAt ?? 1,
    attempts: overrides.attempts ?? [],
    recoveryAttempts: overrides.recoveryAttempts ?? [],
    delivery: overrides.delivery ?? { taskId: overrides.id, status: "not_requested" },
    ...(overrides.failure ? { failure: overrides.failure } : {}),
    checklist: overrides.checklist ?? {
      items: [],
      completedCount: 0,
      actionableCount: 0,
      failedCount: 0,
    },
    monitor: overrides.monitor ?? {
      activeAttemptCount: 0,
      runningAttemptCount: 0,
      queuedAttemptCount: 0,
      visibleAttemptCount: 1,
      internalAttemptCount: 0,
      recoveryAttemptCount: 0,
      activeRecoveryCount: 0,
      duplicateExecutionRisk: false,
      awaitingApproval: false,
      awaitingUser: false,
      deliveryStatus: "not_requested",
    },
    ...(overrides.continuity ? { continuity: overrides.continuity } : {}),
    ...(overrides.diagnostics ? { diagnostics: overrides.diagnostics } : {}),
    activities: overrides.activities ?? [],
  }
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

describe("task009 operations diagnostics", () => {
  it("summarizes health and repeated issues without exposing raw HTML errors", () => {
    const summary = buildOperationsSummary({
      now: 100,
      runs: [
        makeRun({
          id: "run-1",
          requestGroupId: "group-1",
          prompt: "weather",
          status: "failed",
          summary: "OpenAI failed: <html><body>403 Forbidden<script>secret</script></body></html>",
          updatedAt: 10,
          recentEvents: [
            { id: "evt-1", at: 11, label: "OpenAI failed: <html><body>403 Forbidden</body></html>" },
          ],
        }),
      ],
      tasks: [
        makeTask({
          id: "task-1",
          requestGroupId: "group-1",
          anchorRunId: "run-1",
          updatedAt: 12,
          diagnostics: {
            promptSourceIds: [],
            promptSources: [],
            latencyEvents: [],
            memoryEvents: ["memory vector degraded: stale_embedding checksum mismatch", "memory vector degraded: stale_embedding checksum mismatch"],
            toolEvents: ["screen_capture tool failed: timeout", "screen_capture tool failed: timeout"],
            deliveryEvents: ["telegram_send_file failed: 403", "telegram_send_file failed: 403"],
            recoveryEvents: [],
          },
        }),
      ],
    })

    expect(summary.health.vector.status).toBe("degraded")
    expect(summary.health.channel.status).toBe("degraded")
    expect(summary.repeatedIssues.map((issue) => issue.key)).toEqual(expect.arrayContaining(["provider:openai", "vector", "tool:screen_capture", "channel:telegram"]))
    expect(JSON.stringify(summary)).not.toContain("<html>")
    expect(JSON.stringify(summary)).not.toContain("<script>")
  })

  it("cleans only stale active runs, records audit diagnostics, and blocks active history deletion", () => {
    const now = 1_000_000
    seedSession("session-stale")
    createRootRun({ id: "run-approval", sessionId: "session-stale", requestGroupId: "group-approval", prompt: "approve", source: "webui" })
    createRootRun({ id: "run-fresh", sessionId: "session-stale", requestGroupId: "group-fresh", prompt: "fresh", source: "webui" })
    createRootRun({ id: "run-done", sessionId: "session-stale", requestGroupId: "group-done", prompt: "done", source: "webui" })
    updateRunStatus("run-approval", "awaiting_approval", "승인 대기", true)
    updateRunStatus("run-fresh", "running", "진행 중", true)
    updateRunStatus("run-done", "completed", "완료", false)
    getDb().prepare<[number, string]>("UPDATE root_runs SET updated_at = ? WHERE id = ?").run(now - 2_000_000, "run-approval")
    getDb().prepare<[number, string]>("UPDATE root_runs SET updated_at = ? WHERE id = ?").run(now - 10_000, "run-fresh")
    getDb().prepare<[number, string]>("UPDATE root_runs SET updated_at = ? WHERE id = ?").run(now - 2_000_000, "run-done")

    const cleanup = cleanupStaleRunStates({ now, staleMs: 1_800_000 })

    expect(cleanup).toMatchObject({ cleanedRunCount: 1, skippedRunCount: 0, cleanedRunIds: ["run-approval"] })
    expect(getRootRun("run-approval")?.status).toBe("interrupted")
    expect(getRootRun("run-fresh")?.status).toBe("running")
    expect(getRootRun("run-done")?.status).toBe("completed")
    expect(getDb().prepare<[], { count: number }>("SELECT count(*) AS count FROM diagnostic_events WHERE kind = 'stale_run_cleanup'").get()?.count).toBe(1)
    expect(getDb().prepare<[], { count: number }>("SELECT count(*) AS count FROM audit_logs WHERE tool_name = 'stale_run_cleanup'").get()?.count).toBe(1)

    const deleteActive = deleteRunHistory("run-fresh")
    expect(deleteActive).toMatchObject({ deletedRunCount: 0, blockedRunCount: 1 })
    expect(getRootRun("run-fresh")?.status).toBe("running")
  })
})
