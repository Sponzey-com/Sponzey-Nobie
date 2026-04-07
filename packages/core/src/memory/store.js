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
export async function searchMemory(query, limit = 5, filters) {
    const mode = getConfig().memory?.searchMode ?? "fts";
    try {
        const results = await searchMemoryItems2(query, limit, mode, filters);
        return results.map((r) => r.item);
    }
    catch {
        return [];
    }
}
export function searchMemorySync(query, limit = 5, filters) {
    try {
        return searchMemoryItems(query, limit, filters);
    }
    catch {
        return [];
    }
}
export function recentMemories(limit = 10, filters) {
    return getRecentMemoryItems(limit, filters);
}
/** Build a formatted memory context block for system prompt injection */
export async function buildMemoryContext(params) {
    const journalContextPromise = import("./journal.js")
        .then((mod) => mod.buildMemoryJournalContext(params.query, {
        limit: 6,
        ...(params.sessionId ? { sessionId: params.sessionId } : {}),
        ...(params.requestGroupId ? { requestGroupId: params.requestGroupId } : {}),
        ...(params.runId ? { runId: params.runId } : {}),
    }))
        .catch(() => "");
    const [results, journalContext] = await Promise.all([
        searchMemory(params.query, 5, {
            ...(params.sessionId ? { sessionId: params.sessionId } : {}),
            ...(params.runId ? { runId: params.runId } : {}),
        }),
        journalContextPromise,
    ]);
    const relatedMemoryContext = results.length ? `[관련 기억]\n${results.map((r) => {
        const date = new Date(r.created_at).toLocaleDateString("ko-KR");
        return `- ${r.content} (${date})`;
    }).join("\n")}` : "";
    return [relatedMemoryContext, journalContext].filter(Boolean).join("\n\n");
}
//# sourceMappingURL=store.js.map
