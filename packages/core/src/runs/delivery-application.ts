import type { DirectArtifactDeliveryDecision } from "./delivery-postpass.js"
import type { RecoveryAlternative } from "./recovery.js"

export type DirectArtifactDeliveryApplication =
  | {
      kind: "none"
    }
  | {
      kind: "complete"
      summary: string
      finalText: string
      eventLabel: string
    }
  | {
      kind: "stop"
      summary: string
      reason: string
      remainingItems: string[]
    }
  | {
      kind: "retry"
      recoveryKey: string
      summary: string
      detail: string
      title: string
      eventLabel: string
      alternatives: RecoveryAlternative[]
      nextMessage: string
      reviewStepStatus: "running"
      executingStepSummary: string
      updateRunStatusSummary: string
      clearWorkerRuntime: true
    }

export function decideDirectArtifactDeliveryApplication(
  decision: DirectArtifactDeliveryDecision,
): DirectArtifactDeliveryApplication {
  if (decision.kind === "none") {
    return { kind: "none" }
  }

  if (decision.kind === "complete") {
    return {
      kind: "complete",
      summary: decision.deliverySummary,
      finalText: decision.finalText,
      eventLabel: decision.eventLabel,
    }
  }

  if (decision.kind === "stop") {
    return {
      kind: "stop",
      summary: decision.summary,
      reason: decision.reason,
      remainingItems: decision.remainingItems,
    }
  }

  return {
    kind: "retry",
    recoveryKey: decision.recoveryKey,
    summary: decision.summary,
    detail: decision.reason,
    title: "direct_artifact_delivery_recovery",
    eventLabel: decision.eventLabel,
    alternatives: decision.alternatives,
    nextMessage: decision.nextMessage,
    reviewStepStatus: "running",
    executingStepSummary: decision.summary,
    updateRunStatusSummary: decision.summary,
    clearWorkerRuntime: true,
  }
}
