import {
  consumeRecoveryBudget,
  formatRecoveryBudgetProgress,
  type RecoveryBudgetUsage,
} from "./recovery-budget.js"
import type { FinalizationDependencies, FinalizationSource } from "./finalization.js"
import { applyTerminalApplication } from "./terminal-application.js"
import type { RunChunkDeliveryHandler } from "./delivery.js"

export interface IntakeRetryDirective {
  summary: string
  reason: string
  message: string
  remainingItems?: string[]
  eventLabel?: string
}

export type IntakeRetryApplicationResult =
  | { kind: "break" }
  | {
      kind: "retry"
      nextMessage: string
    }

export interface IntakeRetryApplicationDependencies {
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
    stepKey: string,
    status: "running" | "completed" | "cancelled" | "pending" | "failed",
    summary: string,
  ) => void
  updateRunStatus: (
    runId: string,
    status: "queued" | "running" | "awaiting_approval" | "awaiting_user" | "completed" | "failed" | "cancelled" | "interrupted",
    summary: string,
    canCancel: boolean,
  ) => void
}

interface IntakeRetryApplicationModuleDependencies {
  applyTerminalApplication: typeof applyTerminalApplication
}

const defaultModuleDependencies: IntakeRetryApplicationModuleDependencies = {
  applyTerminalApplication,
}

export async function applyIntakeRetryDirective(
  params: {
    runId: string
    sessionId: string
    source: FinalizationSource
    onChunk: RunChunkDeliveryHandler | undefined
    directive: IntakeRetryDirective
    usedTurns: number
    maxTurns: number
    recoveryBudgetUsage: RecoveryBudgetUsage
    finalizationDependencies: FinalizationDependencies
  },
  dependencies: IntakeRetryApplicationDependencies,
  moduleDependencies: IntakeRetryApplicationModuleDependencies = defaultModuleDependencies,
): Promise<IntakeRetryApplicationResult> {
  if (params.directive.eventLabel) {
    dependencies.appendRunEvent(params.runId, params.directive.eventLabel)
  }
  dependencies.rememberRunFailure({
    runId: params.runId,
    sessionId: params.sessionId,
    source: params.source,
    summary: params.directive.summary,
    detail: params.directive.reason,
    title: "intake_recovery",
  })

  dependencies.incrementDelegationTurnCount(params.runId, params.directive.summary)
  const interpretationBudgetAfterUse = consumeRecoveryBudget({
    usage: params.recoveryBudgetUsage,
    kind: "interpretation",
    maxDelegationTurns: params.maxTurns,
  })
  dependencies.appendRunEvent(
    params.runId,
    `일정 해석 복구 ${formatRecoveryBudgetProgress(interpretationBudgetAfterUse)}`,
  )
  dependencies.setRunStepStatus(params.runId, "executing", "running", params.directive.summary)
  dependencies.updateRunStatus(params.runId, "running", params.directive.summary, true)

  return {
    kind: "retry",
    nextMessage: params.directive.message,
  }
}
