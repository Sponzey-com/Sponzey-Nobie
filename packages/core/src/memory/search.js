/**
 * Hybrid search: combines FTS (keyword) + vector (semantic) results
 * using Reciprocal Rank Fusion (RRF).
 */
import { searchMemoryItems, getDb } from "../db/index.js";
import { getEmbeddingProvider, decodeEmbedding, cosineSimilarity } from "./embedding.js";
const RRF_K = 60; // RRF constant
const DEFAULT_VECTOR_SEARCH_TIMEOUT_MS = 750;
function rrfScore(rank) {
    return 1 / (RRF_K + rank + 1);
}
function elapsedMs(startedAt) {
    return Number((process.hrtime.bigint() - startedAt) / 1000000n);
}
function uniqueValues(values) {
    return [...new Set(values.filter((value) => Boolean(value?.trim())).map((value) => value.trim()))];
}
function withVectorTimeout(promise, fallback, timeoutMs = DEFAULT_VECTOR_SEARCH_TIMEOUT_MS) {
    return new Promise((resolve) => {
        const timer = setTimeout(() => resolve(fallback), timeoutMs);
        promise.then((value) => {
            clearTimeout(timer);
            resolve(value);
        }, () => {
            clearTimeout(timer);
            resolve(fallback);
        });
    });
}
function escapeLike(value) {
    return value.replace(/[\\%_]/g, (match) => `\\${match}`);
}
export function sanitizeFtsQuery(query) {
    const terms = query
        .normalize("NFKC")
        .match(/[\p{L}\p{N}_]+/gu)
        ?.map((term) => term.trim())
        .filter((term) => term.length > 0)
        .slice(0, 12) ?? [];
    if (terms.length === 0)
        return null;
    return terms.map((term) => `"${term.replace(/"/g, '""')}"`).join(" OR ");
}
function buildChunkScopeWhere(filters, alias = "c") {
    const prefix = alias ? `${alias}.` : "";
    const clauses = [`${prefix}scope = 'global'`];
    const values = [];
    if (filters?.sessionId) {
        clauses.push(`(${prefix}scope = 'session' AND ${prefix}owner_id = ?)`);
        values.push(filters.sessionId);
    }
    const taskOwners = uniqueValues([filters?.requestGroupId, filters?.runId]);
    if (taskOwners.length > 0) {
        clauses.push(`(${prefix}scope = 'task' AND ${prefix}owner_id IN (${taskOwners.map(() => "?").join(", ")}))`);
        values.push(...taskOwners);
    }
    if (filters?.includeArtifact) {
        const artifactOwners = uniqueValues([filters.requestGroupId, filters.runId, filters.sessionId]);
        if (artifactOwners.length > 0) {
            clauses.push(`(${prefix}scope = 'artifact' AND ${prefix}owner_id IN (${artifactOwners.map(() => "?").join(", ")}))`);
            values.push(...artifactOwners);
        }
    }
    if (filters?.includeDiagnostic) {
        const diagnosticOwners = uniqueValues([filters.requestGroupId, filters.runId, filters.sessionId]);
        if (diagnosticOwners.length > 0) {
            clauses.push(`(${prefix}scope = 'diagnostic' AND ${prefix}owner_id IN (${diagnosticOwners.map(() => "?").join(", ")}))`);
            values.push(...diagnosticOwners);
        }
    }
    return { clause: `(${clauses.join(" OR ")})`, values };
}
function buildLegacyItemScopeWhere(filters) {
    const clauses = ["memory_scope = 'global'", "memory_scope IS NULL", "memory_scope = ''"];
    const values = [];
    if (filters?.sessionId) {
        clauses.push("(memory_scope = 'session' AND session_id = ?)");
        values.push(filters.sessionId);
    }
    const taskOwners = uniqueValues([filters?.requestGroupId, filters?.runId]);
    if (taskOwners.length > 0) {
        const placeholders = taskOwners.map(() => "?").join(", ");
        clauses.push(`(memory_scope = 'task' AND (request_group_id IN (${placeholders}) OR run_id IN (${placeholders})))`);
        values.push(...taskOwners, ...taskOwners);
    }
    return { clause: `(${clauses.join(" OR ")})`, values };
}
function mapChunkRows(rows, source, startedAt) {
    const latencyMs = elapsedMs(startedAt);
    return rows.map((chunk, index) => ({
        chunk,
        score: Number.isFinite(chunk.score) ? chunk.score : rrfScore(index),
        source,
        chunkId: chunk.id,
        latencyMs,
    }));
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
export function ftsChunkSearch(query, limit, filters) {
    const startedAt = process.hrtime.bigint();
    const sanitized = sanitizeFtsQuery(query);
    if (!sanitized)
        return likeChunkSearch(query, limit, filters);
    const scope = buildChunkScopeWhere(filters);
    try {
        const rows = getDb()
            .prepare(`SELECT c.*, d.title AS document_title, d.source_type AS document_source_type,
                d.source_ref AS document_source_ref, d.metadata_json AS document_metadata_json,
                bm25(memory_chunks_fts) AS score
         FROM memory_chunks_fts f
         JOIN memory_chunks c ON c.rowid = f.rowid
         JOIN memory_documents d ON d.id = c.document_id
         WHERE memory_chunks_fts MATCH ?
           AND d.archived_at IS NULL
           AND ${scope.clause}
         ORDER BY score ASC
         LIMIT ?`)
            .all(sanitized, ...scope.values, limit);
        return mapChunkRows(rows, "fts", startedAt);
    }
    catch {
        return likeChunkSearch(query, limit, filters);
    }
}
export function likeChunkSearch(query, limit, filters) {
    const startedAt = process.hrtime.bigint();
    const normalized = query.normalize("NFKC").trim();
    if (!normalized)
        return [];
    const pattern = `%${escapeLike(normalized)}%`;
    const scope = buildChunkScopeWhere(filters);
    const rows = getDb()
        .prepare(`SELECT c.*, d.title AS document_title, d.source_type AS document_source_type,
              d.source_ref AS document_source_ref, d.metadata_json AS document_metadata_json,
              0 AS score
       FROM memory_chunks c
       JOIN memory_documents d ON d.id = c.document_id
       WHERE d.archived_at IS NULL
         AND c.content LIKE ? ESCAPE '\\'
         AND ${scope.clause}
       ORDER BY c.updated_at DESC, c.ordinal ASC
       LIMIT ?`)
        .all(pattern, ...scope.values, limit);
    return mapChunkRows(rows, "like", startedAt);
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
    const scope = buildLegacyItemScopeWhere(filters);
    const rows = db
        .prepare(`SELECT * FROM memory_items
       WHERE embedding IS NOT NULL
         AND ${scope.clause}`)
        .all(...scope.values);
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
export async function vectorChunkSearch(query, limit, filters) {
    const startedAt = process.hrtime.bigint();
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
    const scope = buildChunkScopeWhere(filters);
    const rows = getDb()
        .prepare(`SELECT c.*, d.title AS document_title, d.source_type AS document_source_type,
              d.source_ref AS document_source_ref, d.metadata_json AS document_metadata_json,
              0 AS score,
              e.provider, e.model, e.dimensions, e.text_checksum, e.vector
       FROM memory_embeddings e
       JOIN memory_chunks c ON c.id = e.chunk_id
       JOIN memory_documents d ON d.id = c.document_id
       WHERE d.archived_at IS NULL
         AND ${scope.clause}`)
        .all(...scope.values);
    const latencyMs = elapsedMs(startedAt);
    return rows
        .map((row) => {
        const score = cosineSimilarity(queryVec, decodeEmbedding(row.vector));
        return { chunk: row, score, source: "vector", chunkId: row.id, latencyMs };
    })
        .sort((a, b) => b.score - a.score)
        .slice(0, limit);
}
/** Hybrid search: RRF fusion of FTS and vector results */
export async function hybridSearch(query, limit, filters) {
    const [ftsResults, vecResults] = await Promise.all([
        Promise.resolve(ftsSearch(query, limit * 2, filters)),
        withVectorTimeout(vectorSearch(query, limit * 2, filters), []),
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
export async function hybridChunkSearch(query, limit, filters) {
    const [ftsResults, vectorResults] = await Promise.all([
        Promise.resolve(ftsChunkSearch(query, limit * 2, filters)),
        withVectorTimeout(vectorChunkSearch(query, limit * 2, filters), []),
    ]);
    const byId = new Map();
    for (let i = 0; i < ftsResults.length; i++) {
        const result = ftsResults[i];
        if (!result)
            continue;
        const previous = byId.get(result.chunkId);
        byId.set(result.chunkId, {
            ...result,
            source: previous ? "hybrid" : result.source,
            score: (previous?.score ?? 0) + rrfScore(i),
            latencyMs: Math.max(previous?.latencyMs ?? 0, result.latencyMs),
        });
    }
    for (let i = 0; i < vectorResults.length; i++) {
        const result = vectorResults[i];
        if (!result)
            continue;
        const previous = byId.get(result.chunkId);
        byId.set(result.chunkId, {
            ...result,
            source: previous ? "hybrid" : "vector",
            score: (previous?.score ?? 0) + rrfScore(i),
            latencyMs: Math.max(previous?.latencyMs ?? 0, result.latencyMs),
        });
    }
    return Array.from(byId.values())
        .sort((a, b) => b.score - a.score)
        .slice(0, limit);
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
export async function searchMemoryChunks(query, limit = 5, mode, filters) {
    const resolvedMode = mode ?? "fts";
    if (resolvedMode === "vector")
        return vectorChunkSearch(query, limit, filters);
    if (resolvedMode === "hybrid")
        return hybridChunkSearch(query, limit, filters);
    return ftsChunkSearch(query, limit, filters);
}
//# sourceMappingURL=search.js.map