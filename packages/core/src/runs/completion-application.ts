import type { SuccessfulToolEvidence } from "./recovery.js"
import {
  buildEmptyResultRecoveryPrompt,
  buildTruncatedOutputRecoveryPrompt,
} from "./recovery.js"
import type { CompletionFlowDecision } from "./completion-flow.js"

export type CompletionApplicationDecision =
  | {
      kind: "complete"
      summary: string
      persistedText: string
      statusText: string
    }
  | {
      kind: "stop"
      summary: string
      reason: string
      remainingItems?: string[]
    }
  | {
      kind: "retry"
      budgetKind: "execution" | "interpretation"
      summary: string
      detail?: string
      title?: string
      eventLabel: string
      nextMessage: string
      reviewStepStatus: "running" | "completed"
      executingStepSummary: string
      updateRunStatusSummary?: string
      normalizedFollowupPrompt?: string
      markTruncatedOutputRecoveryAttempted?: boolean
      clearWorkerRuntime?: boolean
    }
  | {
      kind: "awaiting_user"
      summary: string
      reason?: string
      remainingItems?: string[]
      userMessage?: string
    }

export function decideCompletionApplication(params: {
  decision: CompletionFlowDecision
  originalRequest: string
  previousResult: string
  successfulTools: SuccessfulToolEvidence[]
  sawRealFilesystemMutation: boolean
  usedTurns: number
  maxTurns: number
  interpretationBudgetLimit: number
  executionBudgetLimit: number
  canRetryInterpretation: boolean
  canRetryExecution: boolean
  followupAlreadySeen: boolean
}): CompletionApplicationDecision {
  const { decision } = params

  if (decision.kind === "complete") {
    return decision
  }

  if (decision.kind === "invalid_followup") {
    return {
      kind: "stop",
      summary: decision.summary,
      reason: decision.reason,
      remainingItems: decision.remainingItems,
    }
  }

  if (decision.kind === "recover_empty_result") {
    if (!params.canRetryExecution) {
      return {
        kind: "stop",
        summary: `실행 결과가 비어 있고 완료 근거가 없어 자동 진행을 멈췄습니다.`,
        reason: decision.reason,
        remainingItems: decision.remainingItems,
      }
    }

    return {
      kind: "retry",
      budgetKind: "execution",
      summary: decision.summary,
      detail: decision.reason,
      title: "empty_result_recovery",
      eventLabel: "빈 결과 복구",
      nextMessage: buildEmptyResultRecoveryPrompt({
        originalRequest: params.originalRequest,
        previousResult: params.previousResult,
        successfulTools: params.successfulTools,
        sawRealFilesystemMutation: params.sawRealFilesystemMutation,
      }),
      reviewStepStatus: "running",
      executingStepSummary: decision.summary,
      updateRunStatusSummary: decision.summary,
    }
  }

  if (decision.kind === "followup") {
    // nobie-critical-decision-audit: completion.followup_prompt_dedupe
    // Temporary guard only. Task 006/008 replaces raw prompt dedupe with contract/receipt based loop protection.
    const normalizedPrompt = decision.followupPrompt.replace(/\s+/g, " ").trim().toLowerCase()
    if (normalizedPrompt && params.followupAlreadySeen) {
      return {
        kind: "stop",
        summary: "같은 후속 지시가 반복되어 자동 진행을 멈췄습니다.",
        reason: decision.reason || "반복 후속 지시 감지",
        remainingItems: decision.remainingItems,
      }
    }

    if (!params.canRetryInterpretation) {
      return {
        kind: "stop",
        summary: "해석/후속 처리를 자동으로 계속할 수 없습니다.",
        reason: decision.reason || "새 안전 대안이나 필요한 결정 정보가 부족합니다.",
        ...(decision.remainingItems ? { remainingItems: decision.remainingItems } : {}),
      }
    }

    return {
      kind: "retry",
      budgetKind: "interpretation",
      summary: decision.summary,
      eventLabel: "후속 처리",
      nextMessage: decision.followupPrompt,
      reviewStepStatus: "completed",
      executingStepSummary: decision.summary,
      ...(normalizedPrompt ? { normalizedFollowupPrompt: normalizedPrompt } : {}),
    }
  }

  if (decision.kind === "retry_truncated") {
    if (!params.canRetryExecution) {
      return {
        kind: "stop",
        summary: "실행 복구를 자동으로 계속할 수 없습니다.",
        reason: decision.reason || "새 안전 대안이나 필요한 결정 정보가 부족합니다.",
        ...(decision.remainingItems ? { remainingItems: decision.remainingItems } : {}),
      }
    }

    return {
      kind: "retry",
      budgetKind: "execution",
      summary: decision.summary,
      eventLabel: "중간 절단 복구",
      nextMessage: buildTruncatedOutputRecoveryPrompt({
        originalRequest: params.originalRequest,
        previousResult: params.previousResult,
        summary: decision.summary,
        ...(decision.reason ? { reason: decision.reason } : {}),
        ...(decision.remainingItems ? { remainingItems: decision.remainingItems } : {}),
      }),
      reviewStepStatus: "completed",
      executingStepSummary: "중간에 끊긴 작업을 다른 방식으로 이어갑니다.",
      updateRunStatusSummary: "중간에 끊긴 작업을 다른 방식으로 이어갑니다.",
      markTruncatedOutputRecoveryAttempted: true,
      clearWorkerRuntime: true,
    }
  }

  return {
    kind: "awaiting_user",
    summary: decision.summary,
    ...(decision.reason ? { reason: decision.reason } : {}),
    ...(decision.remainingItems ? { remainingItems: decision.remainingItems } : {}),
    ...(decision.userMessage ? { userMessage: decision.userMessage } : {}),
  }
}
