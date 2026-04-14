import type { CompletionReviewResult } from "../agent/completion-review.js";
import type { TaskExecutionSemantics } from "../agent/intake.js";
import type { SuccessfulToolEvidence } from "./recovery.js";
export interface CompletionEvidenceState {
    executionSatisfied: boolean;
    deliveryRequired: boolean;
    deliverySatisfied: boolean;
    completionSatisfied: boolean;
    conflictReason?: string;
}
export type CompletionInterpretationStatus = "satisfied" | "followup_required" | "user_input_required";
export type CompletionExecutionStatus = "satisfied" | "missing";
export type CompletionDeliveryStatus = "satisfied" | "missing" | "not_required";
export type CompletionRecoveryStatus = "settled" | "required";
export type CompletionChecklistItemKey = "request" | "execution" | "delivery" | "completion";
export type CompletionChecklistItemStatus = "completed" | "pending" | "not_required";
export interface CompletionChecklistItem {
    key: CompletionChecklistItemKey;
    status: CompletionChecklistItemStatus;
    reason?: string;
}
export interface CompletionChecklistState {
    items: CompletionChecklistItem[];
    completedCount: number;
    actionableCount: number;
    pendingCount: number;
}
export interface CompletionStageState extends CompletionEvidenceState {
    interpretationStatus: CompletionInterpretationStatus;
    executionStatus: CompletionExecutionStatus;
    deliveryStatus: CompletionDeliveryStatus;
    recoveryStatus: CompletionRecoveryStatus;
    blockingReasons: string[];
    checklist?: CompletionChecklistState;
}
export declare function deriveCompletionEvidenceState(params: {
    executionSemantics: TaskExecutionSemantics;
    preview: string;
    deliverySatisfied: boolean;
    successfulTools: SuccessfulToolEvidence[];
    sawRealFilesystemMutation: boolean;
}): CompletionEvidenceState;
export declare function deriveCompletionStageState(params: {
    review: CompletionReviewResult | null;
    executionSemantics: TaskExecutionSemantics;
    preview: string;
    deliverySatisfied: boolean;
    successfulTools: SuccessfulToolEvidence[];
    sawRealFilesystemMutation: boolean;
    requiresFilesystemMutation: boolean;
    truncatedOutputRecoveryAttempted: boolean;
}): CompletionStageState;
//# sourceMappingURL=completion-state.d.ts.map