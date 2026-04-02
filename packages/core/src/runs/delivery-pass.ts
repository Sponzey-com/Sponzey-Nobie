import {
  resolveDeliveryOutcome,
  type DeliveryOutcome,
  type DeliverySource,
  type SuccessfulFileDelivery,
} from "./delivery.js"
import {
  buildDeliveryPostPassPreview,
  decideDirectArtifactDeliveryFlow,
} from "./delivery-postpass.js"
import {
  decideDirectArtifactDeliveryApplication,
  type DirectArtifactDeliveryApplication,
} from "./delivery-application.js"
import type { SuccessfulToolEvidence } from "./recovery.js"

export interface DeliveryPassResult {
  deliveryOutcome: DeliveryOutcome
  preview: string
  summaryToLog?: string
  directDeliveryApplication: DirectArtifactDeliveryApplication
}

export function runDeliveryPass(params: {
  preview: string
  wantsDirectArtifactDelivery: boolean
  successfulFileDeliveries: SuccessfulFileDelivery[]
  successfulTools: SuccessfulToolEvidence[]
  sawRealFilesystemMutation: boolean
  source: DeliverySource
  seenDeliveryRecoveryKeys: Set<string>
  canRetry: boolean
  maxTurns: number
  deliveryBudgetLimit: number
  originalRequest: string
  previousResult: string
}): DeliveryPassResult {
  const deliveryOutcome = resolveDeliveryOutcome({
    wantsDirectArtifactDelivery: params.wantsDirectArtifactDelivery,
    deliveries: params.successfulFileDeliveries,
  })
  const postPassPreview = buildDeliveryPostPassPreview({
    preview: params.preview,
    deliveryOutcome,
    successfulFileDeliveries: params.successfulFileDeliveries,
    successfulTools: params.successfulTools,
    sawRealFilesystemMutation: params.sawRealFilesystemMutation,
  })
  const directDeliveryDecision = decideDirectArtifactDeliveryFlow({
    deliveryOutcome,
    source: params.source,
    successfulFileDeliveries: params.successfulFileDeliveries,
    seenKeys: params.seenDeliveryRecoveryKeys,
    canRetry: params.canRetry,
    maxTurns: params.maxTurns,
    deliveryBudgetLimit: params.deliveryBudgetLimit,
    originalRequest: params.originalRequest,
    previousResult: postPassPreview.preview,
    successfulTools: params.successfulTools,
  })

  return {
    deliveryOutcome,
    preview: postPassPreview.preview,
    ...(postPassPreview.summaryToLog ? { summaryToLog: postPassPreview.summaryToLog } : {}),
    directDeliveryApplication: decideDirectArtifactDeliveryApplication(directDeliveryDecision),
  }
}
