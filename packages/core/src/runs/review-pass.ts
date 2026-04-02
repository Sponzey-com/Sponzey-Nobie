import type { CompletionReviewResult } from "../agent/completion-review.js"
import { reviewTaskCompletion } from "../agent/completion-review.js"
import type { LLMProvider } from "../llm/index.js"
import type { SuccessfulFileDelivery } from "./delivery.js"
import {
  detectSyntheticApprovalRequest,
  type SyntheticApprovalRequest,
} from "./approval.js"
import type { SuccessfulToolEvidence } from "./recovery.js"

export interface ReviewPassResult {
  review: CompletionReviewResult | null
  syntheticApproval: SyntheticApprovalRequest | null
}

export interface ReviewPassDependencies {
  reviewTaskCompletion: typeof reviewTaskCompletion
  onReviewError?: (message: string) => void
}

export async function runReviewPass(params: {
  executionProfile: {
    approvalRequired: boolean
    approvalTool: string
  }
  originalRequest: string
  preview: string
  priorAssistantMessages: string[]
  model?: string
  providerId?: string
  provider?: LLMProvider
  workDir?: string
  usesWorkerRuntime: boolean
  requiresPrivilegedToolExecution: boolean
  successfulTools: SuccessfulToolEvidence[]
  successfulFileDeliveries: SuccessfulFileDelivery[]
  sawRealFilesystemMutation: boolean
}, dependencies: ReviewPassDependencies): Promise<ReviewPassResult> {
  const review = await dependencies.reviewTaskCompletion({
    originalRequest: params.originalRequest,
    latestAssistantMessage: params.preview,
    priorAssistantMessages: params.priorAssistantMessages,
    ...(params.model ? { model: params.model } : {}),
    ...(params.providerId ? { providerId: params.providerId } : {}),
    ...(params.provider ? { provider: params.provider } : {}),
    ...(params.workDir ? { workDir: params.workDir } : {}),
  }).catch((error) => {
    dependencies.onReviewError?.(error instanceof Error ? error.message : String(error))
    return null
  })

  const syntheticApproval = detectSyntheticApprovalRequest({
    executionProfile: params.executionProfile,
    originalRequest: params.originalRequest,
    preview: params.preview,
    review,
    usesWorkerRuntime: params.usesWorkerRuntime,
    requiresPrivilegedToolExecution: params.requiresPrivilegedToolExecution,
    successfulTools: params.successfulTools,
    successfulFileDeliveries: params.successfulFileDeliveries,
    sawRealFilesystemMutation: params.sawRealFilesystemMutation,
  })

  return { review, syntheticApproval }
}

export const defaultReviewPassDependencies: ReviewPassDependencies = {
  reviewTaskCompletion,
}
