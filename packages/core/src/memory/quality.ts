import { getDb, type MemoryScope } from "../db/index.js"

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
] as const satisfies readonly MemoryScope[]

export interface MemoryScopeQualityMetric {
  scope: MemoryScope
  documents: number
  chunks: number
  missingEmbeddings: number
  staleEmbeddings: number
  staleDocuments: number
  accessCount: number
  avgRetrievalLatencyMs: number | null
  p95RetrievalLatencyMs: number | null
  lastFailure: string | null
}

export interface MemoryWritebackQualityMetric {
  pending: number
  writing: number
  failed: number
  completed: number
  discarded: number
  lastFailure: string | null
}

export interface FlashFeedbackQualityMetric {
  active: number
  expired: number
  highSeverityActive: number
}

export interface LearningHistoryQualityMetric {
  pendingReview: number
  autoApplied: number
  appliedByUser: number
  rejected: number
  historyVersions: number
  restoreEvents: number
}

export interface MemoryRetrievalPolicySnapshot {
  fastPathBlocksLongTerm: boolean
  fastPathBlocksVector: boolean
  fastPathBudget: {
    maxChunks: number
    maxChars: number
  }
  normalBudget: {
    maxChunks: number
    maxChars: number
  }
  scheduleMemoryDefaultInjection: boolean
}

export interface MemoryQualitySnapshot {
  generatedAt: number
  status: "healthy" | "degraded"
  scopes: MemoryScopeQualityMetric[]
  totals: {
    documents: number
    chunks: number
    missingEmbeddings: number
    staleEmbeddings: number
    staleDocuments: number
    accessCount: number
  }
  writeback: MemoryWritebackQualityMetric
  flashFeedback: FlashFeedbackQualityMetric
  learningHistory: LearningHistoryQualityMetric
  retrievalPolicy: MemoryRetrievalPolicySnapshot
  lastFailure: string | null
}

interface ScopeStorageRow {
  scope: MemoryScope
  documents: number
  chunks: number
  missing_embeddings: number
  stale_embeddings: number
  stale_documents: number
}

interface LatencyRow {
  scope: MemoryScope | null
  latency_ms: number | null
}

interface FailureRow {
  scope: MemoryScope | null
  failure: string | null
  at: number
}

const DEFAULT_STALE_AFTER_MS = 30 * 24 * 60 * 60 * 1000
const DEFAULT_LATENCY_WINDOW_MS = 24 * 60 * 60 * 1000

function countRows(table: string, where = "1 = 1", values: unknown[] = []): number {
  try {
    const row = getDb()
      .prepare<unknown[], { count: number }>(`SELECT count(*) AS count FROM ${table} WHERE ${where}`)
      .get(...values)
    return row?.count ?? 0
  } catch {
    return 0
  }
}

function percentile95(values: number[]): number | null {
  const sorted = values.filter((value) => Number.isFinite(value)).sort((a, b) => a - b)
  if (sorted.length === 0) return null
  const index = Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1)
  return sorted[index] ?? null
}

function average(values: number[]): number | null {
  const finite = values.filter((value) => Number.isFinite(value))
  if (finite.length === 0) return null
  return Math.round(finite.reduce((sum, value) => sum + value, 0) / finite.length)
}

function readScopeStorageMetrics(staleBefore: number): Map<MemoryScope, ScopeStorageRow> {
  const rows = getDb()
    .prepare<[number], ScopeStorageRow>(
      `SELECT
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
       GROUP BY d.scope`,
    )
    .all(staleBefore)

  return new Map(rows.map((row) => [row.scope, row]))
}

function readLatencyMetrics(since: number): Map<MemoryScope, number[]> {
  const rows = getDb()
    .prepare<[number], LatencyRow>(
      `SELECT d.scope AS scope, a.latency_ms
       FROM memory_access_log a
       LEFT JOIN memory_documents d ON d.id = a.document_id
       WHERE a.latency_ms IS NOT NULL
         AND a.created_at >= ?`,
    )
    .all(since)

  const result = new Map<MemoryScope, number[]>()
  for (const row of rows) {
    if (!row.scope || row.latency_ms == null) continue
    const list = result.get(row.scope) ?? []
    list.push(row.latency_ms)
    result.set(row.scope, list)
  }
  return result
}

function readLastFailureByScope(): Map<MemoryScope, string> {
  const rows = getDb()
    .prepare<[], FailureRow>(
      `SELECT d.scope AS scope, j.last_error AS failure, j.updated_at AS at
       FROM memory_index_jobs j
       LEFT JOIN memory_documents d ON d.id = j.document_id
       WHERE j.status = 'failed' AND j.last_error IS NOT NULL
       UNION ALL
       SELECT q.scope AS scope, q.last_error AS failure, q.updated_at AS at
       FROM memory_writeback_queue q
       WHERE q.status = 'failed' AND q.last_error IS NOT NULL
       ORDER BY at DESC`,
    )
    .all()

  const result = new Map<MemoryScope, string>()
  for (const row of rows) {
    if (!row.scope || !row.failure || result.has(row.scope)) continue
    result.set(row.scope, row.failure)
  }
  return result
}

function readWritebackMetric(): MemoryWritebackQualityMetric {
  const rows = getDb()
    .prepare<[], { status: keyof Omit<MemoryWritebackQualityMetric, "lastFailure">; count: number }>(
      `SELECT status, count(*) AS count
       FROM memory_writeback_queue
       GROUP BY status`,
    )
    .all()
  const lastFailure = getDb()
    .prepare<[], { last_error: string | null }>(
      `SELECT last_error
       FROM memory_writeback_queue
       WHERE status = 'failed' AND last_error IS NOT NULL
       ORDER BY updated_at DESC
       LIMIT 1`,
    )
    .get()?.last_error ?? null
  const metric: MemoryWritebackQualityMetric = {
    pending: 0,
    writing: 0,
    failed: 0,
    completed: 0,
    discarded: 0,
    lastFailure,
  }
  for (const row of rows) {
    metric[row.status] = row.count
  }
  return metric
}

function readFlashFeedbackMetric(now: number): FlashFeedbackQualityMetric {
  return {
    active: countRows("flash_feedback", "expires_at > ?", [now]),
    expired: countRows("flash_feedback", "expires_at <= ?", [now]),
    highSeverityActive: countRows("flash_feedback", "severity = 'high' AND expires_at > ?", [now]),
  }
}

function readLearningHistoryMetric(): LearningHistoryQualityMetric {
  return {
    pendingReview: countRows("learning_events", "approval_state = ?", ["pending_review"]),
    autoApplied: countRows("learning_events", "approval_state = ?", ["auto_applied"]),
    appliedByUser: countRows("learning_events", "approval_state = ?", ["applied_by_user"]),
    rejected: countRows("learning_events", "approval_state = ?", ["rejected"]),
    historyVersions: countRows("profile_history_versions"),
    restoreEvents: countRows("profile_restore_events"),
  }
}

function buildRetrievalPolicySnapshot(): MemoryRetrievalPolicySnapshot {
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
  }
}

export function buildMemoryQualitySnapshot(input: {
  now?: number
  staleAfterMs?: number
  latencyWindowMs?: number
} = {}): MemoryQualitySnapshot {
  const now = input.now ?? Date.now()
  const staleBefore = now - Math.max(1, input.staleAfterMs ?? DEFAULT_STALE_AFTER_MS)
  const latencySince = now - Math.max(1, input.latencyWindowMs ?? DEFAULT_LATENCY_WINDOW_MS)
  const storage = readScopeStorageMetrics(staleBefore)
  const latency = readLatencyMetrics(latencySince)
  const failures = readLastFailureByScope()

  const scopes = MEMORY_QUALITY_SCOPES.map((scope) => {
    const row = storage.get(scope)
    const latencies = latency.get(scope) ?? []
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
    }
  })

  const writeback = readWritebackMetric()
  const flashFeedback = readFlashFeedbackMetric(now)
  const learningHistory = readLearningHistoryMetric()
  const lastFailure = writeback.lastFailure ?? scopes.find((scope) => scope.lastFailure)?.lastFailure ?? null
  const totals = scopes.reduce(
    (acc, scope) => ({
      documents: acc.documents + scope.documents,
      chunks: acc.chunks + scope.chunks,
      missingEmbeddings: acc.missingEmbeddings + scope.missingEmbeddings,
      staleEmbeddings: acc.staleEmbeddings + scope.staleEmbeddings,
      staleDocuments: acc.staleDocuments + scope.staleDocuments,
      accessCount: acc.accessCount + scope.accessCount,
    }),
    { documents: 0, chunks: 0, missingEmbeddings: 0, staleEmbeddings: 0, staleDocuments: 0, accessCount: 0 },
  )

  const status = writeback.failed > 0 || totals.staleEmbeddings > 0 || scopes.some((scope) => (scope.p95RetrievalLatencyMs ?? 0) > 500)
    ? "degraded"
    : "healthy"

  return {
    generatedAt: now,
    status,
    scopes,
    totals,
    writeback,
    flashFeedback,
    learningHistory,
    retrievalPolicy: buildRetrievalPolicySnapshot(),
    lastFailure,
  }
}
