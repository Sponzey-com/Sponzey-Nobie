import type { TaskExecutionSemantics } from "../agent/intake.js";
import type { SubAgentResultReview } from "../agent/sub-agent-result-review.js";
import { type CompletionStageState } from "./completion-state.js";
import type { DeliveryOutcome } from "./delivery.js";
import type { SuccessfulToolEvidence } from "./recovery.js";
export interface ReviewGateDecision {
    kind: "skip" | "run";
    state: CompletionStageState;
    reason?: string;
}
export interface SubSessionReviewGateDecision {
    kind: "allow_parent_completion" | "wait_for_revision" | "manual_action_required";
    blockedSubSessionIds: string[];
    reasonCodes: string[];
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
export declare function decideSubSessionReviewGate(reviews: Array<{
    subSessionId: string;
    review: Pick<SubAgentResultReview, "accepted" | "canRetry" | "normalizedFailureKey" | "manualActionReason">;
}>): SubSessionReviewGateDecision;
//# sourceMappingURL=review-gate.d.ts.map