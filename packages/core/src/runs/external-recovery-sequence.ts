import type { RunChunkDeliveryHandler } from "./delivery.js"
import type { FinalizationDependencies, FinalizationSource } from "./finalization.js"
import {
  runExternalRecoveryPass,
  type ExternalRecoveryPassResult,
} from "./external-recovery-pass.js"
import type {
  ExternalRecoveryKind,
  ExternalRecoveryPayload,
  ExternalRecoveryState,
} from "./external-recovery.js"
import type { TaskProfile } from "./types.js"

export type ExternalRecoverySequenceResult =
  | { kind: "none" }
  | { kind: "stop" }
  | {
      kind: "retry"
      nextState: ExternalRecoveryState
      nextMessage: string
    }

interface ExternalRecoverySequenceDependencies {
  appendRunEvent: (runId: string, message: string) => void
}

interface ExternalRecoverySequenceModuleDependencies {
  runExternalRecoveryPass: typeof runExternalRecoveryPass
}

const defaultModuleDependencies: ExternalRecoverySequenceModuleDependencies = {
  runExternalRecoveryPass,
}

export async function runExternalRecoverySequence(
  params: {
    recoveries: Array<{
      kind: ExternalRecoveryKind
      payload?: ExternalRecoveryPayload | null
    }>
    aborted: boolean
    taskProfile: TaskProfile
    current: ExternalRecoveryState
    seenKeys: Set<string>
    originalRequest: string
    previousResult: string
    runId: string
    sessionId: string
    source: FinalizationSource
    onChunk: RunChunkDeliveryHandler | undefined
    preview: string
    finalizationDependencies: FinalizationDependencies
  },
  dependencies: ExternalRecoverySequenceDependencies,
  moduleDependencies: ExternalRecoverySequenceModuleDependencies = defaultModuleDependencies,
): Promise<ExternalRecoverySequenceResult> {
  for (const recoveryInput of params.recoveries) {
    const result: ExternalRecoveryPassResult = await moduleDependencies.runExternalRecoveryPass({
      kind: recoveryInput.kind,
      ...(recoveryInput.payload !== undefined ? { payload: recoveryInput.payload } : {}),
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

    if (result.kind === "stop" || result.kind === "retry") {
      return result
    }
  }

  return { kind: "none" }
}
