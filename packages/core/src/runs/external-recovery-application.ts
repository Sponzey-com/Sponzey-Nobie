import type { RunChunkDeliveryHandler } from "./delivery.js"
import type { FinalizationDependencies, FinalizationSource } from "./finalization.js"
import type { ExternalRecoveryPlan } from "./external-recovery.js"
import { applyTerminalApplication } from "./terminal-application.js"

export type AppliedExternalRecoveryPlan =
  | { kind: "stop" }
  | {
      kind: "retry"
      nextState: ExternalRecoveryPlan["nextState"]
      nextMessage: string
    }

interface ExternalRecoveryApplicationDependencies {
  appendRunEvent: (runId: string, message: string) => void
}

interface ExternalRecoveryApplicationModuleDependencies {
  applyTerminalApplication: typeof applyTerminalApplication
}

const defaultModuleDependencies: ExternalRecoveryApplicationModuleDependencies = {
  applyTerminalApplication,
}

export async function applyExternalRecoveryPlan(
  params: {
    runId: string
    sessionId: string
    source: FinalizationSource
    onChunk: RunChunkDeliveryHandler | undefined
    preview: string
    plan: ExternalRecoveryPlan
    seenKeys: Set<string>
    finalizationDependencies: FinalizationDependencies
  },
  dependencies: ExternalRecoveryApplicationDependencies,
  moduleDependencies: ExternalRecoveryApplicationModuleDependencies = defaultModuleDependencies,
): Promise<AppliedExternalRecoveryPlan> {
  if (params.plan.duplicateStop) {
    await moduleDependencies.applyTerminalApplication({
      runId: params.runId,
      sessionId: params.sessionId,
      source: params.source,
      onChunk: params.onChunk,
        application: {
          kind: "stop",
          preview: params.preview,
          summary: params.plan.duplicateStop.summary,
          ...(params.plan.duplicateStop.reason ? { reason: params.plan.duplicateStop.reason } : {}),
          ...(params.plan.duplicateStop.rawMessage ? { rawMessage: params.plan.duplicateStop.rawMessage } : {}),
          remainingItems: params.plan.duplicateStop.remainingItems,
        },
      dependencies: params.finalizationDependencies,
    })
    return { kind: "stop" }
  }

  params.seenKeys.add(params.plan.recoveryKey)
  dependencies.appendRunEvent(params.runId, params.plan.eventLabel)
  if (params.plan.routeEventLabel) {
    dependencies.appendRunEvent(params.runId, params.plan.routeEventLabel)
  }

  return {
    kind: "retry",
    nextState: params.plan.nextState,
    nextMessage: params.plan.nextMessage,
  }
}
