import { getDb } from "../db/index.js";
export const MEMORY_QUALITY_SCOPES = [
    "global",
    "session",
    "task",
    "schedule",
    "flash-feedback",
    "artifact",
    "diagnostic",
    "long-term",
    "short-term",
];
const DEFAULT_STALE_AFTER_MS = 30 * 24 * 60 * 60 * 1000;
const DEFAULT_LATENCY_WINDOW_MS = 24 * 60 * 60 * 1000;
function countRows(table, where = "1 = 1", values = []) {
    try {
        const row = getDb()
            .prepare(`SELECT count(*) AS count FROM ${table} WHERE ${where}`)
            .get(...values);
        return row?.count ?? 0;
    }
    catch {
        return 0;
    }
}
function percentile95(values) {
    const sorted = values.filter((value) => Number.isFinite(value)).sort((a, b) => a - b);
    if (sorted.length === 0)
        return null;
    const index = Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1);
    return sorted[index] ?? null;
}
function average(values) {
    const finite = values.filter((value) => Number.isFinite(value));
    if (finite.length === 0)
        return null;
    return Math.round(finite.reduce((sum, value) => sum + value, 0) / finite.length);
}
function readScopeStorageMetrics(staleBefore) {
    const rows = getDb()
        .prepare(`SELECT
         d.scope AS scope,
         count(DISTINCT d.id) AS documents,
         count(c.id) AS chunks,
         sum(CASE WHEN c.id IS NOT NULL AND e.id IS NULL THEN 1 ELSE 0 END) AS missing_embeddings,
         sum(CASE WHEN e.id IS NOT NULL AND e.text_checksum != c.checksum THEN 1 ELSE 0 END) AS stale_embeddings,
         sum(CASE WHEN d.updated_at < ? THEN 1 ELSE 0 END) AS stale_documents
       FROM memory_documents d
       LEFT JOIN memory_chunks c ON c.document_id = d.id
       LEFT JOIN memory_embeddings e ON e.chunk_id = c.id
       WHERE d.archived_at IS NULL
       GROUP BY d.scope`)
        .all(staleBefore);
    return new Map(rows.map((row) => [row.scope, row]));
}
function readLatencyMetrics(since) {
    const rows = getDb()
        .prepare(`SELECT d.scope AS scope, a.latency_ms
       FROM memory_access_log a
       LEFT JOIN memory_documents d ON d.id = a.document_id
       WHERE a.latency_ms IS NOT NULL
         AND a.created_at >= ?`)
        .all(since);
    const result = new Map();
    for (const row of rows) {
        if (!row.scope || row.latency_ms == null)
            continue;
        const list = result.get(row.scope) ?? [];
        list.push(row.latency_ms);
        result.set(row.scope, list);
    }
    return result;
}
function readLastFailureByScope() {
    const rows = getDb()
        .prepare(`SELECT d.scope AS scope, j.last_error AS failure, j.updated_at AS at
       FROM memory_index_jobs j
       LEFT JOIN memory_documents d ON d.id = j.document_id
       WHERE j.status = 'failed' AND j.last_error IS NOT NULL
       UNION ALL
       SELECT q.scope AS scope, q.last_error AS failure, q.updated_at AS at
       FROM memory_writeback_queue q
       WHERE q.status = 'failed' AND q.last_error IS NOT NULL
       ORDER BY at DESC`)
        .all();
    const result = new Map();
    for (const row of rows) {
        if (!row.scope || !row.failure || result.has(row.scope))
            continue;
        result.set(row.scope, row.failure);
    }
    return result;
}
function readWritebackMetric() {
    const rows = getDb()
        .prepare(`SELECT status, count(*) AS count
       FROM memory_writeback_queue
       GROUP BY status`)
        .all();
    const lastFailure = getDb()
        .prepare(`SELECT last_error
       FROM memory_writeback_queue
       WHERE status = 'failed' AND last_error IS NOT NULL
       ORDER BY updated_at DESC
       LIMIT 1`)
        .get()?.last_error ?? null;
    const metric = {
        pending: 0,
        writing: 0,
        failed: 0,
        completed: 0,
        discarded: 0,
        lastFailure,
    };
    for (const row of rows) {
        metric[row.status] = row.count;
    }
    return metric;
}
function readFlashFeedbackMetric(now) {
    return {
        active: countRows("flash_feedback", "expires_at > ?", [now]),
        expired: countRows("flash_feedback", "expires_at <= ?", [now]),
        highSeverityActive: countRows("flash_feedback", "severity = 'high' AND expires_at > ?", [now]),
    };
}
function buildRetrievalPolicySnapshot() {
    return {
        fastPathBlocksLongTerm: true,
        fastPathBlocksVector: true,
        fastPathBudget: {
            maxChunks: 0,
            maxChars: 0,
        },
        normalBudget: {
            maxChunks: 4,
            maxChars: 2200,
        },
        scheduleMemoryDefaultInjection: false,
    };
}
export function buildMemoryQualitySnapshot(input = {}) {
    const now = input.now ?? Date.now();
    const staleBefore = now - Math.max(1, input.staleAfterMs ?? DEFAULT_STALE_AFTER_MS);
    const latencySince = now - Math.max(1, input.latencyWindowMs ?? DEFAULT_LATENCY_WINDOW_MS);
    const storage = readScopeStorageMetrics(staleBefore);
    const latency = readLatencyMetrics(latencySince);
    const failures = readLastFailureByScope();
    const scopes = MEMORY_QUALITY_SCOPES.map((scope) => {
        const row = storage.get(scope);
        const latencies = latency.get(scope) ?? [];
        return {
            scope,
            documents: row?.documents ?? 0,
            chunks: row?.chunks ?? 0,
            missingEmbeddings: row?.missing_embeddings ?? 0,
            staleEmbeddings: row?.stale_embeddings ?? 0,
            staleDocuments: row?.stale_documents ?? 0,
            accessCount: latencies.length,
            avgRetrievalLatencyMs: average(latencies),
            p95RetrievalLatencyMs: percentile95(latencies),
            lastFailure: failures.get(scope) ?? null,
        };
    });
    const writeback = readWritebackMetric();
    const flashFeedback = readFlashFeedbackMetric(now);
    const lastFailure = writeback.lastFailure ?? scopes.find((scope) => scope.lastFailure)?.lastFailure ?? null;
    const totals = scopes.reduce((acc, scope) => ({
        documents: acc.documents + scope.documents,
        chunks: acc.chunks + scope.chunks,
        missingEmbeddings: acc.missingEmbeddings + scope.missingEmbeddings,
        staleEmbeddings: acc.staleEmbeddings + scope.staleEmbeddings,
        staleDocuments: acc.staleDocuments + scope.staleDocuments,
        accessCount: acc.accessCount + scope.accessCount,
    }), { documents: 0, chunks: 0, missingEmbeddings: 0, staleEmbeddings: 0, staleDocuments: 0, accessCount: 0 });
    const status = writeback.failed > 0 || totals.staleEmbeddings > 0 || scopes.some((scope) => (scope.p95RetrievalLatencyMs ?? 0) > 500)
        ? "degraded"
        : "healthy";
    return {
        generatedAt: now,
        status,
        scopes,
        totals,
        writeback,
        flashFeedback,
        retrievalPolicy: buildRetrievalPolicySnapshot(),
        lastFailure,
    };
}
//# sourceMappingURL=quality.js.map