import type { SubAgentResultReview } from "../agent/sub-agent-result-review.js";
import { type NamedDeliveryEvent, type NicknameSnapshot, type ResultReport } from "../contracts/sub-agent-orchestration.js";
import { type DbMessageLedgerEvent } from "../db/index.js";
import { type AssistantTextDeliveryOutcome, type RunChunkDeliveryHandler, emitAssistantTextDelivery } from "./delivery.js";
export type FinalDeliverySource = "webui" | "cli" | "telegram" | "slack";
export type FinalDeliveryStatus = "delivered" | "duplicate_suppressed" | "blocked" | "delivery_failed";
export type FinalizerApprovalStatus = "requested" | "approved" | "approved_once" | "approved_run" | "consumed" | "denied" | "expired" | "superseded";
export interface FinalizerApprovalState {
    approvalId: string;
    status: FinalizerApprovalStatus;
    subSessionId?: string;
    agentId?: string;
    summary?: string;
    reasonCode?: string;
}
export interface FinalizerReviewState {
    subSessionId: string;
    review: Pick<SubAgentResultReview, "accepted" | "normalizedFailureKey"> & Partial<Pick<SubAgentResultReview, "verdict" | "parentIntegrationStatus">>;
}
export interface FinalDeliveryAttribution {
    resultReportId: string;
    subSessionId: string;
    source: NicknameSnapshot;
    summary: string;
}
export interface FinalDeliveryCommitResult {
    status: FinalDeliveryStatus;
    idempotencyKey: string;
    deliveryKey: string;
    text: string;
    attributions: FinalDeliveryAttribution[];
    reasonCodes: string[];
    existingEventId?: string;
    deliveryOutcome?: AssistantTextDeliveryOutcome;
}
export interface PendingFinalizerRestoreItem {
    parentRunId: string;
    requestGroupId: string | null;
    sessionKey: string | null;
    channel: string;
    deliveryKey: string;
    generatedEventId: string;
    generatedAt: number;
    safeToAutoDeliver: false;
    duplicateRisk: true;
}
export interface ApprovalAggregationResult {
    eventId: string | null;
    text: string;
    pendingApprovalIds: string[];
    blockedApprovalIds: string[];
    approvedApprovalIds: string[];
}
export declare function buildFinalDeliveryAttributions(resultReports?: readonly ResultReport[]): FinalDeliveryAttribution[];
export declare function buildNobieFinalAnswer(input: {
    text: string;
    resultReports?: readonly ResultReport[];
}): {
    text: string;
    attributions: FinalDeliveryAttribution[];
};
export declare function findCommittedFinalDelivery(parentRunId: string): DbMessageLedgerEvent | undefined;
export declare function commitFinalDelivery(input: {
    parentRunId: string;
    sessionId: string;
    source: FinalDeliverySource;
    text: string;
    onChunk: RunChunkDeliveryHandler | undefined;
    speaker?: NicknameSnapshot;
    resultReports?: readonly ResultReport[];
    reviews?: readonly FinalizerReviewState[];
    approvals?: readonly FinalizerApprovalState[];
    deliveryDependencies?: NonNullable<Parameters<typeof emitAssistantTextDelivery>[0]["dependencies"]>;
    onDeliveryError?: (message: string) => void;
}): Promise<FinalDeliveryCommitResult>;
export declare function buildNamedResultDeliveryEvent(input: {
    parentRunId: string;
    sender: NicknameSnapshot;
    recipient: NicknameSnapshot;
    resultReportId: string;
    summary: string;
}): NamedDeliveryEvent;
export declare function recordApprovalAggregation(input: {
    parentRunId: string;
    sessionId: string;
    source: FinalDeliverySource;
    approvals: readonly FinalizerApprovalState[];
    speaker?: NicknameSnapshot;
}): ApprovalAggregationResult;
export declare function listPendingFinalizers(input?: {
    runId?: string;
    requestGroupId?: string;
    limit?: number;
}): PendingFinalizerRestoreItem[];
export declare function recordLateResultNoReply(input: {
    parentRunId: string;
    subSessionId: string;
    agentId?: string;
    resultReportId: string;
    reasonCode?: string;
}): void;
//# sourceMappingURL=channel-finalizer.d.ts.map