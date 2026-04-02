import type { DbSchedule } from "../db/index.js"

type ScheduleTickSource = Pick<
  DbSchedule,
  "id" | "name" | "enabled" | "execution_driver" | "cron_expression" | "created_at" | "last_run_at"
>

export type ScheduleTickDirective =
  | { kind: "skip"; reason: "disabled" | "system_driver" | "invalid_cron" | "queue_active" | "not_due" | "cron_error" }
  | { kind: "run"; dueAtMs: number; trigger: string }

export function resolveScheduleTickDirective(params: {
  schedule: ScheduleTickSource
  nowMs: number
  queueActive: boolean
  isValidCron: (cron: string) => boolean
  getNextRun: (cron: string, base: Date) => Date
}): ScheduleTickDirective {
  const { schedule, nowMs, queueActive, isValidCron, getNextRun } = params

  if (!schedule.enabled) {
    return { kind: "skip", reason: "disabled" }
  }

  if (schedule.execution_driver === "system_crontab") {
    return { kind: "skip", reason: "system_driver" }
  }

  if (!isValidCron(schedule.cron_expression)) {
    return { kind: "skip", reason: "invalid_cron" }
  }

  if (queueActive) {
    return { kind: "skip", reason: "queue_active" }
  }

  try {
    const baseTimestamp = schedule.last_run_at ?? schedule.created_at ?? nowMs
    const base = new Date(baseTimestamp)
    const nextRun = getNextRun(schedule.cron_expression, base)

    if (nextRun.getTime() > nowMs) {
      return { kind: "skip", reason: "not_due" }
    }

    return {
      kind: "run",
      dueAtMs: nextRun.getTime(),
      trigger: `scheduler tick (due: ${nextRun.toISOString()})`,
    }
  } catch {
    return { kind: "skip", reason: "cron_error" }
  }
}
