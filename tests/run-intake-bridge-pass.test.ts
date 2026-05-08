import { describe, expect, it, vi } from "vitest"
import { runIntakeBridgePass } from "../packages/core/src/runs/intake-bridge-pass.ts"

function createDependencies() {
  return {
    appendRunEvent: vi.fn(),
    updateRunSummary: vi.fn(),
    incrementDelegationTurnCount: vi.fn(),
    emitScheduleCreated: vi.fn(),
    emitScheduleCancelled: vi.fn(),
    scheduleDelayedRun: vi.fn(),
    startDelegatedRun: vi.fn(),
    normalizeTaskProfile: vi.fn((taskProfile) => taskProfile ?? "general_chat"),
    logInfo: vi.fn(),
  }
}

function createBaseIntakeResult() {
  return {
    intent: {
      category: "task_intake" as const,
      summary: "후속 실행이 필요합니다.",
      confidence: 0.9,
    },
    user_message: {
      mode: "accepted_receipt" as const,
      text: "후속 실행을 시작합니다.",
    },
    action_items: [],
    structured_request: {
      source_language: "en" as const,
      normalized_english: "Deliver the requested result.",
      target: "deliver result",
      to: "telegram chat 1, main thread",
      context: ["request accepted"],
      complete_condition: ["deliver result"],
    },
    intent_envelope: {
      intent_type: "task_intake" as const,
      source_language: "en" as const,
      normalized_english: "Deliver the requested result.",
      target: "deliver result",
      destination: "telegram chat 1, main thread",
      context: ["request accepted"],
      complete_condition: ["deliver result"],
      schedule_spec: {
        detected: false,
        kind: "none" as const,
        status: "not_applicable" as const,
        schedule_text: "",
      },
      execution_semantics: {
        filesystemEffect: "none" as const,
        privilegedOperation: "none" as const,
        artifactDelivery: "none" as const,
        approvalRequired: false,
        approvalTool: "external_action" as const,
      },
      delivery_mode: "none" as const,
      requires_approval: false,
      approval_tool: "external_action" as const,
      preferred_target: "auto",
      needs_tools: false,
      needs_web: false,
    },
    scheduling: {
      detected: false,
      kind: "none" as const,
      status: "not_applicable" as const,
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
        filesystemEffect: "none" as const,
        privilegedOperation: "none" as const,
        artifactDelivery: "none" as const,
        approvalRequired: false,
        approvalTool: "external_action" as const,
      },
    },
    notes: [],
  }
}

describe("run intake bridge pass", () => {
  it("returns immediate complete directive for reply action", async () => {
    const dependencies = createDependencies()
    const moduleDependencies = {
      analyzeTaskIntake: vi.fn().mockResolvedValue({
        ...createBaseIntakeResult(),
        intent: {
          category: "direct_answer" as const,
          summary: "즉시 응답",
          confidence: 1,
        },
        action_items: [{
          id: "reply-1",
          type: "reply" as const,
          title: "reply",
          priority: "normal" as const,
          reason: "direct reply",
          payload: {
            content: "hello",
          },
        }],
      }),
      resolveRunRoute: vi.fn(),
      executeScheduleActions: vi.fn(),
      createDefaultScheduleActionDependencies: vi.fn(),
      inferDelegatedTaskProfile: vi.fn(),
      buildFollowupPrompt: vi.fn(),
    }

    const result = await runIntakeBridgePass({
      message: "say hello",
      originalRequest: "say hello",
      sessionId: "session-1",
      requestGroupId: "group-1",
      model: "gpt-test",
      workDir: "/tmp",
      source: "telegram",
      runId: "run-1",
      onChunk: undefined,
      reuseConversationContext: false,
    }, dependencies, moduleDependencies)

    expect(result).toEqual({
      kind: "complete",
      text: "hello",
      eventLabel: "intake 즉시 응답 완료",
    })
    expect(dependencies.appendRunEvent).toHaveBeenCalledWith("run-1", "Intake: direct_answer")
    expect(dependencies.updateRunSummary).toHaveBeenCalledWith("run-1", "즉시 응답")
  })

  it("returns retry_intake when schedule analysis fails without delegated actions", async () => {
    const dependencies = createDependencies()
    const moduleDependencies = {
      analyzeTaskIntake: vi.fn().mockResolvedValue({
        ...createBaseIntakeResult(),
        intent: {
          category: "schedule_request" as const,
          summary: "일정 요청",
          confidence: 0.8,
        },
      }),
      resolveRunRoute: vi.fn(),
      executeScheduleActions: vi.fn().mockReturnValue({
        ok: false,
        message: "스케줄 생성 실패",
        detail: "run_at missing",
        successCount: 0,
        failureCount: 1,
        receipts: [],
      }),
      createDefaultScheduleActionDependencies: vi.fn().mockReturnValue({}),
      inferDelegatedTaskProfile: vi.fn(),
      buildFollowupPrompt: vi.fn(),
    }

    const result = await runIntakeBridgePass({
      message: "schedule this later",
      originalRequest: "schedule this later",
      sessionId: "session-2",
      requestGroupId: "group-2",
      model: "gpt-test",
      workDir: "/tmp",
      source: "webui",
      runId: "run-2",
      onChunk: undefined,
      reuseConversationContext: false,
    }, dependencies, moduleDependencies)

    expect(result).toMatchObject({
      kind: "retry_intake",
      summary: "일정 요청을 다시 분석하고 가능한 일정 방안으로 재시도합니다.",
      reason: "run_at missing",
      eventLabel: "일정 해석 실패로 재분석",
    })
  })

  it("starts delegated follow-up runs and returns intake receipt", async () => {
    const dependencies = createDependencies()
    const delegatedIntake = {
      ...createBaseIntakeResult(),
      action_items: [{
        id: "delegate-1",
        type: "run_task" as const,
        title: "캘린더 만들기",
        priority: "high" as const,
        reason: "needs follow-up",
        payload: {
          goal: "Create a calendar app",
          preferred_target: "provider:openai",
        },
      }],
    }
    const moduleDependencies = {
      analyzeTaskIntake: vi.fn().mockResolvedValue(delegatedIntake),
      resolveRunRoute: vi.fn().mockReturnValue({
        targetId: "provider:openai",
        targetLabel: "OpenAI",
        providerId: "openai",
        model: "gpt-5.4",
        reason: "routing:provider:openai",
      }),
      executeScheduleActions: vi.fn(),
      createDefaultScheduleActionDependencies: vi.fn(),
      inferDelegatedTaskProfile: vi.fn().mockReturnValue("coding"),
      buildFollowupPrompt: vi.fn().mockReturnValue("[Task Intake Bridge]\nCreate a calendar app"),
    }

    const result = await runIntakeBridgePass({
      message: "make calendar",
      originalRequest: "make calendar",
      sessionId: "session-3",
      requestGroupId: "group-3",
      model: "gpt-test",
      workDir: "/tmp/project",
      source: "cli",
      runId: "run-3",
      onChunk: undefined,
      reuseConversationContext: false,
    }, dependencies, moduleDependencies)

    expect(dependencies.startDelegatedRun).toHaveBeenCalledWith(expect.objectContaining({
      message: "[Task Intake Bridge]\nCreate a calendar app",
      sessionId: "session-3",
      taskProfile: "coding",
      requestGroupId: "run-3:child:1",
      parentRunId: "run-3",
      runScope: "child",
      handoffSummary: "캘린더 만들기",
      contextMode: "handoff",
      originalRequest: "make calendar",
      model: "gpt-5.4",
      providerId: "openai",
      targetId: "provider:openai",
      targetLabel: "OpenAI",
      workDir: "/tmp/project",
      source: "cli",
      skipIntake: true,
    }))
    expect(dependencies.startDelegatedRun.mock.calls[0]?.[0]).not.toHaveProperty("onChunk")
    expect(result).toEqual({
      kind: "complete_silent",
      summary: "후속 실행으로 전달되었습니다.",
      eventLabel: "intake 후속 실행 생성 완료",
    })
  })

  it("waits for delegated child results when the starter returns a completion handle", async () => {
    const dependencies = createDependencies()
    dependencies.startDelegatedRun.mockReturnValue({
      runId: "child-run-1",
      finished: Promise.resolve({
        status: "completed",
        summary: "행랑아범이 확인한 결과입니다.",
      }),
    })
    const moduleDependencies = {
      analyzeTaskIntake: vi.fn().mockResolvedValue({
        ...createBaseIntakeResult(),
        action_items: [{
          id: "task-1",
          type: "run_task" as const,
          title: "증시 확인",
          priority: "high" as const,
          reason: "후속 실행",
          payload: {
            preferred_target: "provider:openai",
          },
        }],
      }),
      resolveRunRoute: vi.fn().mockReturnValue({
        targetId: "workspace:draft:node:executor-5",
        targetLabel: "행랑아범",
        model: "gpt-5.4",
        reason: "routing:executor",
      }),
      executeScheduleActions: vi.fn(),
      createDefaultScheduleActionDependencies: vi.fn(),
      inferDelegatedTaskProfile: vi.fn().mockReturnValue("research"),
      buildFollowupPrompt: vi.fn().mockReturnValue("[Task Intake Bridge]\n증시 확인"),
    }

    const result = await runIntakeBridgePass({
      message: "코스피 확인",
      originalRequest: "코스피 확인",
      sessionId: "session-aggregate",
      requestGroupId: "group-aggregate",
      model: "gpt-test",
      workDir: "/tmp/project",
      source: "webui",
      runId: "run-aggregate",
      onChunk: undefined,
      reuseConversationContext: false,
    }, dependencies, moduleDependencies)

    expect(dependencies.startDelegatedRun).toHaveBeenCalledWith(expect.objectContaining({
      requestGroupId: "run-aggregate:child:1",
      parentRunId: "run-aggregate",
      targetId: "workspace:draft:node:executor-5",
    }))
    expect(dependencies.appendRunEvent).toHaveBeenCalledWith(
      "run-aggregate",
      "parent_run_awaiting_child_result:intake_followup;child_run=child-run-1",
    )
    expect(dependencies.appendRunEvent).toHaveBeenCalledWith(
      "run-aggregate",
      "parent_run_child_result_received:intake_followup;child_run=child-run-1;status=completed",
    )
    expect(result).toEqual({
      kind: "complete",
      text: "행랑아범이 확인한 결과입니다.",
      eventLabel: "intake 처리 결과 전달",
    })
  })

  it("retries intake instead of finalizing when delegated child review finds missing work", async () => {
    const dependencies = createDependencies()
    dependencies.startDelegatedRun.mockReturnValue({
      runId: "child-run-market",
      finished: Promise.resolve({
        status: "completed",
        summary: [
          "나스닥 종합지수 시가: 확인 실패",
          "나스닥 종합지수 현재값: 확인 실패",
          "테슬라 현재값: 417.63달러",
        ].join("\n"),
      }),
    })
    const moduleDependencies = {
      analyzeTaskIntake: vi.fn().mockResolvedValue({
        ...createBaseIntakeResult(),
        action_items: [{
          id: "task-market",
          type: "run_task" as const,
          title: "나스닥과 테슬라 가격 확인",
          priority: "high" as const,
          reason: "후속 실행",
          payload: {
            preferred_target: "provider:openai",
          },
        }],
      }),
      resolveRunRoute: vi.fn().mockReturnValue({
        targetId: "workspace:draft:node:executor-5",
        targetLabel: "행랑아범",
        model: "gpt-5.4",
        reason: "routing:executor",
      }),
      executeScheduleActions: vi.fn(),
      createDefaultScheduleActionDependencies: vi.fn(),
      inferDelegatedTaskProfile: vi.fn().mockReturnValue("research"),
      buildFollowupPrompt: vi.fn().mockReturnValue("[Task Intake Bridge]\n나스닥과 테슬라 가격 확인"),
      reviewTaskCompletion: vi.fn().mockResolvedValue({
        status: "followup" as const,
        summary: "나스닥 시가와 현재값이 아직 확인되지 않았습니다.",
        reason: "요청한 현재 지수 중 일부가 미확인 상태입니다.",
        followupPrompt: "나스닥 종합지수 시가와 현재값을 다른 신뢰 가능한 경로로 확인하고, 이미 확인된 테슬라 값과 함께 최종 답변을 작성하세요.",
        remainingItems: ["나스닥 종합지수 시가", "나스닥 종합지수 현재값"],
      }),
    }

    const result = await runIntakeBridgePass({
      message: "오늘 나스닥 출발 지수하고 현재 지수 알려줘. 테슬라 가격도",
      originalRequest: "오늘 나스닥 출발 지수하고 현재 지수 알려줘. 테슬라 가격도",
      sessionId: "session-market",
      requestGroupId: "group-market",
      model: "gpt-test",
      workDir: "/tmp/project",
      source: "telegram",
      runId: "run-market",
      onChunk: undefined,
      reuseConversationContext: false,
    }, dependencies, moduleDependencies)

    expect(moduleDependencies.reviewTaskCompletion).toHaveBeenCalledWith(expect.objectContaining({
      originalRequest: "오늘 나스닥 출발 지수하고 현재 지수 알려줘. 테슬라 가격도",
      latestAssistantMessage: expect.stringContaining("나스닥 종합지수 시가: 확인 실패"),
      workDir: "/tmp/project",
    }))
    expect(dependencies.appendRunEvent).toHaveBeenCalledWith(
      "run-market",
      "parent_run_child_result_review:intake_followup;child_run=child-run-market;status=followup;remaining=2",
    )
    expect(result).toMatchObject({
      kind: "retry_intake",
      summary: "나스닥 시가와 현재값이 아직 확인되지 않았습니다.",
      reason: "요청한 현재 지수 중 일부가 미확인 상태입니다.",
      remainingItems: ["나스닥 종합지수 시가", "나스닥 종합지수 현재값"],
      eventLabel: "하위 실행 결과 미완료로 재분석",
    })
    expect(result && "message" in result ? result.message : "").toContain("Focused follow-up")
    expect(result && "message" in result ? result.message : "").toContain("나스닥 종합지수 시가와 현재값")
  })

  it("normalizes mistaken direct artifact semantics before delegated weather runs", async () => {
    const dependencies = createDependencies()
    const directSemantics = {
      filesystemEffect: "none" as const,
      privilegedOperation: "none" as const,
      artifactDelivery: "direct" as const,
      approvalRequired: false,
      approvalTool: "external_action" as const,
    }
    const delegatedIntake = {
      ...createBaseIntakeResult(),
      action_items: [{
        id: "weather-1",
        type: "run_task" as const,
        title: "Current weather conditions for Dongcheon-dong",
        priority: "normal" as const,
        reason: "live information requires web lookup",
        payload: {
          goal: "Current weather conditions for Dongcheon-dong",
          preferred_target: "provider:openai",
        },
      }],
      structured_request: {
        source_language: "ko" as const,
        normalized_english: "Tell me the current weather in Dongcheon-dong.",
        target: "Current weather conditions for Dongcheon-dong",
        to: "telegram chat 1, main thread",
        context: ["User asked for current weather in 동천동"],
        complete_condition: ["Provide a concise current weather summary for Dongcheon-dong."],
      },
      intent_envelope: {
        ...createBaseIntakeResult().intent_envelope,
        source_language: "ko" as const,
        normalized_english: "Tell me the current weather in Dongcheon-dong.",
        target: "Current weather conditions for Dongcheon-dong",
        destination: "telegram chat 1, main thread",
        context: ["User asked for current weather in 동천동"],
        complete_condition: ["Provide a concise current weather summary for Dongcheon-dong."],
        execution_semantics: directSemantics,
        delivery_mode: "direct" as const,
        needs_web: true,
      },
      execution: {
        ...createBaseIntakeResult().execution,
        requires_run: true,
        needs_web: true,
        execution_semantics: directSemantics,
      },
    }
    const moduleDependencies = {
      analyzeTaskIntake: vi.fn().mockResolvedValue(delegatedIntake),
      resolveRunRoute: vi.fn().mockReturnValue({
        targetId: "provider:openai",
        targetLabel: "OpenAI",
        providerId: "openai",
        model: "gpt-5.4",
        reason: "routing:provider:openai",
      }),
      executeScheduleActions: vi.fn(),
      createDefaultScheduleActionDependencies: vi.fn(),
      inferDelegatedTaskProfile: vi.fn().mockReturnValue("general_chat"),
      buildFollowupPrompt: vi.fn().mockReturnValue("[Task Execution Brief]\nweather"),
    }

    await runIntakeBridgePass({
      message: "지금 동천동 날씨 어때?",
      originalRequest: "지금 동천동 날씨 어때?",
      sessionId: "session-weather",
      requestGroupId: "group-weather",
      model: "gpt-test",
      workDir: "/tmp/project",
      source: "telegram",
      runId: "run-weather",
      onChunk: undefined,
      reuseConversationContext: false,
    }, dependencies, moduleDependencies)

    expect(moduleDependencies.buildFollowupPrompt).toHaveBeenCalledWith(expect.objectContaining({
      intake: expect.objectContaining({
        intent_envelope: expect.objectContaining({
          delivery_mode: "none",
          execution_semantics: expect.objectContaining({ artifactDelivery: "none" }),
        }),
      }),
    }))
    expect(dependencies.startDelegatedRun).toHaveBeenCalledWith(expect.objectContaining({
      executionSemantics: expect.objectContaining({ artifactDelivery: "none" }),
      intentEnvelope: expect.objectContaining({
        delivery_mode: "none",
        execution_semantics: expect.objectContaining({ artifactDelivery: "none" }),
      }),
    }))
  })

  it("emits schedule created event for recurring schedule receipts", async () => {
    const dependencies = createDependencies()
    const moduleDependencies = {
      analyzeTaskIntake: vi.fn().mockResolvedValue({
        ...createBaseIntakeResult(),
        intent: {
          category: "schedule_request" as const,
          summary: "반복 예약",
          confidence: 0.9,
        },
      }),
      resolveRunRoute: vi.fn(),
      executeScheduleActions: vi.fn().mockReturnValue({
        ok: true,
        message: "스케줄이 저장되었습니다.",
        detail: "매 분: 안녕이라고 해줘",
        successCount: 1,
        failureCount: 0,
        receipts: [{
          kind: "schedule_create_recurring" as const,
          scheduleId: "schedule-1",
          title: "매 분 안녕",
          task: "안녕이라고 해줘",
          cron: "* * * * *",
          scheduleText: "매 분",
          source: "telegram" as const,
          targetSessionId: "telegram-session-1",
          originRunId: "run-4",
          originRequestGroupId: "group-4",
          driver: "internal" as const,
        }],
      }),
      createDefaultScheduleActionDependencies: vi.fn().mockReturnValue({}),
      inferDelegatedTaskProfile: vi.fn(),
      buildFollowupPrompt: vi.fn(),
    }

    const result = await runIntakeBridgePass({
      message: "매 분 안녕이라고 해줘",
      originalRequest: "매 분 안녕이라고 해줘",
      sessionId: "session-4",
      requestGroupId: "group-4",
      model: "gpt-test",
      workDir: "/tmp",
      source: "telegram",
      runId: "run-4",
      onChunk: undefined,
      reuseConversationContext: false,
    }, dependencies, moduleDependencies)

    expect(dependencies.emitScheduleCreated).toHaveBeenCalledWith({
      runId: "run-4",
      requestGroupId: "group-4",
      registrationKind: "recurring",
      title: "매 분 안녕",
      task: "안녕이라고 해줘",
      source: "telegram",
      scheduleText: "매 분",
      scheduleId: "schedule-1",
      cron: "* * * * *",
      targetSessionId: "telegram-session-1",
      driver: "internal",
    })
    expect(result).toEqual({
      kind: "complete",
      text: "스케줄이 저장되었습니다.",
      eventLabel: "intake 처리 결과 전달",
    })
  })
})
