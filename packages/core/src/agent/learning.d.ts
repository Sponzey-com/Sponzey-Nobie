import { type JsonObject } from "../contracts/index.js";
import { type DbLearningEvent, type DbProfileHistoryVersion, type DbProfileRestoreEvent } from "../db/index.js";
import type { AgentEntityType, HistoryVersion, LearningApprovalState, LearningEvent, OwnerScope, RestoreEvent } from "../contracts/sub-agent-orchestration.js";
export type LearningRiskLevel = "low" | "medium" | "high";
export type LearningPolicyReasonCode = "auto_apply_self_memory_high_confidence" | "pending_missing_evidence" | "pending_medium_confidence" | "pending_non_memory_target" | "pending_locked_setting_conflict" | "pending_permission_or_capability_expansion" | "rejected_low_confidence" | "rejected_cross_agent_write";
export interface LearningPolicyInput {
    actorOwner: OwnerScope;
    targetOwner: OwnerScope;
    learningTarget: LearningEvent["learningTarget"];
    before: JsonObject;
    after: JsonObject;
    confidence: number;
    evidenceRefs?: string[];
    risk?: LearningRiskLevel;
    lockedFields?: string[];
}
export interface LearningPolicyDecision {
    approvalState: LearningApprovalState;
    reasonCode: LearningPolicyReasonCode;
    autoApply: boolean;
    requiresReview: boolean;
    blocked: boolean;
    confidence: number;
    risk: LearningRiskLevel;
    issues: string[];
}
export interface LearningEventServiceInput extends LearningPolicyInput {
    agentId: string;
    agentType: AgentEntityType;
    beforeSummary: string;
    afterSummary: string;
    evidenceRefs: string[];
    sourceRunId?: string;
    sourceSessionId?: string;
    sourceSubSessionId?: string;
    parentRunId?: string;
    parentSessionId?: string;
    parentSubSessionId?: string;
    parentRequestId?: string;
    auditCorrelationId?: string;
    learningEventId?: string;
    idempotencyKey?: string;
    now?: () => number;
}
export interface LearningEventServiceResult {
    event: LearningEvent;
    policy: LearningPolicyDecision;
    inserted: boolean;
    history?: HistoryVersion;
    memoryDocumentId?: string;
}
export interface LearningReviewQueueQuery {
    agentId?: string;
    limit?: number;
}
export interface HistoryVersionInput {
    targetEntityType: HistoryVersion["targetEntityType"];
    targetEntityId: string;
    before: JsonObject;
    after: JsonObject;
    reasonCode: string;
    owner: OwnerScope;
    historyVersionId?: string;
    idempotencyKey?: string;
    auditCorrelationId?: string;
    parentRunId?: string;
    parentSessionId?: string;
    parentSubSessionId?: string;
    parentRequestId?: string;
    now?: () => number;
}
export interface RestoreDryRunResult {
    ok: boolean;
    targetEntityType: RestoreEvent["targetEntityType"];
    targetEntityId: string;
    restoredHistoryVersionId: string;
    restorePayload: JsonObject;
    currentPayload?: JsonObject;
    effectSummary: string[];
    conflictCodes: string[];
}
export interface RestoreHistoryVersionInput {
    targetEntityType: RestoreEvent["targetEntityType"];
    targetEntityId: string;
    restoredHistoryVersionId: string;
    owner: OwnerScope;
    dryRun: boolean;
    restoreEventId?: string;
    idempotencyKey?: string;
    auditCorrelationId?: string;
    parentRunId?: string;
    parentSessionId?: string;
    parentSubSessionId?: string;
    parentRequestId?: string;
    apply?: boolean;
    now?: () => number;
}
export interface RestoreHistoryVersionResult extends RestoreDryRunResult {
    event: RestoreEvent;
    inserted: boolean;
    applied: boolean;
}
export interface ApproveLearningEventInput {
    agentId: string;
    learningEventId: string;
    owner: OwnerScope;
    auditCorrelationId?: string;
    now?: () => number;
}
export interface ApproveLearningEventResult {
    ok: boolean;
    reasonCode: "approved" | "learning_event_not_found" | "learning_event_not_pending" | "learning_event_missing_diff";
    event?: LearningEvent;
    history?: HistoryVersion;
    historyInserted: boolean;
    memoryDocumentId?: string;
}
export declare function evaluateLearningPolicy(input: LearningPolicyInput): LearningPolicyDecision;
export declare function buildHistoryVersion(input: HistoryVersionInput): HistoryVersion;
export declare function recordHistoryVersion(input: HistoryVersion, options?: {
    auditId?: string | null;
}): boolean;
export declare function recordLearningEvent(input: LearningEventServiceInput): Promise<LearningEventServiceResult>;
export declare function dbLearningEventToContract(row: DbLearningEvent): LearningEvent;
export declare function approveLearningEvent(input: ApproveLearningEventInput): Promise<ApproveLearningEventResult>;
export declare function dbHistoryVersionToContract(row: DbProfileHistoryVersion): HistoryVersion;
export declare function dbRestoreEventToContract(row: DbProfileRestoreEvent): RestoreEvent;
export declare function dryRunRestoreHistoryVersion(input: {
    targetEntityType: RestoreEvent["targetEntityType"];
    targetEntityId: string;
    restoredHistoryVersionId: string;
}): RestoreDryRunResult;
export declare function restoreHistoryVersion(input: RestoreHistoryVersionInput): RestoreHistoryVersionResult;
export declare function listAgentLearningEvents(agentId: string): LearningEvent[];
export declare function listLearningReviewQueue(query?: LearningReviewQueueQuery): LearningEvent[];
export declare function listHistoryVersions(targetEntityType: HistoryVersion["targetEntityType"], targetEntityId: string): HistoryVersion[];
export declare function listRestoreEvents(targetEntityType: RestoreEvent["targetEntityType"], targetEntityId: string): RestoreEvent[];
//# sourceMappingURL=learning.d.ts.map