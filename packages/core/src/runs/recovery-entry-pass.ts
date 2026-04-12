import type { RunChunkDeliveryHandler } from "./delivery.js"
import {
  runExternalRecoverySequence,
  type ExternalRecoverySequenceResult,
} from "./external-recovery-sequence.js"
import { enqueueRunRecovery } from "./recovery-queue.js"
import type { ExternalRecoveryPayload, ExternalRecoveryState } from "./external-recovery.js"
import type { FinalizationDependencies, FinalizationSource } from "./finalization.js"
import type { TaskProfile } from "./types.js"
import { applyTerminalApplication } from "./terminal-application.js"

export type RecoveryEntryPassResult =
  | { kind: "break" }
  | { kind: "continue" }
  | {
      kind: "retry"
      nextState: ExternalRecoveryState
      nextMessage: string
    }

interface RecoveryEntryPassDependencies {
  appendRunEvent: (runId: string, message: string) => void
}

interface RecoveryEntryPassModuleDependencies {
  applyTerminalApplication: typeof applyTerminalApplication
  runExternalRecoverySequence: typeof runExternalRecoverySequence
  enqueueRunRecovery: typeof enqueueRunRecovery
}

const defaultModuleDependencies: RecoveryEntryPassModuleDependencies = {
  applyTerminalApplication,
  runExternalRecoverySequence,
  enqueueRunRecovery,
}

export async function runRecoveryEntryPass(
  params: {
    runId: string
    sessionId: string
    source: FinalizationSource
    onChunk: RunChunkDeliveryHandler | undefined
    preview: string
    executionRecoveryLimitStop: {
      summary: string
      reason: string
      rawMessage?: string
      remainingItems: string[]
    } | null
    aiRecoveryLimitStop: {
      summary: string
      reason: string
      rawMessage?: string
      remainingItems: string[]
    } | null
    recoveries: Array<{
      kind: "ai" | "worker_runtime"
      payload?: ExternalRecoveryPayload | null
    }>
    aborted: boolean
    failed: boolean
    taskProfile: TaskProfile
    current: ExternalRecoveryState
    seenKeys: Set<string>
    originalRequest: string
    previousResult: string
    finalizationDependencies: FinalizationDependencies
  },
  dependencies: RecoveryEntryPassDependencies,
  moduleDependencies: RecoveryEntryPassModuleDependencies = defaultModuleDependencies,
): Promise<RecoveryEntryPassResult> {
  return moduleDependencies.enqueueRunRecovery({
    runId: params.runId,
    task: async () => {
      if (params.executionRecoveryLimitStop) {
        await moduleDependencies.applyTerminalApplication({
          runId: params.runId,
          sessionId: params.sessionId,
          source: params.source,
          onChunk: params.onChunk,
          application: {
            kind: "stop",
            preview: params.preview,
            summary: params.executionRecoveryLimitStop.summary,
            reason: params.executionRecoveryLimitStop.reason,
            ...(params.executionRecoveryLimitStop.rawMessage ? { rawMessage: params.executionRecoveryLimitStop.rawMessage } : {}),
            remainingItems: params.executionRecoveryLimitStop.remainingItems,
          },
          dependencies: params.finalizationDependencies,
        })
        return { kind: "break" }
      }

      if (params.aiRecoveryLimitStop) {
        await moduleDependencies.applyTerminalApplication({
          runId: params.runId,
          sessionId: params.sessionId,
          source: params.source,
          onChunk: params.onChunk,
          application: {
            kind: "stop",
            preview: params.preview,
            summary: params.aiRecoveryLimitStop.summary,
            reason: params.aiRecoveryLimitStop.reason,
            ...(params.aiRecoveryLimitStop.rawMessage ? { rawMessage: params.aiRecoveryLimitStop.rawMessage } : {}),
            remainingItems: params.aiRecoveryLimitStop.remainingItems,
          },
          dependencies: params.finalizationDependencies,
        })
        return { kind: "break" }
      }

      const externalRecoverySequence: ExternalRecoverySequenceResult = await moduleDependencies.runExternalRecoverySequence({
        recoveries: params.recoveries,
        aborted: params.aborted,
        taskProfile: params.taskProfile,
        current: params.current,
        seenKeys: params.seenKeys,
        originalRequest: params.originalRequest,
        previousResult: params.previousResult,
        runId: params.runId,
        sessionId: params.sessionId,
        source: params.source,
        onChunk: params.onChunk,
        preview: params.preview,
        finalizationDependencies: params.finalizationDependencies,
      }, {
        appendRunEvent: dependencies.appendRunEvent,
      })

      if (externalRecoverySequence.kind === "stop") {
        return { kind: "break" }
      }

      if (externalRecoverySequence.kind === "retry") {
        return {
          kind: "retry",
          nextState: externalRecoverySequence.nextState,
          nextMessage: externalRecoverySequence.nextMessage,
        }
      }

      if (params.aborted || params.failed) {
        return { kind: "break" }
      }

      return { kind: "continue" }
    },
  }, {
    appendRunEvent: dependencies.appendRunEvent,
  })
}
