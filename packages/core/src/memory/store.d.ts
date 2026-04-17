import { type DbMemoryItem, type MemorySearchFilters, type MemoryScope, type StoreMemoryDocumentResult } from "../db/index.js";
import { type MemoryChunkSearchResult, type MemorySearchResult } from "./search.js";
export type { DbMemoryItem };
export type { MemorySearchResult };
export type { MemoryChunkSearchResult };
export interface StoreMemoryDocumentParams {
    rawText: string;
    scope: MemoryScope;
    ownerId?: string;
    scheduleId?: string;
    sourceType: string;
    sourceRef?: string;
    title?: string;
    metadata?: Record<string, unknown>;
}
export interface DetailedMemorySearchResult extends MemoryChunkSearchResult {
}
export interface MemoryContextBudget {
    maxChunks?: number;
    maxChars?: number;
    maxChunkChars?: number;
}
export declare function storeMemoryDocument(params: StoreMemoryDocumentParams): Promise<StoreMemoryDocumentResult>;
/** Store a memory item, auto-embedding if provider available */
export declare function storeMemory(params: {
    content: string;
    tags?: string[];
    importance?: "low" | "medium" | "high";
    scope?: MemoryScope;
    ownerId?: string;
    scheduleId?: string;
    sessionId?: string;
    requestGroupId?: string;
    runId?: string;
    type?: "user_fact" | "session_summary" | "project_note";
}): Promise<string>;
/** Synchronous version for compressor (no embedding) */
export declare function storeMemorySync(params: {
    content: string;
    tags?: string[];
    importance?: "low" | "medium" | "high";
    scope?: MemoryScope;
    ownerId?: string;
    scheduleId?: string;
    sessionId?: string;
    requestGroupId?: string;
    runId?: string;
    type?: "user_fact" | "session_summary" | "project_note";
}): string;
export declare function searchMemoryDetailed(query: string, limit?: number, filters?: MemorySearchFilters): Promise<DetailedMemorySearchResult[]>;
export declare function searchMemory(query: string, limit?: number, filters?: {
    sessionId?: string;
    runId?: string;
    requestGroupId?: string;
}): Promise<DbMemoryItem[]>;
export declare function searchMemorySync(query: string, limit?: number, filters?: {
    sessionId?: string;
    runId?: string;
    requestGroupId?: string;
}): DbMemoryItem[];
export declare function recentMemories(limit?: number, filters?: {
    sessionId?: string;
    runId?: string;
    requestGroupId?: string;
}): DbMemoryItem[];
export declare function buildMemoryInjectionContext(results: DetailedMemorySearchResult[], budget?: MemoryContextBudget): string;
/** Build a formatted memory context block for system prompt injection */
export declare function buildMemoryContext(params: {
    query: string;
    sessionId?: string;
    requestGroupId?: string;
    runId?: string;
    scheduleId?: string;
    includeSchedule?: boolean;
    includeArtifact?: boolean;
    includeDiagnostic?: boolean;
    includeFlashFeedback?: boolean;
    budget?: MemoryContextBudget;
}): Promise<string>;
//# sourceMappingURL=store.d.ts.map