import { describe, expect, it, vi } from "vitest"
import { runReviewOutcomePass } from "../packages/core/src/runs/review-outcome-pass.ts"

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
  }
}

function createParams() {
  return {
    runId: "run-1",
    sessionId: "session-1",
    source: "telegram" as const,
    onChunk: undefined,
    signal: new AbortController().signal,
    preview: "preview",
    review: null,
    syntheticApproval: null,
    executionSemantics: {
      completionMode: "normal",
      deliveryMode: "default",
      artifactMode: "none",
      requiresApproval: false,
      preferredTarget: "auto",
    },
    deliveryOutcome: {
      directArtifactDeliveryRequested: false,
      hasSuccessfulArtifactDelivery: false,
      deliverySatisfied: false,
      requiresDirectArtifactRecovery: false,
    },
    successfulTools: [],
    sawRealFilesystemMutation: false,
    requiresFilesystemMutation: false,
    truncatedOutputRecoveryAttempted: false,
    originalRequest: "hello",
    recoveryBudgetUsage: {
      interpretation: 0,
      execution: 0,
      delivery: 0,
      external: 0,
    },
    defaultMaxDelegationTurns: 3,
    followupPromptSeen: false,
    syntheticApprovalAlreadyApproved: false,
    syntheticApprovalSourceLabel: "agent_reply",
    syntheticApprovalRuntimeDependencies: {
      timeoutSec: 60,
      fallback: "deny" as const,
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
  }
}

describe("review outcome pass", () => {
  it("returns synthetic approval retry continuation", async () => {
    const result = await runReviewOutcomePass({
      ...createParams(),
      syntheticApproval: {
        toolName: "screen_capture",
        summary: "화면 캡처 승인 필요",
        continuationPrompt: "continue with approval",
      },
    }, createDependencies(), {
      runSyntheticApprovalPass: vi.fn().mockResolvedValue({
        kind: "continue",
        eventLabel: "screen_capture 단계 승인",
        reviewSummary: "화면 캡처 승인 필요",
        executingSummary: "승인된 작업을 계속 진행합니다.",
        continuationPrompt: "continue with approval",
        grantMode: "single",
        clearWorkerRuntime: true,
        clearProvider: true,
      }),
      applySyntheticApprovalContinuation: vi.fn().mockReturnValue({
        kind: "continue",
        nextMessage: "continue with approval",
        clearWorkerRuntime: true,
        clearProvider: true,
      }),
      runCompletionPass: vi.fn(),
      applyCompletionApplicationPass: vi.fn(),
    })

    expect(result).toEqual({
      kind: "retry",
      nextMessage: "continue with approval",
      clearWorkerRuntime: true,
      clearProvider: true,
    })
  })

  it("returns completion retry continuation", async () => {
    const result = await runReviewOutcomePass({
      ...createParams(),
      review: {
        status: "followup",
        summary: "retry needed",
        reason: "missing output",
        followupPrompt: "Need more details",
      },
    }, createDependencies(), {
      runSyntheticApprovalPass: vi.fn(),
      applySyntheticApprovalContinuation: vi.fn(),
      runCompletionPass: vi.fn().mockReturnValue({
        decision: { kind: "followup", prompt: "Need more details" },
        application: { kind: "retry" },
        usedTurns: 0,
        maxTurns: 3,
      }),
      applyCompletionApplicationPass: vi.fn().mockResolvedValue({
        kind: "retry",
        nextMessage: "Need more details",
        clearWorkerRuntime: true,
        normalizedFollowupPrompt: "need more details",
      }),
    })

    expect(result).toEqual({
      kind: "retry",
      nextMessage: "Need more details",
      clearWorkerRuntime: true,
      normalizedFollowupPrompt: "need more details",
    })
  })

  it("breaks when completion application does not retry", async () => {
    const result = await runReviewOutcomePass(createParams(), createDependencies(), {
      runSyntheticApprovalPass: vi.fn(),
      applySyntheticApprovalContinuation: vi.fn(),
      runCompletionPass: vi.fn().mockReturnValue({
        decision: { kind: "complete" },
        application: { kind: "complete" },
        usedTurns: 0,
        maxTurns: 3,
      }),
      applyCompletionApplicationPass: vi.fn().mockResolvedValue({
        kind: "break",
      }),
    })

    expect(result).toEqual({ kind: "break" })
  })
})
