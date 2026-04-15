import { existsSync, mkdirSync } from "node:fs"
import { dirname, join } from "node:path"
import BetterSqlite3 from "better-sqlite3"
import { PATHS } from "../config/index.js"
import { createPreMigrationBackupIfNeeded, runMigrations } from "./migrations.js"
import type { PromptSourceMetadata, PromptSourceSnapshot, PromptSourceState } from "../memory/nobie-md.js"
import {
  buildDeliveryKey,
  buildPayloadHash,
  buildScheduleIdentityKey,
  formatContractValidationFailureForUser,
  toCanonicalJson,
  validateScheduleContract,
  type ScheduleContract,
} from "../contracts/index.js"

let _db: BetterSqlite3.Database | null = null

export function getDb(): BetterSqlite3.Database {
  if (_db) return _db

  mkdirSync(dirname(PATHS.dbFile), { recursive: true })

  const dbExisted = existsSync(PATHS.dbFile)
  _db = new BetterSqlite3(PATHS.dbFile)
  _db.pragma("journal_mode = WAL")
  _db.pragma("foreign_keys = ON")
  _db.pragma("synchronous = NORMAL")

  if (dbExisted) createPreMigrationBackupIfNeeded(_db, PATHS.dbFile, join(PATHS.stateDir, "backups", "db"))
  runMigrations(_db)
  return _db
}

export function closeDb(): void {
  _db?.close()
  _db = null
}

// Typed helpers

export interface DbSession {
  id: string
  source: string
  source_id: string | null
  created_at: number
  updated_at: number
  summary: string | null
  token_count: number
}

export interface DbMessage {
  id: string
  session_id: string
  root_run_id?: string | null
  role: string
  content: string
  tool_calls: string | null
  tool_call_id: string | null
  created_at: number
}


export interface DbRequestGroupMessage extends DbMessage {
  run_prompt: string | null
  run_request_group_id: string | null
  run_worker_session_id: string | null
  run_context_mode: string | null
}

export interface DbAuditLog {
  id: string
  timestamp: number
  session_id: string | null
  run_id: string | null
  request_group_id: string | null
  channel: string | null
  source: string
  tool_name: string
  params: string | null
  output: string | null
  result: string
  duration_ms: number | null
  approval_required: number
  approved_by: string | null
  error_code: string | null
  retry_count: number | null
  stop_reason: string | null
}

type DbAuditLogInput = Omit<DbAuditLog, "id" | "run_id" | "request_group_id" | "channel" | "error_code" | "retry_count" | "stop_reason"> & Partial<Pick<DbAuditLog, "run_id" | "request_group_id" | "channel" | "error_code" | "retry_count" | "stop_reason">>

export interface DbChannelMessageRef {
  id: string
  source: string
  session_id: string
  root_run_id: string
  request_group_id: string
  external_chat_id: string
  external_thread_id: string | null
  external_message_id: string
  role: string
  created_at: number
}

export interface DbPromptSource {
  source_id: string
  locale: string
  path: string
  version: string
  priority: number
  enabled: number
  is_required: number
  usage_scope: string
  checksum: string
  updated_at: number
}

export interface DbTaskContinuity {
  lineage_root_run_id: string
  parent_run_id: string | null
  handoff_summary: string | null
  last_good_state: string | null
  pending_approvals: string | null
  pending_delivery: string | null
  last_tool_receipt: string | null
  last_delivery_receipt: string | null
  failed_recovery_key: string | null
  failure_kind: string | null
  recovery_budget: string | null
  continuity_status: string | null
  updated_at: number
}

export interface TaskContinuitySnapshot {
  lineageRootRunId: string
  parentRunId?: string
  handoffSummary?: string
  lastGoodState?: string
  pendingApprovals: string[]
  pendingDelivery: string[]
  lastToolReceipt?: string
  lastDeliveryReceipt?: string
  failedRecoveryKey?: string
  failureKind?: string
  recoveryBudget?: string
  status?: string
  updatedAt: number
}

export type DbArtifactRetentionPolicy = "ephemeral" | "standard" | "permanent"

export interface DbArtifactMetadata {
  id: string
  source_run_id: string | null
  request_group_id: string | null
  owner_channel: string
  channel_target: string | null
  artifact_path: string
  mime_type: string
  size_bytes: number | null
  retention_policy: DbArtifactRetentionPolicy
  expires_at: number | null
  metadata_json: string | null
  created_at: number
  updated_at: number
  deleted_at: number | null
}

export interface ArtifactMetadataInput {
  artifactPath: string
  ownerChannel: string
  channelTarget?: string | null
  sourceRunId?: string | null
  requestGroupId?: string | null
  mimeType?: string
  sizeBytes?: number
  retentionPolicy?: DbArtifactRetentionPolicy
  expiresAt?: number | null
  metadata?: Record<string, unknown>
  createdAt?: number
  updatedAt?: number
}

interface PromptSourceStateRow {
  sourceId: string
  locale: "ko" | "en"
  enabled: 0 | 1
}

export function insertSession(session: Omit<DbSession, "token_count">): void {
  const db = getDb()
  db.prepare(
    `INSERT OR REPLACE INTO sessions
     (id, source, source_id, created_at, updated_at, summary)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(
    session.id,
    session.source,
    session.source_id,
    session.created_at,
    session.updated_at,
    session.summary,
  )
}

export function getSession(id: string): DbSession | undefined {
  return getDb()
    .prepare<[string], DbSession>("SELECT * FROM sessions WHERE id = ?")
    .get(id)
}

export function insertMessage(msg: DbMessage): void {
  getDb()
    .prepare(
      `INSERT INTO messages
       (id, session_id, root_run_id, role, content, tool_calls, tool_call_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      msg.id,
      msg.session_id,
      msg.root_run_id ?? null,
      msg.role,
      msg.content,
      msg.tool_calls,
      msg.tool_call_id,
      msg.created_at,
    )
}

export function getMessages(sessionId: string): DbMessage[] {
  return getDb()
    .prepare<[string], DbMessage>(
      "SELECT * FROM messages WHERE session_id = ? ORDER BY created_at ASC",
    )
    .all(sessionId)
}

export function getMessagesForRequestGroup(sessionId: string, requestGroupId: string): DbMessage[] {
  return getDb()
    .prepare<[string, string], DbMessage>(
      `SELECT m.*
       FROM messages m
       JOIN root_runs r ON r.id = m.root_run_id
       WHERE m.session_id = ?
         AND r.request_group_id = ?
       ORDER BY m.created_at ASC`,
    )
    .all(sessionId, requestGroupId)
}


export function getMessagesForRequestGroupWithRunMeta(sessionId: string, requestGroupId: string): DbRequestGroupMessage[] {
  return getDb()
    .prepare<[string, string], DbRequestGroupMessage>(
      `SELECT m.*, r.prompt AS run_prompt, r.request_group_id AS run_request_group_id,
              r.worker_session_id AS run_worker_session_id, r.context_mode AS run_context_mode
       FROM messages m
       JOIN root_runs r ON r.id = m.root_run_id
       WHERE m.session_id = ?
         AND r.request_group_id = ?
       ORDER BY m.created_at ASC`,
    )
    .all(sessionId, requestGroupId)
}

export function getMessagesForRun(sessionId: string, runId: string): DbMessage[] {
  return getDb()
    .prepare<[string, string], DbMessage>(
      `SELECT * FROM messages
       WHERE session_id = ?
         AND root_run_id = ?
       ORDER BY created_at ASC`,
    )
    .all(sessionId, runId)
}

export function insertAuditLog(log: DbAuditLogInput): void {
  const id = crypto.randomUUID()
  getDb()
    .prepare(
      `INSERT INTO audit_logs
       (id, timestamp, session_id, run_id, request_group_id, channel, source, tool_name, params, output, result,
        duration_ms, approval_required, approved_by, error_code, retry_count, stop_reason)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      log.timestamp,
      log.session_id,
      log.run_id ?? null,
      log.request_group_id ?? null,
      log.channel ?? null,
      log.source,
      log.tool_name,
      log.params,
      log.output,
      log.result,
      log.duration_ms,
      log.approval_required,
      log.approved_by,
      log.error_code ?? null,
      log.retry_count ?? null,
      log.stop_reason ?? null,
    )
}

export function insertChannelMessageRef(ref: Omit<DbChannelMessageRef, "id">): string {
  const id = crypto.randomUUID()
  getDb()
    .prepare(
      `INSERT INTO channel_message_refs
       (id, source, session_id, root_run_id, request_group_id, external_chat_id, external_thread_id, external_message_id, role, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      ref.source,
      ref.session_id,
      ref.root_run_id,
      ref.request_group_id,
      ref.external_chat_id,
      ref.external_thread_id,
      ref.external_message_id,
      ref.role,
      ref.created_at,
    )
  return id
}

export function findChannelMessageRef(params: {
  source: string
  externalChatId: string
  externalMessageId: string
  externalThreadId?: string
}): DbChannelMessageRef | undefined {
  const withThread = params.externalThreadId
    ? getDb()
        .prepare<[string, string, string, string], DbChannelMessageRef>(
          `SELECT *
           FROM channel_message_refs
           WHERE source = ?
             AND external_chat_id = ?
             AND external_message_id = ?
             AND (external_thread_id = ? OR external_thread_id IS NULL)
           ORDER BY created_at DESC
           LIMIT 1`,
        )
        .get(params.source, params.externalChatId, params.externalMessageId, params.externalThreadId)
    : undefined

  if (withThread) return withThread

  return getDb()
    .prepare<[string, string, string], DbChannelMessageRef>(
      `SELECT *
       FROM channel_message_refs
       WHERE source = ?
         AND external_chat_id = ?
         AND external_message_id = ?
       ORDER BY created_at DESC
       LIMIT 1`,
    )
    .get(params.source, params.externalChatId, params.externalMessageId)
}

export function upsertPromptSources(sources: PromptSourceMetadata[]): void {
  if (sources.length === 0) return
  const now = Date.now()
  const db = getDb()
  const insert = db.prepare(
    `INSERT INTO prompt_sources
     (source_id, locale, path, version, priority, enabled, is_required, usage_scope, checksum, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(source_id, locale) DO UPDATE SET
       path = excluded.path,
       version = excluded.version,
       priority = excluded.priority,
       enabled = CASE WHEN excluded.is_required = 1 THEN 1 ELSE prompt_sources.enabled END,
       is_required = excluded.is_required,
       usage_scope = excluded.usage_scope,
       checksum = excluded.checksum,
       updated_at = excluded.updated_at`,
  )
  const tx = db.transaction(() => {
    for (const source of sources) {
      insert.run(
        source.sourceId,
        source.locale,
        source.path,
        source.version,
        source.priority,
        source.enabled ? 1 : 0,
        source.required ? 1 : 0,
        source.usageScope,
        source.checksum,
        now,
      )
    }
  })
  tx()
}

export function updateRunPromptSourceSnapshot(runId: string, snapshot: PromptSourceSnapshot): void {
  getDb()
    .prepare(`UPDATE root_runs SET prompt_source_snapshot = ?, updated_at = ? WHERE id = ?`)
    .run(JSON.stringify(snapshot), Date.now(), runId)
}

export function getPromptSourceStates(): PromptSourceState[] {
  return getDb()
    .prepare<[], PromptSourceStateRow>(
      `SELECT source_id AS sourceId, locale, enabled
       FROM prompt_sources`,
    )
    .all()
    .map((row) => ({
      sourceId: row.sourceId,
      locale: row.locale,
      enabled: row.enabled === 1,
    }))
}

// ── Memory Items ───────────────────────────────────────────────────────────

export type MemoryScope =
  | "global"
  | "session"
  | "task"
  | "artifact"
  | "diagnostic"
  | "long-term"
  | "short-term"
  | "schedule"
  | "flash-feedback"

export interface DbMemoryItem {
  id: string
  content: string
  tags: string | null           // JSON array
  source: string | null
  memory_scope: MemoryScope | null
  session_id: string | null
  run_id: string | null
  request_group_id: string | null
  type: string | null           // "user_fact" | "session_summary" | "project_note"
  importance: string | null     // "low" | "medium" | "high"
  embedding: Buffer | null
  created_at: number
  updated_at: number
}

export interface DbMemoryDocument {
  id: string
  scope: MemoryScope
  owner_id: string
  source_type: string
  source_ref: string | null
  title: string | null
  raw_text: string
  checksum: string
  metadata_json: string | null
  archived_at: number | null
  created_at: number
  updated_at: number
}

export interface DbMemoryChunk {
  id: string
  document_id: string
  scope: MemoryScope
  owner_id: string
  ordinal: number
  token_estimate: number
  content: string
  checksum: string
  metadata_json: string | null
  created_at: number
  updated_at: number
}

export type MemoryWritebackStatus = "pending" | "writing" | "failed" | "completed" | "discarded"

export interface DbMemoryWritebackCandidate {
  id: string
  scope: MemoryScope
  owner_id: string
  source_type: string
  content: string
  metadata_json: string | null
  status: MemoryWritebackStatus
  retry_count: number
  last_error: string | null
  run_id: string | null
  created_at: number
  updated_at: number
}

export interface DbMemoryChunkSearchRow extends DbMemoryChunk {
  document_title: string | null
  document_source_type: string
  document_source_ref: string | null
  document_metadata_json: string | null
  score: number
}

export interface StoreMemoryDocumentInput {
  scope: MemoryScope
  ownerId?: string
  sourceType: string
  sourceRef?: string
  title?: string
  rawText: string
  checksum: string
  metadata?: Record<string, unknown>
  chunks: Array<{
    ordinal: number
    tokenEstimate: number
    content: string
    checksum: string
    metadata?: Record<string, unknown>
  }>
}

export interface StoreMemoryDocumentResult {
  documentId: string
  chunkIds: string[]
  deduplicated: boolean
}

export interface MemorySearchFilters {
  sessionId?: string
  runId?: string
  requestGroupId?: string
  scheduleId?: string
  includeSchedule?: boolean
  includeArtifact?: boolean
  includeDiagnostic?: boolean
}

function resolveMemoryOwnerId(scope: MemoryScope, ownerId: string | undefined): string {
  if (scope === "global" || scope === "long-term") return ownerId?.trim() || "global"
  const normalized = ownerId?.trim()
  if (!normalized) {
    throw new Error(`${scope} memory requires an owner id`)
  }
  return normalized
}

function toJsonOrNull(value: Record<string, unknown> | undefined): string | null {
  return value ? JSON.stringify(value) : null
}

export function storeMemoryDocument(input: StoreMemoryDocumentInput): StoreMemoryDocumentResult {
  const ownerId = resolveMemoryOwnerId(input.scope, input.ownerId)
  const db = getDb()
  const now = Date.now()
  const existing = db
    .prepare<[string, string, string], { id: string }>(
      `SELECT id FROM memory_documents WHERE scope = ? AND owner_id = ? AND checksum = ? LIMIT 1`,
    )
    .get(input.scope, ownerId, input.checksum)
  if (existing) {
    const chunks = db
      .prepare<[string], { id: string }>(`SELECT id FROM memory_chunks WHERE document_id = ? ORDER BY ordinal ASC`)
      .all(existing.id)
    return { documentId: existing.id, chunkIds: chunks.map((chunk) => chunk.id), deduplicated: true }
  }

  const documentId = crypto.randomUUID()
  const chunkIds: string[] = []
  const insertDocument = db.prepare(
    `INSERT INTO memory_documents
     (id, scope, owner_id, source_type, source_ref, title, raw_text, checksum, metadata_json, archived_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)`,
  )
  const insertChunk = db.prepare(
    `INSERT INTO memory_chunks
     (id, document_id, scope, owner_id, ordinal, token_estimate, content, checksum, metadata_json, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
  const insertChunkFts = db.prepare(
    `INSERT INTO memory_chunks_fts(rowid, content, metadata_json)
     SELECT rowid, content, metadata_json FROM memory_chunks WHERE id = ?`,
  )
  const insertIndexJob = db.prepare(
    `INSERT INTO memory_index_jobs (id, document_id, status, retry_count, created_at, updated_at)
     VALUES (?, ?, 'pending', 0, ?, ?)`,
  )

  const tx = db.transaction(() => {
    insertDocument.run(
      documentId,
      input.scope,
      ownerId,
      input.sourceType,
      input.sourceRef ?? null,
      input.title ?? null,
      input.rawText,
      input.checksum,
      toJsonOrNull(input.metadata),
      now,
      now,
    )

    for (const chunk of input.chunks) {
      const chunkId = crypto.randomUUID()
      chunkIds.push(chunkId)
      insertChunk.run(
        chunkId,
        documentId,
        input.scope,
        ownerId,
        chunk.ordinal,
        chunk.tokenEstimate,
        chunk.content,
        chunk.checksum,
        toJsonOrNull(chunk.metadata),
        now,
        now,
      )
      insertChunkFts.run(chunkId)
    }

    insertIndexJob.run(crypto.randomUUID(), documentId, now, now)
  })
  tx()

  return { documentId, chunkIds, deduplicated: false }
}

export function insertMemoryEmbeddingIfMissing(input: {
  chunkId: string
  provider: string
  model: string
  dimensions: number
  textChecksum: string
  vector: Buffer
}): string {
  const id = crypto.randomUUID()
  getDb()
    .prepare(
      `INSERT OR IGNORE INTO memory_embeddings
       (id, chunk_id, provider, model, dimensions, text_checksum, vector, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(id, input.chunkId, input.provider, input.model, input.dimensions, input.textChecksum, input.vector, Date.now())
  const existing = getDb()
    .prepare<[string, string, number, string], { id: string }>(
      `SELECT id FROM memory_embeddings
       WHERE provider = ? AND model = ? AND dimensions = ? AND text_checksum = ?`,
    )
    .get(input.provider, input.model, input.dimensions, input.textChecksum)
  return existing?.id ?? id
}

export function rebuildMemorySearchIndexes(): void {
  getDb().exec(`
    INSERT INTO memory_fts(memory_fts) VALUES('rebuild');
    INSERT INTO memory_chunks_fts(memory_chunks_fts) VALUES('rebuild');
  `)
}

export function markMemoryIndexJobCompleted(documentId: string): void {
  getDb()
    .prepare(`UPDATE memory_index_jobs SET status = 'completed', updated_at = ? WHERE document_id = ?`)
    .run(Date.now(), documentId)
}

export function markMemoryIndexJobFailed(documentId: string, error: string): void {
  getDb()
    .prepare(
      `UPDATE memory_index_jobs
       SET status = 'failed', retry_count = retry_count + 1, last_error = ?, updated_at = ?
       WHERE document_id = ?`,
    )
    .run(error, Date.now(), documentId)
}

export function recordMemoryAccessLog(input: {
  runId?: string
  sessionId?: string
  requestGroupId?: string
  documentId?: string
  chunkId?: string
  query: string
  resultSource: string
  score?: number
  latencyMs?: number
}): string {
  const id = crypto.randomUUID()
  getDb()
    .prepare(
      `INSERT INTO memory_access_log
       (id, run_id, session_id, request_group_id, document_id, chunk_id, query, result_source, score, latency_ms, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      input.runId ?? null,
      input.sessionId ?? null,
      input.requestGroupId ?? null,
      input.documentId ?? null,
      input.chunkId ?? null,
      input.query,
      input.resultSource,
      input.score ?? null,
      input.latencyMs ?? null,
      Date.now(),
    )
  return id
}

export function insertFlashFeedback(input: {
  sessionId: string
  content: string
  runId?: string
  requestGroupId?: string
  severity?: "low" | "normal" | "high"
  ttlMs?: number
  metadata?: Record<string, unknown>
}): string {
  const sessionId = input.sessionId.trim()
  if (!sessionId) throw new Error("flash-feedback requires a session id")
  const id = crypto.randomUUID()
  const now = Date.now()
  const ttlMs = Math.max(1, input.ttlMs ?? 30 * 60 * 1000)
  getDb()
    .prepare(
      `INSERT INTO flash_feedback
       (id, session_id, run_id, request_group_id, content, severity, expires_at, metadata_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      sessionId,
      input.runId ?? null,
      input.requestGroupId ?? null,
      input.content,
      input.severity ?? "normal",
      now + ttlMs,
      toJsonOrNull(input.metadata),
      now,
      now,
    )
  return id
}

export function upsertScheduleMemoryEntry(input: {
  scheduleId: string
  prompt: string
  sessionId?: string
  requestGroupId?: string
  title?: string
  cronExpression?: string
  nextRunAt?: number
  enabled?: boolean
  metadata?: Record<string, unknown>
}): string {
  const scheduleId = input.scheduleId.trim()
  if (!scheduleId) throw new Error("schedule memory requires a schedule id")
  const id = crypto.randomUUID()
  const now = Date.now()
  getDb()
    .prepare(
      `INSERT INTO schedule_entries
       (id, schedule_id, session_id, request_group_id, title, prompt, cron_expression, next_run_at, enabled, metadata_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(schedule_id) DO UPDATE SET
         session_id = excluded.session_id,
         request_group_id = excluded.request_group_id,
         title = excluded.title,
         prompt = excluded.prompt,
         cron_expression = excluded.cron_expression,
         next_run_at = excluded.next_run_at,
         enabled = excluded.enabled,
         metadata_json = excluded.metadata_json,
         updated_at = excluded.updated_at`,
    )
    .run(
      id,
      scheduleId,
      input.sessionId ?? null,
      input.requestGroupId ?? null,
      input.title ?? null,
      input.prompt,
      input.cronExpression ?? null,
      input.nextRunAt ?? null,
      input.enabled === false ? 0 : 1,
      toJsonOrNull(input.metadata),
      now,
      now,
    )
  const row = getDb()
    .prepare<[string], { id: string }>(`SELECT id FROM schedule_entries WHERE schedule_id = ? LIMIT 1`)
    .get(scheduleId)
  return row?.id ?? id
}

export function insertArtifactReceipt(input: {
  channel: string
  artifactPath: string
  runId?: string
  requestGroupId?: string
  mimeType?: string
  sizeBytes?: number
  deliveryReceipt?: Record<string, unknown>
  deliveredAt?: number
}): string {
  const id = crypto.randomUUID()
  getDb()
    .prepare(
      `INSERT INTO artifact_receipts
       (id, run_id, request_group_id, channel, artifact_path, mime_type, size_bytes, delivery_receipt_json, delivered_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      input.runId ?? null,
      input.requestGroupId ?? null,
      input.channel,
      input.artifactPath,
      input.mimeType ?? null,
      input.sizeBytes ?? null,
      toJsonOrNull(input.deliveryReceipt),
      input.deliveredAt ?? null,
      Date.now(),
    )
  return id
}

export function hasArtifactReceipt(input: {
  runId: string
  channel: string
  artifactPath: string
}): boolean {
  const row = getDb()
    .prepare<[string, string, string], { id: string }>(
      `SELECT id FROM artifact_receipts
       WHERE run_id = ? AND channel = ? AND artifact_path = ?
       LIMIT 1`,
    )
    .get(input.runId, input.channel, input.artifactPath)
  return Boolean(row)
}

export function insertArtifactMetadata(input: ArtifactMetadataInput): string {
  const id = crypto.randomUUID()
  const now = Date.now()
  getDb()
    .prepare(
      `INSERT INTO artifacts
       (id, source_run_id, request_group_id, owner_channel, channel_target, artifact_path, mime_type, size_bytes,
        retention_policy, expires_at, metadata_json, created_at, updated_at, deleted_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
    )
    .run(
      id,
      input.sourceRunId ?? null,
      input.requestGroupId ?? null,
      input.ownerChannel,
      input.channelTarget ?? null,
      input.artifactPath,
      input.mimeType ?? "application/octet-stream",
      input.sizeBytes ?? null,
      input.retentionPolicy ?? "standard",
      input.expiresAt ?? null,
      toJsonOrNull(input.metadata),
      input.createdAt ?? now,
      input.updatedAt ?? input.createdAt ?? now,
    )
  return id
}

export function getLatestArtifactMetadataByPath(artifactPath: string): DbArtifactMetadata | undefined {
  return getDb()
    .prepare<[string], DbArtifactMetadata>(
      `SELECT * FROM artifacts
       WHERE artifact_path = ?
       ORDER BY created_at DESC
       LIMIT 1`,
    )
    .get(artifactPath)
}

export function getArtifactMetadata(id: string): DbArtifactMetadata | undefined {
  return getDb()
    .prepare<[string], DbArtifactMetadata>(
      `SELECT * FROM artifacts
       WHERE id = ?
       LIMIT 1`,
    )
    .get(id)
}

export function listExpiredArtifactMetadata(now: number = Date.now()): DbArtifactMetadata[] {
  return getDb()
    .prepare<[number], DbArtifactMetadata>(
      `SELECT * FROM artifacts
       WHERE expires_at IS NOT NULL
         AND expires_at <= ?
         AND deleted_at IS NULL
       ORDER BY expires_at ASC`,
    )
    .all(now)
}

export function markArtifactDeleted(id: string, deletedAt: number = Date.now()): void {
  getDb()
    .prepare(`UPDATE artifacts SET deleted_at = ?, updated_at = ? WHERE id = ?`)
    .run(deletedAt, deletedAt, id)
}

export function insertDiagnosticEvent(input: {
  kind: string
  summary: string
  runId?: string
  sessionId?: string
  requestGroupId?: string
  recoveryKey?: string
  detail?: Record<string, unknown>
}): string {
  const id = crypto.randomUUID()
  getDb()
    .prepare(
      `INSERT INTO diagnostic_events
       (id, run_id, session_id, request_group_id, recovery_key, kind, summary, detail_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      input.runId ?? null,
      input.sessionId ?? null,
      input.requestGroupId ?? null,
      input.recoveryKey ?? null,
      input.kind,
      input.summary,
      toJsonOrNull(input.detail),
      Date.now(),
    )
  return id
}

export function enqueueMemoryWritebackCandidate(input: {
  scope: MemoryScope
  ownerId?: string
  sourceType: string
  content: string
  metadata?: Record<string, unknown>
  runId?: string
  status?: MemoryWritebackStatus
  lastError?: string
}): string {
  const ownerId = resolveMemoryOwnerId(input.scope, input.ownerId)
  const id = crypto.randomUUID()
  const now = Date.now()
  const status = input.status ?? "pending"
  getDb()
    .prepare(
      `INSERT INTO memory_writeback_queue
       (id, scope, owner_id, source_type, content, metadata_json, status, retry_count, last_error, run_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?)`,
    )
    .run(
      id,
      input.scope,
      ownerId,
      input.sourceType,
      input.content,
      toJsonOrNull(input.metadata),
      status,
      input.lastError ?? null,
      input.runId ?? null,
      now,
      now,
    )
  return id
}

export function listMemoryWritebackCandidates(input: {
  status?: MemoryWritebackStatus | "all"
  limit?: number
} = {}): DbMemoryWritebackCandidate[] {
  const status = input.status ?? "pending"
  const limit = Math.max(1, Math.min(500, Math.floor(input.limit ?? 100)))
  if (status === "all") {
    return getDb()
      .prepare<[number], DbMemoryWritebackCandidate>(
        `SELECT * FROM memory_writeback_queue ORDER BY updated_at DESC LIMIT ?`,
      )
      .all(limit)
  }
  return getDb()
    .prepare<[MemoryWritebackStatus, number], DbMemoryWritebackCandidate>(
      `SELECT * FROM memory_writeback_queue WHERE status = ? ORDER BY updated_at DESC LIMIT ?`,
    )
    .all(status, limit)
}

export function getMemoryWritebackCandidate(id: string): DbMemoryWritebackCandidate | undefined {
  return getDb()
    .prepare<[string], DbMemoryWritebackCandidate>(`SELECT * FROM memory_writeback_queue WHERE id = ? LIMIT 1`)
    .get(id)
}

export function updateMemoryWritebackCandidate(input: {
  id: string
  status: MemoryWritebackStatus
  content?: string
  metadata?: Record<string, unknown>
  lastError?: string | null
}): DbMemoryWritebackCandidate | undefined {
  const current = getMemoryWritebackCandidate(input.id)
  if (!current) return undefined
  const nextContent = input.content ?? current.content
  const nextMetadata = input.metadata !== undefined ? toJsonOrNull(input.metadata) : current.metadata_json
  const nextLastError = Object.prototype.hasOwnProperty.call(input, "lastError") ? input.lastError ?? null : current.last_error
  getDb()
    .prepare(
      `UPDATE memory_writeback_queue
       SET status = ?, content = ?, metadata_json = ?, last_error = ?, updated_at = ?
       WHERE id = ?`,
    )
    .run(input.status, nextContent, nextMetadata, nextLastError, Date.now(), input.id)
  return getMemoryWritebackCandidate(input.id)
}

export function upsertSessionSnapshot(input: {
  sessionId: string
  summary: string
  preservedFacts?: string[]
  activeTaskIds?: string[]
}): string {
  const id = crypto.randomUUID()
  const now = Date.now()
  getDb()
    .prepare(
      `INSERT INTO session_snapshots
       (id, session_id, snapshot_version, summary, preserved_facts, active_task_ids, created_at, updated_at)
       VALUES (?, ?, 1, ?, ?, ?, ?, ?)
       ON CONFLICT(session_id, snapshot_version) DO UPDATE SET
         summary = excluded.summary,
         preserved_facts = excluded.preserved_facts,
         active_task_ids = excluded.active_task_ids,
         updated_at = excluded.updated_at`,
    )
    .run(
      id,
      input.sessionId,
      input.summary,
      JSON.stringify(input.preservedFacts ?? []),
      JSON.stringify(input.activeTaskIds ?? []),
      now,
      now,
    )
  const row = getDb()
    .prepare<[string], { id: string }>(
      `SELECT id FROM session_snapshots WHERE session_id = ? AND snapshot_version = 1 LIMIT 1`,
    )
    .get(input.sessionId)
  return row?.id ?? id
}

export function upsertTaskContinuity(input: {
  lineageRootRunId: string
  parentRunId?: string
  handoffSummary?: string
  lastGoodState?: string
  pendingApprovals?: string[]
  pendingDelivery?: string[]
  lastToolReceipt?: string
  lastDeliveryReceipt?: string
  failedRecoveryKey?: string
  failureKind?: string
  recoveryBudget?: string
  status?: string
}): void {
  const hasField = (key: keyof typeof input): boolean => Object.prototype.hasOwnProperty.call(input, key)
  getDb()
    .prepare(
      `INSERT INTO task_continuity
       (lineage_root_run_id, parent_run_id, handoff_summary, last_good_state, pending_approvals, pending_delivery,
        last_tool_receipt, last_delivery_receipt, failed_recovery_key, failure_kind, recovery_budget, continuity_status, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(lineage_root_run_id) DO UPDATE SET
         parent_run_id = COALESCE(excluded.parent_run_id, task_continuity.parent_run_id),
         handoff_summary = COALESCE(excluded.handoff_summary, task_continuity.handoff_summary),
         last_good_state = COALESCE(excluded.last_good_state, task_continuity.last_good_state),
         pending_approvals = COALESCE(excluded.pending_approvals, task_continuity.pending_approvals),
         pending_delivery = COALESCE(excluded.pending_delivery, task_continuity.pending_delivery),
         last_tool_receipt = COALESCE(excluded.last_tool_receipt, task_continuity.last_tool_receipt),
         last_delivery_receipt = COALESCE(excluded.last_delivery_receipt, task_continuity.last_delivery_receipt),
         failed_recovery_key = COALESCE(excluded.failed_recovery_key, task_continuity.failed_recovery_key),
         failure_kind = COALESCE(excluded.failure_kind, task_continuity.failure_kind),
         recovery_budget = COALESCE(excluded.recovery_budget, task_continuity.recovery_budget),
         continuity_status = COALESCE(excluded.continuity_status, task_continuity.continuity_status),
         updated_at = excluded.updated_at`,
    )
    .run(
      input.lineageRootRunId,
      input.parentRunId ?? null,
      input.handoffSummary ?? null,
      input.lastGoodState ?? null,
      hasField("pendingApprovals") ? JSON.stringify(input.pendingApprovals ?? []) : null,
      hasField("pendingDelivery") ? JSON.stringify(input.pendingDelivery ?? []) : null,
      input.lastToolReceipt ?? null,
      input.lastDeliveryReceipt ?? null,
      input.failedRecoveryKey ?? null,
      input.failureKind ?? null,
      input.recoveryBudget ?? null,
      input.status ?? null,
      Date.now(),
    )
}

function parseContinuityStringArray(value: string | null): string[] {
  if (!value) return []
  try {
    const parsed = JSON.parse(value) as unknown
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
      : []
  } catch {
    return []
  }
}

function mapTaskContinuity(row: DbTaskContinuity): TaskContinuitySnapshot {
  return {
    lineageRootRunId: row.lineage_root_run_id,
    ...(row.parent_run_id ? { parentRunId: row.parent_run_id } : {}),
    ...(row.handoff_summary ? { handoffSummary: row.handoff_summary } : {}),
    ...(row.last_good_state ? { lastGoodState: row.last_good_state } : {}),
    pendingApprovals: parseContinuityStringArray(row.pending_approvals),
    pendingDelivery: parseContinuityStringArray(row.pending_delivery),
    ...(row.last_tool_receipt ? { lastToolReceipt: row.last_tool_receipt } : {}),
    ...(row.last_delivery_receipt ? { lastDeliveryReceipt: row.last_delivery_receipt } : {}),
    ...(row.failed_recovery_key ? { failedRecoveryKey: row.failed_recovery_key } : {}),
    ...(row.failure_kind ? { failureKind: row.failure_kind } : {}),
    ...(row.recovery_budget ? { recoveryBudget: row.recovery_budget } : {}),
    ...(row.continuity_status ? { status: row.continuity_status } : {}),
    updatedAt: row.updated_at,
  }
}

export function getTaskContinuity(lineageRootRunId: string): TaskContinuitySnapshot | undefined {
  const row = getDb()
    .prepare<[string], DbTaskContinuity>(`SELECT * FROM task_continuity WHERE lineage_root_run_id = ?`)
    .get(lineageRootRunId)
  return row ? mapTaskContinuity(row) : undefined
}

export function listTaskContinuityForLineages(lineageRootRunIds: string[]): TaskContinuitySnapshot[] {
  const ids = [...new Set(lineageRootRunIds.filter((value) => value.trim().length > 0))]
  if (ids.length === 0) return []
  const placeholders = ids.map(() => "?").join(", ")
  return getDb()
    .prepare<unknown[], DbTaskContinuity>(`SELECT * FROM task_continuity WHERE lineage_root_run_id IN (${placeholders})`)
    .all(...ids)
    .map(mapTaskContinuity)
}

export function insertMemoryItem(item: {
  content: string
  tags?: string[]
  scope?: MemoryScope
  sessionId?: string
  runId?: string
  requestGroupId?: string
  type?: string
  importance?: string
}): string {
  if ((item.scope === "session" || item.scope === "short-term" || item.scope === "flash-feedback") && !item.sessionId) {
    throw new Error(`${item.scope} memory requires a session id`)
  }
  if (item.scope === "task" && !item.runId && !item.requestGroupId) {
    throw new Error("task memory requires a runId or requestGroupId")
  }
  if (item.scope === "schedule" && !item.requestGroupId) {
    throw new Error("schedule memory requires a schedule id")
  }
  const id = crypto.randomUUID()
  const now = Date.now()
  const db = getDb()
  db.prepare(
    `INSERT INTO memory_items (id, content, tags, source, memory_scope, session_id, run_id, request_group_id, type, importance, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    item.content,
    JSON.stringify(item.tags ?? []),
    "agent",
    item.scope ?? "global",
    item.sessionId ?? null,
    item.runId ?? null,
    item.requestGroupId ?? null,
    item.type ?? "user_fact",
    item.importance ?? "medium",
    now,
    now,
  )
  // Sync into FTS index
  db.prepare(
    `INSERT INTO memory_fts(rowid, content, tags)
     SELECT rowid, content, tags FROM memory_items WHERE id = ?`,
  ).run(id)
  return id
}

function buildMemoryScopeWhere(filters?: {
  sessionId?: string
  runId?: string
  requestGroupId?: string
  scheduleId?: string
  includeSchedule?: boolean
}, alias = "m"): { clause: string; values: string[] } {
  const prefix = alias ? `${alias}.` : ""
  const clauses = [`${prefix}memory_scope = 'global'`, `${prefix}memory_scope = 'long-term'`, `${prefix}memory_scope IS NULL`, `${prefix}memory_scope = ''`]
  const values: string[] = []

  if (filters?.sessionId) {
    clauses.push(`(${prefix}memory_scope IN ('session', 'short-term', 'flash-feedback') AND ${prefix}session_id = ?)`)
    values.push(filters.sessionId)
  }

  const taskOwners = [filters?.requestGroupId, filters?.runId].filter((value): value is string => Boolean(value))
  if (taskOwners.length > 0) {
    const placeholders = taskOwners.map(() => "?").join(", ")
    clauses.push(`(${prefix}memory_scope = 'task' AND (${prefix}request_group_id IN (${placeholders}) OR ${prefix}run_id IN (${placeholders})))`)
    values.push(...taskOwners, ...taskOwners)
  }

  if (filters?.includeSchedule && filters.scheduleId) {
    clauses.push(`(${prefix}memory_scope = 'schedule' AND ${prefix}request_group_id = ?)`)
    values.push(filters.scheduleId)
  }

  return {
    clause: `(${clauses.join(" OR ")})`,
    values,
  }
}

function sanitizeMemoryFtsQuery(query: string): string | null {
  const terms = query
    .normalize("NFKC")
    .match(/[\p{L}\p{N}_]+/gu)
    ?.map((term) => term.trim())
    .filter(Boolean)
    .slice(0, 12) ?? []
  return terms.length > 0 ? terms.map((term) => `"${term.replace(/"/g, '""')}"`).join(" OR ") : null
}

function escapeMemoryLike(query: string): string {
  return query.replace(/[\\%_]/g, (match) => `\\${match}`)
}

export function searchMemoryItems(query: string, limit = 5, filters?: {
  sessionId?: string
  runId?: string
  requestGroupId?: string
}): DbMemoryItem[] {
  const scope = buildMemoryScopeWhere(filters)
  const sanitized = sanitizeMemoryFtsQuery(query)
  if (sanitized) {
    try {
      return getDb()
        .prepare<unknown[], DbMemoryItem>(
          `SELECT m.* FROM memory_fts f
           JOIN memory_items m ON m.rowid = f.rowid
           WHERE memory_fts MATCH ?
             AND ${scope.clause}
           ORDER BY rank
           LIMIT ?`,
        )
        .all(sanitized, ...scope.values, limit)
    } catch {
      // Fall through to LIKE search when MATCH rejects special input or the FTS table is unavailable.
    }
  }

  const likeScope = buildMemoryScopeWhere(filters, "")
  const pattern = `%${escapeMemoryLike(query.normalize("NFKC").trim())}%`
  return getDb()
    .prepare<unknown[], DbMemoryItem>(
      `SELECT * FROM memory_items
       WHERE content LIKE ? ESCAPE '\\'
         AND ${likeScope.clause}
       ORDER BY updated_at DESC
       LIMIT ?`,
    )
    .all(pattern, ...likeScope.values, limit)
}

export function getRecentMemoryItems(limit = 10, filters?: {
  sessionId?: string
  runId?: string
  requestGroupId?: string
}): DbMemoryItem[] {
  const scope = buildMemoryScopeWhere(filters, "")
  return getDb()
    .prepare<unknown[], DbMemoryItem>(
      `SELECT * FROM memory_items
       WHERE ${scope.clause}
       ORDER BY updated_at DESC LIMIT ?`,
    )
    .all(...scope.values, limit)
}

export function markMessagesCompressed(ids: string[], summaryId: string): void {
  if (!ids.length) return
  const db = getDb()
  const update = db.prepare<[string, string]>(
    "UPDATE messages SET compressed = 1, summary_id = ? WHERE id = ?",
  )
  const tx = db.transaction(() => {
    for (const id of ids) update.run(summaryId, id)
  })
  tx()
}

// ── Schedules ─────────────────────────────────────────────────────────────

export interface DbSchedule {
  id: string
  name: string
  cron_expression: string
  timezone: string | null
  prompt: string
  enabled: number          // 0 | 1
  target_channel: string
  target_session_id: string | null
  execution_driver: string
  origin_run_id: string | null
  origin_request_group_id: string | null
  model: string | null
  max_retries: number
  timeout_sec: number
  contract_json: string | null
  identity_key: string | null
  payload_hash: string | null
  delivery_key: string | null
  contract_schema_version: number | null
  created_at: number
  updated_at: number
  // computed / optional
  last_run_at?: number | null
  next_run_at?: number | null
  legacy?: number
}

export type DbScheduleInsertInput = Omit<
  DbSchedule,
  | "last_run_at"
  | "next_run_at"
  | "timezone"
  | "contract_json"
  | "identity_key"
  | "payload_hash"
  | "delivery_key"
  | "contract_schema_version"
  | "legacy"
> & {
  timezone?: string | null
  contract?: ScheduleContract
  contract_json?: string | null
  identity_key?: string | null
  payload_hash?: string | null
  delivery_key?: string | null
  contract_schema_version?: number | null
}

export interface DbScheduleRun {
  id: string
  schedule_id: string
  started_at: number
  finished_at: number | null
  success: number | null   // 0 | 1
  summary: string | null
  error: string | null
  execution_success?: number | null
  delivery_success?: number | null
  delivery_dedupe_key?: string | null
  delivery_error?: string | null
}

export type DbScheduleDeliveryStatus = "delivered" | "failed" | "skipped"

export interface DbScheduleDeliveryReceipt {
  dedupe_key: string
  schedule_id: string
  schedule_run_id: string
  due_at: string
  target_channel: string
  target_session_id: string | null
  payload_hash: string
  delivery_status: DbScheduleDeliveryStatus
  summary: string | null
  error: string | null
  created_at: number
  updated_at: number
}

export type DbScheduleDeliveryReceiptInput = Omit<DbScheduleDeliveryReceipt, "created_at" | "updated_at"> & {
  created_at?: number
  updated_at?: number
}

export function getSchedules(): DbSchedule[] {
  return getDb()
    .prepare<[], DbSchedule>(
      `SELECT s.*,
        (SELECT r.started_at FROM schedule_runs r WHERE r.schedule_id = s.id ORDER BY r.started_at DESC LIMIT 1) AS last_run_at,
        CASE WHEN s.contract_json IS NULL OR s.contract_schema_version IS NULL THEN 1 ELSE 0 END AS legacy
       FROM schedules s ORDER BY s.created_at DESC`,
    )
    .all()
}

export function getSchedule(id: string): DbSchedule | undefined {
  return getDb()
    .prepare<[string], DbSchedule>(
      `SELECT s.*,
        (SELECT r.started_at FROM schedule_runs r WHERE r.schedule_id = s.id ORDER BY r.started_at DESC LIMIT 1) AS last_run_at,
        CASE WHEN s.contract_json IS NULL OR s.contract_schema_version IS NULL THEN 1 ELSE 0 END AS legacy
       FROM schedules s WHERE s.id = ?`,
    )
    .get(id)
}

export function getSchedulesForSession(sessionId: string, enabledOnly = false): DbSchedule[] {
  const enabledClause = enabledOnly ? "AND s.enabled = 1" : ""
  return getDb()
    .prepare<[string], DbSchedule>(
      `SELECT s.*,
        (SELECT r.started_at FROM schedule_runs r WHERE r.schedule_id = s.id ORDER BY r.started_at DESC LIMIT 1) AS last_run_at,
        CASE WHEN s.contract_json IS NULL OR s.contract_schema_version IS NULL THEN 1 ELSE 0 END AS legacy
       FROM schedules s
       WHERE s.target_session_id = ?
       ${enabledClause}
       ORDER BY s.created_at DESC`,
    )
    .all(sessionId)
}

export function prepareScheduleContractPersistence(contract: ScheduleContract): Pick<DbSchedule, "contract_json" | "identity_key" | "payload_hash" | "delivery_key" | "contract_schema_version"> {
  const validation = validateScheduleContract(contract)
  if (!validation.ok) {
    throw new Error(formatContractValidationFailureForUser(validation.issues))
  }

  return {
    contract_json: toCanonicalJson(contract),
    identity_key: buildScheduleIdentityKey(contract),
    payload_hash: buildPayloadHash(contract.payload),
    delivery_key: buildDeliveryKey(contract.delivery),
    contract_schema_version: contract.schemaVersion,
  }
}

export function isLegacySchedule(schedule: Pick<DbSchedule, "contract_json" | "contract_schema_version">): boolean {
  return !schedule.contract_json || schedule.contract_schema_version == null
}

export function insertSchedule(s: DbScheduleInsertInput): void {
  const contractFields = s.contract
    ? prepareScheduleContractPersistence(s.contract)
    : {
        contract_json: s.contract_json ?? null,
        identity_key: s.identity_key ?? null,
        payload_hash: s.payload_hash ?? null,
        delivery_key: s.delivery_key ?? null,
        contract_schema_version: s.contract_schema_version ?? null,
      }

  getDb()
    .prepare(
      `INSERT INTO schedules (id, name, cron_expression, timezone, prompt, enabled, target_channel, target_session_id, execution_driver, origin_run_id, origin_request_group_id, model, max_retries, timeout_sec, contract_json, identity_key, payload_hash, delivery_key, contract_schema_version, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      s.id,
      s.name,
      s.cron_expression,
      s.timezone ?? null,
      s.prompt,
      s.enabled,
      s.target_channel,
      s.target_session_id,
      s.execution_driver,
      s.origin_run_id,
      s.origin_request_group_id,
      s.model,
      s.max_retries,
      s.timeout_sec,
      contractFields.contract_json,
      contractFields.identity_key,
      contractFields.payload_hash,
      contractFields.delivery_key,
      contractFields.contract_schema_version,
      s.created_at,
      s.updated_at,
    )
}

export function updateSchedule(id: string, fields: Partial<Omit<DbSchedule, "id" | "created_at" | "last_run_at" | "next_run_at">>): void {
  const sets: string[] = []
  const vals: unknown[] = []
  for (const [k, v] of Object.entries(fields)) {
    sets.push(`${k} = ?`)
    vals.push(v)
  }
  if (!sets.length) return
  vals.push(Date.now(), id)
  getDb().prepare(`UPDATE schedules SET ${sets.join(", ")}, updated_at = ? WHERE id = ?`).run(...vals)
}

export function deleteSchedule(id: string): void {
  getDb().prepare("DELETE FROM schedules WHERE id = ?").run(id)
}

export function getScheduleRuns(scheduleId: string, limit: number, offset: number): DbScheduleRun[] {
  return getDb()
    .prepare<[string, number, number], DbScheduleRun>(
      "SELECT * FROM schedule_runs WHERE schedule_id = ? ORDER BY started_at DESC LIMIT ? OFFSET ?",
    )
    .all(scheduleId, limit, offset)
}

export function listUnfinishedScheduleRuns(limit = 200): DbScheduleRun[] {
  return getDb()
    .prepare<[number], DbScheduleRun>(
      `SELECT * FROM schedule_runs
       WHERE finished_at IS NULL OR success IS NULL
       ORDER BY started_at DESC
       LIMIT ?`,
    )
    .all(Math.max(1, Math.min(1000, Math.floor(limit))))
}

export function interruptUnfinishedScheduleRunsOnStartup(input: {
  finishedAt?: number
  error?: string
  limit?: number
} = {}): DbScheduleRun[] {
  const rows = listUnfinishedScheduleRuns(input.limit ?? 200)
  if (!rows.length) return []
  const finishedAt = input.finishedAt ?? Date.now()
  const error = input.error ?? "Interrupted by daemon restart; not retried automatically."
  const update = getDb().prepare<[number, string, string]>(
    `UPDATE schedule_runs
     SET finished_at = ?, success = 0, error = COALESCE(error, ?)
     WHERE id = ? AND (finished_at IS NULL OR success IS NULL)`,
  )
  const tx = getDb().transaction(() => {
    for (const row of rows) update.run(finishedAt, error, row.id)
  })
  tx()
  return rows
}

export function countScheduleRuns(scheduleId: string): number {
  return (getDb()
    .prepare<[string], { n: number }>("SELECT COUNT(*) as n FROM schedule_runs WHERE schedule_id = ?")
    .get(scheduleId) as { n: number }).n
}

export function insertScheduleRun(r: DbScheduleRun): void {
  getDb()
    .prepare(
      `INSERT INTO schedule_runs (id, schedule_id, started_at, finished_at, success, summary, error)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(r.id, r.schedule_id, r.started_at, r.finished_at, r.success, r.summary, r.error)
}

export function updateScheduleRun(
  id: string,
  fields: Partial<Pick<DbScheduleRun, "finished_at" | "success" | "summary" | "error" | "execution_success" | "delivery_success" | "delivery_dedupe_key" | "delivery_error">>,
): void {
  const sets: string[] = []
  const vals: unknown[] = []
  for (const [k, v] of Object.entries(fields)) {
    sets.push(`${k} = ?`)
    vals.push(v)
  }
  if (!sets.length) return
  vals.push(id)
  getDb().prepare(`UPDATE schedule_runs SET ${sets.join(", ")} WHERE id = ?`).run(...vals)
}

export function getScheduleDeliveryReceipt(dedupeKey: string): DbScheduleDeliveryReceipt | undefined {
  return getDb()
    .prepare<[string], DbScheduleDeliveryReceipt>("SELECT * FROM schedule_delivery_receipts WHERE dedupe_key = ?")
    .get(dedupeKey)
}

export function insertScheduleDeliveryReceipt(input: DbScheduleDeliveryReceiptInput): void {
  const now = Date.now()
  const createdAt = input.created_at ?? now
  const updatedAt = input.updated_at ?? now
  getDb()
    .prepare(
      `INSERT INTO schedule_delivery_receipts
       (dedupe_key, schedule_id, schedule_run_id, due_at, target_channel, target_session_id, payload_hash, delivery_status, summary, error, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(dedupe_key) DO UPDATE SET
         schedule_run_id = excluded.schedule_run_id,
         delivery_status = excluded.delivery_status,
         summary = excluded.summary,
         error = excluded.error,
         updated_at = excluded.updated_at`,
    )
    .run(
      input.dedupe_key,
      input.schedule_id,
      input.schedule_run_id,
      input.due_at,
      input.target_channel,
      input.target_session_id,
      input.payload_hash,
      input.delivery_status,
      input.summary,
      input.error,
      createdAt,
      updatedAt,
    )
}

export function getScheduleStats(scheduleId: string): {
  total: number; successes: number; failures: number
  avgDurationMs: number | null; lastRunAt: number | null
} {
  const row = getDb()
    .prepare<[string], { total: number; successes: number; failures: number; avg_ms: number | null; last_run: number | null }>(
      `SELECT
         COUNT(*) as total,
         SUM(CASE WHEN success = 1 THEN 1 ELSE 0 END) as successes,
         SUM(CASE WHEN success = 0 THEN 1 ELSE 0 END) as failures,
         AVG(CASE WHEN finished_at IS NOT NULL THEN finished_at - started_at END) as avg_ms,
         MAX(started_at) as last_run
       FROM schedule_runs WHERE schedule_id = ?`,
    )
    .get(scheduleId)
  return {
    total: row?.total ?? 0,
    successes: row?.successes ?? 0,
    failures: row?.failures ?? 0,
    avgDurationMs: row?.avg_ms ? Math.round(row.avg_ms) : null,
    lastRunAt: row?.last_run ?? null,
  }
}
