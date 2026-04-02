import {
  canConsumeRecoveryBudget,
  getRecoveryBudgetState,
  type RecoveryBudgetUsage,
} from "./recovery-budget.js"
import {
  buildCommandFailureRecoveryPrompt,
  buildExecutionRecoveryPrompt,
  selectCommandFailureRecovery,
  selectGenericExecutionRecovery,
  type FailedCommandTool,
} from "./recovery.js"
import type { RecoveryRetryApplicationState } from "./retry-application.js"

export interface ExecutionRecoveryPayload {
  summary: string
  reason: string
  toolNames: string[]
}

export type ExecutionPostPassDecision =
  | { kind: "none" }
  | {
      kind: "stop"
      summary: string
      reason: string
      remainingItems: string[]
    }
  | {
      kind: "retry"
      seenKey: string
      seenKeyKind: "command" | "generic_execution"
      state: RecoveryRetryApplicationState
    }

export function decideExecutionPostPassRecovery(params: {
  originalRequest: string
  preview: string
  failedCommandTools: FailedCommandTool[]
  commandFailureSeen: boolean
  commandRecoveredWithinSamePass: boolean
  executionRecovery: ExecutionRecoveryPayload | null
  seenCommandFailureRecoveryKeys: Set<string>
  seenExecutionRecoveryKeys: Set<string>
  recoveryBudgetUsage: RecoveryBudgetUsage
  usedTurns: number
  maxDelegationTurns: number
}): ExecutionPostPassDecision {
  const commandFailureRecovery = selectCommandFailureRecovery({
    failedTools: params.failedCommandTools,
    commandFailureSeen: params.commandFailureSeen,
    commandRecoveredWithinSamePass: params.commandRecoveredWithinSamePass,
    seenKeys: params.seenCommandFailureRecoveryKeys,
  })

  if (commandFailureRecovery) {
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
      return {
        kind: "stop",
        summary: `실행 복구 재시도 한도(${executionBudget.limit > 0 ? executionBudget.limit : params.maxDelegationTurns}회)에 도달했습니다.`,
        reason: commandFailureRecovery.reason,
        remainingItems: ["실패한 명령에 대한 다른 방법 탐색이 더 필요하지만 자동 한도에 도달했습니다."],
      }
    }

    return {
      kind: "retry",
      seenKeyKind: "command",
      seenKey: commandFailureRecovery.key,
      state: {
        summary: commandFailureRecovery.summary,
        budgetKind: "execution",
        maxDelegationTurns: params.maxDelegationTurns,
        eventLabel: "명령 실패 대안 재시도",
        nextMessage: buildCommandFailureRecoveryPrompt({
          originalRequest: params.originalRequest,
          previousResult: params.preview,
          summary: commandFailureRecovery.summary,
          reason: commandFailureRecovery.reason,
          failedTools: params.failedCommandTools,
          alternatives: commandFailureRecovery.alternatives,
        }),
        reviewStepStatus: "running",
        executingStepSummary: commandFailureRecovery.summary,
        updateRunStatusSummary: commandFailureRecovery.summary,
        updateRunSummary: commandFailureRecovery.summary,
        clearWorkerRuntime: true,
        alternatives: commandFailureRecovery.alternatives,
        failureTitle: "command_failure_recovery",
        failureDetail: commandFailureRecovery.reason,
      },
    }
  }

  const genericExecutionRecovery = params.executionRecovery
    ? selectGenericExecutionRecovery({
        executionRecovery: params.executionRecovery,
        seenKeys: params.seenExecutionRecoveryKeys,
      })
    : null

  if (!genericExecutionRecovery) {
    return { kind: "none" }
  }

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
    return {
      kind: "stop",
      summary: `실행 복구 재시도 한도(${executionBudget.limit > 0 ? executionBudget.limit : params.maxDelegationTurns}회)에 도달했습니다.`,
      reason: genericExecutionRecovery.reason,
      remainingItems: ["실패한 도구에 대한 다른 방법 탐색이 더 필요하지만 자동 한도에 도달했습니다."],
    }
  }

  return {
    kind: "retry",
    seenKeyKind: "generic_execution",
    seenKey: genericExecutionRecovery.key,
    state: {
      summary: genericExecutionRecovery.summary,
      budgetKind: "execution",
      maxDelegationTurns: params.maxDelegationTurns,
      eventLabel: "도구 실패 대안 재시도",
      nextMessage: buildExecutionRecoveryPrompt({
        originalRequest: params.originalRequest,
        previousResult: params.preview,
        summary: genericExecutionRecovery.summary,
        reason: genericExecutionRecovery.reason,
        toolNames: params.executionRecovery?.toolNames ?? [],
        alternatives: genericExecutionRecovery.alternatives,
      }),
      reviewStepStatus: "running",
      executingStepSummary: genericExecutionRecovery.summary,
      updateRunStatusSummary: genericExecutionRecovery.summary,
      updateRunSummary: genericExecutionRecovery.summary,
      clearWorkerRuntime: true,
      alternatives: genericExecutionRecovery.alternatives,
      failureTitle: "execution_recovery_followup",
      failureDetail: genericExecutionRecovery.reason,
    },
  }
}
