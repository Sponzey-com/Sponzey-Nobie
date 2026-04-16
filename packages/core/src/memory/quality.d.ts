import { type MemoryScope } from "../db/index.js";
export declare const MEMORY_QUALITY_SCOPES: readonly ["global", "session", "task", "schedule", "flash-feedback", "artifact", "diagnostic", "long-term", "short-term"];
export interface MemoryScopeQualityMetric {
    scope: MemoryScope;
    documents: number;
    chunks: number;
    missingEmbeddings: number;
    staleEmbeddings: number;
    staleDocuments: number;
    accessCount: number;
    avgRetrievalLatencyMs: number | null;
    p95RetrievalLatencyMs: number | null;
    lastFailure: string | null;
}
export interface MemoryWritebackQualityMetric {
    pending: number;
    writing: number;
    failed: number;
    completed: number;
    discarded: number;
    lastFailure: string | null;
}
export interface FlashFeedbackQualityMetric {
    active: number;
    expired: number;
    highSeverityActive: number;
}
export interface MemoryRetrievalPolicySnapshot {
    fastPathBlocksLongTerm: boolean;
    fastPathBlocksVector: boolean;
    fastPathBudget: {
        maxChunks: number;
        maxChars: number;
    };
    normalBudget: {
        maxChunks: number;
        maxChars: number;
    };
    scheduleMemoryDefaultInjection: boolean;
}
export interface MemoryQualitySnapshot {
    generatedAt: number;
    status: "healthy" | "degraded";
    scopes: MemoryScopeQualityMetric[];
    totals: {
        documents: number;
        chunks: number;
        missingEmbeddings: number;
        staleEmbeddings: number;
        staleDocuments: number;
        accessCount: number;
    };
    writeback: MemoryWritebackQualityMetric;
    flashFeedback: FlashFeedbackQualityMetric;
    retrievalPolicy: MemoryRetrievalPolicySnapshot;
    lastFailure: string | null;
}
export declare function buildMemoryQualitySnapshot(input?: {
    now?: number;
    staleAfterMs?: number;
    latencyWindowMs?: number;
}): MemoryQualitySnapshot;
//# sourceMappingURL=quality.d.ts.map