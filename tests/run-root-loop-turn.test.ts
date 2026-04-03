import { describe, expect, it, vi } from "vitest"
import { runRootLoopTurn } from "../packages/core/src/runs/root-loop-turn.ts"

function createState() {
  return {
    currentMessage: "initial message",
    currentModel: "gpt-5",
    currentProviderId: "provider:openai",
    currentProvider: undefined,
    currentTargetId: "provider:openai",
    currentTargetLabel: "OpenAI",
    activeWorkerRuntime: undefined,
    executionRecoveryLimitStop: null,
    aiRecoveryLimitStop: null,
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
  }
}

function createParams() {
  return {
    runId: "run-1",
    sessionId: "session-1",
    requestGroupId: "group-1",
    source: "cli" as const,
    onChunk: undefined,
    signal: new AbortController().signal,
    abortExecutionStream: vi.fn(),
    pendingLoopDirective: null,
    intakeProcessed: false,
    state: createState(),
    recoveryBudgetUsage: {
      interpretation: 0,
      execution: 0,
      delivery: 0,
      external: 0,
    },
    executionSemantics: {
      filesystemEffect: "none",
      privilegedOperation: "not_required",
      artifactDelivery: "none",
      approvalRequired: false,
      approvalTool: "approve_run",
    },
    originalRequest: "original request",
    requestMessage: "initial message",
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
    seenAiRecoveryKeys: new Set<string>(),
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

describe("run root loop turn", () => {
  it("returns retry-updated state from loop-entry without executing the cycle", async () => {
    const moduleDependencies = {
      prepareRootLoopEntryPassLaunch: vi.fn(() => ({
        params: {},
        dependencies: {},
      })),
      runLoopEntryPass: vi.fn(async () => ({ kind: "retry" as const, nextMessage: "retry intake" })),
      applyLoopEntryPassResult: vi.fn(() => ({
        kind: "retry" as const,
        nextMessage: "retry intake",
        state: {
          pendingLoopDirective: null,
          intakeProcessed: false,
        },
      })),
      prepareRootExecutionCyclePassLaunch: vi.fn(),
      runExecutionCyclePass: vi.fn(),
    }

    const result = await runRootLoopTurn(createParams(), createDependencies() as any, moduleDependencies as any)

    expect(result).toEqual({
      kind: "continue",
      pendingLoopDirective: null,
      intakeProcessed: false,
      state: expect.objectContaining({
        currentMessage: "retry intake",
      }),
    })
    expect(moduleDependencies.runExecutionCyclePass).not.toHaveBeenCalled()
  })

  it("returns execution-cycle retry state after a continue loop-entry", async () => {
    const moduleDependencies = {
      prepareRootLoopEntryPassLaunch: vi.fn(() => ({
        params: {},
        dependencies: {},
      })),
      runLoopEntryPass: vi.fn(async () => ({ kind: "proceed" as const, intakeProcessed: true })),
      applyLoopEntryPassResult: vi.fn(() => ({
        kind: "continue" as const,
        state: {
          pendingLoopDirective: null,
          intakeProcessed: true,
        },
      })),
      prepareRootExecutionCyclePassLaunch: vi.fn(() => ({
        params: {},
        dependencies: {},
      })),
      runExecutionCyclePass: vi.fn(async () => ({
        kind: "retry" as const,
        state: {
          ...createState(),
          currentMessage: "after cycle retry",
        },
      })),
    }

    const result = await runRootLoopTurn(createParams(), createDependencies() as any, moduleDependencies as any)

    expect(result).toEqual({
      kind: "continue",
      pendingLoopDirective: null,
      intakeProcessed: true,
      state: expect.objectContaining({
        currentMessage: "after cycle retry",
      }),
    })
  })

  it("does not execute the cycle when loop-entry sets a directive", async () => {
    const moduleDependencies = {
      prepareRootLoopEntryPassLaunch: vi.fn(() => ({
        params: {},
        dependencies: {},
      })),
      runLoopEntryPass: vi.fn(async () => ({
        kind: "set_directive" as const,
        directive: {
          kind: "complete_silent" as const,
          summary: "후속 실행으로 전달되었습니다.",
        },
        intakeProcessed: true,
      })),
      applyLoopEntryPassResult: vi.fn(() => ({
        kind: "continue" as const,
        state: {
          pendingLoopDirective: {
            kind: "complete_silent" as const,
            summary: "후속 실행으로 전달되었습니다.",
          },
          intakeProcessed: true,
        },
      })),
      prepareRootExecutionCyclePassLaunch: vi.fn(),
      runExecutionCyclePass: vi.fn(),
    }

    const result = await runRootLoopTurn(createParams(), createDependencies() as any, moduleDependencies as any)

    expect(result).toEqual({
      kind: "continue",
      pendingLoopDirective: {
        kind: "complete_silent",
        summary: "후속 실행으로 전달되었습니다.",
      },
      intakeProcessed: true,
      state: expect.objectContaining({
        currentMessage: "initial message",
      }),
    })
    expect(moduleDependencies.runExecutionCyclePass).not.toHaveBeenCalled()
  })
})
