import type { CompletionReviewResult } from "../agent/completion-review.js"
import type { TaskExecutionSemantics } from "../agent/intake.js"
import { allowsTextOnlyCompletion } from "./execution.js"
import { shouldRetryTruncatedOutput } from "./recovery.js"
import type { SuccessfulToolEvidence } from "./recovery.js"

export interface CompletionEvidenceState {
  executionSatisfied: boolean
  deliveryRequired: boolean
  deliverySatisfied: boolean
  completionSatisfied: boolean
  conflictReason?: string
}

export type CompletionInterpretationStatus = "satisfied" | "followup_required" | "user_input_required"
export type CompletionExecutionStatus = "satisfied" | "missing"
export type CompletionDeliveryStatus = "satisfied" | "missing" | "not_required"
export type CompletionRecoveryStatus = "settled" | "required"
export type CompletionChecklistItemKey = "request" | "execution" | "delivery" | "completion"
export type CompletionChecklistItemStatus = "completed" | "pending" | "not_required"

export interface CompletionChecklistItem {
  key: CompletionChecklistItemKey
  status: CompletionChecklistItemStatus
  reason?: string
}

export interface CompletionChecklistState {
  items: CompletionChecklistItem[]
  completedCount: number
  actionableCount: number
  pendingCount: number
}

export interface CompletionStageState extends CompletionEvidenceState {
  interpretationStatus: CompletionInterpretationStatus
  executionStatus: CompletionExecutionStatus
  deliveryStatus: CompletionDeliveryStatus
  recoveryStatus: CompletionRecoveryStatus
  blockingReasons: string[]
  checklist?: CompletionChecklistState
}

export function deriveCompletionEvidenceState(params: {
  executionSemantics: TaskExecutionSemantics
  preview: string
  deliverySatisfied: boolean
  successfulTools: SuccessfulToolEvidence[]
  sawRealFilesystemMutation: boolean
}): CompletionEvidenceState {
  const textResponseSatisfied =
    params.preview.trim().length > 0
    && allowsTextOnlyCompletion({ executionSemantics: params.executionSemantics })

  const executionSatisfied =
    params.successfulTools.length > 0
    || params.sawRealFilesystemMutation
    || textResponseSatisfied

  const deliveryRequired = params.executionSemantics.artifactDelivery === "direct"
  const deliverySatisfied = !deliveryRequired || params.deliverySatisfied
  const completionSatisfied = executionSatisfied && deliverySatisfied

  if (!executionSatisfied) {
    return {
      executionSatisfied,
      deliveryRequired,
      deliverySatisfied,
      completionSatisfied,
      conflictReason: "명확한 실행 근거가 확인되지 않았습니다.",
    }
  }

  if (!deliverySatisfied) {
    return {
      executionSatisfied,
      deliveryRequired,
      deliverySatisfied,
      completionSatisfied,
      conflictReason: "요청된 직접 결과 전달이 아직 완료되지 않았습니다.",
    }
  }

  return {
    executionSatisfied,
    deliveryRequired,
    deliverySatisfied,
    completionSatisfied,
  }
}

export function deriveCompletionStageState(params: {
  review: CompletionReviewResult | null
  executionSemantics: TaskExecutionSemantics
  preview: string
  deliverySatisfied: boolean
  successfulTools: SuccessfulToolEvidence[]
  sawRealFilesystemMutation: boolean
  requiresFilesystemMutation: boolean
  truncatedOutputRecoveryAttempted: boolean
}): CompletionStageState {
  const evidenceState = deriveCompletionEvidenceState({
    executionSemantics: params.executionSemantics,
    preview: params.preview,
    deliverySatisfied: params.deliverySatisfied,
    successfulTools: params.successfulTools,
    sawRealFilesystemMutation: params.sawRealFilesystemMutation,
  })

  const interpretationStatus: CompletionInterpretationStatus =
    params.review?.status === "followup"
      ? "followup_required"
      : params.review?.status === "ask_user"
        ? "user_input_required"
        : "satisfied"

  const executionStatus: CompletionExecutionStatus = evidenceState.executionSatisfied ? "satisfied" : "missing"
  const deliveryStatus: CompletionDeliveryStatus = !evidenceState.deliveryRequired
    ? "not_required"
    : evidenceState.deliverySatisfied
      ? "satisfied"
      : "missing"

  const truncatedRecoveryRequired = params.review
    ? shouldRetryTruncatedOutput({
        review: params.review,
        preview: params.preview,
        requiresFilesystemMutation: params.requiresFilesystemMutation,
      }) && !params.truncatedOutputRecoveryAttempted
    : false

  const recoveryStatus: CompletionRecoveryStatus =
    interpretationStatus === "followup_required"
    || executionStatus === "missing"
    || deliveryStatus === "missing"
    || truncatedRecoveryRequired
      ? "required"
      : "settled"

  const blockingReasons: string[] = []

  if (interpretationStatus === "followup_required") {
    blockingReasons.push("completion review가 추가 follow-up 작업을 요구합니다.")
  }

  if (interpretationStatus === "user_input_required") {
    blockingReasons.push("completion review가 사용자 추가 입력을 요구합니다.")
  }

  if (executionStatus === "missing" && evidenceState.conflictReason) {
    blockingReasons.push(evidenceState.conflictReason)
  }

  if (deliveryStatus === "missing" && evidenceState.conflictReason) {
    blockingReasons.push(evidenceState.conflictReason)
  }

  if (truncatedRecoveryRequired) {
    blockingReasons.push("중간 절단된 출력이라 복구 재시도가 한 번 더 필요합니다.")
  }

  const checklistItems: CompletionChecklistItem[] = [
    {
      key: "request",
      status: interpretationStatus === "user_input_required" ? "pending" : "completed",
      ...(interpretationStatus === "user_input_required"
        ? { reason: "사용자 추가 입력이 필요해 요청 확정이 아직 끝나지 않았습니다." }
        : {}),
    },
    {
      key: "execution",
      status: executionStatus === "satisfied" ? "completed" : "pending",
      ...(executionStatus === "missing" ? { reason: evidenceState.conflictReason || "명확한 실행 근거가 아직 없습니다." } : {}),
    },
    {
      key: "delivery",
      status:
        deliveryStatus === "not_required"
          ? "not_required"
          : deliveryStatus === "satisfied"
            ? "completed"
            : "pending",
      ...(deliveryStatus === "missing" ? { reason: "요청된 직접 결과 전달이 아직 완료되지 않았습니다." } : {}),
    },
    {
      key: "completion",
      status:
        interpretationStatus === "satisfied"
        && executionStatus === "satisfied"
        && deliveryStatus !== "missing"
        && recoveryStatus === "settled"
          ? "completed"
          : "pending",
      ...(interpretationStatus === "followup_required"
        ? { reason: "completion review가 추가 follow-up 작업을 요구합니다." }
        : interpretationStatus === "user_input_required"
          ? { reason: "completion review가 사용자 추가 입력을 요구합니다." }
          : truncatedRecoveryRequired
            ? { reason: "중간 절단된 출력이라 복구 재시도가 한 번 더 필요합니다." }
            : recoveryStatus === "required"
              ? { reason: blockingReasons[0] || "완료 전에 처리할 항목이 남아 있습니다." }
              : {}),
    },
  ]

  const actionableChecklistItems = checklistItems.filter((item) => item.status !== "not_required")
  const checklist: CompletionChecklistState = {
    items: checklistItems,
    completedCount: actionableChecklistItems.filter((item) => item.status === "completed").length,
    actionableCount: actionableChecklistItems.length,
    pendingCount: actionableChecklistItems.filter((item) => item.status === "pending").length,
  }

  const completionSatisfied = actionableChecklistItems.every((item) => item.status === "completed")

  return {
    ...evidenceState,
    interpretationStatus,
    executionStatus,
    deliveryStatus,
    recoveryStatus,
    completionSatisfied,
    checklist,
    ...(blockingReasons.length > 0 ? { blockingReasons } : { blockingReasons: [] }),
    ...(blockingReasons.length > 0 ? { conflictReason: blockingReasons[0] } : {}),
  }
}
