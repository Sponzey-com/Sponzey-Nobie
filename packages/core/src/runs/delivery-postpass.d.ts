import { type DeliveryOutcome, type DeliverySource, type SuccessfulFileDelivery, type SuccessfulTextDelivery } from "./delivery.js";
import { type RecoveryAlternative, type SuccessfulToolEvidence } from "./recovery.js";
export interface DeliveryPostPassPreview {
    preview: string;
    summaryToLog?: string;
}
export declare function buildDeliveryPostPassPreview(params: {
    preview: string;
    deliveryOutcome: DeliveryOutcome;
    successfulFileDeliveries: SuccessfulFileDelivery[];
    successfulTools: SuccessfulToolEvidence[];
    sawRealFilesystemMutation: boolean;
}): DeliveryPostPassPreview;
export type DirectArtifactDeliveryDecision = {
    kind: "none";
} | {
    kind: "complete";
    deliverySummary: string;
    finalText: string;
    eventLabel: string;
} | {
    kind: "stop";
    summary: string;
    reason: string;
    remainingItems: string[];
} | {
    kind: "retry";
    recoveryKey: string;
    summary: string;
    reason: string;
    alternatives: RecoveryAlternative[];
    nextMessage: string;
    eventLabel: string;
};
export declare function decideDirectArtifactDeliveryFlow(params: {
    deliveryOutcome: DeliveryOutcome;
    source: DeliverySource;
    successfulFileDeliveries: SuccessfulFileDelivery[];
    successfulTextDeliveries?: SuccessfulTextDelivery[];
    seenKeys: Set<string>;
    canRetry: boolean;
    maxTurns: number;
    deliveryBudgetLimit: number;
    originalRequest: string;
    previousResult: string;
    successfulTools: SuccessfulToolEvidence[];
}): DirectArtifactDeliveryDecision;
//# sourceMappingURL=delivery-postpass.d.ts.map