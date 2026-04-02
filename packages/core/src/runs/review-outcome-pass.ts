import type { CompletionReviewResult } from "../agent/completion-review.js"
import type { TaskExecutionSemantics } from "../agent/intake.js"
import type { DeliveryOutcome, RunChunkDeliveryHandler } from "./delivery.js"
import type { FinalizationDependencies, FinalizationSource } from "./finalization.js"
import type { RecoveryBudgetUsage } from "./recovery-budget.js"
import type { SuccessfulToolEvidence } from "./recovery.js"
import { type SyntheticApprovalRequest, type SyntheticApprovalRuntimeDependencies } from "./approval.js"
import { applySyntheticApprovalContinuation } from "./approval-application.js"
import { runSyntheticApprovalPass } from "./approval-pass.js"
import { applyCompletionApplicationPass, type CompletionApplicationPassResult } from "./completion-application-pass.js"
import { runCompletionPass } from "./completion-pass.js"

export type ReviewOutcomePassResult =
  | { kind: "break" }
  | {
      kind: "retry"
      nextMessage: string
      clearWorkerRuntime: boolean
      clearProvider?: boolean
      normalizedFollowupPrompt?: string
      markTruncatedOutputRecoveryAttempted?: boolean
    }

interface ReviewOutcomePassDependencies {
  rememberRunApprovalScope: (runId: string) => void
  grantRunApprovalScope: (runId: string) => void
  grantRunSingleApproval: (runId: string) => void
  rememberRunFailure: (params: {
    runId: string
    sessionId: string
    source: FinalizationSource
    summary: string
    detail?: string
    title?: string
  }) => void
  incrementDelegationTurnCount: (runId: string, summary: string) => void
  appendRunEvent: (runId: string, message: string) => void
  updateRunSummary: (runId: string, summary: string) => void
  setRunStepStatus: (
    runId: string,
    step: string,
    status: "pending" | "running" | "completed" | "failed" | "cancelled",
    summary: string,
  ) => void
  updateRunStatus: (
    runId: string,
    status: "queued" | "running" | "awaiting_approval" | "awaiting_user" | "completed" | "failed" | "cancelled" | "interrupted",
    summary: string,
    active: boolean,
  ) => void
}

interface ReviewOutcomePassModuleDependencies {
  runSyntheticApprovalPass: typeof runSyntheticApprovalPass
  applySyntheticApprovalContinuation: typeof applySyntheticApprovalContinuation
  runCompletionPass: typeof runCompletionPass
  applyCompletionApplicationPass: typeof applyCompletionApplicationPass
}

const defaultModuleDependencies: ReviewOutcomePassModuleDependencies = {
  runSyntheticApprovalPass,
  applySyntheticApprovalContinuation,
  runCompletionPass,
  applyCompletionApplicationPass,
}

export async function runReviewOutcomePass(
  params: {
    runId: string
    sessionId: string
    source: FinalizationSource
    onChunk: RunChunkDeliveryHandler | undefined
    signal: AbortSignal
    preview: string
    review: CompletionReviewResult | null
    syntheticApproval: SyntheticApprovalRequest | null
    executionSemantics: TaskExecutionSemantics
    deliveryOutcome: DeliveryOutcome
    successfulTools: SuccessfulToolEvidence[]
    sawRealFilesystemMutation: boolean
    requiresFilesystemMutation: boolean
    truncatedOutputRecoveryAttempted: boolean
    originalRequest: string
    recoveryBudgetUsage: RecoveryBudgetUsage
    delegationTurnCount?: number
    maxDelegationTurns?: number
    defaultMaxDelegationTurns: number
    followupPromptSeen: boolean
    syntheticApprovalAlreadyApproved: boolean
    syntheticApprovalSourceLabel: string
    syntheticApprovalRuntimeDependencies: SyntheticApprovalRuntimeDependencies
    finalizationDependencies: FinalizationDependencies
  },
  dependencies: ReviewOutcomePassDependencies,
  moduleDependencies: ReviewOutcomePassModuleDependencies = defaultModuleDependencies,
): Promise<ReviewOutcomePassResult> {
  if (params.syntheticApproval) {
    const continuation = await moduleDependencies.runSyntheticApprovalPass({
      request: params.syntheticApproval,
      runId: params.runId,
      sessionId: params.sessionId,
      signal: params.signal,
      alreadyApproved: params.syntheticApprovalAlreadyApproved,
      sourceLabel: params.syntheticApprovalSourceLabel,
      originalRequest: params.originalRequest,
      latestAssistantMessage: params.preview,
      runtimeDependencies: params.syntheticApprovalRuntimeDependencies,
    })

    const approvalApplication = moduleDependencies.applySyntheticApprovalContinuation({
      runId: params.runId,
      continuation,
      aborted: params.signal.aborted,
    }, dependencies)

    if (approvalApplication.kind === "stop") {
      return { kind: "break" }
    }

    return {
      kind: "retry",
      nextMessage: approvalApplication.nextMessage,
      clearWorkerRuntime: approvalApplication.clearWorkerRuntime,
      ...(approvalApplication.clearProvider ? { clearProvider: approvalApplication.clearProvider } : {}),
    }
  }

  const normalizedFollowupPrompt = params.review?.status === "followup"
    ? params.review.followupPrompt?.replace(/\s+/g, " ").trim().toLowerCase()
    : undefined

  const completionPass = moduleDependencies.runCompletionPass({
    review: params.review,
    executionSemantics: params.executionSemantics,
    preview: params.preview,
    deliveryOutcome: params.deliveryOutcome,
    successfulTools: params.successfulTools,
    sawRealFilesystemMutation: params.sawRealFilesystemMutation,
    requiresFilesystemMutation: params.requiresFilesystemMutation,
    truncatedOutputRecoveryAttempted: params.truncatedOutputRecoveryAttempted,
    originalRequest: params.originalRequest,
    recoveryBudgetUsage: params.recoveryBudgetUsage,
    ...(typeof params.delegationTurnCount === "number"
      ? { delegationTurnCount: params.delegationTurnCount }
      : {}),
    ...(typeof params.maxDelegationTurns === "number"
      ? { maxDelegationTurns: params.maxDelegationTurns }
      : {}),
    defaultMaxDelegationTurns: params.defaultMaxDelegationTurns,
    followupAlreadySeen: params.followupPromptSeen,
  })

  const completionApplicationPass: CompletionApplicationPassResult = await moduleDependencies.applyCompletionApplicationPass({
    runId: params.runId,
    sessionId: params.sessionId,
    source: params.source,
    onChunk: params.onChunk,
    preview: params.preview,
    state: completionPass.state,
    application: completionPass.application,
    maxTurns: completionPass.maxTurns,
    recoveryBudgetUsage: params.recoveryBudgetUsage,
    finalizationDependencies: params.finalizationDependencies,
  }, dependencies)

  if (completionApplicationPass.kind === "retry") {
    return {
      kind: "retry",
      nextMessage: completionApplicationPass.nextMessage,
      clearWorkerRuntime: completionApplicationPass.clearWorkerRuntime,
      ...(completionApplicationPass.normalizedFollowupPrompt
        ? { normalizedFollowupPrompt: completionApplicationPass.normalizedFollowupPrompt }
        : normalizedFollowupPrompt
          ? { normalizedFollowupPrompt }
          : {}),
      ...(completionApplicationPass.markTruncatedOutputRecoveryAttempted
        ? { markTruncatedOutputRecoveryAttempted: completionApplicationPass.markTruncatedOutputRecoveryAttempted }
        : {}),
    }
  }

  return { kind: "break" }
}
