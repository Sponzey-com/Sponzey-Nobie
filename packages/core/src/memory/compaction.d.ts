import type { Message } from "../ai/types.js";
export declare const SESSION_COMPACTION_TOKEN_THRESHOLD = 120000;
export declare const SESSION_COMPACTION_MESSAGE_THRESHOLD = 40;
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
export declare function estimateContextTokens(value: string | Message[]): number;
export declare function needsSessionCompaction(messages: Message[], totalTokens: number): boolean;
export declare function truncateSnapshotSummary(summary: string, maxChars?: number): string;
export declare function buildSessionCompactionSnapshot(input: SessionCompactionSnapshotInput): SessionCompactionSnapshot;
export declare function hasBalancedToolUsePairs(messages: Message[]): boolean;
//# sourceMappingURL=compaction.d.ts.map