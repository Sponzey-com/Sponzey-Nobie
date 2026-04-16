import type { TaskExecutionSemantics } from "../agent/intake.js"
import { deriveCompletionStageState, type CompletionStageState } from "./completion-state.js"
import type { DeliveryOutcome } from "./delivery.js"
import type { SuccessfulToolEvidence } from "./recovery.js"

export interface ReviewGateDecision {
  kind: "skip" | "run"
  state: CompletionStageState
  reason?: string
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
