import { describe, expect, it, vi } from "vitest"
import { runPostExecutionPass } from "../packages/core/src/runs/post-execution-pass.ts"

function createDependencies() {
  return {
    rememberRunFailure: vi.fn(),
    incrementDelegationTurnCount: vi.fn(),
    appendRunEvent: vi.fn(),
    updateRunSummary: vi.fn(),
    setRunStepStatus: vi.fn(),
    updateRunStatus: vi.fn(),
    getFinalizationDependencies: vi.fn(() => ({
      appendRunEvent: vi.fn(),
      setRunStepStatus: vi.fn(),
      updateRunStatus: vi.fn(),
      rememberRunSuccess: vi.fn(),
      rememberRunFailure: vi.fn(),
    })),
    insertMessage: vi.fn(),
    writeReplyLog: vi.fn(),
    createId: vi.fn(() => "msg-1"),
    now: vi.fn(() => 123),
    runVerificationSubtask: vi.fn(async () => ({
      ok: true,
      summary: "verified",
    })),
  }
}

function createModuleDependencies() {
  return {
    decideExecutionPostPassRecovery: vi.fn(() => ({ kind: "none" as const })),
    applyExecutionPostPassDecision: vi.fn(async () => ({ kind: "continue" as const })),
    runDeliveryPass: vi.fn(() => ({
      deliveryOutcome: {
        directArtifactDeliveryRequested: false,
        hasSuccessfulArtifactDelivery: false,
        deliverySatisfied: false,
        requiresDirectArtifactRecovery: false,
      },
      preview: "delivery preview",
      directDeliveryApplication: { kind: "none" as const },
    })),
    decideFilesystemPostPassRecovery: vi.fn(async () => ({ kind: "none" as const })),
    applyFilesystemPostPassDecision: vi.fn(async () => ({ kind: "continue" as const })),
    runReviewEntryPass: vi.fn(async () => ({ kind: "continue" as const })),
  }
}

function createParams() {
  return {
    runId: "run-1",
    sessionId: "session-1",
    source: "telegram" as const,
    onChunk: undefined,
    preview: "preview",
    originalRequest: "capture and send",
    verificationRequest: "capture and send",
    wantsDirectArtifactDelivery: true,
    requiresFilesystemMutation: true,
    activeWorkerRuntime: true,
    workerSessionId: "worker-1",
    successfulFileDeliveries: [],
    successfulTools: [],
    sawRealFilesystemMutation: false,
    filesystemMutationRecoveryAttempted: false,
    mutationPaths: ["out.png"],
    failedCommandTools: [],
    commandFailureSeen: false,
    commandRecoveredWithinSamePass: false,
    executionRecovery: null,
    seenCommandFailureRecoveryKeys: new Set<string>(),
    seenExecutionRecoveryKeys: new Set<string>(),
    seenDeliveryRecoveryKeys: new Set<string>(),
    recoveryBudgetUsage: {
      interpretation: 0,
      execution: 0,
      delivery: 0,
      external: 0,
    },
    usedTurns: 0,
    maxDelegationTurns: 3,
  }
}

describe("run post execution pass", () => {
  it("returns retry with execution seen key metadata", async () => {
    const dependencies = createDependencies()
    const moduleDependencies = createModuleDependencies()
    moduleDependencies.decideExecutionPostPassRecovery.mockReturnValue({
      kind: "retry",
      seenKey: "command:key",
      seenKeyKind: "command",
      state: {
        summary: "retry execution",
        budgetKind: "execution",
        maxDelegationTurns: 3,
        eventLabel: "retry execution",
        nextMessage: "retry prompt",
        reviewStepStatus: "running",
        executingStepSummary: "retry execution",
      },
    })
    moduleDependencies.applyExecutionPostPassDecision.mockResolvedValue({
      kind: "retry",
      nextMessage: "retry prompt",
      clearWorkerRuntime: true,
      seenKey: {
        key: "command:key",
        kind: "command",
      },
    })

    const result = await runPostExecutionPass(createParams(), dependencies, moduleDependencies)

    expect(result).toEqual({
      kind: "retry",
      nextMessage: "retry prompt",
      clearWorkerRuntime: true,
      seenCommandFailureRecoveryKey: "command:key",
    })
    expect(moduleDependencies.runDeliveryPass).not.toHaveBeenCalled()
  })

  it("returns retry with delivery recovery key after review entry retry", async () => {
    const dependencies = createDependencies()
    const moduleDependencies = createModuleDependencies()
    moduleDependencies.runDeliveryPass.mockReturnValue({
      deliveryOutcome: {
        directArtifactDeliveryRequested: true,
        hasSuccessfulArtifactDelivery: false,
        deliverySatisfied: false,
        requiresDirectArtifactRecovery: true,
      },
      preview: "delivery preview",
      directDeliveryApplication: {
        kind: "retry",
        recoveryKey: "delivery:key",
        summary: "retry delivery",
        detail: "delivery missing",
        title: "direct_artifact_delivery_recovery",
        eventLabel: "retry delivery",
        alternatives: [],
        nextMessage: "delivery retry prompt",
        reviewStepStatus: "running",
        executingStepSummary: "retry delivery",
        clearWorkerRuntime: true,
      },
    })
    moduleDependencies.runReviewEntryPass.mockResolvedValue({
      kind: "retry",
      nextMessage: "delivery retry prompt",
      clearWorkerRuntime: true,
    })

    const result = await runPostExecutionPass(createParams(), dependencies, moduleDependencies)

    expect(result).toEqual({
      kind: "retry",
      nextMessage: "delivery retry prompt",
      clearWorkerRuntime: true,
      seenDeliveryRecoveryKey: "delivery:key",
    })
  })

  it("continues with updated preview and delivery outcome", async () => {
    const dependencies = createDependencies()
    const moduleDependencies = createModuleDependencies()
    moduleDependencies.runDeliveryPass.mockReturnValue({
      deliveryOutcome: {
        directArtifactDeliveryRequested: true,
        hasSuccessfulArtifactDelivery: true,
        deliverySatisfied: true,
        requiresDirectArtifactRecovery: false,
        deliverySummary: "telegram file sent",
      },
      preview: "delivery preview",
      summaryToLog: "telegram file sent",
      directDeliveryApplication: { kind: "none" },
    })
    moduleDependencies.applyFilesystemPostPassDecision.mockResolvedValue({
      kind: "continue",
      preview: "verified preview",
    })

    const result = await runPostExecutionPass(createParams(), dependencies, moduleDependencies)

    expect(result).toEqual({
      kind: "continue",
      preview: "verified preview",
      deliveryOutcome: {
        directArtifactDeliveryRequested: true,
        hasSuccessfulArtifactDelivery: true,
        deliverySatisfied: true,
        requiresDirectArtifactRecovery: false,
        deliverySummary: "telegram file sent",
      },
    })
    expect(dependencies.updateRunSummary).toHaveBeenCalledWith("run-1", "telegram file sent")
  })
})
