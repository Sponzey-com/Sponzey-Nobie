import { describe, expect, it, vi } from "vitest"
import { runIntakeBridgePass } from "../packages/core/src/runs/intake-bridge-pass.ts"

function createDependencies() {
  return {
    appendRunEvent: vi.fn(),
    updateRunSummary: vi.fn(),
    incrementDelegationTurnCount: vi.fn(),
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
      buildDelegatedReceipt: vi.fn(),
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
      buildDelegatedReceipt: vi.fn(),
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
      buildDelegatedReceipt: vi.fn().mockReturnValue("후속 실행을 시작합니다."),
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
      requestGroupId: "group-3",
      originalRequest: "make calendar",
      model: "gpt-5.4",
      providerId: "openai",
      targetId: "provider:openai",
      targetLabel: "OpenAI",
      workDir: "/tmp/project",
      source: "cli",
      skipIntake: true,
    }))
    expect(result).toEqual({
      kind: "complete",
      text: "후속 실행을 시작합니다.",
      eventLabel: "intake 처리 결과 전달",
    })
  })
})
