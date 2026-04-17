/**
 * Hybrid search: combines FTS (keyword) + vector (semantic) results
 * using Reciprocal Rank Fusion (RRF).
 */
import { searchMemoryItems, getDb, insertDiagnosticEvent, markMemoryIndexJobStale } from "../db/index.js";
import { getEmbeddingProvider, decodeEmbedding, cosineSimilarity } from "./embedding.js";
const RRF_K = 60; // RRF constant
const DEFAULT_VECTOR_SEARCH_TIMEOUT_MS = 750;
const DEFAULT_RETRIEVAL_DEGRADED_THRESHOLD_MS = 500;
function rrfScore(rank) {
    return 1 / (RRF_K + rank + 1);
}
function elapsedMs(startedAt) {
    return Number((process.hrtime.bigint() - startedAt) / 1000000n);
}
function uniqueValues(values) {
    return [...new Set(values.filter((value) => Boolean(value?.trim())).map((value) => value.trim()))];
}
function withVectorTimeout(promise, fallback, timeoutMs = DEFAULT_VECTOR_SEARCH_TIMEOUT_MS, onTimeout) {
    return new Promise((resolve) => {
        let settled = false;
        const timer = setTimeout(() => {
            if (settled)
                return;
            settled = true;
            onTimeout?.();
            resolve(fallback);
        }, timeoutMs);
        promise.then((value) => {
            if (settled)
                return;
            settled = true;
            clearTimeout(timer);
            resolve(value);
        }, () => {
            if (settled)
                return;
            settled = true;
            clearTimeout(timer);
            resolve(fallback);
        });
    });
}
function escapeLike(value) {
    return value.replace(/[\\%_]/g, (match) => `\\${match}`);
}
function parseMetadataJson(value) {
    if (!value)
        return {};
    try {
        const parsed = JSON.parse(value);
        return parsed && typeof parsed === "object" && !Array.isArray(parsed)
            ? parsed
            : {};
    }
    catch {
        return {};
    }
}
function isLongTermReviewApproved(metadata) {
    if (metadata["approved"] === true || metadata["reviewApproved"] === true)
        return true;
    if (metadata["requiresReview"] === true)
        return false;
    return true;
}
function isFlashFeedbackActive(metadata, nowMs = Date.now()) {
    const expiresAt = metadata["expiresAt"] ?? metadata["expires_at"];
    return typeof expiresAt !== "number" || expiresAt > nowMs;
}
function getMemoryVisibilityRejectionReason(row, filters) {
    if (row.scope === "diagnostic" && !filters?.includeDiagnostic)
        return "diagnostic_scope_excluded";
    if (row.scope === "artifact" && !filters?.includeArtifact)
        return "artifact_scope_excluded";
    if (row.scope === "schedule" && !filters?.includeSchedule)
        return "schedule_scope_excluded";
    if (row.scope === "flash-feedback" && !filters?.includeFlashFeedback)
        return "flash_feedback_scope_excluded";
    const metadata = parseMetadataJson(row.document_metadata_json);
    if (row.scope === "long-term" && !isLongTermReviewApproved(metadata))
        return "long_term_review_pending";
    if (row.scope === "flash-feedback" && !isFlashFeedbackActive(metadata))
        return "flash_feedback_expired";
    return null;
}
function filterVisibleMemoryRows(rows, filters) {
    const visible = [];
    for (const row of rows) {
        const rejectionReason = getMemoryVisibilityRejectionReason(row, filters);
        if (!rejectionReason) {
            visible.push(row);
            continue;
        }
        recordMemoryScopeRejection(filters, row, rejectionReason);
    }
    return visible;
}
function recordMemoryVectorDiagnostic(filters, diagnostic) {
    try {
        insertDiagnosticEvent({
            kind: "memory_vector_degraded",
            summary: diagnostic.summary,
            ...(filters?.runId ? { runId: filters.runId } : {}),
            ...(filters?.sessionId ? { sessionId: filters.sessionId } : {}),
            ...(filters?.requestGroupId ? { requestGroupId: filters.requestGroupId } : {}),
            detail: {
                reason: diagnostic.reason,
                ...(diagnostic.provider ? { provider: diagnostic.provider } : {}),
                ...(diagnostic.model ? { model: diagnostic.model } : {}),
                ...(diagnostic.expectedDimensions !== undefined ? { expectedDimensions: diagnostic.expectedDimensions } : {}),
                ...(diagnostic.actualDimensions !== undefined ? { actualDimensions: diagnostic.actualDimensions } : {}),
                ...(diagnostic.candidateCount !== undefined ? { candidateCount: diagnostic.candidateCount } : {}),
            },
        });
    }
    catch {
        // Retrieval diagnostics must never affect memory search.
    }
}
function recordMemoryScopeRejection(filters, row, reason) {
    if (!filters?.runId && !filters?.sessionId && !filters?.requestGroupId)
        return;
    try {
        insertDiagnosticEvent({
            kind: "memory_scope_rejected",
            summary: `memory chunk rejected by scope guard: ${reason}`,
            ...(filters?.runId ? { runId: filters.runId } : {}),
            ...(filters?.sessionId ? { sessionId: filters.sessionId } : {}),
            ...(filters?.requestGroupId ? { requestGroupId: filters.requestGroupId } : {}),
            recoveryKey: `memory_scope:${reason}:${row.scope}`,
            detail: {
                reason,
                scope: row.scope,
                chunkId: row.id,
                documentId: row.document_id,
                sourceChecksum: row.source_checksum,
            },
        });
    }
    catch {
        // Scope diagnostics are best-effort.
    }
}
function recordRetrievalLatencyDiagnostic(filters, params) {
    if (params.latencyMs < DEFAULT_RETRIEVAL_DEGRADED_THRESHOLD_MS)
        return;
    try {
        insertDiagnosticEvent({
            kind: "memory_retrieval_degraded",
            summary: `memory ${params.source} retrieval exceeded latency threshold`,
            ...(filters?.runId ? { runId: filters.runId } : {}),
            ...(filters?.sessionId ? { sessionId: filters.sessionId } : {}),
            ...(filters?.requestGroupId ? { requestGroupId: filters.requestGroupId } : {}),
            detail: {
                source: params.source,
                latencyMs: params.latencyMs,
                candidateCount: params.candidateCount,
                thresholdMs: DEFAULT_RETRIEVAL_DEGRADED_THRESHOLD_MS,
            },
        });
    }
    catch {
        // Diagnostic logging is best-effort.
    }
}
export function diagnoseVectorEmbeddingRows(rows, provider) {
    const diagnostics = [];
    const pushUnique = (diagnostic) => {
        if (diagnostics.some((entry) => entry.reason === diagnostic.reason && entry.summary === diagnostic.summary))
            return;
        diagnostics.push(diagnostic);
    };
    const modelMismatchCount = rows.filter((row) => row.provider !== provider.providerId || row.model !== provider.modelId).length;
    if (modelMismatchCount > 0) {
        pushUnique({
            reason: "model_mismatch",
            summary: "stored memory embedding provider/model differs from active provider/model",
            provider: provider.providerId,
            model: provider.modelId,
            candidateCount: modelMismatchCount,
        });
    }
    const dimensionMismatchCount = rows.filter((row) => row.dimensions !== provider.dimensions || (row.vector && row.vector.byteLength / 4 !== provider.dimensions)).length;
    if (dimensionMismatchCount > 0) {
        const actualDimensions = rows.find((row) => row.dimensions !== provider.dimensions)?.dimensions;
        pushUnique({
            reason: "dimension_mismatch",
            summary: "stored memory embedding dimension differs from active provider dimension",
            provider: provider.providerId,
            model: provider.modelId,
            expectedDimensions: provider.dimensions,
            ...(actualDimensions !== undefined ? { actualDimensions } : {}),
            candidateCount: dimensionMismatchCount,
        });
    }
    const staleCount = rows.filter((row) => row.text_checksum !== row.checksum).length;
    if (staleCount > 0) {
        pushUnique({
            reason: "stale_embedding",
            summary: "stored memory embedding checksum is stale for the current chunk text",
            provider: provider.providerId,
            model: provider.modelId,
            candidateCount: staleCount,
        });
    }
    return diagnostics;
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
    const clauses = [`${prefix}scope = 'global'`, `${prefix}scope = 'long-term'`];
    const values = [];
    if (filters?.sessionId) {
        clauses.push(`(${prefix}scope IN ('session', 'short-term') AND ${prefix}owner_id = ?)`);
        values.push(filters.sessionId);
        if (filters.includeFlashFeedback) {
            clauses.push(`(${prefix}scope = 'flash-feedback' AND ${prefix}owner_id = ?)`);
            values.push(filters.sessionId);
        }
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
    if (filters?.includeSchedule && filters.scheduleId) {
        clauses.push(`(${prefix}scope = 'schedule' AND ${prefix}owner_id = ?)`);
        values.push(filters.scheduleId);
    }
    return { clause: `(${clauses.join(" OR ")})`, values };
}
function buildLegacyItemScopeWhere(filters) {
    const clauses = ["memory_scope = 'global'", "memory_scope = 'long-term'", "memory_scope IS NULL", "memory_scope = ''"];
    const values = [];
    if (filters?.sessionId) {
        clauses.push("(memory_scope IN ('session', 'short-term') AND session_id = ?)");
        values.push(filters.sessionId);
    }
    const taskOwners = uniqueValues([filters?.requestGroupId, filters?.runId]);
    if (taskOwners.length > 0) {
        const placeholders = taskOwners.map(() => "?").join(", ");
        clauses.push(`(memory_scope = 'task' AND (request_group_id IN (${placeholders}) OR run_id IN (${placeholders})))`);
        values.push(...taskOwners, ...taskOwners);
    }
    if (filters?.includeSchedule && filters.scheduleId) {
        clauses.push("(memory_scope = 'schedule' AND request_group_id = ?)");
        values.push(filters.scheduleId);
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
        const rawRows = getDb()
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
            .all(sanitized, ...scope.values, limit * 3);
        const rows = filterVisibleMemoryRows(rawRows, filters).slice(0, limit);
        const results = mapChunkRows(rows, "fts", startedAt);
        recordRetrievalLatencyDiagnostic(filters, { source: "fts", latencyMs: results[0]?.latencyMs ?? 0, candidateCount: rows.length });
        return results;
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
    const rawRows = getDb()
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
        .all(pattern, ...scope.values, limit * 3);
    const rows = filterVisibleMemoryRows(rawRows, filters).slice(0, limit);
    const results = mapChunkRows(rows, "like", startedAt);
    recordRetrievalLatencyDiagnostic(filters, { source: "like", latencyMs: results[0]?.latencyMs ?? 0, candidateCount: rows.length });
    return results;
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
    if (provider.dimensions === 0) {
        recordMemoryVectorDiagnostic(filters, {
            reason: "disabled",
            summary: "memory vector backend is disabled because embedding provider is not configured",
            provider: provider.providerId,
            model: provider.modelId,
            expectedDimensions: provider.dimensions,
        });
        return [];
    }
    let queryVec;
    try {
        queryVec = await provider.embed(query);
    }
    catch {
        recordMemoryVectorDiagnostic(filters, {
            reason: "provider_error",
            summary: "memory vector embedding provider failed during query embedding",
            provider: provider.providerId,
            model: provider.modelId,
            expectedDimensions: provider.dimensions,
        });
        return [];
    }
    if (queryVec.length !== provider.dimensions) {
        recordMemoryVectorDiagnostic(filters, {
            reason: "dimension_mismatch",
            summary: "memory vector query embedding dimension differs from configured provider dimension",
            provider: provider.providerId,
            model: provider.modelId,
            expectedDimensions: provider.dimensions,
            actualDimensions: queryVec.length,
        });
        return [];
    }
    const scope = buildChunkScopeWhere(filters);
    const rawRows = getDb()
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
    const rows = filterVisibleMemoryRows(rawRows, filters);
    for (const diagnostic of diagnoseVectorEmbeddingRows(rows, provider)) {
        recordMemoryVectorDiagnostic(filters, diagnostic);
    }
    for (const row of rows) {
        if (row.text_checksum !== row.checksum) {
            markMemoryIndexJobStale(row.document_id, "stored memory embedding checksum is stale for the current chunk text");
        }
    }
    const eligibleRows = rows.filter((row) => row.provider === provider.providerId
        && row.model === provider.modelId
        && row.dimensions === provider.dimensions
        && row.text_checksum === row.checksum
        && row.vector.byteLength / 4 === provider.dimensions);
    const latencyMs = elapsedMs(startedAt);
    const results = eligibleRows
        .map((row) => {
        const score = cosineSimilarity(queryVec, decodeEmbedding(row.vector));
        return { chunk: row, score, source: "vector", chunkId: row.id, latencyMs };
    })
        .sort((a, b) => b.score - a.score)
        .slice(0, limit);
    recordRetrievalLatencyDiagnostic(filters, { source: "vector", latencyMs, candidateCount: eligibleRows.length });
    return results;
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
        withVectorTimeout(vectorChunkSearch(query, limit * 2, filters), [], DEFAULT_VECTOR_SEARCH_TIMEOUT_MS, () => {
            recordMemoryVectorDiagnostic(filters, {
                reason: "timeout",
                summary: "memory vector retrieval timed out and fell back to FTS results",
            });
        }),
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
    if (resolvedMode === "vector") {
        const vectorResults = await vectorSearch(query, limit, filters);
        return vectorResults.length > 0 ? vectorResults : ftsSearch(query, limit, filters);
    }
    if (resolvedMode === "hybrid")
        return hybridSearch(query, limit, filters);
    return ftsSearch(query, limit, filters);
}
export async function searchMemoryChunks(query, limit = 5, mode, filters) {
    const resolvedMode = mode ?? "fts";
    if (resolvedMode === "vector") {
        const vectorResults = await vectorChunkSearch(query, limit, filters);
        return vectorResults.length > 0 ? vectorResults : ftsChunkSearch(query, limit, filters);
    }
    if (resolvedMode === "hybrid")
        return hybridChunkSearch(query, limit, filters);
    return ftsChunkSearch(query, limit, filters);
}
//# sourceMappingURL=search.js.map