import { describe, expect, it, vi } from "vitest"
import { runExecutionCyclePass, type ExecutionCycleState } from "../packages/core/src/runs/execution-cycle-pass.ts"

function createState(): ExecutionCycleState {
  return {
    currentMessage: "do work",
    currentModel: "gpt-5",
    currentProviderId: "provider:openai",
    currentProvider: { id: "openai" } as never,
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
    rememberRunFailure: vi.fn(),
    incrementDelegationTurnCount: vi.fn(),
    appendRunEvent: vi.fn(),
    updateRunSummary: vi.fn(),
    setRunStepStatus: vi.fn(),
    updateRunStatus: vi.fn(),
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
    onReviewError: vi.fn(),
  }
}

function createParams() {
  return {
    runId: "run-1",
    sessionId: "session-1",
    requestGroupId: "group-1",
    source: "telegram" as const,
    onChunk: undefined,
    signal: new AbortController().signal,
    state: createState(),
    executionSemantics: {
      filesystemEffect: "none",
      privilegedOperation: "not_required",
      artifactDelivery: "none",
      approvalRequired: false,
      approvalTool: "approve_run",
    },
    originalRequest: "do work",
    memorySearchQuery: "do work",
    verificationRequest: "do work",
    workDir: "/tmp",
    onDeliveryError: vi.fn(),
    abortExecutionStream: vi.fn(),
    isRootRequest: true,
    contextMode: "full" as const,
    taskProfile: "general_chat" as const,
    wantsDirectArtifactDelivery: false,
    requiresFilesystemMutation: false,
    requiresPrivilegedToolExecution: false,
    pendingToolParams: new Map<string, unknown>(),
    filesystemMutationPaths: new Set<string>(),
    successfulTools: [],
    seenFollowupPrompts: new Set<string>(),
    seenCommandFailureRecoveryKeys: new Set<string>(),
    seenExecutionRecoveryKeys: new Set<string>(),
    seenDeliveryRecoveryKeys: new Set<string>(),
    seenAiRecoveryKeys: new Set<string>(),
    recoveryBudgetUsage: {
      interpretation: 0,
      execution: 0,
      delivery: 0,
      external: 0,
    },
    priorAssistantMessages: [] as string[],
    syntheticApprovalAlreadyApproved: false,
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

describe("run execution cycle pass", () => {
  it("returns retry when recovery entry asks for reroute", async () => {
    const params = createParams()
    const dependencies = createDependencies()
    const moduleDependencies = {
      runExecutionAttemptPass: vi.fn(async () => ({
        preview: "preview",
        failed: false,
        executionRecoveryLimitStop: null,
        aiRecoveryLimitStop: null,
        aiRecovery: {
          summary: "retry ai",
          reason: "boom",
          message: "boom",
        },
        workerRuntimeRecovery: null,
        executionRecovery: null,
        sawRealFilesystemMutation: false,
        commandFailureSeen: false,
        commandRecoveredWithinSamePass: false,
      })),
      runRecoveryEntryPass: vi.fn(async () => ({
        kind: "retry" as const,
        nextMessage: "retry with fallback",
        nextState: {
          model: "gpt-5-mini",
          providerId: "provider:openai",
          provider: params.state.currentProvider,
          targetId: "provider:openai-mini",
          targetLabel: "OpenAI Mini",
          workerRuntime: undefined,
        },
      })),
      runPostExecutionPass: vi.fn(),
      runReviewCyclePass: vi.fn(),
      applyRecoveryEntryPassResult: vi.fn(({ result }) => ({
        kind: "retry" as const,
        state: {
          currentMessage: result.nextMessage,
          currentModel: result.nextState.model,
          currentProviderId: result.nextState.providerId,
          currentProvider: result.nextState.provider,
          currentTargetId: result.nextState.targetId,
          currentTargetLabel: result.nextState.targetLabel,
          activeWorkerRuntime: result.nextState.workerRuntime,
        },
      })),
      applyPostExecutionPassResult: vi.fn(),
      applyReviewCyclePassResult: vi.fn(),
    }

    const result = await runExecutionCyclePass(params, dependencies, moduleDependencies as never)

    expect(result).toEqual({
      kind: "retry",
      state: {
        ...params.state,
        currentMessage: "retry with fallback",
        currentModel: "gpt-5-mini",
        currentProviderId: "provider:openai",
        currentProvider: params.state.currentProvider,
        currentTargetId: "provider:openai-mini",
        currentTargetLabel: "OpenAI Mini",
        activeWorkerRuntime: undefined,
      },
    })
    expect(moduleDependencies.runPostExecutionPass).not.toHaveBeenCalled()
    expect(moduleDependencies.runReviewCyclePass).not.toHaveBeenCalled()
  })

  it("returns retry when review cycle asks for followup", async () => {
    const params = createParams()
    const dependencies = createDependencies()
    const moduleDependencies = {
      runExecutionAttemptPass: vi.fn(async () => ({
        preview: "preview",
        failed: false,
        executionRecoveryLimitStop: null,
        aiRecoveryLimitStop: null,
        aiRecovery: null,
        workerRuntimeRecovery: null,
        executionRecovery: null,
        sawRealFilesystemMutation: true,
        commandFailureSeen: false,
        commandRecoveredWithinSamePass: false,
      })),
      runRecoveryEntryPass: vi.fn(async () => ({ kind: "continue" as const })),
      runPostExecutionPass: vi.fn(async () => ({
        kind: "continue" as const,
        preview: "post preview",
        deliveryOutcome: {
          directArtifactDeliveryRequested: false,
          hasSuccessfulArtifactDelivery: false,
          deliverySatisfied: false,
          requiresDirectArtifactRecovery: false,
        },
      })),
      runReviewCyclePass: vi.fn(async () => ({
        kind: "retry" as const,
        nextMessage: "ask a follow-up",
        clearWorkerRuntime: true,
        clearProvider: true,
        normalizedFollowupPrompt: "ask a follow-up",
        markTruncatedOutputRecoveryAttempted: true,
      })),
      applyRecoveryEntryPassResult: vi.fn(() => ({ kind: "continue" as const })),
      applyPostExecutionPassResult: vi.fn(({ result, activeWorkerRuntime, filesystemMutationRecoveryAttempted, currentMessage }) => ({
        kind: "continue" as const,
        state: {
          currentMessage,
          filesystemMutationRecoveryAttempted,
          activeWorkerRuntime,
        },
        preview: result.preview,
        deliveryOutcome: result.deliveryOutcome,
      })),
      applyReviewCyclePassResult: vi.fn(({ result, currentProvider, currentMessage, truncatedOutputRecoveryAttempted }) => ({
        kind: "retry" as const,
        state: {
          currentMessage: result.nextMessage ?? currentMessage,
          truncatedOutputRecoveryAttempted: truncatedOutputRecoveryAttempted || Boolean(result.markTruncatedOutputRecoveryAttempted),
          activeWorkerRuntime: undefined,
          currentProvider: result.clearProvider ? undefined : currentProvider,
        },
      })),
    }

    const result = await runExecutionCyclePass(params, dependencies, moduleDependencies as never)

    expect(result).toEqual({
      kind: "retry",
      state: {
        ...params.state,
        currentMessage: "ask a follow-up",
        sawRealFilesystemMutation: true,
        activeWorkerRuntime: undefined,
        currentProvider: undefined,
        truncatedOutputRecoveryAttempted: true,
      },
    })
  })

  it("breaks when post-review cycle completes without retry", async () => {
    const params = createParams()
    const dependencies = createDependencies()
    const moduleDependencies = {
      runExecutionAttemptPass: vi.fn(async () => ({
        preview: "preview",
        failed: false,
        executionRecoveryLimitStop: null,
        aiRecoveryLimitStop: null,
        aiRecovery: null,
        workerRuntimeRecovery: null,
        executionRecovery: null,
        sawRealFilesystemMutation: false,
        commandFailureSeen: false,
        commandRecoveredWithinSamePass: false,
      })),
      runRecoveryEntryPass: vi.fn(async () => ({ kind: "continue" as const })),
      runPostExecutionPass: vi.fn(async () => ({
        kind: "continue" as const,
        preview: "post preview",
        deliveryOutcome: {
          directArtifactDeliveryRequested: false,
          hasSuccessfulArtifactDelivery: false,
          deliverySatisfied: false,
          requiresDirectArtifactRecovery: false,
        },
      })),
      runReviewCyclePass: vi.fn(async () => ({ kind: "break" as const })),
      applyRecoveryEntryPassResult: vi.fn(() => ({ kind: "continue" as const })),
      applyPostExecutionPassResult: vi.fn(({ result, activeWorkerRuntime, filesystemMutationRecoveryAttempted, currentMessage }) => ({
        kind: "continue" as const,
        state: {
          currentMessage,
          filesystemMutationRecoveryAttempted,
          activeWorkerRuntime,
        },
        preview: result.preview,
        deliveryOutcome: result.deliveryOutcome,
      })),
      applyReviewCyclePassResult: vi.fn(() => ({ kind: "break" as const })),
    }

    const result = await runExecutionCyclePass(params, dependencies, moduleDependencies as never)

    expect(result).toEqual({ kind: "break" })
  })
})
