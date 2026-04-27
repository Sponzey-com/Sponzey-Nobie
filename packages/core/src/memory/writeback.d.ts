import type { JsonObject } from "../contracts/index.js";
import type { AgentEntityType, LearningEvent, OwnerScope } from "../contracts/sub-agent-orchestration.js";
import { type MemoryScope, type MemoryWritebackStatus } from "../db/index.js";
export type RunWritebackKind = "instruction" | "success" | "failure" | "tool_result" | "flash_feedback";
export interface MemoryWritebackCandidate {
    scope: MemoryScope;
    ownerId?: string;
    sourceType: string;
    content: string;
    metadata?: Record<string, unknown>;
}
export type MemoryWritebackReviewAction = "approve_long_term" | "approve_edited" | "keep_session" | "discard";
export interface MemoryWritebackSafetyResult {
    content: string;
    blockReasons: string[];
    masked: boolean;
    blocked: boolean;
}
export interface PreparedMemoryWritebackCandidate extends MemoryWritebackCandidate {
    status?: MemoryWritebackStatus;
    lastError?: string;
}
export interface MemoryWritebackReviewItem {
    id: string;
    scope: MemoryScope;
    ownerId: string;
    sourceType: string;
    sourceRunId?: string;
    sourceChannel?: string;
    sessionId?: string;
    requestGroupId?: string;
    confidence?: string;
    ttl?: string;
    proposedText: string;
    repeatExamples: string[];
    blockReasons: string[];
    status: MemoryWritebackStatus;
    createdAt: number;
    updatedAt: number;
}
export interface MemoryWritebackReviewResult {
    ok: boolean;
    candidate: MemoryWritebackReviewItem;
    documentId?: string;
    action: MemoryWritebackReviewAction;
    reason?: string;
}
export interface LearningWritebackCandidate {
    agentId: string;
    agentType: AgentEntityType;
    actorOwner: OwnerScope;
    targetOwner: OwnerScope;
    learningTarget: LearningEvent["learningTarget"];
    before: JsonObject;
    after: JsonObject;
    beforeSummary: string;
    afterSummary: string;
    evidenceRefs: string[];
    confidence: number;
    sourceSessionId?: string;
    sourceSubSessionId?: string;
}
export interface BuildRunWritebackCandidatesParams {
    kind: RunWritebackKind;
    content: string;
    sessionId?: string;
    requestGroupId?: string;
    runId?: string;
    source?: string;
    toolName?: string;
    repeatCount?: number;
    metadata?: Record<string, unknown>;
}
export declare function inspectMemoryWritebackSafety(input: {
    scope: MemoryScope;
    sourceType: string;
    content: string;
}): MemoryWritebackSafetyResult;
export declare function prepareMemoryWritebackQueueInput(candidate: MemoryWritebackCandidate): PreparedMemoryWritebackCandidate;
export declare function isExplicitMemoryRequest(content: string): boolean;
export declare function isFlashFeedback(content: string): boolean;
export declare function stripExplicitMemoryDirective(content: string): string;
export declare function isEphemeralToolOutput(params: {
    toolName?: string;
    content: string;
}): boolean;
export declare function shouldPromoteFlashFeedback(params: {
    content: string;
    repeatCount?: number;
}): boolean;
export declare function buildRunWritebackCandidates(params: BuildRunWritebackCandidatesParams): MemoryWritebackCandidate[];
export declare function listMemoryWritebackReviewItems(input?: {
    status?: MemoryWritebackStatus | "all";
    limit?: number;
}): MemoryWritebackReviewItem[];
export declare function buildLearningWritebackCandidate(input: {
    item: MemoryWritebackReviewItem;
    agentId: string;
    agentType: AgentEntityType;
    actorOwner: OwnerScope;
    targetOwner: OwnerScope;
}): LearningWritebackCandidate;
export declare function reviewMemoryWritebackCandidate(params: {
    id: string;
    action: MemoryWritebackReviewAction;
    editedContent?: string;
    reviewerId?: string;
}): Promise<MemoryWritebackReviewResult>;
//# sourceMappingURL=writeback.d.ts.map