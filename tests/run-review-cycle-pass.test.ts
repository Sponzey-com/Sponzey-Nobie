import { describe, expect, it, vi } from "vitest"
import { runReviewCyclePass } from "../packages/core/src/runs/review-cycle-pass.ts"

function createDependencies() {
  return {
    rememberRunApprovalScope: vi.fn(),
    grantRunApprovalScope: vi.fn(),
    grantRunSingleApproval: vi.fn(),
    rememberRunFailure: vi.fn(),
    incrementDelegationTurnCount: vi.fn(),
    appendRunEvent: vi.fn(),
    updateRunSummary: vi.fn(),
    setRunStepStatus: vi.fn(),
    updateRunStatus: vi.fn(),
    onReviewError: vi.fn(),
  }
}

function createModuleDependencies() {
  return {
    runReviewPass: vi.fn(async () => ({
      review: {
        status: "followup",
        summary: "need followup",
        followupPrompt: "Need   more detail",
      },
      syntheticApproval: null,
    })),
    runReviewOutcomePass: vi.fn(async () => ({ kind: "break" as const })),
    getRootRun: vi.fn(() => ({
      delegationTurnCount: 2,
      maxDelegationTurns: 5,
    })),
  }
}

function createParams() {
  return {
    runId: "run-1",
    sessionId: "session-1",
    source: "telegram" as const,
    onChunk: undefined,
    signal: new AbortController().signal,
    preview: "preview text",
    priorAssistantMessages: ["old preview"],
    executionSemantics: {
      filesystemEffect: "none",
      artifactDelivery: "none",
      approvalRequired: false,
      approvalTool: "none",
      privilegedOperation: "none",
    },
    requiresFilesystemMutation: false,
    originalRequest: "original request",
    model: "gpt-test",
    workDir: "/tmp",
    usesWorkerRuntime: true,
    workerRuntimeKind: "worker_runtime",
    requiresPrivilegedToolExecution: false,
    successfulTools: [],
    successfulFileDeliveries: [],
    sawRealFilesystemMutation: false,
    deliveryOutcome: {
      directArtifactDeliveryRequested: false,
      hasSuccessfulArtifactDelivery: false,
      deliverySatisfied: false,
      requiresDirectArtifactRecovery: false,
    },
    truncatedOutputRecoveryAttempted: false,
    recoveryBudgetUsage: {
      interpretation: 0,
      execution: 0,
      delivery: 0,
      external: 0,
    },
    seenFollowupPrompts: new Set(["need more detail"]),
    syntheticApprovalAlreadyApproved: false,
    syntheticApprovalRuntimeDependencies: {
      timeoutSec: 30,
      fallback: "deny",
      appendRunEvent: vi.fn(),
      setRunStepStatus: vi.fn(),
      updateRunStatus: vi.fn(),
      cancelRun: vi.fn(),
      emitApprovalResolved: vi.fn(),
      emitApprovalRequest: vi.fn(),
      onRequested: vi.fn(),
    },
    finalizationDependencies: {
      appendRunEvent: vi.fn(),
      setRunStepStatus: vi.fn(),
      updateRunStatus: vi.fn(),
      rememberRunSuccess: vi.fn(),
      rememberRunFailure: vi.fn(),
    },
    approvalRequired: false,
    approvalTool: "none",
    defaultMaxDelegationTurns: 8,
  }
}

describe("run review cycle pass", () => {
  it("passes review state and delegation counts into review outcome", async () => {
    const dependencies = createDependencies()
    const moduleDependencies = createModuleDependencies()
    const params = createParams()

    const result = await runReviewCyclePass(params, dependencies, moduleDependencies)

    expect(result).toEqual({ kind: "break" })
    expect(params.priorAssistantMessages).toEqual(["old preview", "preview text"])
    expect(moduleDependencies.runReviewOutcomePass).toHaveBeenCalledWith(
      expect.objectContaining({
        runId: "run-1",
        preview: "preview text",
        delegationTurnCount: 2,
        maxDelegationTurns: 5,
        followupPromptSeen: true,
        syntheticApprovalSourceLabel: "worker_runtime",
      }),
      expect.any(Object),
    )
  })

  it("forwards retry outcome from review outcome pass", async () => {
    const dependencies = createDependencies()
    const moduleDependencies = createModuleDependencies()
    moduleDependencies.runReviewOutcomePass.mockResolvedValue({
      kind: "retry",
      nextMessage: "retry prompt",
      clearWorkerRuntime: true,
      normalizedFollowupPrompt: "need more detail",
    })

    const result = await runReviewCyclePass(createParams(), dependencies, moduleDependencies)

    expect(result).toEqual({
      kind: "retry",
      nextMessage: "retry prompt",
      clearWorkerRuntime: true,
      normalizedFollowupPrompt: "need more detail",
    })
  })
})
