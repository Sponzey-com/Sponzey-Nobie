import { describe, expect, it, vi } from "vitest"
import { runRootLoop, type ExecutionCycleState } from "../packages/core/src/runs/root-loop.ts"

function createExecutionState(): ExecutionCycleState {
  return {
    currentMessage: "initial message",
    currentModel: "gpt-5",
    currentProviderId: "provider:openai",
    currentProvider: { id: "openai" } as never,
    currentTargetId: "provider:openai",
    currentTargetLabel: "OpenAI",
    activeWorkerRuntime: undefined,
    executionRecoveryLimitStop: null,
    llmRecoveryLimitStop: null,
    sawRealFilesystemMutation: false,
    filesystemMutationRecoveryAttempted: false,
    truncatedOutputRecoveryAttempted: false,
  }
}

function createDependencies() {
  return {
    appendRunEvent: vi.fn(),
    updateRunSummary: vi.fn(),
    setRunStepStatus: vi.fn(),
    updateRunStatus: vi.fn(),
    rememberRunFailure: vi.fn(),
    incrementDelegationTurnCount: vi.fn(),
    markAbortedRunCancelledIfActive: vi.fn(),
    getDelegationTurnState: vi.fn(() => ({ usedTurns: 0, maxTurns: 3 })),
    getFinalizationDependencies: vi.fn(() => ({
      appendRunEvent: vi.fn(),
      setRunStepStatus: vi.fn(),
      updateRunStatus: vi.fn(),
      rememberRunSuccess: vi.fn(),
      rememberRunFailure: vi.fn(),
      onDeliveryError: vi.fn(),
    })),
    insertMessage: vi.fn(),
    writeReplyLog: vi.fn(),
    createId: vi.fn(() => "msg-1"),
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
  }
}

function createParams() {
  return {
    runId: "run-1",
    sessionId: "session-1",
    requestGroupId: "group-1",
    source: "telegram" as const,
    onChunk: undefined,
    controller: new AbortController(),
    reconnectNeedsClarification: false,
    queuedBehindRequestGroupRun: false,
    ...createExecutionState(),
    requestMessage: "initial message",
    originalRequest: "initial message",
    executionSemantics: {
      filesystemEffect: "none",
      privilegedOperation: "not_required",
      artifactDelivery: "none",
      approvalRequired: false,
      approvalTool: "approve_run",
    },
    workDir: "/tmp",
    isRootRequest: true,
    contextMode: "full" as const,
    taskProfile: "general_chat" as const,
    wantsDirectArtifactDelivery: false,
    requiresFilesystemMutation: false,
    requiresPrivilegedToolExecution: false,
    pendingToolParams: new Map<string, unknown>(),
    filesystemMutationPaths: new Set<string>(),
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
    priorAssistantMessages: [] as string[],
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
    defaultMaxDelegationTurns: 3,
  }
}

describe("run root loop", () => {
  it("retries loop-entry and uses updated message on the next cycle", async () => {
    const params = createParams()
    const dependencies = createDependencies()
    const moduleDependencies = {
      prepareRootLoopBootstrapState: vi.fn(() => ({
        intakeProcessed: false,
        pendingLoopDirective: null,
        state: createExecutionState(),
      })),
      runRootLoopTurn: vi
        .fn()
        .mockResolvedValueOnce({
          kind: "continue",
          pendingLoopDirective: null,
          intakeProcessed: false,
          state: {
            ...createExecutionState(),
            currentMessage: "retry intake",
          },
        })
        .mockImplementationOnce(async ({ state }) => {
          expect(state.currentMessage).toBe("retry intake")
          return { kind: "break" as const }
        }),
    }

    const result = await runRootLoop(params, dependencies, moduleDependencies as never)

    expect(result.currentMessage).toBe("retry intake")
    expect(moduleDependencies.runRootLoopTurn).toHaveBeenCalledTimes(2)
  })

  it("reuses retry state returned by execution cycle on the next iteration", async () => {
    const params = createParams()
    const dependencies = createDependencies()
    const moduleDependencies = {
      prepareRootLoopBootstrapState: vi.fn(() => ({
        intakeProcessed: true,
        pendingLoopDirective: null,
        state: createExecutionState(),
      })),
      runRootLoopTurn: vi
        .fn()
        .mockResolvedValueOnce({
          kind: "continue",
          pendingLoopDirective: null,
          intakeProcessed: true,
          state: {
            ...createExecutionState(),
            currentMessage: "after cycle retry",
          },
        })
        .mockImplementationOnce(async ({ state }) => {
          expect(state.currentMessage).toBe("after cycle retry")
          return { kind: "break" as const }
        }),
    }

    const result = await runRootLoop(params, dependencies, moduleDependencies as never)

    expect(result.currentMessage).toBe("after cycle retry")
    expect(moduleDependencies.runRootLoopTurn).toHaveBeenCalledTimes(2)
  })
})
