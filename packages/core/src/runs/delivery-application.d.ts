import type { DirectArtifactDeliveryDecision } from "./delivery-postpass.js";
import type { RecoveryAlternative } from "./recovery.js";
export type DirectArtifactDeliveryApplication = {
    kind: "none";
} | {
    kind: "complete";
    summary: string;
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
    detail: string;
    title: string;
    eventLabel: string;
    alternatives: RecoveryAlternative[];
    nextMessage: string;
    reviewStepStatus: "running";
    executingStepSummary: string;
    updateRunStatusSummary: string;
    clearWorkerRuntime: true;
};
export declare function decideDirectArtifactDeliveryApplication(decision: DirectArtifactDeliveryDecision): DirectArtifactDeliveryApplication;
//# sourceMappingURL=delivery-application.d.ts.map