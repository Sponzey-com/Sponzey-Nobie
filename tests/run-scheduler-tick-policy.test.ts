import { describe, expect, it, vi } from "vitest"
import { resolveScheduleTickDirective } from "../packages/core/src/scheduler/tick-policy.ts"

describe("scheduler tick policy", () => {
  it("skips due schedules when the same schedule id is already queued", () => {
    const getNextRun = vi.fn()

    const result = resolveScheduleTickDirective({
      schedule: {
        id: "schedule-1",
        name: "아침 보고",
        enabled: 1,
        execution_driver: "internal",
        cron_expression: "* * * * *",
        timezone: null,
        created_at: Date.parse("2026-04-02T00:00:00.000Z"),
        last_run_at: null,
      },
      nowMs: Date.parse("2026-04-02T00:01:00.000Z"),
      queueActive: true,
      isValidCron: () => true,
      getNextRun,
    })

    expect(result).toEqual({ kind: "skip", reason: "queue_active" })
    expect(getNextRun).not.toHaveBeenCalled()
  })

  it("returns a scheduler tick trigger when the schedule is due and not queued", () => {
    const result = resolveScheduleTickDirective({
      schedule: {
        id: "schedule-1",
        name: "아침 보고",
        enabled: 1,
        execution_driver: "internal",
        cron_expression: "* * * * *",
        timezone: null,
        created_at: Date.parse("2026-04-02T00:00:00.000Z"),
        last_run_at: null,
      },
      nowMs: Date.parse("2026-04-02T00:01:10.000Z"),
      queueActive: false,
      isValidCron: () => true,
      getNextRun: () => new Date("2026-04-02T00:01:00.000Z"),
    })

    expect(result).toEqual({
      kind: "run",
      dueAtMs: Date.parse("2026-04-02T00:01:00.000Z"),
      trigger: "scheduler tick (due: 2026-04-02T00:01:00.000Z)",
    })
  })

  it("skips schedules that are not due yet", () => {
    const result = resolveScheduleTickDirective({
      schedule: {
        id: "schedule-1",
        name: "아침 보고",
        enabled: 1,
        execution_driver: "internal",
        cron_expression: "* * * * *",
        timezone: null,
        created_at: Date.parse("2026-04-02T00:00:00.000Z"),
        last_run_at: null,
      },
      nowMs: Date.parse("2026-04-02T00:00:10.000Z"),
      queueActive: false,
      isValidCron: () => true,
      getNextRun: () => new Date("2026-04-02T00:01:00.000Z"),
    })

    expect(result).toEqual({ kind: "skip", reason: "not_due" })
  })
})
