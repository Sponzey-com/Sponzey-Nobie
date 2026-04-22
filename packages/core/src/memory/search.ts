/**
 * Hybrid search: combines FTS (keyword) + vector (semantic) results
 * using Reciprocal Rank Fusion (RRF).
 */

import { searchMemoryItems, getDb, insertDiagnosticEvent, markMemoryIndexJobStale, type DbMemoryChunkSearchRow, type DbMemoryItem, type MemorySearchFilters } from "../db/index.js"
import { getEmbeddingProvider, decodeEmbedding, cosineSimilarity, type EmbeddingProvider } from "./embedding.js"

const RRF_K = 60  // RRF constant
const DEFAULT_VECTOR_SEARCH_TIMEOUT_MS = 750
const DEFAULT_RETRIEVAL_DEGRADED_THRESHOLD_MS = 500

function rrfScore(rank: number): number {
  return 1 / (RRF_K + rank + 1)
}

export interface MemorySearchResult {
  item: DbMemoryItem
  score: number
  source: "fts" | "vector" | "hybrid"
}

export interface MemoryChunkSearchResult {
  chunk: DbMemoryChunkSearchRow
  score: number
  source: "fts" | "vector" | "hybrid" | "like"
  chunkId: string
  latencyMs: number
}

export type MemoryVectorDegradedReason =
  | "disabled"
  | "timeout"
  | "provider_error"
  | "dimension_mismatch"
  | "model_mismatch"
  | "stale_embedding"

export interface MemoryVectorDiagnostic {
  reason: MemoryVectorDegradedReason
  summary: string
  provider?: string
  model?: string
  expectedDimensions?: number
  actualDimensions?: number
  candidateCount?: number
}

interface ChunkVectorRow extends DbMemoryChunkSearchRow {
  provider: string
  model: string
  dimensions: number
  text_checksum: string
  vector: Buffer
}

function elapsedMs(startedAt: bigint): number {
  return Number((process.hrtime.bigint() - startedAt) / 1_000_000n)
}

function uniqueValues(values: Array<string | undefined>): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value?.trim())).map((value) => value.trim()))]
}

function withVectorTimeout<T>(
  promise: Promise<T>,
  fallback: T,
  timeoutMs = DEFAULT_VECTOR_SEARCH_TIMEOUT_MS,
  onTimeout?: () => void,
): Promise<T> {
  return new Promise<T>((resolve) => {
    let settled = false
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      onTimeout?.()
      resolve(fallback)
    }, timeoutMs)
    promise.then(
      (value) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        resolve(value)
      },
      () => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        resolve(fallback)
      },
    )
  })
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (match) => `\\${match}`)
}

function parseMetadataJson(value: string | null | undefined): Record<string, unknown> {
  if (!value) return {}
  try {
    const parsed = JSON.parse(value) as unknown
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {}
  } catch {
    return {}
  }
}

function isLongTermReviewApproved(metadata: Record<string, unknown>): boolean {
  if (metadata["approved"] === true || metadata["reviewApproved"] === true) return true
  if (metadata["requiresReview"] === true) return false
  return true
}

function isFlashFeedbackActive(metadata: Record<string, unknown>, nowMs = Date.now()): boolean {
  const expiresAt = metadata["expiresAt"] ?? metadata["expires_at"]
  return typeof expiresAt !== "number" || expiresAt > nowMs
}

function getMemoryVisibilityRejectionReason(row: DbMemoryChunkSearchRow, filters?: MemorySearchFilters): string | null {
  if (row.scope === "diagnostic" && !filters?.includeDiagnostic) return "diagnostic_scope_excluded"
  if (row.scope === "artifact" && !filters?.includeArtifact) return "artifact_scope_excluded"
  if (row.scope === "schedule" && !filters?.includeSchedule) return "schedule_scope_excluded"
  if (row.scope === "flash-feedback" && !filters?.includeFlashFeedback) return "flash_feedback_scope_excluded"

  const metadata = parseMetadataJson(row.document_metadata_json)
  if (row.scope === "long-term" && !isLongTermReviewApproved(metadata)) return "long_term_review_pending"
  if (row.scope === "flash-feedback" && !isFlashFeedbackActive(metadata)) return "flash_feedback_expired"
  return null
}

function filterVisibleMemoryRows(rows: DbMemoryChunkSearchRow[], filters?: MemorySearchFilters): DbMemoryChunkSearchRow[] {
  const visible: DbMemoryChunkSearchRow[] = []
  for (const row of rows) {
    const rejectionReason = getMemoryVisibilityRejectionReason(row, filters)
    if (!rejectionReason) {
      visible.push(row)
      continue
    }
    recordMemoryScopeRejection(filters, row, rejectionReason)
  }
  return visible
}

function recordMemoryVectorDiagnostic(filters: MemorySearchFilters | undefined, diagnostic: MemoryVectorDiagnostic): void {
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
    })
  } catch {
    // Retrieval diagnostics must never affect memory search.
  }
}

function recordMemoryScopeRejection(filters: MemorySearchFilters | undefined, row: DbMemoryChunkSearchRow, reason: string): void {
  if (!filters?.runId && !filters?.sessionId && !filters?.requestGroupId) return
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
    })
  } catch {
    // Scope diagnostics are best-effort.
  }
}

function recordRetrievalLatencyDiagnostic(filters: MemorySearchFilters | undefined, params: {
  source: string
  latencyMs: number
  candidateCount: number
}): void {
  if (params.latencyMs < DEFAULT_RETRIEVAL_DEGRADED_THRESHOLD_MS) return
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
    })
  } catch {
    // Diagnostic logging is best-effort.
  }
}

export function diagnoseVectorEmbeddingRows(
  rows: Array<{
    provider: string
    model: string
    dimensions: number
    text_checksum: string
    checksum: string
    vector?: Buffer
  }>,
  provider: Pick<EmbeddingProvider, "providerId" | "modelId" | "dimensions">,
): MemoryVectorDiagnostic[] {
  const diagnostics: MemoryVectorDiagnostic[] = []
  const pushUnique = (diagnostic: MemoryVectorDiagnostic): void => {
    if (diagnostics.some((entry) => entry.reason === diagnostic.reason && entry.summary === diagnostic.summary)) return
    diagnostics.push(diagnostic)
  }

  const modelMismatchCount = rows.filter((row) => row.provider !== provider.providerId || row.model !== provider.modelId).length
  if (modelMismatchCount > 0) {
    pushUnique({
      reason: "model_mismatch",
      summary: "stored memory embedding provider/model differs from active provider/model",
      provider: provider.providerId,
      model: provider.modelId,
      candidateCount: modelMismatchCount,
    })
  }

  const dimensionMismatchCount = rows.filter((row) => row.dimensions !== provider.dimensions || (row.vector && row.vector.byteLength / 4 !== provider.dimensions)).length
  if (dimensionMismatchCount > 0) {
    const actualDimensions = rows.find((row) => row.dimensions !== provider.dimensions)?.dimensions
    pushUnique({
      reason: "dimension_mismatch",
      summary: "stored memory embedding dimension differs from active provider dimension",
      provider: provider.providerId,
      model: provider.modelId,
      expectedDimensions: provider.dimensions,
      ...(actualDimensions !== undefined ? { actualDimensions } : {}),
      candidateCount: dimensionMismatchCount,
    })
  }

  const staleCount = rows.filter((row) => row.text_checksum !== row.checksum).length
  if (staleCount > 0) {
    pushUnique({
      reason: "stale_embedding",
      summary: "stored memory embedding checksum is stale for the current chunk text",
      provider: provider.providerId,
      model: provider.modelId,
      candidateCount: staleCount,
    })
  }

  return diagnostics
}

export function sanitizeFtsQuery(query: string): string | null {
  const terms = query
    .normalize("NFKC")
    .match(/[\p{L}\p{N}_]+/gu)
    ?.map((term) => term.trim())
    .filter((term) => term.length > 0)
    .slice(0, 12) ?? []
  if (terms.length === 0) return null
  return terms.map((term) => `"${term.replace(/"/g, '""')}"`).join(" OR ")
}

function buildChunkScopeWhere(filters?: MemorySearchFilters, alias = "c"): { clause: string; values: string[] } {
  const prefix = alias ? `${alias}.` : ""
  if (filters?.ownerScope) {
    const ownerIds = uniqueValues([
      filters.ownerScope.ownerId,
      filters.ownerScope.ownerType === "nobie" ? "global" : undefined,
    ])
    const placeholders = ownerIds.map(() => "?").join(", ")
    return {
      clause: `(${prefix}owner_id IN (${placeholders}))`,
      values: ownerIds,
    }
  }

  const clauses = [`${prefix}scope = 'global'`, `${prefix}scope = 'long-term'`]
  const values: string[] = []

  if (filters?.sessionId) {
    clauses.push(`(${prefix}scope IN ('session', 'short-term') AND ${prefix}owner_id = ?)`)
    values.push(filters.sessionId)
    if (filters.includeFlashFeedback) {
      clauses.push(`(${prefix}scope = 'flash-feedback' AND ${prefix}owner_id = ?)`)
      values.push(filters.sessionId)
    }
  }

  const taskOwners = uniqueValues([filters?.requestGroupId, filters?.runId])
  if (taskOwners.length > 0) {
    clauses.push(`(${prefix}scope = 'task' AND ${prefix}owner_id IN (${taskOwners.map(() => "?").join(", ")}))`)
    values.push(...taskOwners)
  }

  if (filters?.includeArtifact) {
    const artifactOwners = uniqueValues([filters.requestGroupId, filters.runId, filters.sessionId])
    if (artifactOwners.length > 0) {
      clauses.push(`(${prefix}scope = 'artifact' AND ${prefix}owner_id IN (${artifactOwners.map(() => "?").join(", ")}))`)
      values.push(...artifactOwners)
    }
  }

  if (filters?.includeDiagnostic) {
    const diagnosticOwners = uniqueValues([filters.requestGroupId, filters.runId, filters.sessionId])
    if (diagnosticOwners.length > 0) {
      clauses.push(`(${prefix}scope = 'diagnostic' AND ${prefix}owner_id IN (${diagnosticOwners.map(() => "?").join(", ")}))`)
      values.push(...diagnosticOwners)
    }
  }

  if (filters?.includeSchedule && filters.scheduleId) {
    clauses.push(`(${prefix}scope = 'schedule' AND ${prefix}owner_id = ?)`)
    values.push(filters.scheduleId)
  }

  return { clause: `(${clauses.join(" OR ")})`, values }
}

function buildLegacyItemScopeWhere(filters?: {
  sessionId?: string
  runId?: string
  requestGroupId?: string
  scheduleId?: string
  includeSchedule?: boolean
}): { clause: string; values: string[] } {
  const clauses = ["memory_scope = 'global'", "memory_scope = 'long-term'", "memory_scope IS NULL", "memory_scope = ''"]
  const values: string[] = []

  if (filters?.sessionId) {
    clauses.push("(memory_scope IN ('session', 'short-term') AND session_id = ?)")
    values.push(filters.sessionId)
  }

  const taskOwners = uniqueValues([filters?.requestGroupId, filters?.runId])
  if (taskOwners.length > 0) {
    const placeholders = taskOwners.map(() => "?").join(", ")
    clauses.push(`(memory_scope = 'task' AND (request_group_id IN (${placeholders}) OR run_id IN (${placeholders})))`)
    values.push(...taskOwners, ...taskOwners)
  }

  if (filters?.includeSchedule && filters.scheduleId) {
    clauses.push("(memory_scope = 'schedule' AND request_group_id = ?)")
    values.push(filters.scheduleId)
  }

  return { clause: `(${clauses.join(" OR ")})`, values }
}

function mapChunkRows(rows: DbMemoryChunkSearchRow[], source: "fts" | "like", startedAt: bigint): MemoryChunkSearchResult[] {
  const latencyMs = elapsedMs(startedAt)
  return rows.map((chunk, index) => ({
    chunk,
    score: Number.isFinite(chunk.score) ? chunk.score : rrfScore(index),
    source,
    chunkId: chunk.id,
    latencyMs,
  }))
}

/** FTS-only search */
export function ftsSearch(query: string, limit: number, filters?: {
  sessionId?: string
  runId?: string
  requestGroupId?: string
}): MemorySearchResult[] {
  try {
    const items = searchMemoryItems(query, limit, filters)
    return items.map((item, rank) => ({ item, score: rrfScore(rank), source: "fts" as const }))
  } catch {
    return []
  }
}

export function ftsChunkSearch(query: string, limit: number, filters?: MemorySearchFilters): MemoryChunkSearchResult[] {
  const startedAt = process.hrtime.bigint()
  const sanitized = sanitizeFtsQuery(query)
  if (!sanitized) return likeChunkSearch(query, limit, filters)

  const scope = buildChunkScopeWhere(filters)
  try {
    const rawRows = getDb()
      .prepare<unknown[], DbMemoryChunkSearchRow>(
        `SELECT c.*, d.title AS document_title, d.source_type AS document_source_type,
                d.source_ref AS document_source_ref, d.metadata_json AS document_metadata_json,
                bm25(memory_chunks_fts) AS score
         FROM memory_chunks_fts f
         JOIN memory_chunks c ON c.rowid = f.rowid
         JOIN memory_documents d ON d.id = c.document_id
         WHERE memory_chunks_fts MATCH ?
           AND d.archived_at IS NULL
           AND ${scope.clause}
         ORDER BY score ASC
         LIMIT ?`,
      )
      .all(sanitized, ...scope.values, limit * 3)
    const rows = filterVisibleMemoryRows(rawRows, filters).slice(0, limit)
    const results = mapChunkRows(rows, "fts", startedAt)
    recordRetrievalLatencyDiagnostic(filters, { source: "fts", latencyMs: results[0]?.latencyMs ?? 0, candidateCount: rows.length })
    return results
  } catch {
    return likeChunkSearch(query, limit, filters)
  }
}

export function likeChunkSearch(query: string, limit: number, filters?: MemorySearchFilters): MemoryChunkSearchResult[] {
  const startedAt = process.hrtime.bigint()
  const normalized = query.normalize("NFKC").trim()
  if (!normalized) return []
  const pattern = `%${escapeLike(normalized)}%`
  const scope = buildChunkScopeWhere(filters)
  const rawRows = getDb()
    .prepare<unknown[], DbMemoryChunkSearchRow>(
      `SELECT c.*, d.title AS document_title, d.source_type AS document_source_type,
              d.source_ref AS document_source_ref, d.metadata_json AS document_metadata_json,
              0 AS score
       FROM memory_chunks c
       JOIN memory_documents d ON d.id = c.document_id
       WHERE d.archived_at IS NULL
         AND c.content LIKE ? ESCAPE '\\'
         AND ${scope.clause}
       ORDER BY c.updated_at DESC, c.ordinal ASC
       LIMIT ?`,
    )
    .all(pattern, ...scope.values, limit * 3)
  const rows = filterVisibleMemoryRows(rawRows, filters).slice(0, limit)
  const results = mapChunkRows(rows, "like", startedAt)
  recordRetrievalLatencyDiagnostic(filters, { source: "like", latencyMs: results[0]?.latencyMs ?? 0, candidateCount: rows.length })
  return results
}

/** Vector-only search using in-process cosine similarity */
export async function vectorSearch(query: string, limit: number, filters?: {
  sessionId?: string
  runId?: string
  requestGroupId?: string
  scheduleId?: string
  includeSchedule?: boolean
}): Promise<MemorySearchResult[]> {
  const provider = getEmbeddingProvider()
  if (provider.dimensions === 0) return []

  let queryVec: number[]
  try { queryVec = await provider.embed(query) } catch { return [] }

  const db = getDb()
  const scope = buildLegacyItemScopeWhere(filters)
  const rows = db
    .prepare<unknown[], DbMemoryItem>(
      `SELECT * FROM memory_items
       WHERE embedding IS NOT NULL
         AND ${scope.clause}`,
    )
    .all(...scope.values)

  if (!rows.length) return []

  const scored: MemorySearchResult[] = []
  for (const item of rows) {
    if (!item.embedding) continue
    const vec = decodeEmbedding(item.embedding as Buffer)
    const score = cosineSimilarity(queryVec, vec)
    scored.push({ item, score, source: "vector" as const })
  }

  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
}

export async function vectorChunkSearch(query: string, limit: number, filters?: MemorySearchFilters): Promise<MemoryChunkSearchResult[]> {
  const startedAt = process.hrtime.bigint()
  const provider = getEmbeddingProvider()
  if (provider.dimensions === 0) {
    recordMemoryVectorDiagnostic(filters, {
      reason: "disabled",
      summary: "memory vector backend is disabled because embedding provider is not configured",
      provider: provider.providerId,
      model: provider.modelId,
      expectedDimensions: provider.dimensions,
    })
    return []
  }

  let queryVec: number[]
  try { queryVec = await provider.embed(query) } catch {
    recordMemoryVectorDiagnostic(filters, {
      reason: "provider_error",
      summary: "memory vector embedding provider failed during query embedding",
      provider: provider.providerId,
      model: provider.modelId,
      expectedDimensions: provider.dimensions,
    })
    return []
  }
  if (queryVec.length !== provider.dimensions) {
    recordMemoryVectorDiagnostic(filters, {
      reason: "dimension_mismatch",
      summary: "memory vector query embedding dimension differs from configured provider dimension",
      provider: provider.providerId,
      model: provider.modelId,
      expectedDimensions: provider.dimensions,
      actualDimensions: queryVec.length,
    })
    return []
  }

  const scope = buildChunkScopeWhere(filters)
  const rawRows = getDb()
    .prepare<unknown[], ChunkVectorRow>(
      `SELECT c.*, d.title AS document_title, d.source_type AS document_source_type,
              d.source_ref AS document_source_ref, d.metadata_json AS document_metadata_json,
              0 AS score,
              e.provider, e.model, e.dimensions, e.text_checksum, e.vector
       FROM memory_embeddings e
       JOIN memory_chunks c ON c.id = e.chunk_id
       JOIN memory_documents d ON d.id = c.document_id
       WHERE d.archived_at IS NULL
         AND ${scope.clause}`,
    )
    .all(...scope.values)
  const rows = filterVisibleMemoryRows(rawRows, filters) as ChunkVectorRow[]

  for (const diagnostic of diagnoseVectorEmbeddingRows(rows, provider)) {
    recordMemoryVectorDiagnostic(filters, diagnostic)
  }
  for (const row of rows) {
    if (row.text_checksum !== row.checksum) {
      markMemoryIndexJobStale(row.document_id, "stored memory embedding checksum is stale for the current chunk text")
    }
  }

  const eligibleRows = rows.filter((row) =>
    row.provider === provider.providerId
    && row.model === provider.modelId
    && row.dimensions === provider.dimensions
    && row.text_checksum === row.checksum
    && row.vector.byteLength / 4 === provider.dimensions,
  )

  const latencyMs = elapsedMs(startedAt)
  const results = eligibleRows
    .map((row) => {
      const score = cosineSimilarity(queryVec, decodeEmbedding(row.vector))
      return { chunk: row, score, source: "vector" as const, chunkId: row.id, latencyMs }
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
  recordRetrievalLatencyDiagnostic(filters, { source: "vector", latencyMs, candidateCount: eligibleRows.length })
  return results
}

/** Hybrid search: RRF fusion of FTS and vector results */
export async function hybridSearch(query: string, limit: number, filters?: {
  sessionId?: string
  runId?: string
  requestGroupId?: string
  scheduleId?: string
  includeSchedule?: boolean
}): Promise<MemorySearchResult[]> {
  const [ftsResults, vecResults] = await Promise.all([
    Promise.resolve(ftsSearch(query, limit * 2, filters)),
    withVectorTimeout(vectorSearch(query, limit * 2, filters), []),
  ])

  // Build score map
  const scoreMap = new Map<string, { item: DbMemoryItem; score: number }>()

  for (let i = 0; i < ftsResults.length; i++) {
    const entry = ftsResults[i]
    if (!entry) continue
    const { item } = entry
    const prev = scoreMap.get(item.id)
    scoreMap.set(item.id, { item, score: (prev?.score ?? 0) + rrfScore(i) })
  }

  for (let i = 0; i < vecResults.length; i++) {
    const entry = vecResults[i]
    if (!entry) continue
    const { item } = entry
    const prev = scoreMap.get(item.id)
    scoreMap.set(item.id, { item, score: (prev?.score ?? 0) + rrfScore(i) })
  }

  return Array.from(scoreMap.values())
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ item, score }) => ({ item, score, source: "hybrid" as const }))
}

export async function hybridChunkSearch(query: string, limit: number, filters?: MemorySearchFilters): Promise<MemoryChunkSearchResult[]> {
  const [ftsResults, vectorResults] = await Promise.all([
    Promise.resolve(ftsChunkSearch(query, limit * 2, filters)),
    withVectorTimeout(vectorChunkSearch(query, limit * 2, filters), [], DEFAULT_VECTOR_SEARCH_TIMEOUT_MS, () => {
      recordMemoryVectorDiagnostic(filters, {
        reason: "timeout",
        summary: "memory vector retrieval timed out and fell back to FTS results",
      })
    }),
  ])

  const byId = new Map<string, MemoryChunkSearchResult>()
  for (let i = 0; i < ftsResults.length; i++) {
    const result = ftsResults[i]
    if (!result) continue
    const previous = byId.get(result.chunkId)
    byId.set(result.chunkId, {
      ...result,
      source: previous ? "hybrid" : result.source,
      score: (previous?.score ?? 0) + rrfScore(i),
      latencyMs: Math.max(previous?.latencyMs ?? 0, result.latencyMs),
    })
  }
  for (let i = 0; i < vectorResults.length; i++) {
    const result = vectorResults[i]
    if (!result) continue
    const previous = byId.get(result.chunkId)
    byId.set(result.chunkId, {
      ...result,
      source: previous ? "hybrid" : "vector",
      score: (previous?.score ?? 0) + rrfScore(i),
      latencyMs: Math.max(previous?.latencyMs ?? 0, result.latencyMs),
    })
  }

  return Array.from(byId.values())
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
}

/** Main entry point respecting config.memory.searchMode */
export async function searchMemoryItems2(
  query: string,
  limit = 5,
  mode?: "fts" | "vector" | "hybrid",
  filters?: {
    sessionId?: string
    runId?: string
    requestGroupId?: string
    scheduleId?: string
    includeSchedule?: boolean
  },
): Promise<MemorySearchResult[]> {
  const resolvedMode = mode ?? "fts"

  if (resolvedMode === "vector") {
    const vectorResults = await vectorSearch(query, limit, filters)
    return vectorResults.length > 0 ? vectorResults : ftsSearch(query, limit, filters)
  }
  if (resolvedMode === "hybrid") return hybridSearch(query, limit, filters)
  return ftsSearch(query, limit, filters)
}

export async function searchMemoryChunks(
  query: string,
  limit = 5,
  mode?: "fts" | "vector" | "hybrid",
  filters?: MemorySearchFilters,
): Promise<MemoryChunkSearchResult[]> {
  const resolvedMode = mode ?? "fts"
  if (resolvedMode === "vector") {
    const vectorResults = await vectorChunkSearch(query, limit, filters)
    return vectorResults.length > 0 ? vectorResults : ftsChunkSearch(query, limit, filters)
  }
  if (resolvedMode === "hybrid") return hybridChunkSearch(query, limit, filters)
  return ftsChunkSearch(query, limit, filters)
}
