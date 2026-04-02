import {
  canConsumeRecoveryBudget,
  consumeRecoveryBudget,
  formatRecoveryBudgetProgress,
  getRecoveryBudgetState,
  type RecoveryBudgetUsage,
} from "./recovery-budget.js"
import type { FinalizationSource } from "./finalization.js"

export interface ExecutionRecoveryPayload {
  summary: string
  reason: string
  toolNames: string[]
}

export type ExecutionRecoveryAttemptResult =
  | {
      kind: "stop"
      stop: {
        summary: string
        reason: string
        remainingItems: string[]
      }
    }
  | {
      kind: "retry"
      payload: ExecutionRecoveryPayload
    }

export interface ExecutionRecoveryAttemptDependencies {
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

export function applyExecutionRecoveryAttempt(
  params: {
    runId: string
    sessionId: string
    source: FinalizationSource
    recoveryBudgetUsage: RecoveryBudgetUsage
    usedTurns: number
    maxDelegationTurns: number
    payload: ExecutionRecoveryPayload
  },
  dependencies: ExecutionRecoveryAttemptDependencies,
): ExecutionRecoveryAttemptResult {
  dependencies.rememberRunFailure({
    runId: params.runId,
    sessionId: params.sessionId,
    source: params.source,
    summary: params.payload.summary,
    detail: params.payload.reason,
    title: `execution_recovery: ${params.payload.toolNames.join(", ") || "tool"}`,
  })

  const executionBudget = getRecoveryBudgetState({
    usage: params.recoveryBudgetUsage,
    kind: "execution",
    maxDelegationTurns: params.maxDelegationTurns,
  })

  if ((params.maxDelegationTurns > 0 && params.usedTurns >= params.maxDelegationTurns) || !canConsumeRecoveryBudget({
    usage: params.recoveryBudgetUsage,
    kind: "execution",
    maxDelegationTurns: params.maxDelegationTurns,
  })) {
    dependencies.appendRunEvent(
      params.runId,
      `실행 복구 한도 도달 ${formatRecoveryBudgetProgress(executionBudget)}`,
    )
    return {
      kind: "stop",
      stop: {
        summary: `실행 복구 재시도 한도(${executionBudget.limit > 0 ? executionBudget.limit : params.maxDelegationTurns}회)에 도달했습니다.`,
        reason: params.payload.reason,
        remainingItems: [
          `${params.payload.toolNames.join(", ")} 실행 실패에 대한 추가 대안 탐색이 필요하지만 자동 한도에 도달했습니다.`,
        ],
      },
    }
  }

  incrementExecutionRecoveryRetry({
    runId: params.runId,
    summary: params.payload.summary,
    recoveryBudgetUsage: params.recoveryBudgetUsage,
    maxDelegationTurns: params.maxDelegationTurns,
  }, dependencies)

  return {
    kind: "retry",
    payload: params.payload,
  }
}

function incrementExecutionRecoveryRetry(
  params: {
    runId: string
    summary: string
    recoveryBudgetUsage: RecoveryBudgetUsage
    maxDelegationTurns: number
  },
  dependencies: ExecutionRecoveryAttemptDependencies,
): void {
  dependencies.incrementDelegationTurnCount(params.runId, params.summary)
  const executionBudgetAfterUse = consumeRecoveryBudget({
    usage: params.recoveryBudgetUsage,
    kind: "execution",
    maxDelegationTurns: params.maxDelegationTurns,
  })
  dependencies.appendRunEvent(
    params.runId,
    `실행 복구 재시도 ${formatRecoveryBudgetProgress(executionBudgetAfterUse)}`,
  )
  dependencies.setRunStepStatus(params.runId, "executing", "running", params.summary)
  dependencies.updateRunStatus(params.runId, "running", params.summary, true)
}
