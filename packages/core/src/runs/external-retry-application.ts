import {
  consumeRecoveryBudget,
  formatRecoveryBudgetProgress,
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

  dependencies.incrementDelegationTurnCount(params.runId, params.payload.summary)
  const externalBudgetAfterUse = consumeRecoveryBudget({
    usage: params.recoveryBudgetUsage,
    kind: "external",
    maxDelegationTurns: params.maxDelegationTurns,
  })
  dependencies.appendRunEvent(
    params.runId,
    `${params.kind === "ai" ? "AI 오류" : "작업 세션"} 복구 ${formatRecoveryBudgetProgress(externalBudgetAfterUse)}`,
  )
  dependencies.setRunStepStatus(params.runId, "executing", "running", params.payload.summary)
  dependencies.updateRunStatus(params.runId, "running", params.payload.summary, true)

  return {
    kind: "retry",
    payload: params.payload,
  }
}
