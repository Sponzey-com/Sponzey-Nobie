import { describe, expect, it } from "vitest"
import {
  buildScheduleRegistrationCancelledEvent,
  buildScheduleRegistrationCreatedEvent,
  buildScheduleRunCompleteEvent,
  buildScheduleRunFailedEvent,
  buildScheduleRunStartEvent,
} from "../packages/core/src/scheduler/lifecycle.ts"

describe("scheduler lifecycle helpers", () => {
  const schedule = {
    id: "schedule-1",
    name: "아침 보고",
    target_channel: "telegram",
    target_session_id: "telegram-session-1",
    origin_run_id: "origin-run-1",
    origin_request_group_id: "origin-group-1",
  }

  it("builds a start event with schedule lineage", () => {
    expect(buildScheduleRunStartEvent({
      schedule,
      scheduleRunId: "schedule-run-1",
      trigger: "manual",
    })).toEqual({
      scheduleId: "schedule-1",
      scheduleRunId: "schedule-run-1",
      runId: "schedule-run-1",
      scheduleName: "아침 보고",
      targetChannel: "telegram",
      targetSessionId: "telegram-session-1",
      originRunId: "origin-run-1",
      originRequestGroupId: "origin-group-1",
      trigger: "manual",
    })
  })

  it("builds a completion event with optional summary", () => {
    expect(buildScheduleRunCompleteEvent({
      schedule,
      scheduleRunId: "schedule-run-2",
      trigger: "scheduler tick",
      success: true,
      durationMs: 1200,
      summary: "보고 완료",
    })).toEqual({
      scheduleId: "schedule-1",
      scheduleRunId: "schedule-run-2",
      runId: "schedule-run-2",
      scheduleName: "아침 보고",
      targetChannel: "telegram",
      targetSessionId: "telegram-session-1",
      originRunId: "origin-run-1",
      originRequestGroupId: "origin-group-1",
      trigger: "scheduler tick",
      success: true,
      durationMs: 1200,
      summary: "보고 완료",
    })
  })

  it("builds a failed event without forcing optional fields", () => {
    expect(buildScheduleRunFailedEvent({
      schedule: {
        ...schedule,
        target_session_id: null,
      },
      scheduleRunId: "schedule-run-3",
      trigger: "manual",
      error: "telegram channel is not running",
      attempts: 2,
    })).toEqual({
      scheduleId: "schedule-1",
      scheduleRunId: "schedule-run-3",
      runId: "schedule-run-3",
      scheduleName: "아침 보고",
      targetChannel: "telegram",
      originRunId: "origin-run-1",
      originRequestGroupId: "origin-group-1",
      trigger: "manual",
      error: "telegram channel is not running",
      attempts: 2,
    })
  })

  it("builds a registration created event with recurring lineage", () => {
    expect(buildScheduleRegistrationCreatedEvent({
      runId: "run-1",
      requestGroupId: "group-1",
      registrationKind: "recurring",
      title: "아침 보고",
      task: "오늘 아침 보고를 보내줘",
      source: "telegram",
      scheduleText: "매일 오전 8시",
      scheduleId: "schedule-1",
      cron: "0 8 * * *",
      targetSessionId: "telegram-session-1",
      driver: "internal",
    })).toEqual({
      runId: "run-1",
      requestGroupId: "group-1",
      registrationKind: "recurring",
      title: "아침 보고",
      task: "오늘 아침 보고를 보내줘",
      source: "telegram",
      scheduleText: "매일 오전 8시",
      scheduleId: "schedule-1",
      cron: "0 8 * * *",
      targetSessionId: "telegram-session-1",
      driver: "internal",
    })
  })

  it("builds a registration cancelled event with explicit ids", () => {
    expect(buildScheduleRegistrationCancelledEvent({
      runId: "run-2",
      requestGroupId: "group-2",
      cancelledScheduleIds: ["schedule-1", "schedule-2"],
      cancelledNames: ["매 1분 알림", "아침 보고"],
    })).toEqual({
      runId: "run-2",
      requestGroupId: "group-2",
      cancelledScheduleIds: ["schedule-1", "schedule-2"],
      cancelledNames: ["매 1분 알림", "아침 보고"],
    })
  })
})
