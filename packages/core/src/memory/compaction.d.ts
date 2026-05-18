import type { AIProvider, Message } from "../ai/types.js";
import { type MemoryCapsule, type MemoryCapsuleArtifactRef } from "./capsule.js";
export declare const SESSION_COMPACTION_TOKEN_THRESHOLD = 120000;
export declare const SESSION_COMPACTION_MESSAGE_THRESHOLD = 40;
export declare const ROOT_SESSION_COMPACTION_DEFAULT_TAIL_SIZE = 8;
export type RootSessionCompactionReasonCode = "token_threshold_exceeded" | "message_threshold_exceeded" | "large_tool_payload_pruned" | "root_continuity_refresh_needed" | "blocked_by_pending_finalization" | "blocked_by_unmatched_tool_pair" | "blocked_by_cancellation_or_recovery";
export interface SessionCompactionSnapshotInput {
    sessionId: string;
    summary: string;
    requestGroupId?: string;
    activeTaskIds?: string[];
    pendingApprovals?: string[];
    pendingDelivery?: string[];
}
export interface SessionCompactionSnapshot {
    sessionId: string;
    summary: string;
    preservedFacts: string[];
    activeTaskIds: string[];
}
export interface SilentMemoryFlushInput {
    sessionId: string;
    runId?: string;
    requestGroupId?: string;
    pendingApprovals?: string[];
    pendingDelivery?: string[];
    durableFacts?: string[];
}
export interface SessionCompactionMaintenanceResult {
    snapshotId: string;
    flushCandidateId?: string;
    snapshot: SessionCompactionSnapshot;
}
export interface RootSessionDeterministicState {
    activeTaskIds: string[];
    activeObjectives: string[];
    pendingApprovals: string[];
    pendingDelivery: string[];
    explicitTargetSelectors: string[];
    latestArtifactReceipts: string[];
    unresolvedResultReviewItems: string[];
    explicitUserCorrections: string[];
    retryDoNotRepeatBoundary: string[];
    finalDeliveryBlockReasons: string[];
    confirmedFacts: string[];
    mustKeepConstraints: string[];
    decisions: string[];
    recoveryStates: string[];
}
export interface RootSessionPinnedWorkingSet {
    activeObjectives: string[];
    confirmedFacts: string[];
    constraints: string[];
    decisions: string[];
    pendingItems: string[];
    artifactRefs: MemoryCapsuleArtifactRef[];
    blockedReasonCodes: RootSessionCompactionReasonCode[];
}
export interface RootSessionStructuredSummary {
    whatHappened: string;
    currentGoal: string[];
    stillOpen: string[];
    confirmedFacts: string[];
    mustKeepConstraints: string[];
    artifactsAndReceipts: string[];
    toolSideEffectBoundary: string[];
    retryDoNotRepeat: string[];
    handoffReadyContext: string[];
}
export interface RootSessionCompactionExecutionResult {
    capsuleId: string;
    compactionRunId: string;
    capsule: MemoryCapsule;
    rewrittenMessages: Message[];
    triggerReasonCodes: RootSessionCompactionReasonCode[];
    tailMessageCount: number;
    degradedTailMessageCount?: number;
    sourceMessageCount: number;
    archiveDocumentId?: string;
    rollupCapsuleId?: string;
}
export interface RootSessionRetrievalOnlyRewriteResult {
    messages: Message[];
    snippetCount: number;
    resultTokenEstimate: number;
}
interface RootSessionCompactionAttemptInput {
    provider: AIProvider;
    model: string;
    sessionId: string;
    messages: Message[];
    sourceTokenEstimate: number;
    triggerReasonCodes: RootSessionCompactionReasonCode[];
    runId?: string;
    requestGroupId?: string;
}
interface RootSessionCompactionRewriteResult {
    messages: Message[];
    tailMessageCount: number;
    degradedTailMessageCount?: number;
    resultTokenEstimate: number;
}
export declare function estimateContextTokens(value: string | Message[]): number;
export declare function needsSessionCompaction(messages: Message[], totalTokens: number): boolean;
export declare function truncateSnapshotSummary(summary: string, maxChars?: number): string;
export declare function buildSessionCompactionSnapshot(input: SessionCompactionSnapshotInput): SessionCompactionSnapshot;
export declare function runSilentMemoryFlushBeforeCompaction(input: SilentMemoryFlushInput): string | undefined;
export declare function persistSessionCompactionMaintenance(input: SessionCompactionSnapshotInput & SilentMemoryFlushInput): SessionCompactionMaintenanceResult;
export declare function hasBalancedToolUsePairs(messages: Message[]): boolean;
export declare function buildRootSessionCompactionReasonCodes(input: {
    messages: Message[];
    totalTokens: number;
    pruningDecisionCount?: number;
    deterministicState?: RootSessionDeterministicState;
}): RootSessionCompactionReasonCode[];
export declare function extractRootSessionDeterministicState(input: {
    messages: Message[];
    requestGroupId?: string;
}): RootSessionDeterministicState;
export declare function buildRootSessionPinnedWorkingSet(input: {
    deterministicState: RootSessionDeterministicState;
}): RootSessionPinnedWorkingSet;
export declare function executeRootSessionCompaction(input: RootSessionCompactionAttemptInput): Promise<RootSessionCompactionExecutionResult>;
export declare function rewriteRootSessionActiveWindow(input: {
    messages: Message[];
    capsule: MemoryCapsule;
    pinnedWorkingSet: RootSessionPinnedWorkingSet;
    preferredTailSize?: number;
    maintenanceRestoreBlock?: string;
    promptTimeRecallBlock?: string;
}): RootSessionCompactionRewriteResult;
export declare function rewriteRootSessionRetrievalOnlyWindow(input: {
    messages: Message[];
    capsule: MemoryCapsule;
    pinnedWorkingSet: RootSessionPinnedWorkingSet;
    maxSnippetCount?: number;
    maxSnippetChars?: number;
    retrievalSnippets?: string[];
}): RootSessionRetrievalOnlyRewriteResult;
export {};
//# sourceMappingURL=compaction.d.ts.map