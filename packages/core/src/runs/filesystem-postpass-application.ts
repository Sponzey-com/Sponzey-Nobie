import type { RunChunkDeliveryHandler } from "./delivery.js"
import type { FilesystemPostPassDecision } from "./filesystem-postpass.js"
import type { FinalizationDependencies, FinalizationSource } from "./finalization.js"
import {
  applyRecoveryRetryState,
  type RecoveryRetryApplicationDependencies,
} from "./retry-application.js"
import { applyTerminalApplication } from "./terminal-application.js"

export type FilesystemPostPassApplicationResult =
  | { kind: "continue"; preview?: string }
  | { kind: "break" }
  | {
      kind: "retry"
      nextMessage: string
      clearWorkerRuntime: boolean
      markMutationRecoveryAttempted?: true
    }

interface FilesystemPostPassApplicationModuleDependencies {
  applyTerminalApplication: typeof applyTerminalApplication
  applyRecoveryRetryState: typeof applyRecoveryRetryState
}

const defaultModuleDependencies: FilesystemPostPassApplicationModuleDependencies = {
  applyTerminalApplication,
  applyRecoveryRetryState,
}

export async function applyFilesystemPostPassDecision(
  params: {
    runId: string
    sessionId: string
    source: FinalizationSource
    onChunk: RunChunkDeliveryHandler | undefined
    preview: string
    decision: FilesystemPostPassDecision
    recoveryBudgetUsage: {
      interpretation: number
      execution: number
      delivery: number
      external: number
    }
    finalizationDependencies: FinalizationDependencies
  },
  dependencies: RecoveryRetryApplicationDependencies,
  moduleDependencies: FilesystemPostPassApplicationModuleDependencies = defaultModuleDependencies,
): Promise<FilesystemPostPassApplicationResult> {
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
        ...(params.decision.reason ? { reason: params.decision.reason } : {}),
        ...(params.decision.remainingItems ? { remainingItems: params.decision.remainingItems } : {}),
      },
      dependencies: params.finalizationDependencies,
    })
    return { kind: "break" }
  }

  if (params.decision.kind === "initial_retry") {
    dependencies.appendRunEvent(params.runId, params.decision.eventLabel)
    dependencies.updateRunSummary(params.runId, params.decision.summary)
    dependencies.setRunStepStatus(params.runId, "executing", "running", params.decision.summary)
    dependencies.updateRunStatus(params.runId, "running", params.decision.summary, true)
    return {
      kind: "retry",
      nextMessage: params.decision.nextMessage,
      clearWorkerRuntime: true,
      markMutationRecoveryAttempted: params.decision.markAttempted,
    }
  }

  if (params.decision.kind === "retry") {
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
    }
  }

  dependencies.appendRunEvent(params.runId, params.decision.eventLabel)
  dependencies.updateRunSummary(params.runId, params.decision.summary)
  return {
    kind: "continue",
    preview: params.decision.nextPreview,
  }
}
