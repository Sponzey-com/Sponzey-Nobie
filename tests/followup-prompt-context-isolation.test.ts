import { describe, expect, it, vi } from "vitest"
import { buildPromptContextBlockPlan } from "../packages/core/src/orchestration/prompt-bundle.ts"
import { buildFollowupPrompt } from "../packages/core/src/runs/action-execution.ts"
import { prepareStartLaunch } from "../packages/core/src/runs/start-launch.ts"

function baseIntake(overrides: Record<string, unknown> = {}): any {
  return {
    intent: {
      category: "task_intake",
      summary: "Build the requested artifact.",
      confidence: 0.92,
    },
    user_message: {
      mode: "accepted_receipt",
      text: "",
    },
    action_items: [],
    structured_request: {
      source_language: "ko",
      normalized_english: "Build a small artifact and verify it.",
      target: "검증 가능한 작업 결과",
      to: "parent agent",
      context: ["현재 root 요청에서 나온 하위 작업입니다."],
      complete_condition: [
        "실제 결과를 만든다.",
        "검증 결과를 부모에게 돌려준다.",
      ],
    },
    intent_envelope: {
      intent_type: "task_intake",
      source_language: "ko",
      normalized_english: "Build a small artifact and verify it.",
      target: "검증 가능한 작업 결과",
      destination: "parent agent",
      context: ["현재 root 요청에서 나온 하위 작업입니다."],
      complete_condition: [
        "실제 결과를 만든다.",
        "검증 결과를 부모에게 돌려준다.",
      ],
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
        approvalTool: null,
      },
      delivery_mode: "none",
      requires_approval: false,
      approval_tool: null,
      preferred_target: "provider:openai",
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
      requires_delegation: true,
      suggested_target: "provider:openai",
      max_delegation_turns: 4,
      needs_tools: false,
      needs_web: false,
      execution_semantics: {
        filesystemEffect: "none",
        privilegedOperation: "none",
        artifactDelivery: "none",
        approvalRequired: false,
        approvalTool: null,
      },
    },
    notes: ["부모가 최종 검증합니다."],
    ...overrides,
  }
}

function startPlanFixture(overrides: Record<string, unknown> = {}): any {
  return {
    entrySemantics: {
      reuse_conversation_context: false,
      active_queue_cancellation_mode: null,
    },
    requestedClosedRequestGroup: false,
    shouldReconnectGroup: false,
    reconnectTarget: undefined,
    reconnectCandidateCount: 0,
    reconnectNeedsClarification: false,
    requestIsolation: "root",
    continuationSource: "new_root",
    requestGroupId: "run-new",
    isRootRequest: true,
    effectiveTaskProfile: "general_chat",
    initialDelegationTurnCount: 0,
    shouldReuseContext: false,
    effectiveContextMode: "isolated",
    orchestrationMode: "orchestration",
    orchestrationRegistrySnapshot: {
      mode: "orchestration",
      reasonCode: "test",
      activeSubAgentCount: 1,
    },
    orchestrationPlanSnapshot: {
      planId: "plan-test",
      directNobieTasks: [],
      delegatedTasks: [],
      dependencyEdges: [],
      resourceLocks: [],
      parallelGroups: [],
      approvalRequirements: [],
      fallbackStrategy: {
        mode: "self_solve",
        reasonCode: "test",
      },
      createdAt: 1,
    },
    topologyRouting: {
      mode: "disabled",
      reasonCode: "test",
    },
    workerSessionId: undefined,
    reusableWorkerSessionRun: undefined,
    latencyEvents: [],
    ...overrides,
  }
}

async function prepareWithPlan(plan: any): Promise<any> {
  const createRootRun = vi.fn(() => ({ id: plan.requestGroupId }))
  await prepareStartLaunch({
    message: "새 요청",
    sessionId: "session-test",
    runId: "run-new",
    source: "telegram",
    controller: new AbortController(),
    now: 1,
    maxDelegationTurns: 4,
    hasRequestGroupExecutionQueue: () => false,
  }, {
    buildStartPlan: vi.fn(async () => plan) as any,
    isReusableRequestGroup: vi.fn(),
    listActiveSessionRequestGroups: vi.fn(),
    compareRequestContinuation: vi.fn(),
    getRequestGroupDelegationTurnCount: vi.fn(),
    buildWorkerSessionId: vi.fn(),
    normalizeTaskProfile: vi.fn(),
    findLatestWorkerSessionRun: vi.fn(),
    ensureSessionExists: vi.fn(),
    createRootRun: createRootRun as any,
    applyStartInitialization: vi.fn(() => ({
      queuedBehindRequestGroupRun: false,
      interruptedWorkerRunCount: 0,
    })) as any,
    rememberRunInstruction: vi.fn(),
    bindActiveRunController: vi.fn(),
    interruptOrphanWorkerSessionRuns: vi.fn(),
    appendRunEvent: vi.fn(),
    updateRunSummary: vi.fn(),
    setRunStepStatus: vi.fn(),
    updateRunStatus: vi.fn(),
  })
  return createRootRun.mock.calls[0]?.[0]
}

describe("follow-up prompt context isolation", () => {
  it("excludes request group context for new root prompt snapshots", async () => {
    const created = await prepareWithPlan(startPlanFixture({
      reconnectTarget: {
        id: "old-run",
        requestGroupId: "old-group",
        title: "이전 요청",
        prompt: "OLD_ROOT_SHOULD_NOT_APPEAR",
      },
    }))

    expect(created.promptSourceSnapshot.requestIsolation).toEqual(expect.objectContaining({
      mode: "root",
      continuationSource: "new_root",
      contextMode: "isolated",
    }))
    expect(created.promptSourceSnapshot.included_context_blocks).toContainEqual({
      blockId: "request_group_context",
      included: false,
      reason: "excluded_without_explicit_continuation",
    })
    expect(JSON.stringify(created.promptSourceSnapshot)).not.toContain("OLD_ROOT_SHOULD_NOT_APPEAR")
  })

  it("includes request group context only for explicit continuation snapshots", async () => {
    const created = await prepareWithPlan(startPlanFixture({
      requestIsolation: "continuation",
      continuationSource: "explicit_request_group",
      requestGroupId: "group-explicit",
      isRootRequest: false,
      shouldReuseContext: true,
      effectiveContextMode: "request_group",
    }))

    expect(created.promptSourceSnapshot.included_context_blocks).toContainEqual({
      blockId: "request_group_context",
      included: true,
      reason: "explicit_continuation_only",
    })
  })

  it("builds child prompts around parent work order and return contract", () => {
    const prompt = buildFollowupPrompt({
      originalMessage: "사용자 최신 요청만 처리해줘",
      taskProfile: "coding",
      action: {
        id: "action-1",
        type: "run_task",
        title: "구현 작업",
        priority: "normal",
        reason: "하위 실행자에게 맡길 구현 작업",
        payload: {
          goal: "구현하고 검증한다.",
          success_criteria: ["테스트가 통과한다."],
          constraints: ["기존 사용자 변경을 되돌리지 않는다."],
          preferred_target: "provider:openai",
        },
      },
      intake: baseIntake(),
      selectedExecutorId: "topology:main:node:developer",
      selectedExecutorLabel: "개발자",
      selectedExecutorReason: "직속 하위 실행자가 구현 역할과 일치합니다.",
    })

    expect(prompt).toContain("[parent_work_order]")
    expect(prompt).toContain("[required_outputs]")
    expect(prompt).toContain("[verification_notes]")
    expect(prompt).toContain("[return_to_parent_contract]")
    expect(prompt).toContain("[validated_executor]")
    expect(prompt).toContain("topology:main:node:developer")
    expect(prompt).toContain("부모 실행자가 검증/취합")
    expect(prompt).not.toContain("선호 대상")
    expect(prompt).not.toContain("provider:openai")
    expect(prompt).toContain("Do not send or claim the final user-channel answer yourself.")
  })

  it("separates root, continuation, and handoff context block rules", () => {
    const rootPlan = buildPromptContextBlockPlan({
      mode: "root",
      hasRequestGroupContext: true,
      hasParentWorkOrder: true,
    })
    const continuationPlan = buildPromptContextBlockPlan({
      mode: "explicit_continuation",
      hasRequestGroupContext: true,
    })
    const handoffPlan = buildPromptContextBlockPlan({
      mode: "handoff",
      hasParentWorkOrder: true,
      hasRequiredOutputs: true,
      hasVerificationNotes: true,
      hasReturnToParentContract: true,
    })

    expect(rootPlan.includedContextBlocks).toContainEqual({
      blockId: "request_group_context",
      included: false,
      reason: "excluded_without_explicit_continuation",
    })
    expect(continuationPlan.includedContextBlocks).toContainEqual({
      blockId: "request_group_context",
      included: true,
      reason: "explicit_continuation_only",
    })
    expect(handoffPlan.includedContextBlocks).toEqual(expect.arrayContaining([
      expect.objectContaining({ blockId: "parent_work_order", included: true }),
      expect.objectContaining({ blockId: "required_outputs", included: true }),
      expect.objectContaining({ blockId: "verification_notes", included: true }),
      expect.objectContaining({ blockId: "return_to_parent_contract", included: true }),
    ]))
  })
})
