import type { RunChunkDeliveryHandler } from "./delivery.js"
import type { FinalizationDependencies, FinalizationSource } from "./finalization.js"
import {
  applyExternalRecoveryPlan,
  type AppliedExternalRecoveryPlan,
} from "./external-recovery-application.js"
import {
  planExternalRecovery,
  type ExternalRecoveryKind,
  type ExternalRecoveryPayload,
  type ExternalRecoveryState,
} from "./external-recovery.js"
import type { TaskProfile } from "./types.js"

export type ExternalRecoveryPassResult =
  | { kind: "none" }
  | { kind: "stop" }
  | {
      kind: "retry"
      nextState: ExternalRecoveryState
      nextMessage: string
    }

interface ExternalRecoveryPassDependencies {
  appendRunEvent: (runId: string, message: string) => void
}

interface ExternalRecoveryPassModuleDependencies {
  planExternalRecovery: typeof planExternalRecovery
  applyExternalRecoveryPlan: typeof applyExternalRecoveryPlan
}

const defaultModuleDependencies: ExternalRecoveryPassModuleDependencies = {
  planExternalRecovery,
  applyExternalRecoveryPlan,
}

export async function runExternalRecoveryPass(
  params: {
    kind: ExternalRecoveryKind
    payload?: ExternalRecoveryPayload | null
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
  dependencies: ExternalRecoveryPassDependencies,
  moduleDependencies: ExternalRecoveryPassModuleDependencies = defaultModuleDependencies,
): Promise<ExternalRecoveryPassResult> {
  if (!params.payload || params.aborted) {
    return { kind: "none" }
  }

  const recoveryPlan = moduleDependencies.planExternalRecovery({
    kind: params.kind,
    taskProfile: params.taskProfile,
    current: params.current,
    payload: params.payload,
    seenKeys: params.seenKeys,
    originalRequest: params.originalRequest,
    previousResult: params.previousResult,
  })

  const appliedRecovery: AppliedExternalRecoveryPlan = await moduleDependencies.applyExternalRecoveryPlan({
    runId: params.runId,
    sessionId: params.sessionId,
    source: params.source,
    onChunk: params.onChunk,
    preview: params.preview,
    plan: recoveryPlan,
    seenKeys: params.seenKeys,
    finalizationDependencies: params.finalizationDependencies,
  }, {
    appendRunEvent: dependencies.appendRunEvent,
  })

  if (appliedRecovery.kind === "stop") {
    return { kind: "stop" }
  }

  return {
    kind: "retry",
    nextState: appliedRecovery.nextState,
    nextMessage: appliedRecovery.nextMessage,
  }
}
