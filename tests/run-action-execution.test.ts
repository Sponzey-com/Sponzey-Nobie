import { describe, expect, it, vi } from "vitest"
import {
  buildDelegatedReceipt,
  buildFollowupPrompt,
  executeScheduleActions,
  inferDelegatedTaskProfile,
  type ScheduleActionDependencies,
} from "../packages/core/src/runs/action-execution.ts"
import type { TaskIntakeActionItem, TaskIntakeResult } from "../packages/core/src/agent/intake.ts"

function buildIntake(overrides: Partial<TaskIntakeResult> = {}): TaskIntakeResult {
  return {
    intent: {
      category: "task_intake",
      summary: "기본 작업",
      confidence: 0.9,
    },
    user_message: {
      mode: "accepted_receipt",
      text: "요청을 접수했습니다.",
    },
    action_items: [],
    structured_request: {
      source_language: "ko",
      normalized_english: "Target: default task",
      target: "기본 작업",
      to: "telegram chat 42120565, main thread",
      context: ["Delivery destination: telegram chat 42120565, main thread"],
      complete_condition: ["요청한 작업이 수행됩니다."],
    },
    intent_envelope: {
      intent_type: "task_intake",
      source_language: "ko",
      normalized_english: "Target: default task",
      target: "기본 작업",
      destination: "telegram chat 42120565, main thread",
      context: ["Delivery destination: telegram chat 42120565, main thread"],
      complete_condition: ["요청한 작업이 수행됩니다."],
      schedule_spec: {
        detected: false,
        kind: "none",
        status: "not_applicable",
        schedule_text: "",
      },
      execution_semantics: {
        filesystemEffect: "none",
        privilegedOperation: "none",
        artifactDelivery: "none",
        approvalRequired: false,
        approvalTool: "external_action",
      },
      delivery_mode: "none",
      requires_approval: false,
      approval_tool: "external_action",
      preferred_target: "auto",
      needs_tools: false,
      needs_web: false,
    },
    scheduling: {
      detected: false,
      kind: "none",
      status: "not_applicable",
      schedule_text: "",
    },
    execution: {
      requires_run: true,
      requires_delegation: false,
      suggested_target: "auto",
      max_delegation_turns: 3,
      needs_tools: false,
      needs_web: false,
      execution_semantics: {
        filesystemEffect: "none",
        privilegedOperation: "none",
        artifactDelivery: "none",
        approvalRequired: false,
        approvalTool: "external_action",
      },
    },
    notes: [],
    ...overrides,
  }
}

function buildDependencies(overrides: Partial<ScheduleActionDependencies> = {}): ScheduleActionDependencies {
  return {
    scheduleDelayedRun: vi.fn(),
    createRecurringSchedule: vi.fn(() => ({ scheduleId: "schedule-default", driver: "internal" as const })),
    cancelSchedules: vi.fn(() => []),
    ...overrides,
  }
}

describe("run action execution helpers", () => {
  it("builds a delegated follow-up prompt from the intake envelope", () => {
    const intake = buildIntake({
      intent: {
        category: "schedule_request",
        summary: "예약 메시지 전달",
        confidence: 0.9,
      },
    })
    const action: TaskIntakeActionItem = {
      id: "a1",
      type: "run_task",
      title: "후속 작업",
      priority: "normal",
      reason: "후속 실행 필요",
      payload: {
        goal: "정확한 문구 전달",
        context: "예약 시각 도달",
        success_criteria: ["정확한 문구 전달"],
        constraints: ["부가 설명 금지"],
      },
    }

    const prompt = buildFollowupPrompt({
      originalMessage: "30초 뒤 안녕이라고 해줘",
      intake,
      action,
      taskProfile: "operations",
    })

    expect(prompt).toContain("[Task Intake Bridge]")
    expect(prompt).toContain("[target]")
    expect(prompt).toContain("[to]")
    expect(prompt).toContain("성공 조건:")
    expect(prompt).toContain("제약 사항:")
  })

  it("infers delegated task profile from explicit action payload or schedule context", () => {
    const scheduleIntake = buildIntake({
      intent: {
        category: "schedule_request",
        summary: "예약 작업",
        confidence: 0.9,
      },
    })
    const implicitProfile = inferDelegatedTaskProfile({
      intake: scheduleIntake,
      action: {
        id: "a2",
        type: "delegate_agent",
        title: "예약 후속 작업",
        priority: "normal",
        reason: "후속 실행",
        payload: {},
      },
    })
    expect(implicitProfile).toBe("operations")

    const explicitProfile = inferDelegatedTaskProfile({
      intake: buildIntake(),
      action: {
        id: "a3",
        type: "delegate_agent",
        title: "코딩 작업",
        priority: "high",
        reason: "코드 변경",
        payload: { task_profile: "coding" },
      },
    })
    expect(explicitProfile).toBe("coding")
  })

  it("creates a delayed schedule execution with direct delivery context", () => {
    const scheduleDelayedRun = vi.fn()
    const dependencies = buildDependencies({ scheduleDelayedRun })
    const intake = buildIntake({
      intent: {
        category: "schedule_request",
        summary: "안녕이라고 해줘",
        confidence: 0.95,
      },
      scheduling: {
        detected: true,
        kind: "one_time",
        status: "accepted",
        schedule_text: "30초 뒤",
        run_at: "2026-04-01T00:00:30.000Z",
      },
      intent_envelope: {
        ...buildIntake().intent_envelope,
        intent_type: "schedule_request",
        target: "안녕이라고 해줘",
        destination: "telegram chat 42120565, main thread",
      },
    })
    const action: TaskIntakeActionItem = {
      id: "s1",
      type: "create_schedule",
      title: "30초 후 실행",
      priority: "normal",
      reason: "상대 시간 예약",
      payload: {
        title: "30초 후 실행",
        task: "안녕이라고 해줘",
        run_at: "2026-04-01T00:00:30.000Z",
        schedule_text: "30초 뒤",
      },
    }

    const result = executeScheduleActions(
      [action],
      intake,
      {
        runId: "run-1",
        message: "30초 뒤 안녕이라고 해줘",
        originalRequest: "30초 뒤 안녕이라고 해줘",
        sessionId: "telegram-session",
        requestGroupId: "rg-1",
        model: "gpt-test",
        source: "telegram",
        onChunk: undefined,
      },
      dependencies,
    )

    expect(result.ok).toBe(true)
    expect(result.message).toContain("일회성 예약 실행이 저장되었습니다.")
    expect(result.receipts).toEqual([{
      kind: "schedule_create_one_time",
      title: "30초 후 실행",
      task: "안녕이라고 해줘",
      runAtMs: Date.parse("2026-04-01T00:00:30.000Z"),
      scheduleText: "30초 뒤",
      source: "telegram",
      destination: "telegram chat 42120565, main thread",
      taskProfile: "general_chat",
      directDelivery: true,
      immediateCompletionText: "안녕",
      preferredTarget: "auto",
    }])
    expect(scheduleDelayedRun).toHaveBeenCalledTimes(1)
    const delayedRun = scheduleDelayedRun.mock.calls[0]?.[0]
    expect(delayedRun?.originRunId).toBe("run-1")
    expect(delayedRun?.immediateCompletionText).toBe("안녕")
    expect(delayedRun?.originRequestGroupId).toBe("rg-1")
    expect(delayedRun?.message).toContain("telegram chat 42120565, main thread")
  })

  it("creates a recurring schedule via execution dependency and reports the driver", () => {
    const createRecurringSchedule = vi.fn(() => ({
      scheduleId: "schedule-1",
      targetSessionId: "telegram-session",
      driver: "system" as const,
    }))
    const dependencies = buildDependencies({ createRecurringSchedule })
    const intake = buildIntake({
      intent: {
        category: "schedule_request",
        summary: "매 분 안녕",
        confidence: 0.9,
      },
      scheduling: {
        detected: true,
        kind: "recurring",
        status: "accepted",
        schedule_text: "매 분",
        cron: "* * * * *",
      },
    })
    const action: TaskIntakeActionItem = {
      id: "s2",
      type: "create_schedule",
      title: "매 분 안녕",
      priority: "normal",
      reason: "반복 예약",
      payload: {
        title: "매 분 안녕",
        task: "안녕이라고 해줘",
        cron: "* * * * *",
      },
    }

    const result = executeScheduleActions(
      [action],
      intake,
      {
        runId: "run-2",
        message: "매 분 안녕이라고 해줘",
        originalRequest: "매 분 안녕이라고 해줘",
        sessionId: "telegram-session",
        requestGroupId: "rg-2",
        model: "gpt-test",
        source: "telegram",
        onChunk: undefined,
      },
      dependencies,
    )

    expect(result.ok).toBe(true)
    expect(createRecurringSchedule).toHaveBeenCalledTimes(1)
    expect(createRecurringSchedule).toHaveBeenCalledWith({
      title: "매 분 안녕",
      task: "안녕이라고 해줘",
      cron: "* * * * *",
      source: "telegram",
      sessionId: "telegram-session",
      originRunId: "run-2",
      originRequestGroupId: "rg-2",
      model: "gpt-test",
    })
    expect(result.message).toContain("실행 방식: 시스템 스케줄러")
    expect(result.receipts).toEqual([{
      kind: "schedule_create_recurring",
      scheduleId: "schedule-1",
      title: "매 분 안녕",
      task: "안녕이라고 해줘",
      cron: "* * * * *",
      scheduleText: "* * * * *",
      source: "telegram",
      targetSessionId: "telegram-session",
      originRunId: "run-2",
      originRequestGroupId: "rg-2",
      driver: "system",
      driverReason: undefined,
    }])
  })

  it("cancels schedules through the execution dependency", () => {
    const cancelSchedules = vi.fn(() => ["매 1분 알림", "아침 보고"])
    const dependencies = buildDependencies({ cancelSchedules })
    const action: TaskIntakeActionItem = {
      id: "s3",
      type: "cancel_schedule",
      title: "예약 취소",
      priority: "normal",
      reason: "사용자 요청",
      payload: {
        schedule_ids: ["sch-1", "sch-2"],
      },
    }

    const result = executeScheduleActions(
      [action],
      buildIntake(),
      {
        runId: "run-3",
        message: "예약 모두 취소해줘",
        originalRequest: "예약 모두 취소해줘",
        sessionId: "telegram-session",
        requestGroupId: "rg-3",
        model: "gpt-test",
        source: "telegram",
        onChunk: undefined,
      },
      dependencies,
    )

    expect(result.ok).toBe(true)
    expect(cancelSchedules).toHaveBeenCalledWith(["sch-1", "sch-2"])
    expect(result.message).toContain("2개의 예약 알림을 취소했습니다.")
    expect(result.receipts).toEqual([{
      kind: "schedule_cancel",
      cancelledScheduleIds: ["sch-1", "sch-2"],
      cancelledNames: ["매 1분 알림", "아침 보고"],
    }])
  })

  it("builds delegated receipts without collapsing multiple follow-up items", () => {
    const receipt = buildDelegatedReceipt(
      buildIntake(),
      [
        {
          id: "d1",
          type: "run_task",
          title: "첫 번째 후속 실행",
          priority: "normal",
          reason: "첫 번째",
          payload: {},
        },
        {
          id: "d2",
          type: "delegate_agent",
          title: "두 번째 후속 실행",
          priority: "normal",
          reason: "두 번째",
          payload: {},
        },
      ],
      false,
    )

    expect(receipt).toContain("첫 번째 후속 실행")
    expect(receipt).toContain("두 번째 후속 실행")
  })

  it("returns an empty receipt list when schedule creation fails", () => {
    const result = executeScheduleActions(
      [{
        id: "s4",
        type: "create_schedule",
        title: "실패 예약",
        priority: "normal",
        reason: "run_at 오류",
        payload: {
          title: "실패 예약",
          task: "안녕이라고 해줘",
          run_at: "not-a-date",
        },
      }],
      buildIntake({
        intent: {
          category: "schedule_request",
          summary: "실패 예약",
          confidence: 0.9,
        },
      }),
      {
        runId: "run-4",
        message: "잘못된 예약",
        originalRequest: "잘못된 예약",
        sessionId: "telegram-session",
        requestGroupId: "rg-4",
        model: "gpt-test",
        source: "telegram",
        onChunk: undefined,
      },
      buildDependencies(),
    )

    expect(result.ok).toBe(false)
    expect(result.detail).toContain("run_at 형식")
    expect(result.receipts).toEqual([])
  })
})
