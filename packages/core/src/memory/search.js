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
export function ftsSearch(query, limit) {
    try {
        const items = searchMemoryItems(query, limit);
        return items.map((item, rank) => ({ item, score: rrfScore(rank), source: "fts" }));
    }
    catch {
        return [];
    }
}
/** Vector-only search using in-process cosine similarity */
export async function vectorSearch(query, limit) {
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
        .prepare("SELECT * FROM memory_items WHERE embedding IS NOT NULL")
        .all();
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
export async function hybridSearch(query, limit) {
    const [ftsResults, vecResults] = await Promise.all([
        Promise.resolve(ftsSearch(query, limit * 2)),
        vectorSearch(query, limit * 2),
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
export async function searchMemoryItems2(query, limit = 5, mode) {
    const resolvedMode = mode ?? "fts";
    if (resolvedMode === "vector")
        return vectorSearch(query, limit);
    if (resolvedMode === "hybrid")
        return hybridSearch(query, limit);
    return ftsSearch(query, limit);
}
//# sourceMappingURL=search.js.map