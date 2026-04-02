import type { RunChunkDeliveryHandler } from "./delivery.js"
import type { ExecutionPostPassDecision } from "./execution-postpass.js"
import type { FinalizationDependencies, FinalizationSource } from "./finalization.js"
import {
  applyRecoveryRetryState,
  type RecoveryRetryApplicationDependencies,
} from "./retry-application.js"
import { applyTerminalApplication } from "./terminal-application.js"
import type { RecoveryBudgetUsage } from "./recovery-budget.js"

export type ExecutionPostPassApplicationResult =
  | { kind: "continue" }
  | { kind: "break" }
  | {
      kind: "retry"
      nextMessage: string
      clearWorkerRuntime: boolean
      seenKey?: {
        key: string
        kind: "command" | "generic_execution"
      }
    }

interface ExecutionPostPassApplicationModuleDependencies {
  applyTerminalApplication: typeof applyTerminalApplication
  applyRecoveryRetryState: typeof applyRecoveryRetryState
}

const defaultModuleDependencies: ExecutionPostPassApplicationModuleDependencies = {
  applyTerminalApplication,
  applyRecoveryRetryState,
}

export async function applyExecutionPostPassDecision(
  params: {
    runId: string
    sessionId: string
    source: FinalizationSource
    onChunk: RunChunkDeliveryHandler | undefined
    preview: string
    decision: ExecutionPostPassDecision
    recoveryBudgetUsage: RecoveryBudgetUsage
    finalizationDependencies: FinalizationDependencies
  },
  dependencies: RecoveryRetryApplicationDependencies,
  moduleDependencies: ExecutionPostPassApplicationModuleDependencies = defaultModuleDependencies,
): Promise<ExecutionPostPassApplicationResult> {
  if (params.decision.kind === "none") {
    return { kind: "continue" }
  }

  if (params.decision.kind === "stop") {
    await moduleDependencies.applyTerminalApplication({
      runId: params.runId,
      sessionId: params.sessionId,
      source: params.source,
      onChunk: params.onChunk,
      application: {
        kind: "stop",
        preview: params.preview,
        summary: params.decision.summary,
        reason: params.decision.reason,
        remainingItems: params.decision.remainingItems,
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
    state: params.decision.state,
  }, dependencies)

  return {
    kind: "retry",
    nextMessage: continuation.nextMessage,
    clearWorkerRuntime: continuation.clearWorkerRuntime,
    seenKey: {
      key: params.decision.seenKey,
      kind: params.decision.seenKeyKind,
    },
  }
}
