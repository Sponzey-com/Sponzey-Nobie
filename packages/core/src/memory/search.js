/**
 * Hybrid search: combines FTS (keyword) + vector (semantic) results
 * using Reciprocal Rank Fusion (RRF).
 */
import { searchMemoryItems, getDb } from "../db/index.js";
import { getEmbeddingProvider, decodeEmbedding, cosineSimilarity } from "./embedding.js";
const RRF_K = 60; // RRF constant
function rrfScore(rank) {
    return 1 / (RRF_K + rank + 1);
}
/** FTS-only search */
export function ftsSearch(query, limit, filters) {
    try {
        const items = searchMemoryItems(query, limit, filters);
        return items.map((item, rank) => ({ item, score: rrfScore(rank), source: "fts" }));
    }
    catch {
        return [];
    }
}
/** Vector-only search using in-process cosine similarity */
export async function vectorSearch(query, limit, filters) {
    const provider = getEmbeddingProvider();
    if (provider.dimensions === 0)
        return [];
    let queryVec;
    try {
        queryVec = await provider.embed(query);
    }
    catch {
        return [];
    }
    const db = getDb();
    const rows = db
        .prepare(`SELECT * FROM memory_items
       WHERE embedding IS NOT NULL
         AND (
           memory_scope = 'global'
           OR memory_scope IS NULL
           OR memory_scope = ''
           ${filters?.sessionId ? "OR (memory_scope = 'session' AND session_id = ?)" : ""}
           ${filters?.runId ? "OR (memory_scope = 'task' AND run_id = ?)" : ""}
         )`)
        .all(...(filters?.sessionId ? [filters.sessionId] : []), ...(filters?.runId ? [filters.runId] : []));
    if (!rows.length)
        return [];
    const scored = [];
    for (const item of rows) {
        if (!item.embedding)
            continue;
        const vec = decodeEmbedding(item.embedding);
        const score = cosineSimilarity(queryVec, vec);
        scored.push({ item, score, source: "vector" });
    }
    return scored
        .sort((a, b) => b.score - a.score)
        .slice(0, limit);
}
/** Hybrid search: RRF fusion of FTS and vector results */
export async function hybridSearch(query, limit, filters) {
    const [ftsResults, vecResults] = await Promise.all([
        Promise.resolve(ftsSearch(query, limit * 2, filters)),
        vectorSearch(query, limit * 2, filters),
    ]);
    // Build score map
    const scoreMap = new Map();
    for (let i = 0; i < ftsResults.length; i++) {
        const entry = ftsResults[i];
        if (!entry)
            continue;
        const { item } = entry;
        const prev = scoreMap.get(item.id);
        scoreMap.set(item.id, { item, score: (prev?.score ?? 0) + rrfScore(i) });
    }
    for (let i = 0; i < vecResults.length; i++) {
        const entry = vecResults[i];
        if (!entry)
            continue;
        const { item } = entry;
        const prev = scoreMap.get(item.id);
        scoreMap.set(item.id, { item, score: (prev?.score ?? 0) + rrfScore(i) });
    }
    return Array.from(scoreMap.values())
        .sort((a, b) => b.score - a.score)
        .slice(0, limit)
        .map(({ item, score }) => ({ item, score, source: "hybrid" }));
}
/** Main entry point respecting config.memory.searchMode */
export async function searchMemoryItems2(query, limit = 5, mode, filters) {
    const resolvedMode = mode ?? "fts";
    if (resolvedMode === "vector")
        return vectorSearch(query, limit, filters);
    if (resolvedMode === "hybrid")
        return hybridSearch(query, limit, filters);
    return ftsSearch(query, limit, filters);
}
//# sourceMappingURL=search.js.map
