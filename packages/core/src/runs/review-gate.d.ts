import type { TaskExecutionSemantics } from "../agent/intake.js";
import { type CompletionStageState } from "./completion-state.js";
import type { DeliveryOutcome } from "./delivery.js";
import type { SuccessfulToolEvidence } from "./recovery.js";
export interface ReviewGateDecision {
    kind: "skip" | "run";
    state: CompletionStageState;
    reason?: string;
}
export declare function decideReviewGate(params: {
    executionSemantics: TaskExecutionSemantics;
    preview: string;
    deliveryOutcome: DeliveryOutcome;
    successfulTools: SuccessfulToolEvidence[];
    sawRealFilesystemMutation: boolean;
    requiresFilesystemMutation: boolean;
    truncatedOutputRecoveryAttempted: boolean;
}): ReviewGateDecision;
//# sourceMappingURL=review-gate.d.ts.map