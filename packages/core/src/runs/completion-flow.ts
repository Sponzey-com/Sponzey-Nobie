import type { CompletionReviewResult } from "../agent/completion-review.js"
import type { TaskExecutionSemantics } from "../agent/intake.js"
import { buildImplicitExecutionSummary } from "./execution.js"
import { deriveCompletionStageState } from "./completion-state.js"
import { shouldRetryTruncatedOutput, type SuccessfulToolEvidence } from "./recovery.js"

export type CompletionFlowDecision =
  | {
      kind: "recover_empty_result"
      summary: string
      reason: string
      remainingItems: string[]
    }
  | {
      kind: "complete"
      summary: string
      persistedText: string
      statusText: string
    }
  | {
      kind: "invalid_followup"
      summary: string
      reason: string
      remainingItems: string[]
    }
  | {
      kind: "followup"
      summary: string
      reason: string
      remainingItems: string[]
      followupPrompt: string
    }
  | {
      kind: "retry_truncated"
      summary: string
      reason?: string
      remainingItems?: string[]
    }
  | {
      kind: "ask_user"
      summary: string
      reason?: string
      remainingItems?: string[]
      userMessage?: string
    }

export function decideCompletionFlow(params: {
  review: CompletionReviewResult | null
  executionSemantics: TaskExecutionSemantics
  preview: string
  deliverySatisfied: boolean
  successfulTools: SuccessfulToolEvidence[]
  sawRealFilesystemMutation: boolean
  requiresFilesystemMutation: boolean
  truncatedOutputRecoveryAttempted: boolean
}): CompletionFlowDecision {
  const completionState = deriveCompletionStageState({
    review: params.review,
    executionSemantics: params.executionSemantics,
    preview: params.preview,
    deliverySatisfied: params.deliverySatisfied,
    successfulTools: params.successfulTools,
    sawRealFilesystemMutation: params.sawRealFilesystemMutation,
    requiresFilesystemMutation: params.requiresFilesystemMutation,
    truncatedOutputRecoveryAttempted: params.truncatedOutputRecoveryAttempted,
  })

  if (!params.review && !completionState.completionSatisfied) {
    return {
      kind: "recover_empty_result",
      summary: "실행 결과가 비어 있어 다른 방법으로 다시 시도합니다.",
      reason: completionState.blockingReasons[0]
        ?? "명확한 응답, 성공한 도구 결과, 실제 파일 변경, 전달 완료 중 어떤 근거도 확인되지 않았습니다.",
      remainingItems: ["실제 실행 결과를 남기거나 다른 방법으로 다시 시도해야 합니다."],
    }
  }

  if (params.review?.status === "complete" && !completionState.completionSatisfied) {
    return {
      kind: "recover_empty_result",
      summary: "완료 판정 근거가 부족해 다시 확인합니다.",
      reason: completionState.blockingReasons[0]
        ? `completion review가 complete를 반환했지만 receipt 기준 4축 상태로는 아직 완료 근거가 부족합니다: ${completionState.blockingReasons[0]}`
        : "completion review가 complete를 반환했지만 receipt 기준 완료 근거가 부족합니다.",
      remainingItems: ["실제 실행 또는 전달 근거를 다시 확인해야 합니다."],
    }
  }

  if ((!params.review || params.review.status === "complete") && completionState.completionSatisfied) {
    const summary =
      params.review?.summary?.trim()
      || params.preview
      || buildImplicitExecutionSummary({
        successfulTools: params.successfulTools,
        sawRealFilesystemMutation: params.sawRealFilesystemMutation,
      })
      || "실행을 완료했습니다."

    return {
      kind: "complete",
      summary,
      persistedText: params.preview || summary,
      statusText: params.preview || "실행을 완료했습니다.",
    }
  }

  const review = params.review
  if (!review) {
    return {
      kind: "recover_empty_result",
      summary: "완료 판단 근거가 부족해 다시 시도합니다.",
      reason: completionState.blockingReasons[0]
        ?? "completion review 결과가 없고 receipt 기준 완료 근거도 부족합니다.",
      remainingItems: ["실제 실행 또는 전달 근거를 다시 확인해야 합니다."],
    }
  }

  if (review.status === "followup") {
    const followupPrompt = review.followupPrompt?.trim()
    if (!followupPrompt) {
      return {
        kind: "invalid_followup",
        summary: review.summary || "추가 작업이 남아 있지만 후속 지시가 비어 있습니다.",
        reason: review.reason || "후속 처리 지시 생성 실패",
        remainingItems: review.remainingItems,
      }
    }

    return {
      kind: "followup",
      summary: review.summary || "추가 처리가 필요합니다.",
      reason: review.reason,
      remainingItems: review.remainingItems,
      followupPrompt,
    }
  }

  if (shouldRetryTruncatedOutput({
    review,
    preview: params.preview,
    requiresFilesystemMutation: params.requiresFilesystemMutation,
  }) && !params.truncatedOutputRecoveryAttempted) {
    return {
      kind: "retry_truncated",
      summary: review.summary || "중간에 끊긴 작업을 자동으로 다시 시도합니다.",
      ...(review.reason ? { reason: review.reason } : {}),
      ...(review.remainingItems.length > 0 ? { remainingItems: review.remainingItems } : {}),
    }
  }

  return {
    kind: "ask_user",
    summary: review.summary || "사용자 추가 입력이 필요합니다.",
    ...(review.reason ? { reason: review.reason } : {}),
    ...(review.remainingItems.length > 0 ? { remainingItems: review.remainingItems } : {}),
    ...(review.userMessage ? { userMessage: review.userMessage } : {}),
  }
}
