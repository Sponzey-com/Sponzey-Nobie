import type { RunChunkDeliveryHandler } from "./delivery.js"
import type { CompletionStageState } from "./completion-state.js"
import {
  markRunCompleted,
  type FinalizationDependencies,
  type FinalizationSource,
} from "./finalization.js"
import { applyRecoveryRetryState, type RecoveryRetryApplicationDependencies } from "./retry-application.js"
import { type RecoveryBudgetUsage } from "./recovery-budget.js"
import { applyTerminalApplication } from "./terminal-application.js"
import type { CompletionApplicationDecision } from "./completion-application.js"
import { decideCompletionTerminalOutcome } from "./terminal-outcome-policy.js"

export type CompletionApplicationPassResult =
  | { kind: "break" }
  | {
      kind: "retry"
      nextMessage: string
      clearWorkerRuntime: boolean
      normalizedFollowupPrompt?: string
      markTruncatedOutputRecoveryAttempted?: boolean
    }

interface CompletionApplicationPassModuleDependencies {
  decideCompletionTerminalOutcome: typeof decideCompletionTerminalOutcome
  markRunCompleted: typeof markRunCompleted
  applyTerminalApplication: typeof applyTerminalApplication
  applyRecoveryRetryState: typeof applyRecoveryRetryState
}

const defaultModuleDependencies: CompletionApplicationPassModuleDependencies = {
  decideCompletionTerminalOutcome,
  markRunCompleted,
  applyTerminalApplication,
  applyRecoveryRetryState,
}

export async function applyCompletionApplicationPass(
  params: {
    runId: string
    sessionId: string
    source: FinalizationSource
    onChunk: RunChunkDeliveryHandler | undefined
    preview: string
    state: CompletionStageState
    application: CompletionApplicationDecision
    maxTurns: number
    recoveryBudgetUsage: RecoveryBudgetUsage
    finalizationDependencies: FinalizationDependencies
  },
  dependencies: RecoveryRetryApplicationDependencies,
  moduleDependencies: CompletionApplicationPassModuleDependencies = defaultModuleDependencies,
): Promise<CompletionApplicationPassResult> {
  if (params.application.kind === "complete") {
    const terminalOutcome = moduleDependencies.decideCompletionTerminalOutcome({
      state: params.state,
    })

    if (terminalOutcome.kind === "stop") {
      await moduleDependencies.applyTerminalApplication({
        runId: params.runId,
        sessionId: params.sessionId,
        source: params.source,
        onChunk: params.onChunk,
        application: {
          kind: "stop",
          preview: params.preview,
          summary: terminalOutcome.summary,
          reason: terminalOutcome.reason,
          remainingItems: terminalOutcome.remainingItems,
        },
        dependencies: params.finalizationDependencies,
      })
      return { kind: "break" }
    }

    moduleDependencies.markRunCompleted({
      runId: params.runId,
      sessionId: params.sessionId,
      source: params.source,
      text: params.application.persistedText,
      summary: params.application.summary,
      reviewingSummary: params.application.summary,
      finalizingSummary: "실행 결과를 저장했습니다.",
      completedSummary: params.application.statusText,
      eventLabel: "실행 완료",
      dependencies: params.finalizationDependencies,
    })
    return { kind: "break" }
  }

  if (params.application.kind === "stop") {
    await moduleDependencies.applyTerminalApplication({
      runId: params.runId,
      sessionId: params.sessionId,
      source: params.source,
      onChunk: params.onChunk,
      application: {
        kind: "stop",
        preview: params.preview,
        summary: params.application.summary,
        ...(params.application.reason ? { reason: params.application.reason } : {}),
        ...(params.application.remainingItems ? { remainingItems: params.application.remainingItems } : {}),
      },
      dependencies: params.finalizationDependencies,
    })
    return { kind: "break" }
  }

  if (params.application.kind === "awaiting_user") {
    await moduleDependencies.applyTerminalApplication({
      runId: params.runId,
      sessionId: params.sessionId,
      source: params.source,
      onChunk: params.onChunk,
      application: {
        kind: "awaiting_user",
        preview: params.preview,
        summary: params.application.summary,
        ...(params.application.reason ? { reason: params.application.reason } : {}),
        ...(params.application.remainingItems ? { remainingItems: params.application.remainingItems } : {}),
        ...(params.application.userMessage ? { userMessage: params.application.userMessage } : {}),
      },
      dependencies: params.finalizationDependencies,
    })
    return { kind: "break" }
  }

  const continuation = moduleDependencies.applyRecoveryRetryState({
    runId: params.runId,
    sessionId: params.sessionId,
    source: params.source,
    recoveryBudgetUsage: params.recoveryBudgetUsage,
    state: {
      summary: params.application.summary,
      budgetKind: params.application.budgetKind,
      maxDelegationTurns: params.maxTurns,
      eventLabel: params.application.eventLabel,
      nextMessage: params.application.nextMessage,
      reviewStepStatus: params.application.reviewStepStatus,
      executingStepSummary: params.application.executingStepSummary,
      ...(params.application.updateRunStatusSummary
        ? { updateRunStatusSummary: params.application.updateRunStatusSummary }
        : {}),
      ...(params.application.clearWorkerRuntime
        ? { clearWorkerRuntime: params.application.clearWorkerRuntime }
        : {}),
      ...(params.application.title ? { failureTitle: params.application.title } : {}),
      ...(params.application.detail ? { failureDetail: params.application.detail } : {}),
    },
  }, dependencies)

  return {
    kind: "retry",
    nextMessage: continuation.nextMessage,
    clearWorkerRuntime: continuation.clearWorkerRuntime,
    ...(params.application.normalizedFollowupPrompt
      ? { normalizedFollowupPrompt: params.application.normalizedFollowupPrompt }
      : {}),
    ...(params.application.markTruncatedOutputRecoveryAttempted
      ? { markTruncatedOutputRecoveryAttempted: params.application.markTruncatedOutputRecoveryAttempted }
      : {}),
  }
}
