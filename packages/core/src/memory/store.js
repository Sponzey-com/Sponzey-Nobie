import { insertMemoryItem, searchMemoryItems, getRecentMemoryItems, getDb } from "../db/index.js";
import { getEmbeddingProvider, encodeEmbedding } from "./embedding.js";
import { getConfig } from "../config/index.js";
import { searchMemoryItems2 } from "./search.js";
/** Store a memory item, auto-embedding if provider available */
export async function storeMemory(params) {
    const id = insertMemoryItem(params);
    // Async embed and update
    const provider = getEmbeddingProvider();
    if (provider.dimensions > 0) {
        try {
            const vec = await provider.embed(params.content);
            const embBuf = encodeEmbedding(vec);
            getDb()
                .prepare("UPDATE memory_items SET embedding = ? WHERE id = ?")
                .run(embBuf, id);
        }
        catch {
            // embedding failed — memory still stored, just without vector
        }
    }
    return id;
}
/** Synchronous version for compressor (no embedding) */
export function storeMemorySync(params) {
    return insertMemoryItem(params);
}
export async function searchMemory(query, limit = 5) {
    const mode = getConfig().memory?.searchMode ?? "fts";
    try {
        const results = await searchMemoryItems2(query, limit, mode);
        return results.map((r) => r.item);
    }
    catch {
        return [];
    }
}
export function searchMemorySync(query, limit = 5) {
    try {
        return searchMemoryItems(query, limit);
    }
    catch {
        return [];
    }
}
export function recentMemories(limit = 10) {
    return getRecentMemoryItems(limit);
}
/** Build a formatted memory context block for system prompt injection */
export async function buildMemoryContext(userMessage) {
    const results = await searchMemory(userMessage, 5);
    if (!results.length)
        return "";
    const lines = results.map((r) => {
        const date = new Date(r.created_at).toLocaleDateString("ko-KR");
        return `- ${r.content} (${date})`;
    });
    return `[관련 기억]\n${lines.join("\n")}`;
}
//# sourceMappingURL=store.js.map