import { type DbMemoryItem } from "../db/index.js";
import { type MemorySearchResult } from "./search.js";
export type { DbMemoryItem };
export type { MemorySearchResult };
/** Store a memory item, auto-embedding if provider available */
export declare function storeMemory(params: {
    content: string;
    tags?: string[];
    importance?: "low" | "medium" | "high";
    sessionId?: string;
    type?: "user_fact" | "session_summary" | "project_note";
}): Promise<string>;
/** Synchronous version for compressor (no embedding) */
export declare function storeMemorySync(params: {
    content: string;
    tags?: string[];
    importance?: "low" | "medium" | "high";
    sessionId?: string;
    type?: "user_fact" | "session_summary" | "project_note";
}): string;
export declare function searchMemory(query: string, limit?: number): Promise<DbMemoryItem[]>;
export declare function searchMemorySync(query: string, limit?: number): DbMemoryItem[];
export declare function recentMemories(limit?: number): DbMemoryItem[];
/** Build a formatted memory context block for system prompt injection */
export declare function buildMemoryContext(userMessage: string): Promise<string>;
//# sourceMappingURL=store.d.ts.map