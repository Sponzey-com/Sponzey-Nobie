import {
  applyRunningContinuationState,
  type AppliedRunningContinuation,
  type RunningContinuationDependencies,
} from "./running-application.js"
import {
  consumeRecoveryBudget,
  formatRecoveryBudgetProgress,
  type RecoveryBudgetKind,
  type RecoveryBudgetUsage,
} from "./recovery-budget.js"
import {
  describeRecoveryAlternatives,
  type RecoveryAlternative,
} from "./recovery.js"
import type { FinalizationSource } from "./finalization.js"
import { upsertTaskContinuity } from "../db/index.js"
import { getRootRun } from "./store.js"

export interface RecoveryRetryApplicationState {
  summary: string
  budgetKind: RecoveryBudgetKind
  maxDelegationTurns: number
  eventLabel: string
  nextMessage: string
  reviewStepStatus: "running" | "completed"
  executingStepSummary: string
  updateRunStatusSummary?: string
  updateRunSummary?: string
  clearWorkerRuntime?: boolean
  clearProvider?: boolean
  alternatives?: RecoveryAlternative[]
  failureTitle?: string
  failureDetail?: string
}

export interface RecoveryRetryApplicationDependencies extends RunningContinuationDependencies {
  rememberRunFailure: (params: {
    runId: string
    sessionId: string
    source: FinalizationSource
    summary: string
    detail?: string
    title?: string
  }) => void
  incrementDelegationTurnCount: (runId: string, summary: string) => void
}

export function applyRecoveryRetryState(
  params: {
    runId: string
    sessionId: string
    source: FinalizationSource
    recoveryBudgetUsage: RecoveryBudgetUsage
    state: RecoveryRetryApplicationState
  },
  dependencies: RecoveryRetryApplicationDependencies,
): AppliedRunningContinuation {
  if (params.state.failureTitle || params.state.failureDetail) {
    dependencies.rememberRunFailure({
      runId: params.runId,
      sessionId: params.sessionId,
      source: params.source,
      summary: params.state.summary,
      ...(params.state.failureDetail ? { detail: params.state.failureDetail } : {}),
      ...(params.state.failureTitle ? { title: params.state.failureTitle } : {}),
    })
  }

  dependencies.incrementDelegationTurnCount(params.runId, params.state.summary)
  const budgetAfterUse = consumeRecoveryBudget({
    usage: params.recoveryBudgetUsage,
    kind: params.state.budgetKind,
    maxDelegationTurns: params.state.maxDelegationTurns,
  })
  const eventLabels = [`${params.state.eventLabel} ${formatRecoveryBudgetProgress(budgetAfterUse)}`]
  const recoveryAlternatives = describeRecoveryAlternatives(params.state.alternatives ?? [])
  if (recoveryAlternatives) {
    eventLabels.push(recoveryAlternatives)
  }
  try {
    const run = getRootRun(params.runId)
    if (run) {
      upsertTaskContinuity({
        lineageRootRunId: run.lineageRootRunId ?? run.requestGroupId,
        ...(run.parentRunId ? { parentRunId: run.parentRunId } : {}),
        ...(run.handoffSummary ? { handoffSummary: run.handoffSummary } : {}),
        failedRecoveryKey: `${params.state.budgetKind}:${params.state.eventLabel}`,
        failureKind: params.state.budgetKind,
        recoveryBudget: formatRecoveryBudgetProgress(budgetAfterUse),
        status: "recovering",
        lastGoodState: params.state.summary,
      })
    }
  } catch {
    // Recovery continuity is best-effort and must not block the retry path.
  }

  return applyRunningContinuationState({
    runId: params.runId,
    state: {
      eventLabels,
      reviewStepStatus: params.state.reviewStepStatus,
      reviewSummary: params.state.summary,
      executingSummary: params.state.executingStepSummary,
      ...(params.state.updateRunStatusSummary
        ? { updateRunStatusSummary: params.state.updateRunStatusSummary }
        : {}),
      updateRunSummary: params.state.updateRunSummary ?? params.state.summary,
      nextMessage: params.state.nextMessage,
      ...(params.state.clearWorkerRuntime ? { clearWorkerRuntime: params.state.clearWorkerRuntime } : {}),
      ...(params.state.clearProvider ? { clearProvider: params.state.clearProvider } : {}),
    },
  }, dependencies)
}
