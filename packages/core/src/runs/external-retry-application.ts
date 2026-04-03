import {
  canConsumeRecoveryBudget,
  consumeRecoveryBudget,
  formatRecoveryBudgetProgress,
  getRecoveryBudgetState,
  type RecoveryBudgetUsage,
} from "./recovery-budget.js"
import type { ExternalRecoveryPayload } from "./external-recovery.js"
import type { FinalizationSource } from "./finalization.js"

export type ExternalRetryKind = "ai" | "worker_runtime"

export type ExternalRecoveryAttemptResult =
  | {
    kind: "stop"
    stop: {
      summary: string
      reason: string
      rawMessage?: string
      remainingItems: string[]
    }
  }
  | {
      kind: "retry"
      payload: ExternalRecoveryPayload
    }

export interface ExternalRecoveryAttemptDependencies {
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

export function applyExternalRecoveryAttempt(
  params: {
    kind: ExternalRetryKind
    runId: string
    sessionId: string
    source: FinalizationSource
    recoveryBudgetUsage: RecoveryBudgetUsage
    usedTurns: number
    maxDelegationTurns: number
    failureTitle: string
    payload: ExternalRecoveryPayload
    limitRemainingItems: string[]
  },
  dependencies: ExternalRecoveryAttemptDependencies,
): ExternalRecoveryAttemptResult {
  dependencies.rememberRunFailure({
    runId: params.runId,
    sessionId: params.sessionId,
    source: params.source,
    summary: params.payload.summary,
    detail: `${params.payload.reason}\n${params.payload.message}`,
    title: params.failureTitle,
  })

  const externalBudget = getRecoveryBudgetState({
    usage: params.recoveryBudgetUsage,
    kind: "external",
    maxDelegationTurns: params.maxDelegationTurns,
  })

  if ((params.maxDelegationTurns > 0 && params.usedTurns >= params.maxDelegationTurns) || !canConsumeRecoveryBudget({
    usage: params.recoveryBudgetUsage,
    kind: "external",
    maxDelegationTurns: params.maxDelegationTurns,
  })) {
    dependencies.appendRunEvent(
      params.runId,
      `${params.kind === "ai" ? "AI" : "작업 세션"} 복구 한도 도달 ${formatRecoveryBudgetProgress(externalBudget)}`,
    )
    return {
      kind: "stop",
      stop: {
        summary: `${params.kind === "ai" ? "AI" : "작업 세션"} 복구 재시도 한도(${externalBudget.limit > 0 ? externalBudget.limit : params.maxDelegationTurns}회)에 도달했습니다.`,
        reason: params.payload.reason,
        ...(params.payload.message.trim() ? { rawMessage: params.payload.message } : {}),
        remainingItems: params.limitRemainingItems,
      },
    }
  }

  dependencies.incrementDelegationTurnCount(params.runId, params.payload.summary)
  const externalBudgetAfterUse = consumeRecoveryBudget({
    usage: params.recoveryBudgetUsage,
    kind: "external",
    maxDelegationTurns: params.maxDelegationTurns,
  })
  dependencies.appendRunEvent(
    params.runId,
    `${params.kind === "ai" ? "AI 오류" : "작업 세션"} 복구 재시도 ${formatRecoveryBudgetProgress(externalBudgetAfterUse)}`,
  )
  dependencies.setRunStepStatus(params.runId, "executing", "running", params.payload.summary)
  dependencies.updateRunStatus(params.runId, "running", params.payload.summary, true)

  return {
    kind: "retry",
    payload: params.payload,
  }
}
