import type { AIProvider } from "../ai/index.js"
import { getRootRun } from "./store.js"
import { defaultReviewPassDependencies, runReviewPass } from "./review-pass.js"
import { runReviewOutcomePass, type ReviewOutcomePassResult } from "./review-outcome-pass.js"
import type { RunChunkDeliveryHandler, DeliveryOutcome, SuccessfulFileDelivery } from "./delivery.js"
import type { SuccessfulToolEvidence } from "./recovery.js"
import type { TaskExecutionSemantics } from "../agent/intake.js"
import type { FinalizationDependencies, FinalizationSource } from "./finalization.js"
import type { RecoveryBudgetUsage } from "./recovery-budget.js"
import type { SyntheticApprovalRuntimeDependencies } from "./approval.js"
import { decideReviewGate } from "./review-gate.js"

interface ReviewCyclePassDependencies {
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
  onReviewError?: (message: string) => void
}

interface ReviewCyclePassModuleDependencies {
  decideReviewGate: typeof decideReviewGate
  runReviewPass: typeof runReviewPass
  runReviewOutcomePass: typeof runReviewOutcomePass
  getRootRun: typeof getRootRun
}

const defaultModuleDependencies: ReviewCyclePassModuleDependencies = {
  decideReviewGate,
  runReviewPass,
  runReviewOutcomePass,
  getRootRun,
}

export async function runReviewCyclePass(
  params: {
    runId: string
    sessionId: string
    source: FinalizationSource
    onChunk: RunChunkDeliveryHandler | undefined
    signal: AbortSignal
    preview: string
    priorAssistantMessages: string[]
    executionSemantics: TaskExecutionSemantics
    requiresFilesystemMutation: boolean
    originalRequest: string
    model?: string
    providerId?: string
    provider?: AIProvider
    workDir?: string
    usesWorkerRuntime: boolean
    workerRuntimeKind?: string
    requiresPrivilegedToolExecution: boolean
    successfulTools: SuccessfulToolEvidence[]
    successfulFileDeliveries: SuccessfulFileDelivery[]
    sawRealFilesystemMutation: boolean
    deliveryOutcome: DeliveryOutcome
    truncatedOutputRecoveryAttempted: boolean
    recoveryBudgetUsage: RecoveryBudgetUsage
    seenFollowupPrompts: Set<string>
    syntheticApprovalAlreadyApproved: boolean
    syntheticApprovalRuntimeDependencies: SyntheticApprovalRuntimeDependencies
    finalizationDependencies: FinalizationDependencies
    approvalRequired: boolean
    approvalTool: string
    defaultMaxDelegationTurns: number
  },
  dependencies: ReviewCyclePassDependencies,
  moduleDependencies: ReviewCyclePassModuleDependencies = defaultModuleDependencies,
): Promise<ReviewOutcomePassResult> {
  const reviewGate = moduleDependencies.decideReviewGate({
    executionSemantics: params.executionSemantics,
    preview: params.preview,
    deliveryOutcome: params.deliveryOutcome,
    successfulTools: params.successfulTools,
    sawRealFilesystemMutation: params.sawRealFilesystemMutation,
    requiresFilesystemMutation: params.requiresFilesystemMutation,
    truncatedOutputRecoveryAttempted: params.truncatedOutputRecoveryAttempted,
  })

  const reviewPass = reviewGate.kind === "skip"
    ? {
        review: null,
        syntheticApproval: null,
      }
    : await moduleDependencies.runReviewPass({
        executionProfile: {
          approvalRequired: params.approvalRequired,
          approvalTool: params.approvalTool,
        },
        originalRequest: params.originalRequest,
        preview: params.preview,
        priorAssistantMessages: params.priorAssistantMessages,
        ...(params.model ? { model: params.model } : {}),
        ...(params.providerId ? { providerId: params.providerId } : {}),
        ...(params.provider ? { provider: params.provider } : {}),
        ...(params.workDir ? { workDir: params.workDir } : {}),
        usesWorkerRuntime: params.usesWorkerRuntime,
        requiresPrivilegedToolExecution: params.requiresPrivilegedToolExecution,
        successfulTools: params.successfulTools,
        successfulFileDeliveries: params.successfulFileDeliveries,
        sawRealFilesystemMutation: params.sawRealFilesystemMutation,
      }, {
        ...defaultReviewPassDependencies,
        ...(dependencies.onReviewError ? { onReviewError: dependencies.onReviewError } : {}),
      })

  params.priorAssistantMessages.push(params.preview)
  const currentRun = moduleDependencies.getRootRun(params.runId)
  const normalizedFollowupPrompt = reviewPass.review?.status === "followup"
    ? reviewPass.review.followupPrompt?.replace(/\s+/g, " ").trim().toLowerCase()
    : undefined

  return moduleDependencies.runReviewOutcomePass({
    runId: params.runId,
    sessionId: params.sessionId,
    source: params.source,
    onChunk: params.onChunk,
    signal: params.signal,
    preview: params.preview,
    review: reviewPass.review,
    syntheticApproval: reviewPass.syntheticApproval,
    executionSemantics: params.executionSemantics,
    deliveryOutcome: params.deliveryOutcome,
    successfulTools: params.successfulTools,
    sawRealFilesystemMutation: params.sawRealFilesystemMutation,
    requiresFilesystemMutation: params.requiresFilesystemMutation,
    truncatedOutputRecoveryAttempted: params.truncatedOutputRecoveryAttempted,
    originalRequest: params.originalRequest,
    recoveryBudgetUsage: params.recoveryBudgetUsage,
    ...(typeof currentRun?.delegationTurnCount === "number"
      ? { delegationTurnCount: currentRun.delegationTurnCount }
      : {}),
    ...(typeof currentRun?.maxDelegationTurns === "number"
      ? { maxDelegationTurns: currentRun.maxDelegationTurns }
      : {}),
    defaultMaxDelegationTurns: params.defaultMaxDelegationTurns,
    followupPromptSeen: Boolean(normalizedFollowupPrompt && params.seenFollowupPrompts.has(normalizedFollowupPrompt)),
    syntheticApprovalAlreadyApproved: params.syntheticApprovalAlreadyApproved,
    syntheticApprovalSourceLabel: params.workerRuntimeKind ?? "agent_reply",
    syntheticApprovalRuntimeDependencies: params.syntheticApprovalRuntimeDependencies,
    finalizationDependencies: params.finalizationDependencies,
  }, {
    rememberRunApprovalScope: dependencies.rememberRunApprovalScope,
    grantRunApprovalScope: dependencies.grantRunApprovalScope,
    grantRunSingleApproval: dependencies.grantRunSingleApproval,
    rememberRunFailure: dependencies.rememberRunFailure,
    incrementDelegationTurnCount: dependencies.incrementDelegationTurnCount,
    appendRunEvent: dependencies.appendRunEvent,
    updateRunSummary: dependencies.updateRunSummary,
    setRunStepStatus: dependencies.setRunStepStatus,
    updateRunStatus: dependencies.updateRunStatus,
  })
}
