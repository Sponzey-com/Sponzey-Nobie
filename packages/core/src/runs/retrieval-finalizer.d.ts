import type { RetrievalVerificationVerdict } from "./web-retrieval-verification.js";
import type { RunStatus } from "./types.js";
export type RetrievalCompletionStatus = "completed_value_found" | "completed_approximate_value_found" | "completed_limited_no_value" | "completed_insufficient_evidence" | "completed_policy_blocked" | "awaiting_user";
export type FinalAnswerDeliveryStatus = "delivered" | "suppressed" | "blocked";
export interface FinalAnswerDeliveryReceipt {
    status: FinalAnswerDeliveryStatus;
    delivered: boolean;
    duplicate: boolean;
    blocked: boolean;
    ledgerEventId: string | null;
    idempotencyKey: string;
    deliveryKey: string;
    channel: string;
    summary: string;
    reason?: string;
}
export interface RecordFinalAnswerDeliveryInput {
    runId?: string | null;
    requestGroupId?: string | null;
    sessionKey?: string | null;
    threadKey?: string | null;
    channel: string;
    text: string;
    verdict: RetrievalVerificationVerdict | null;
    createdAt?: number;
}
export interface RecordProgressMessageInput {
    runId?: string | null;
    requestGroupId?: string | null;
    sessionKey?: string | null;
    threadKey?: string | null;
    channel: string;
    text: string;
    createdAt?: number;
}
export interface FinalizedRetrievalCompletion {
    status: RetrievalCompletionStatus;
    runStatus: RunStatus;
    completionSatisfied: boolean;
    shouldRetryRecovery: boolean;
    summary: string;
    reason: string;
}
export interface FailureProtectionResult {
    shouldProtectDeliveredAnswer: boolean;
    outcome: "unchanged" | "success" | "partial_success";
    runStatus?: RunStatus;
    summary?: string;
    reason?: string;
}
export declare function buildFinalAnswerIdempotencyKey(input: {
    runId?: string | null;
    requestGroupId?: string | null;
    sessionKey?: string | null;
    threadKey?: string | null;
    channel: string;
}): string;
export declare function buildFinalAnswerDeliveryKey(input: {
    sessionKey?: string | null;
    threadKey?: string | null;
    channel: string;
    text: string;
}): string;
export declare function buildProgressMessageIdempotencyKey(input: RecordProgressMessageInput): string;
export declare function canGenerateFinalAnswerFromVerdict(input: {
    verdict: RetrievalVerificationVerdict | null;
    text: string;
}): {
    allowed: boolean;
    reason?: string;
};
export declare function recordProgressMessageSent(input: RecordProgressMessageInput): string | null;
export declare function recordFinalAnswerDelivery(input: RecordFinalAnswerDeliveryInput): FinalAnswerDeliveryReceipt;
export declare function finalizeRetrievalCompletion(input: {
    verdict: RetrievalVerificationVerdict | null;
    finalAnswerReceipt?: FinalAnswerDeliveryReceipt | null;
}): FinalizedRetrievalCompletion;
export declare function protectRunFailureAfterFinalAnswer(input: {
    runId?: string | null;
    requestGroupId?: string | null;
    channel: string;
    requestedStatus: RunStatus;
    requestedSummary?: string | null;
}): FailureProtectionResult;
//# sourceMappingURL=retrieval-finalizer.d.ts.map