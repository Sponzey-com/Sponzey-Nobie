import type { TaskExecutionSemantics } from "../agent/intake.js"
import type { SubAgentResultReview } from "../agent/sub-agent-result-review.js"
import { deriveCompletionStageState, type CompletionStageState } from "./completion-state.js"
import type { DeliveryOutcome } from "./delivery.js"
import type { SuccessfulToolEvidence } from "./recovery.js"

export interface ReviewGateDecision {
  kind: "skip" | "run"
  state: CompletionStageState
  reason?: string
}

export interface SubSessionReviewGateDecision {
  kind:
    | "allow_parent_completion"
    | "wait_for_revision"
    | "parent_aggregation_required"
    | "manual_action_required"
  blockedSubSessionIds: string[]
  limitedSubSessionIds?: string[]
  reasonCodes: string[]
}

export function decideReviewGate(params: {
  executionSemantics: TaskExecutionSemantics
  preview: string
  deliveryOutcome: DeliveryOutcome
  successfulTools: SuccessfulToolEvidence[]
  sawRealFilesystemMutation: boolean
  requiresFilesystemMutation: boolean
  truncatedOutputRecoveryAttempted: boolean
}): ReviewGateDecision {
  const state = deriveCompletionStageState({
    review: null,
    executionSemantics: params.executionSemantics,
    preview: params.preview,
    deliverySatisfied: params.deliveryOutcome.deliverySatisfied,
    successfulTools: params.successfulTools,
    sawRealFilesystemMutation: params.sawRealFilesystemMutation,
    requiresFilesystemMutation: params.requiresFilesystemMutation,
    truncatedOutputRecoveryAttempted: params.truncatedOutputRecoveryAttempted,
  })

  if (
    params.deliveryOutcome.directArtifactDeliveryRequested
    && params.deliveryOutcome.deliverySatisfied
    && state.completionSatisfied
  ) {
    return {
      kind: "skip",
      state,
      reason: "직접 결과 전달과 checklist 기준 완료 항목이 이미 모두 충족되어 completion review를 생략합니다.",
    }
  }

  if (
    !params.deliveryOutcome.directArtifactDeliveryRequested
    && state.completionSatisfied
    && params.deliveryOutcome.hasSuccessfulTextDelivery
    && !params.requiresFilesystemMutation
    && !params.sawRealFilesystemMutation
  ) {
    return {
      kind: "skip",
      state,
      reason: "reply 텍스트 전달 receipt와 checklist 기준 완료 항목이 이미 충족되어 completion review를 생략합니다.",
    }
  }

  if (
    !params.deliveryOutcome.directArtifactDeliveryRequested
    && state.completionSatisfied
    && params.successfulTools.length > 0
    && !params.requiresFilesystemMutation
    && !params.sawRealFilesystemMutation
  ) {
    return {
      kind: "skip",
      state,
      reason: "read-only 실행이 성공했고 checklist 기준 완료 항목이 이미 충족되어 completion review를 생략합니다.",
    }
  }

  return {
    kind: "run",
    state,
  }
}

export function decideSubSessionReviewGate(reviews: Array<{
  subSessionId: string
  review: Pick<SubAgentResultReview, "accepted" | "canRetry" | "normalizedFailureKey" | "manualActionReason"> &
    Partial<Pick<SubAgentResultReview, "verdict" | "parentIntegrationStatus">>
}>): SubSessionReviewGateDecision {
  const blocked = reviews.filter((item) => !item.review.accepted)
  const limited = reviews.filter(
    (item) =>
      item.review.accepted &&
      (item.review.verdict === "limited_success" ||
        item.review.parentIntegrationStatus === "limited_parent_integration"),
  )
  if (blocked.length === 0) {
    if (limited.length > 0) {
      return {
        kind: "parent_aggregation_required",
        blockedSubSessionIds: [],
        limitedSubSessionIds: limited.map((item) => item.subSessionId),
        reasonCodes: [
          "limited_success_parent_integration_requires_parent_decision",
          "parent_aggregation_required",
        ],
      }
    }
    return {
      kind: "allow_parent_completion",
      blockedSubSessionIds: [],
      limitedSubSessionIds: [],
      reasonCodes: ["all_sub_session_results_accepted"],
    }
  }
  const needsManualAction = blocked.some(
    (item) =>
      !item.review.canRetry &&
      (item.review.manualActionReason === "permission_required" ||
        item.review.manualActionReason === "user_decision_required"),
  )
  return {
    kind: needsManualAction
      ? "manual_action_required"
      : blocked.some((item) => item.review.canRetry)
        ? "wait_for_revision"
        : "parent_aggregation_required",
    blockedSubSessionIds: blocked.map((item) => item.subSessionId),
    limitedSubSessionIds: limited.map((item) => item.subSessionId),
    reasonCodes: [...new Set(blocked.map((item) =>
      item.review.manualActionReason
      ?? item.review.normalizedFailureKey
      ?? "sub_session_result_not_accepted",
    ))].sort(),
  }
}
