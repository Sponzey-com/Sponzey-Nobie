import { resolveDeliveryOutcome, } from "./delivery.js";
import { buildDeliveryPostPassPreview, decideDirectArtifactDeliveryFlow, } from "./delivery-postpass.js";
import { decideDirectArtifactDeliveryApplication, } from "./delivery-application.js";
export function runDeliveryPass(params) {
    const deliveryOutcome = resolveDeliveryOutcome({
        wantsDirectArtifactDelivery: params.wantsDirectArtifactDelivery,
        deliveries: params.successfulFileDeliveries,
    });
    const postPassPreview = buildDeliveryPostPassPreview({
        preview: params.preview,
        deliveryOutcome,
        successfulFileDeliveries: params.successfulFileDeliveries,
        successfulTools: params.successfulTools,
        sawRealFilesystemMutation: params.sawRealFilesystemMutation,
    });
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
    });
    return {
        deliveryOutcome,
        preview: postPassPreview.preview,
        ...(postPassPreview.summaryToLog ? { summaryToLog: postPassPreview.summaryToLog } : {}),
        directDeliveryApplication: decideDirectArtifactDeliveryApplication(directDeliveryDecision),
    };
}
//# sourceMappingURL=delivery-pass.js.map