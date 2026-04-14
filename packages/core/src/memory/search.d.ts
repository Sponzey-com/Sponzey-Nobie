/**
 * Hybrid search: combines FTS (keyword) + vector (semantic) results
 * using Reciprocal Rank Fusion (RRF).
 */
import { type DbMemoryChunkSearchRow, type DbMemoryItem, type MemorySearchFilters } from "../db/index.js";
import { type EmbeddingProvider } from "./embedding.js";
export interface MemorySearchResult {
    item: DbMemoryItem;
    score: number;
    source: "fts" | "vector" | "hybrid";
}
export interface MemoryChunkSearchResult {
    chunk: DbMemoryChunkSearchRow;
    score: number;
    source: "fts" | "vector" | "hybrid" | "like";
    chunkId: string;
    latencyMs: number;
}
export type MemoryVectorDegradedReason = "disabled" | "timeout" | "provider_error" | "dimension_mismatch" | "model_mismatch" | "stale_embedding";
export interface MemoryVectorDiagnostic {
    reason: MemoryVectorDegradedReason;
    summary: string;
    provider?: string;
    model?: string;
    expectedDimensions?: number;
    actualDimensions?: number;
    candidateCount?: number;
}
export declare function diagnoseVectorEmbeddingRows(rows: Array<{
    provider: string;
    model: string;
    dimensions: number;
    text_checksum: string;
    checksum: string;
    vector?: Buffer;
}>, provider: Pick<EmbeddingProvider, "providerId" | "modelId" | "dimensions">): MemoryVectorDiagnostic[];
export declare function sanitizeFtsQuery(query: string): string | null;
/** FTS-only search */
export declare function ftsSearch(query: string, limit: number, filters?: {
    sessionId?: string;
    runId?: string;
    requestGroupId?: string;
}): MemorySearchResult[];
export declare function ftsChunkSearch(query: string, limit: number, filters?: MemorySearchFilters): MemoryChunkSearchResult[];
export declare function likeChunkSearch(query: string, limit: number, filters?: MemorySearchFilters): MemoryChunkSearchResult[];
/** Vector-only search using in-process cosine similarity */
export declare function vectorSearch(query: string, limit: number, filters?: {
    sessionId?: string;
    runId?: string;
    requestGroupId?: string;
    scheduleId?: string;
    includeSchedule?: boolean;
}): Promise<MemorySearchResult[]>;
export declare function vectorChunkSearch(query: string, limit: number, filters?: MemorySearchFilters): Promise<MemoryChunkSearchResult[]>;
/** Hybrid search: RRF fusion of FTS and vector results */
export declare function hybridSearch(query: string, limit: number, filters?: {
    sessionId?: string;
    runId?: string;
    requestGroupId?: string;
    scheduleId?: string;
    includeSchedule?: boolean;
}): Promise<MemorySearchResult[]>;
export declare function hybridChunkSearch(query: string, limit: number, filters?: MemorySearchFilters): Promise<MemoryChunkSearchResult[]>;
/** Main entry point respecting config.memory.searchMode */
export declare function searchMemoryItems2(query: string, limit?: number, mode?: "fts" | "vector" | "hybrid", filters?: {
    sessionId?: string;
    runId?: string;
    requestGroupId?: string;
    scheduleId?: string;
    includeSchedule?: boolean;
}): Promise<MemorySearchResult[]>;
export declare function searchMemoryChunks(query: string, limit?: number, mode?: "fts" | "vector" | "hybrid", filters?: MemorySearchFilters): Promise<MemoryChunkSearchResult[]>;
//# sourceMappingURL=search.d.ts.map