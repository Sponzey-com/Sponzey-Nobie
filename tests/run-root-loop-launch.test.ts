import { describe, expect, it, vi } from "vitest"
import { prepareRootLoopLaunch } from "../packages/core/src/runs/root-loop-launch.ts"

function createDependencies() {
  return {
    appendRunEvent: vi.fn(),
    updateRunSummary: vi.fn(),
    setRunStepStatus: vi.fn(),
    updateRunStatus: vi.fn(),
    rememberRunFailure: vi.fn(),
    incrementDelegationTurnCount: vi.fn(),
    markAbortedRunCancelledIfActive: vi.fn(),
    getDelegationTurnState: vi.fn(() => ({ usedTurns: 0, maxTurns: 5 })),
    getFinalizationDependencies: vi.fn(() => ({
      appendRunEvent: vi.fn(),
      setRunStepStatus: vi.fn(),
      updateRunStatus: vi.fn(),
      rememberRunSuccess: vi.fn(),
      rememberRunFailure: vi.fn(),
      onDeliveryError: vi.fn(),
    })),
    insertMessage: vi.fn() as any,
    writeReplyLog: vi.fn() as any,
    createId: vi.fn(() => "generated-id"),
    now: vi.fn(() => 123),
    runVerificationSubtask: vi.fn(async () => ({ ok: true, summary: "verified" })),
    rememberRunApprovalScope: vi.fn(),
    grantRunApprovalScope: vi.fn(),
    grantRunSingleApproval: vi.fn(),
    onDeliveryError: vi.fn(),
    onReviewError: vi.fn(),
    executeLoopDirective: vi.fn(async () => "break" as const),
    tryHandleActiveQueueCancellation: vi.fn(async () => null),
    tryHandleIntakeBridge: vi.fn(async () => null),
    getSyntheticApprovalAlreadyApproved: vi.fn(() => false),
    onBootstrapInfo: vi.fn(),
    onFinally: vi.fn(),
  }
}

function createExecutionLoopRuntime() {
  return {
    executionProfile: {
      originalRequest: "Original request",
      structuredRequest: {
        source_language: "en",
        normalized_english: "Do the work",
        target: "Do the work",
        to: "the current channel",
        context: [],
        complete_condition: [],
      },
      intentEnvelope: {
        intent_type: "task_intake",
        source_language: "en",
        normalized_english: "Do the work",
        target: "Do the work",
        destination: "the current channel",
        context: [],
        complete_condition: [],
        schedule_spec: {
          detected: false,
          kind: "none",
          status: "not_applicable",
          schedule_text: "",
        },
        execution_semantics: {
          filesystemEffect: "none" as const,
          privilegedOperation: "none" as const,
          artifactDelivery: "none" as const,
          approvalRequired: false,
          approvalTool: "external_action",
        },
        delivery_mode: "none" as const,
        requires_approval: false,
        approval_tool: "external_action",
        preferred_target: "auto" as const,
        needs_tools: false,
        needs_web: false,
      },
      executionSemantics: {
        filesystemEffect: "none" as const,
        privilegedOperation: "none" as const,
        artifactDelivery: "none" as const,
        approvalRequired: false,
        approvalTool: "external_action",
      },
      requiresFilesystemMutation: false,
      requiresPrivilegedToolExecution: false,
      wantsDirectArtifactDelivery: false,
      approvalRequired: false,
      approvalTool: "external_action",
    },
    originalUserRequest: "Original request",
    priorAssistantMessages: [],
    seenFollowupPrompts: new Set<string>(),
    seenCommandFailureRecoveryKeys: new Set<string>(),
    seenExecutionRecoveryKeys: new Set<string>(),
    seenDeliveryRecoveryKeys: new Set<string>(),
    seenLlmRecoveryKeys: new Set<string>(),
    recoveryBudgetUsage: {
      interpretation: 0,
      execution: 0,
      delivery: 0,
      external: 0,
    },
    requiresFilesystemMutation: false,
    requiresPrivilegedToolExecution: false,
    pendingToolParams: new Map<string, unknown>(),
    filesystemMutationPaths: new Set<string>(["a.txt"]),
  }
}

function createParams() {
  return {
    runId: "run-1",
    sessionId: "session-1",
    requestGroupId: "group-1",
    source: "cli" as const,
    onChunk: undefined,
    controller: new AbortController(),
    message: "Do the work",
    currentModel: "gpt-5",
    currentProviderId: "provider:openai",
    currentProvider: undefined,
    currentTargetId: "provider:openai",
    currentTargetLabel: "OpenAI",
    workDir: "/tmp/work",
    reconnectNeedsClarification: false,
    queuedBehindRequestGroupRun: false,
    activeWorkerRuntime: undefined,
    isRootRequest: true,
    contextMode: "isolated" as const,
    taskProfile: "general_chat" as const,
    syntheticApprovalRuntimeDependencies: {
      timeoutSec: 30,
      fallback: "deny" as const,
      appendRunEvent: vi.fn(),
      setRunStepStatus: vi.fn(),
      updateRunStatus: vi.fn(),
      cancelRun: vi.fn(),
      emitApprovalResolved: vi.fn(),
      emitApprovalRequest: vi.fn(),
      onRequested: vi.fn(),
    },
    defaultMaxDelegationTurns: 5,
  }
}

describe("prepare root loop launch", () => {
  it("creates root loop params from the resolved execution runtime", () => {
    const prepared = prepareRootLoopLaunch(
      createParams(),
      createDependencies() as any,
      createExecutionLoopRuntime() as any,
    )

    expect(prepared.rootLoopParams.originalRequest).toBe("Original request")
    expect(prepared.rootLoopParams.currentMessage).toBe("Do the work")
    expect(prepared.rootLoopParams.executionSemantics.filesystemEffect).toBe("none")
    expect(prepared.rootLoopParams.filesystemMutationPaths).toBeInstanceOf(Set)
  })

  it("wraps verification and intake bridge with the resolved original request", async () => {
    const dependencies = createDependencies()
    const prepared = prepareRootLoopLaunch(
      createParams(),
      dependencies as any,
      createExecutionLoopRuntime() as any,
    )

    await prepared.rootLoopDependencies.runVerificationSubtask()
    await prepared.rootLoopDependencies.tryHandleIntakeBridge("retry with more detail")

    expect(dependencies.runVerificationSubtask).toHaveBeenCalledWith({
      originalRequest: "Original request",
      mutationPaths: ["a.txt"],
    })
    expect(dependencies.tryHandleIntakeBridge).toHaveBeenCalledWith({
      currentMessage: "retry with more detail",
      originalRequest: "Original request",
    })
  })
})
