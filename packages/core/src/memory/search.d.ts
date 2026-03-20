/**
 * Hybrid search: combines FTS (keyword) + vector (semantic) results
 * using Reciprocal Rank Fusion (RRF).
 */
import { type DbMemoryItem } from "../db/index.js";
export interface MemorySearchResult {
    item: DbMemoryItem;
    score: number;
    source: "fts" | "vector" | "hybrid";
}
/** FTS-only search */
export declare function ftsSearch(query: string, limit: number): MemorySearchResult[];
/** Vector-only search using in-process cosine similarity */
export declare function vectorSearch(query: string, limit: number): Promise<MemorySearchResult[]>;
/** Hybrid search: RRF fusion of FTS and vector results */
export declare function hybridSearch(query: string, limit: number): Promise<MemorySearchResult[]>;
/** Main entry point respecting config.memory.searchMode */
export declare function searchMemoryItems2(query: string, limit?: number, mode?: "fts" | "vector" | "hybrid"): Promise<MemorySearchResult[]>;
//# sourceMappingURL=search.d.ts.map