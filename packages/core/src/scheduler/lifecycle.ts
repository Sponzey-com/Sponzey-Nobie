import type { DbSchedule } from "../db/index.js"

type ScheduleLineageSource = Pick<
  DbSchedule,
  "id" | "name" | "target_channel" | "target_session_id" | "origin_run_id" | "origin_request_group_id"
>

export interface ScheduleRunLineage {
  scheduleId: string
  scheduleRunId: string
  runId: string
  scheduleName: string
  targetChannel: string
  targetSessionId?: string
  originRunId?: string
  originRequestGroupId?: string
  trigger: string
}

export interface ScheduleRegistrationCreatedEvent {
  runId: string
  requestGroupId: string
  registrationKind: "one_time" | "recurring"
  title: string
  task: string
  source: "webui" | "cli" | "telegram" | "slack"
  scheduleText: string
  scheduleId?: string
  runAtMs?: number
  cron?: string
  targetSessionId?: string
  driver?: string
}

export interface ScheduleRegistrationCancelledEvent {
  runId: string
  requestGroupId: string
  cancelledScheduleIds: string[]
  cancelledNames: string[]
}

export function buildScheduleRunLineage(params: {
  schedule: ScheduleLineageSource
  scheduleRunId: string
  trigger: string
}): ScheduleRunLineage {
  return {
    scheduleId: params.schedule.id,
    scheduleRunId: params.scheduleRunId,
    runId: params.scheduleRunId,
    scheduleName: params.schedule.name,
    targetChannel: params.schedule.target_channel,
    ...(params.schedule.target_session_id ? { targetSessionId: params.schedule.target_session_id } : {}),
    ...(params.schedule.origin_run_id ? { originRunId: params.schedule.origin_run_id } : {}),
    ...(params.schedule.origin_request_group_id ? { originRequestGroupId: params.schedule.origin_request_group_id } : {}),
    trigger: params.trigger,
  }
}

export function buildScheduleRunStartEvent(params: {
  schedule: ScheduleLineageSource
  scheduleRunId: string
  trigger: string
}): ScheduleRunLineage {
  return buildScheduleRunLineage(params)
}

export function buildScheduleRegistrationCreatedEvent(
  params: ScheduleRegistrationCreatedEvent,
): ScheduleRegistrationCreatedEvent {
  return {
    runId: params.runId,
    requestGroupId: params.requestGroupId,
    registrationKind: params.registrationKind,
    title: params.title,
    task: params.task,
    source: params.source,
    scheduleText: params.scheduleText,
    ...(params.scheduleId ? { scheduleId: params.scheduleId } : {}),
    ...(typeof params.runAtMs === "number" ? { runAtMs: params.runAtMs } : {}),
    ...(params.cron ? { cron: params.cron } : {}),
    ...(params.targetSessionId ? { targetSessionId: params.targetSessionId } : {}),
    ...(params.driver ? { driver: params.driver } : {}),
  }
}

export function buildScheduleRegistrationCancelledEvent(
  params: ScheduleRegistrationCancelledEvent,
): ScheduleRegistrationCancelledEvent {
  return {
    runId: params.runId,
    requestGroupId: params.requestGroupId,
    cancelledScheduleIds: [...params.cancelledScheduleIds],
    cancelledNames: [...params.cancelledNames],
  }
}

export function buildScheduleRunCompleteEvent(params: {
  schedule: ScheduleLineageSource
  scheduleRunId: string
  trigger: string
  success: boolean
  durationMs: number
  summary?: string | null
}): ScheduleRunLineage & {
  success: boolean
  durationMs: number
  summary?: string
} {
  return {
    ...buildScheduleRunLineage(params),
    success: params.success,
    durationMs: params.durationMs,
    ...(params.summary ? { summary: params.summary } : {}),
  }
}

export function buildScheduleRunFailedEvent(params: {
  schedule: ScheduleLineageSource
  scheduleRunId: string
  trigger: string
  error?: string | null
  attempts: number
}): ScheduleRunLineage & {
  error?: string
  attempts: number
} {
  return {
    ...buildScheduleRunLineage(params),
    ...(params.error ? { error: params.error } : {}),
    attempts: params.attempts,
  }
}
