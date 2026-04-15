import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { closeDb, getDb, getSchedule, getScheduleRuns, insertSchedule } from "../packages/core/src/db/index.js"
import { reloadConfig } from "../packages/core/src/config/index.js"
import { storeMemory } from "../packages/core/src/memory/store.ts"
import { searchMemoryChunks } from "../packages/core/src/memory/search.ts"
import { createDefaultScheduleActionDependencies } from "../packages/core/src/runs/action-execution.ts"
import { getNextRunForTimezone, getNextRunInTimezone } from "../packages/core/src/scheduler/cron.ts"
import { computeScheduleRetryDelayMs, normalizeScheduleMaxRetries } from "../packages/core/src/scheduler/retry.ts"
import { runScheduleAndWait } from "../packages/core/src/scheduler/index.ts"
import { resolveScheduleTickDirective } from "../packages/core/src/scheduler/tick-policy.ts"
import { buildScheduleMemoryContext } from "../packages/core/src/schedules/context.ts"

const tempDirs: string[] = []
const previousStateDir = process.env["NOBIE_STATE_DIR"]
const previousConfig = process.env["NOBIE_CONFIG"]

function useTempState(): void {
  closeDb()
  const stateDir = mkdtempSync(join(tmpdir(), "nobie-task007-schedule-"))
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

describe("task007 schedule stability", () => {
  it("calculates next runs using the schedule timezone, including non-DST and DST fixtures", () => {
    expect(getNextRunInTimezone(
      "0 9 * * *",
      new Date("2026-04-12T23:59:00.000Z"),
      "Asia/Seoul",
    ).toISOString()).toBe("2026-04-13T00:00:00.000Z")

    expect(getNextRunInTimezone(
      "0 9 * * *",
      new Date("2026-04-13T08:59:00.000Z"),
      "UTC",
    ).toISOString()).toBe("2026-04-13T09:00:00.000Z")

    expect(getNextRunInTimezone(
      "30 2 * * *",
      new Date("2026-03-08T06:59:00.000Z"),
      "America/New_York",
    ).toISOString()).toBe("2026-03-09T06:30:00.000Z")
  })

  it("uses timezone-aware due checks and still skips disabled schedules", () => {
    const due = resolveScheduleTickDirective({
      schedule: {
        id: "schedule-kst",
        name: "KST 아침 보고",
        enabled: 1,
        execution_driver: "internal",
        cron_expression: "0 9 * * *",
        timezone: "Asia/Seoul",
        created_at: Date.parse("2026-04-12T23:58:00.000Z"),
        last_run_at: null,
      },
      nowMs: Date.parse("2026-04-13T00:00:10.000Z"),
      queueActive: false,
      isValidCron: () => true,
      getNextRun: getNextRunForTimezone,
    })

    expect(due).toEqual({
      kind: "run",
      dueAtMs: Date.parse("2026-04-13T00:00:00.000Z"),
      trigger: "scheduler tick (due: 2026-04-13T00:00:00.000Z)",
    })

    const disabled = resolveScheduleTickDirective({
      schedule: {
        id: "schedule-cancelled",
        name: "취소된 예약",
        enabled: 0,
        execution_driver: "internal",
        cron_expression: "0 9 * * *",
        timezone: "Asia/Seoul",
        created_at: Date.parse("2026-04-12T23:58:00.000Z"),
        last_run_at: null,
      },
      nowMs: Date.parse("2026-04-13T00:00:10.000Z"),
      queueActive: false,
      isValidCron: () => true,
      getNextRun: getNextRunForTimezone,
    })

    expect(disabled).toEqual({ kind: "skip", reason: "disabled" })
  })

  it("stores recurring schedule timezone and exposes it in schedule memory context", () => {
    const dependencies = createDefaultScheduleActionDependencies({ scheduleDelayedRun: vi.fn() })
    const created = dependencies.createRecurringSchedule({
      title: "TASK007 KST 보고",
      task: "TASK007_TIMEZONE_PAYLOAD",
      cron: "0 9 * * *",
      timezone: "Asia/Seoul",
      source: "slack",
      sessionId: "slack-session-task007",
      originRunId: "run-task007",
      originRequestGroupId: "group-task007",
      model: "gpt-5",
    })

    expect(getSchedule(created.scheduleId)?.timezone).toBe("Asia/Seoul")
    const context = buildScheduleMemoryContext({ scheduleId: created.scheduleId, maxRuns: 0 })
    expect(context).toContain("TASK007 KST 보고")
    expect(context).toContain("TASK007_TIMEZONE_PAYLOAD")
    expect(context).toContain("시간대: Asia/Seoul")
  })

  it("completes direct agent notification schedules without re-entering the agent loop", async () => {
    const now = Date.parse("2026-04-15T00:00:00.000Z")
    insertSchedule({
      id: "schedule-direct-agent-task007",
      name: "TASK007 직접 알림",
      cron_expression: "* * * * *",
      timezone: "Asia/Seoul",
      prompt: "매 1분마다 사용자에게 '알림' 메시지로 알려주기",
      enabled: 1,
      target_channel: "agent",
      target_session_id: null,
      execution_driver: "internal",
      origin_run_id: "run-origin-task007",
      origin_request_group_id: "group-origin-task007",
      model: null,
      max_retries: 0,
      timeout_sec: 300,
      created_at: now,
      updated_at: now,
    })

    await runScheduleAndWait("schedule-direct-agent-task007", "manual")

    const [run] = getScheduleRuns("schedule-direct-agent-task007", 1, 0)
    expect(run).toMatchObject({
      schedule_id: "schedule-direct-agent-task007",
      success: 1,
      summary: "알림",
      error: null,
    })
    const messageCount = getDb()
      .prepare<[], { n: number }>("SELECT COUNT(*) AS n FROM messages WHERE session_id LIKE 'schedule:%'")
      .get()?.n ?? 0
    expect(messageCount).toBe(0)

    const legacyAuditCount = getDb()
      .prepare<[], { n: number }>("SELECT COUNT(*) AS n FROM audit_logs WHERE tool_name = 'legacy_schedule_contract_missing'")
      .get()?.n ?? 0
    expect(legacyAuditCount).toBe(1)
  })

  it("applies scheduleId retry budget and exponential backoff", () => {
    expect(normalizeScheduleMaxRetries(null)).toBe(3)
    expect(normalizeScheduleMaxRetries(-5)).toBe(0)
    expect(normalizeScheduleMaxRetries(99)).toBe(10)
    expect(computeScheduleRetryDelayMs(1, { baseDelayMs: 100, maxDelayMs: 1_000 })).toBe(100)
    expect(computeScheduleRetryDelayMs(2, { baseDelayMs: 100, maxDelayMs: 1_000 })).toBe(200)
    expect(computeScheduleRetryDelayMs(9, { baseDelayMs: 100, maxDelayMs: 1_000 })).toBe(1_000)
  })

  it("keeps schedule memory out of normal chat retrieval unless the schedule scope is requested", async () => {
    await storeMemory({
      content: "TASK007_SCOPE_PAYLOAD",
      scope: "schedule",
      scheduleId: "schedule-scope-task007",
      requestGroupId: "schedule-scope-task007",
      type: "project_note",
    })

    const normal = await searchMemoryChunks("TASK007_SCOPE_PAYLOAD", 5, "fts", { sessionId: "chat-session" })
    expect(normal.map((item) => item.chunk.content)).not.toContain("TASK007_SCOPE_PAYLOAD")

    const scoped = await searchMemoryChunks("TASK007_SCOPE_PAYLOAD", 5, "fts", {
      includeSchedule: true,
      scheduleId: "schedule-scope-task007",
    })
    expect(scoped.map((item) => item.chunk.content)).toContain("TASK007_SCOPE_PAYLOAD")
  })
})
