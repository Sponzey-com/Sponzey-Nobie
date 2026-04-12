import { type DeliveryOutcome, type DeliverySource, type SuccessfulFileDelivery } from "./delivery.js";
import { type DirectArtifactDeliveryApplication } from "./delivery-application.js";
import type { SuccessfulToolEvidence } from "./recovery.js";
export interface DeliveryPassResult {
    deliveryOutcome: DeliveryOutcome;
    preview: string;
    summaryToLog?: string;
    directDeliveryApplication: DirectArtifactDeliveryApplication;
}
export declare function runDeliveryPass(params: {
    preview: string;
    wantsDirectArtifactDelivery: boolean;
    successfulFileDeliveries: SuccessfulFileDelivery[];
    successfulTools: SuccessfulToolEvidence[];
    sawRealFilesystemMutation: boolean;
    source: DeliverySource;
    seenDeliveryRecoveryKeys: Set<string>;
    canRetry: boolean;
    maxTurns: number;
    deliveryBudgetLimit: number;
    originalRequest: string;
    previousResult: string;
}): DeliveryPassResult;
//# sourceMappingURL=delivery-pass.d.ts.map