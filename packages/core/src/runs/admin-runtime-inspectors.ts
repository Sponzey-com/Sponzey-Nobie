import type { ControlTimeline, ControlTimelineEvent } from "../control-plane/timeline.js"
import {
  getDb,
  type DbChannelMessageRef,
  type DbMessageLedgerEvent,
  type DbScheduleDeliveryReceipt,
  type DbScheduleRun,
} from "../db/index.js"
import { parseScheduleContractJson } from "../schedules/candidates.js"

export type AdminMemoryOwnerKind = "user" | "diagnostic"
export type AdminSchedulerQueueState = "disabled" | "waiting" | "missed" | "running" | "retrying" | "idle"

export interface AdminMemoryDocumentView {
  id: string
  scope: string
  ownerId: string
  ownerKind: AdminMemoryOwnerKind
  sourceType: string
  sourceRef: string | null
  title: string | null
  chunkCount: number
  ftsCount: number
  embeddingCount: number
  ftsStatus: "available" | "missing" | "empty"
  vectorStatus: "available" | "missing" | "empty"
  indexStatus: string | null
  indexRetryCount: number
  indexLastError: string | null
  runId: string | null
  requestGroupId: string | null
  updatedAt: number
}

export interface AdminMemoryWritebackView {
  id: string
  scope: string
  ownerId: string
  ownerKind: AdminMemoryOwnerKind
  sourceType: string
  status: string
  retryCount: number
  lastError: string | null
  runId: string | null
  requestGroupId: string | null
  contentPreview: string
  updatedAt: number
}

export interface AdminMemoryRetrievalTraceView {
  id: string
  runId: string | null
  requestGroupId: string | null
  sessionKey: string | null
  documentId: string | null
  chunkId: string | null
  scope: string | null
  resultSource: string
  score: number | null
  latencyMs: number | null
  reason: string | null
  queryPreview: string
  createdAt: number
}

export interface AdminMemoryInspector {
  summary: {
    documents: number
    userDocuments: number
    diagnosticDocuments: number
    writebackPending: number
    writebackFailed: number
    retrievalTraces: number
    linkedFailures: number
  }
  documents: { items: AdminMemoryDocumentView[]; degradedReasons: string[] }
  writebackQueue: { items: AdminMemoryWritebackView[]; degradedReasons: string[] }
  retrievalTrace: { items: AdminMemoryRetrievalTraceView[]; degradedReasons: string[] }
  linkedFailures: Array<{ at: number; source: "timeline" | "ledger"; component: string; summary: string; runId: string | null; requestGroupId: string | null }>
}

export interface AdminSchedulerContractView {
  hasContract: boolean
  schemaVersion: number | null
  identityKey: string | null
  payloadHash: string | null
  deliveryKey: string | null
  payloadKind: string | null
  deliveryChannel: string | null
  missedPolicy: string | null
  timeKind: "one_time" | "recurring" | "unknown"
}

export interface AdminSchedulerScheduleView {
  id: string
  name: string
  enabled: boolean
  cronExpression: string
  timezone: string | null
  targetChannel: string
  targetSessionId: string | null
  executionDriver: string
  nextRunAt: number | null
  lastRunAt: number | null
  queueState: AdminSchedulerQueueState
  contract: AdminSchedulerContractView
  latestRun: {
    id: string
    startedAt: number
    finishedAt: number | null
    success: boolean | null
    executionSuccess: boolean | null
    deliverySuccess: boolean | null
    deliveryDedupeKey: string | null
    error: string | null
  } | null
  receipts: Array<{
    dedupeKey: string
    runId: string
    dueAt: string
    targetChannel: string
    status: string
    summary: string | null
    error: string | null
    updatedAt: number
  }>
}

export interface AdminSchedulerInspector {
  summary: {
    schedules: number
    enabled: number
    missed: number
    retrying: number
    receipts: number
  }
  schedules: AdminSchedulerScheduleView[]
  timelineLinks: Array<{ at: number; eventType: string; component: string; summary: string; runId: string | null; requestGroupId: string | null }>
  fieldChecks: {
    comparisonMode: "contract_fields"
    naturalLanguageMatchingAllowed: false
    requiredKeys: string[]
  }
  degradedReasons: string[]
}

export interface AdminChannelMappingView {
  channel: string
  inboundCount: number
  outboundCount: number
  approvalCount: number
  receiptCount: number
  latestAt: number | null
  refs: Array<{
    id: string
    sessionKey: string
    rootRunId: string
    requestGroupId: string
    chatId: string
    threadId: string | null
    messageId: string
    role: string
    createdAt: number
  }>
}

export interface AdminChannelReceiptView {
  id: string
  channel: string
  eventKind: string
  status: string
  summary: string
  deliveryKey: string | null
  idempotencyKey: string | null
  runId: string | null
  requestGroupId: string | null
  sessionKey: string | null
  threadKey: string | null
  chatId: string | null
  threadId: string | null
  userId: string | null
  messageId: string | null
  createdAt: number
}

export interface AdminApprovalCallbackView {
  id: string
  channel: string
  eventKind: string
  status: string
  summary: string
  runId: string | null
  requestGroupId: string | null
  approvalId: string | null
  callbackId: string | null
  buttonPayload: string | null
  userId: string | null
  chatId: string | null
  createdAt: number
}

export interface AdminChannelInspector {
  summary: {
    channels: number
    inbound: number
    outbound: number
    approvals: number
    receipts: number
  }
  mappings: AdminChannelMappingView[]
  ledgerReceipts: AdminChannelReceiptView[]
  approvalCallbacks: AdminApprovalCallbackView[]
  degradedReasons: string[]
}

export interface AdminRuntimeInspectors {
  memory: AdminMemoryInspector
  scheduler: AdminSchedulerInspector
  channels: AdminChannelInspector
}

interface InspectorInput {
  timeline: ControlTimeline
  ledgerEvents: DbMessageLedgerEvent[]
  limit?: number
  filters?: {
    runId?: string
    requestGroupId?: string
    sessionKey?: string
    channel?: string
  }
}

interface QueryResult<T> {
  rows: T[]
  degradedReasons: string[]
}

interface MemoryDocumentRow {
  id: string
  scope: string
  owner_id: string
  source_type: string
  source_ref: string | null
  title: string | null
  checksum: string
  metadata_json: string | null
  archived_at: number | null
  created_at: number
  updated_at: number
  chunk_count: number
  fts_count: number
  embedding_count: number
  index_status: string | null
  index_retry_count: number | null
  index_last_error: string | null
}

interface MemoryWritebackRow {
  id: string
  scope: string
  owner_id: string
  source_type: string
  content: string
  metadata_json: string | null
  status: string
  retry_count: number
  last_error: string | null
  run_id: string | null
  created_at: number
  updated_at: number
}

interface MemoryAccessRow {
  id: string
  run_id: string | null
  session_id: string | null
  request_group_id: string | null
  document_id: string | null
  chunk_id: string | null
  source_checksum: string | null
  scope: string | null
  query: string
  result_source: string
  score: number | null
  latency_ms: number | null
  reason: string | null
  created_at: number
}

interface ScheduleRow {
  id: string
  name: string
  cron_expression: string
  timezone: string | null
  prompt: string
  enabled: number
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
  entry_next_run_at: number | null
}

type ScheduleRunRow = DbScheduleRun
type ScheduleReceiptRow = DbScheduleDeliveryReceipt

const SENSITIVE_KEY_PATTERN = /api[_-]?key|authorization|bearer|cookie|credential|password|refresh[_-]?token|secret|token|html|body|response/i
const SECRET_TEXT_PATTERNS: Array<[RegExp, string]> = [
  [/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer ***"],
  [/xox[abprs]-[A-Za-z0-9-]{8,}/gi, "xox*-***"],
  [/\bsk-[A-Za-z0-9_-]{8,}\b/g, "sk-***"],
  [/\b\d{6,}:[A-Za-z0-9_-]{8,}\b/g, "***:***"],
]

function clampLimit(value: number | undefined, fallback = 100): number {
  if (!Number.isFinite(value)) return fallback
  return Math.max(1, Math.min(500, Math.floor(value ?? fallback)))
}

function queryRows<T>(label: string, run: () => T[]): QueryResult<T> {
  try {
    return { rows: run(), degradedReasons: [] }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { rows: [], degradedReasons: [`${label}: ${message}`] }
  }
}

function parseJson(raw: string | null): unknown {
  if (!raw) return null
  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null
}

function redactText(value: string, max = 220): string {
  let next = value
  for (const [pattern, replacement] of SECRET_TEXT_PATTERNS) next = next.replace(pattern, replacement)
  if (next.length <= max) return next
  return `${next.slice(0, max)}...`
}

function sanitizeDetail(value: unknown, depth = 0): unknown {
  if (value == null) return value
  if (depth > 8) return "[truncated]"
  if (typeof value === "string") return redactText(value, 500)
  if (Array.isArray(value)) return value.slice(0, 50).map((item) => sanitizeDetail(item, depth + 1))
  if (isRecord(value)) {
    const out: Record<string, unknown> = {}
    for (const [key, nested] of Object.entries(value)) {
      out[key] = SENSITIVE_KEY_PATTERN.test(key) ? "[redacted]" : sanitizeDetail(nested, depth + 1)
    }
    return out
  }
  return value
}

function findDetailValue(detail: unknown, keys: string[], depth = 0): string | null {
  if (!detail || depth > 6) return null
  if (typeof detail === "string") return null
  if (Array.isArray(detail)) {
    for (const item of detail) {
      const found = findDetailValue(item, keys, depth + 1)
      if (found) return found
    }
    return null
  }
  if (!isRecord(detail)) return null
  for (const key of keys) {
    const direct = detail[key]
    if (typeof direct === "string" && direct.trim()) return redactText(direct.trim(), 160)
    if (typeof direct === "number" && Number.isFinite(direct)) return String(direct)
  }
  for (const nested of Object.values(detail)) {
    const found = findDetailValue(nested, keys, depth + 1)
    if (found) return found
  }
  return null
}

function ownerKind(scope: string, sourceType?: string | null): AdminMemoryOwnerKind {
  const normalizedScope = scope.toLowerCase()
  const normalizedSource = sourceType?.toLowerCase() ?? ""
  if (normalizedScope === "diagnostic" || normalizedSource.includes("diagnostic") || normalizedSource.includes("debug")) {
    return "diagnostic"
  }
  return "user"
}

function metadataRunId(metadata: unknown): string | null {
  if (!isRecord(metadata)) return null
  return asString(metadata.runId) ?? asString(metadata.sourceRunId) ?? asString(metadata.rootRunId)
}

function metadataRequestGroupId(metadata: unknown): string | null {
  if (!isRecord(metadata)) return null
  return asString(metadata.requestGroupId) ?? asString(metadata.request_group_id)
}

function matchesFilter(row: { runId?: string | null; requestGroupId?: string | null; sessionKey?: string | null; channel?: string | null }, filters: InspectorInput["filters"]): boolean {
  if (!filters) return true
  if (filters.runId && row.runId !== filters.runId) return false
  if (filters.requestGroupId && row.requestGroupId !== filters.requestGroupId) return false
  if (filters.sessionKey && row.sessionKey !== filters.sessionKey) return false
  if (filters.channel && row.channel !== filters.channel) return false
  return true
}

function listMemoryDocuments(limit: number): QueryResult<MemoryDocumentRow> {
  return queryRows("memory documents", () => getDb()
    .prepare<[number], MemoryDocumentRow>(
      `SELECT d.id, d.scope, d.owner_id, d.source_type, d.source_ref, d.title, d.checksum,
              d.metadata_json, d.archived_at, d.created_at, d.updated_at,
              COUNT(DISTINCT c.id) AS chunk_count,
              COUNT(DISTINCT f.rowid) AS fts_count,
              COUNT(DISTINCT e.id) AS embedding_count,
              j.status AS index_status,
              COALESCE(j.retry_count, 0) AS index_retry_count,
              j.last_error AS index_last_error
       FROM memory_documents d
       LEFT JOIN memory_chunks c ON c.document_id = d.id
       LEFT JOIN memory_chunks_fts f ON f.rowid = c.rowid
       LEFT JOIN memory_embeddings e ON e.chunk_id = c.id
       LEFT JOIN memory_index_jobs j ON j.document_id = d.id
       WHERE d.archived_at IS NULL
       GROUP BY d.id
       ORDER BY d.updated_at DESC
       LIMIT ?`,
    )
    .all(limit))
}

function listMemoryWriteback(limit: number): QueryResult<MemoryWritebackRow> {
  return queryRows("memory writeback", () => getDb()
    .prepare<[number], MemoryWritebackRow>(
      `SELECT id, scope, owner_id, source_type, content, metadata_json, status, retry_count, last_error, run_id, created_at, updated_at
       FROM memory_writeback_queue
       ORDER BY updated_at DESC
       LIMIT ?`,
    )
    .all(limit))
}

function listMemoryAccess(limit: number): QueryResult<MemoryAccessRow> {
  return queryRows("memory access", () => getDb()
    .prepare<[number], MemoryAccessRow>(
      `SELECT id, run_id, session_id, request_group_id, document_id, chunk_id, source_checksum, scope, query,
              result_source, score, latency_ms, reason, created_at
       FROM memory_access_log
       ORDER BY created_at DESC
       LIMIT ?`,
    )
    .all(limit))
}

function buildMemoryInspector(input: InspectorInput): AdminMemoryInspector {
  const limit = clampLimit(input.limit, 100)
  const documents = listMemoryDocuments(limit)
  const writeback = listMemoryWriteback(limit)
  const access = listMemoryAccess(limit)

  const documentViews = documents.rows.map((row) => {
    const metadata = parseJson(row.metadata_json)
    const chunkCount = Number(row.chunk_count ?? 0)
    const ftsCount = Number(row.fts_count ?? 0)
    const embeddingCount = Number(row.embedding_count ?? 0)
    return {
      id: row.id,
      scope: row.scope,
      ownerId: row.owner_id,
      ownerKind: ownerKind(row.scope, row.source_type),
      sourceType: row.source_type,
      sourceRef: row.source_ref,
      title: row.title,
      chunkCount,
      ftsCount,
      embeddingCount,
      ftsStatus: chunkCount === 0 ? "empty" as const : ftsCount > 0 ? "available" as const : "missing" as const,
      vectorStatus: chunkCount === 0 ? "empty" as const : embeddingCount > 0 ? "available" as const : "missing" as const,
      indexStatus: row.index_status,
      indexRetryCount: Number(row.index_retry_count ?? 0),
      indexLastError: row.index_last_error ? redactText(row.index_last_error) : null,
      runId: metadataRunId(metadata),
      requestGroupId: metadataRequestGroupId(metadata),
      updatedAt: row.updated_at,
    }
  }).filter((row) => matchesFilter(row, input.filters))

  const writebackViews = writeback.rows.map((row) => {
    const metadata = parseJson(row.metadata_json)
    return {
      id: row.id,
      scope: row.scope,
      ownerId: row.owner_id,
      ownerKind: ownerKind(row.scope, row.source_type),
      sourceType: row.source_type,
      status: row.status,
      retryCount: row.retry_count,
      lastError: row.last_error ? redactText(row.last_error) : null,
      runId: row.run_id,
      requestGroupId: metadataRequestGroupId(metadata),
      contentPreview: redactText(row.content, 180),
      updatedAt: row.updated_at,
    }
  }).filter((row) => matchesFilter(row, input.filters))

  const traceViews = access.rows.map((row) => ({
    id: row.id,
    runId: row.run_id,
    requestGroupId: row.request_group_id,
    sessionKey: row.session_id,
    documentId: row.document_id,
    chunkId: row.chunk_id,
    scope: row.scope,
    resultSource: row.result_source,
    score: row.score,
    latencyMs: row.latency_ms,
    reason: row.reason ? redactText(row.reason) : null,
    queryPreview: redactText(row.query, 180),
    createdAt: row.created_at,
  })).filter((row) => matchesFilter(row, input.filters))

  const memoryTimelineFailures = input.timeline.events
    .filter((event) => (event.component.toLowerCase().includes("memory") || event.eventType.toLowerCase().includes("memory")) && (event.severity === "warning" || event.severity === "error"))
    .map((event) => ({
      at: event.at,
      source: "timeline" as const,
      component: event.component,
      summary: redactText(event.summary),
      runId: event.runId,
      requestGroupId: event.requestGroupId,
    }))
  const memoryLedgerFailures = input.ledgerEvents
    .filter((event) => event.status === "failed" && (event.event_kind.includes("memory") || JSON.stringify(parseJson(event.detail_json) ?? {}).toLowerCase().includes("memory")))
    .map((event) => ({
      at: event.created_at,
      source: "ledger" as const,
      component: event.event_kind,
      summary: redactText(event.summary),
      runId: event.run_id,
      requestGroupId: event.request_group_id,
    }))
  const linkedFailures = [...memoryTimelineFailures, ...memoryLedgerFailures].sort((a, b) => b.at - a.at).slice(0, limit)

  return {
    summary: {
      documents: documentViews.length,
      userDocuments: documentViews.filter((row) => row.ownerKind === "user").length,
      diagnosticDocuments: documentViews.filter((row) => row.ownerKind === "diagnostic").length,
      writebackPending: writebackViews.filter((row) => row.status === "pending" || row.status === "writing").length,
      writebackFailed: writebackViews.filter((row) => row.status === "failed").length,
      retrievalTraces: traceViews.length,
      linkedFailures: linkedFailures.length,
    },
    documents: { items: documentViews, degradedReasons: documents.degradedReasons },
    writebackQueue: { items: writebackViews, degradedReasons: writeback.degradedReasons },
    retrievalTrace: { items: traceViews, degradedReasons: access.degradedReasons },
    linkedFailures,
  }
}

function listSchedules(limit: number): QueryResult<ScheduleRow> {
  return queryRows("schedules", () => getDb()
    .prepare<[number], ScheduleRow>(
      `SELECT s.id, s.name, s.cron_expression, s.timezone, s.prompt, s.enabled, s.target_channel,
              s.target_session_id, s.execution_driver, s.origin_run_id, s.origin_request_group_id,
              s.model, s.max_retries, s.timeout_sec, s.contract_json, s.identity_key, s.payload_hash,
              s.delivery_key, s.contract_schema_version, s.created_at, s.updated_at,
              se.next_run_at AS entry_next_run_at
       FROM schedules s
       LEFT JOIN schedule_entries se ON se.schedule_id = s.id
       ORDER BY s.updated_at DESC
       LIMIT ?`,
    )
    .all(limit))
}

function listScheduleRuns(limit: number): QueryResult<ScheduleRunRow> {
  return queryRows("schedule runs", () => getDb()
    .prepare<[number], ScheduleRunRow>(
      `SELECT id, schedule_id, started_at, finished_at, success, summary, error,
              execution_success, delivery_success, delivery_dedupe_key, delivery_error
       FROM schedule_runs
       ORDER BY started_at DESC
       LIMIT ?`,
    )
    .all(limit))
}

function listScheduleReceipts(limit: number): QueryResult<ScheduleReceiptRow> {
  return queryRows("schedule receipts", () => getDb()
    .prepare<[number], ScheduleReceiptRow>(
      `SELECT dedupe_key, schedule_id, schedule_run_id, due_at, target_channel, target_session_id,
              payload_hash, delivery_status, summary, error, created_at, updated_at
       FROM schedule_delivery_receipts
       ORDER BY updated_at DESC
       LIMIT ?`,
    )
    .all(limit))
}

function toBoolean(value: number | null | undefined): boolean | null {
  if (value == null) return null
  return value === 1
}

function parseRunAt(value: string | null | undefined): number | null {
  if (!value) return null
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : null
}

function buildContractView(row: ScheduleRow): AdminSchedulerContractView {
  const contract = parseScheduleContractJson(row.contract_json)
  return {
    hasContract: Boolean(contract && row.contract_schema_version != null),
    schemaVersion: row.contract_schema_version,
    identityKey: row.identity_key,
    payloadHash: row.payload_hash,
    deliveryKey: row.delivery_key,
    payloadKind: contract?.payload.kind ?? null,
    deliveryChannel: contract?.delivery.channel ?? null,
    missedPolicy: contract?.time.missedPolicy ?? null,
    timeKind: contract?.time.runAt ? "one_time" : contract?.time.cron ? "recurring" : "unknown",
  }
}

function schedulerQueueState(row: ScheduleRow, latestRun: ScheduleRunRow | undefined, nextRunAt: number | null): AdminSchedulerQueueState {
  if (row.enabled !== 1) return "disabled"
  if (latestRun && latestRun.finished_at == null) return "running"
  if (latestRun && (latestRun.success === 0 || latestRun.delivery_success === 0 || latestRun.execution_success === 0)) return "retrying"
  if (nextRunAt && nextRunAt < Date.now() && (!latestRun || latestRun.started_at < nextRunAt)) return "missed"
  if (nextRunAt && nextRunAt >= Date.now()) return "waiting"
  return "idle"
}

function buildSchedulerInspector(input: InspectorInput): AdminSchedulerInspector {
  const limit = clampLimit(input.limit, 100)
  const schedules = listSchedules(limit)
  const runs = listScheduleRuns(limit * 3)
  const receipts = listScheduleReceipts(limit * 3)
  const runsBySchedule = new Map<string, ScheduleRunRow[]>()
  const receiptsBySchedule = new Map<string, ScheduleReceiptRow[]>()
  for (const run of runs.rows) {
    const bucket = runsBySchedule.get(run.schedule_id) ?? []
    bucket.push(run)
    runsBySchedule.set(run.schedule_id, bucket)
  }
  for (const receipt of receipts.rows) {
    const bucket = receiptsBySchedule.get(receipt.schedule_id) ?? []
    bucket.push(receipt)
    receiptsBySchedule.set(receipt.schedule_id, bucket)
  }

  const views = schedules.rows.map((row) => {
    const contract = parseScheduleContractJson(row.contract_json)
    const nextRunAt = row.entry_next_run_at ?? parseRunAt(contract?.time.runAt)
    const scheduleRuns = (runsBySchedule.get(row.id) ?? []).sort((a, b) => b.started_at - a.started_at)
    const latestRun = scheduleRuns[0]
    return {
      id: row.id,
      name: row.name,
      enabled: row.enabled === 1,
      cronExpression: row.cron_expression,
      timezone: row.timezone,
      targetChannel: row.target_channel,
      targetSessionId: row.target_session_id,
      executionDriver: row.execution_driver,
      nextRunAt,
      lastRunAt: latestRun?.started_at ?? null,
      queueState: schedulerQueueState(row, latestRun, nextRunAt),
      contract: buildContractView(row),
      latestRun: latestRun
        ? {
            id: latestRun.id,
            startedAt: latestRun.started_at,
            finishedAt: latestRun.finished_at,
            success: toBoolean(latestRun.success),
            executionSuccess: toBoolean(latestRun.execution_success),
            deliverySuccess: toBoolean(latestRun.delivery_success),
            deliveryDedupeKey: latestRun.delivery_dedupe_key ?? null,
            error: latestRun.error ?? latestRun.delivery_error ?? null,
          }
        : null,
      receipts: (receiptsBySchedule.get(row.id) ?? []).slice(0, 8).map((receipt) => ({
        dedupeKey: receipt.dedupe_key,
        runId: receipt.schedule_run_id,
        dueAt: receipt.due_at,
        targetChannel: receipt.target_channel,
        status: receipt.delivery_status,
        summary: receipt.summary,
        error: receipt.error,
        updatedAt: receipt.updated_at,
      })),
    }
  }).filter((row) => {
    if (input.filters?.runId && row.latestRun?.id !== input.filters.runId) return false
    if (input.filters?.requestGroupId) {
      const scheduleRow = schedules.rows.find((item) => item.id === row.id)
      if (scheduleRow?.origin_request_group_id !== input.filters.requestGroupId) return false
    }
    if (input.filters?.sessionKey && row.targetSessionId !== input.filters.sessionKey) return false
    if (input.filters?.channel && row.targetChannel !== input.filters.channel) return false
    return true
  })

  const timelineLinks = input.timeline.events
    .filter((event) => event.component.toLowerCase().includes("sched") || event.eventType.toLowerCase().includes("sched"))
    .map((event) => ({
      at: event.at,
      eventType: event.eventType,
      component: event.component,
      summary: redactText(event.summary),
      runId: event.runId,
      requestGroupId: event.requestGroupId,
    }))
    .slice(0, limit)

  return {
    summary: {
      schedules: views.length,
      enabled: views.filter((row) => row.enabled).length,
      missed: views.filter((row) => row.queueState === "missed").length,
      retrying: views.filter((row) => row.queueState === "retrying").length,
      receipts: views.reduce((sum, row) => sum + row.receipts.length, 0),
    },
    schedules: views,
    timelineLinks,
    fieldChecks: {
      comparisonMode: "contract_fields",
      naturalLanguageMatchingAllowed: false,
      requiredKeys: ["identity_key", "payload_hash", "delivery_key", "contract_schema_version"],
    },
    degradedReasons: [...schedules.degradedReasons, ...runs.degradedReasons, ...receipts.degradedReasons],
  }
}

function listChannelRefs(limit: number): QueryResult<DbChannelMessageRef> {
  return queryRows("channel refs", () => getDb()
    .prepare<[number], DbChannelMessageRef>(
      `SELECT id, source, session_id, root_run_id, request_group_id, external_chat_id,
              external_thread_id, external_message_id, role, created_at
       FROM channel_message_refs
       ORDER BY created_at DESC
       LIMIT ?`,
    )
    .all(limit))
}

function isInboundEvent(event: DbMessageLedgerEvent): boolean {
  return event.event_kind === "ingress_received" || event.event_kind === "fast_receipt_sent"
}

function isOutboundEvent(event: DbMessageLedgerEvent): boolean {
  return event.event_kind.includes("delivered") || event.event_kind.includes("delivery") || event.event_kind === "progress_message_sent" || event.event_kind === "final_answer_generated"
}

function isApprovalEvent(event: DbMessageLedgerEvent): boolean {
  return event.event_kind.startsWith("approval_")
}

function buildChannelInspector(input: InspectorInput): AdminChannelInspector {
  const limit = clampLimit(input.limit, 100)
  const refs = listChannelRefs(limit * 2)
  const ledgerEvents = input.ledgerEvents.filter((event) => matchesFilter({
    runId: event.run_id,
    requestGroupId: event.request_group_id,
    sessionKey: event.session_key,
    channel: event.channel,
  }, input.filters))
  const refsBySource = new Map<string, DbChannelMessageRef[]>()
  for (const ref of refs.rows) {
    if (input.filters?.channel && ref.source !== input.filters.channel) continue
    if (input.filters?.requestGroupId && ref.request_group_id !== input.filters.requestGroupId) continue
    if (input.filters?.sessionKey && ref.session_id !== input.filters.sessionKey) continue
    const bucket = refsBySource.get(ref.source) ?? []
    bucket.push(ref)
    refsBySource.set(ref.source, bucket)
  }

  const channels = new Set<string>([...ledgerEvents.map((event) => event.channel), ...refsBySource.keys()])
  const mappings = [...channels].sort().map((channel) => {
    const channelEvents = ledgerEvents.filter((event) => event.channel === channel)
    const channelRefs = refsBySource.get(channel) ?? []
    const latestAt = Math.max(0, ...channelEvents.map((event) => event.created_at), ...channelRefs.map((ref) => ref.created_at)) || null
    return {
      channel,
      inboundCount: channelEvents.filter(isInboundEvent).length + channelRefs.filter((ref) => ref.role === "user").length,
      outboundCount: channelEvents.filter(isOutboundEvent).length + channelRefs.filter((ref) => ref.role !== "user").length,
      approvalCount: channelEvents.filter(isApprovalEvent).length,
      receiptCount: channelEvents.filter((event) => Boolean(event.delivery_key) || isOutboundEvent(event)).length,
      latestAt,
      refs: channelRefs.slice(0, 10).map((ref) => ({
        id: ref.id,
        sessionKey: ref.session_id,
        rootRunId: ref.root_run_id,
        requestGroupId: ref.request_group_id,
        chatId: redactText(ref.external_chat_id, 120),
        threadId: ref.external_thread_id ? redactText(ref.external_thread_id, 120) : null,
        messageId: redactText(ref.external_message_id, 120),
        role: ref.role,
        createdAt: ref.created_at,
      })),
    }
  })

  const ledgerReceipts = ledgerEvents
    .filter((event) => Boolean(event.delivery_key) || isOutboundEvent(event) || isInboundEvent(event))
    .slice(0, limit)
    .map((event) => {
      const detail = sanitizeDetail(parseJson(event.detail_json))
      return {
        id: event.id,
        channel: event.channel,
        eventKind: event.event_kind,
        status: event.status,
        summary: redactText(event.summary),
        deliveryKey: event.delivery_key,
        idempotencyKey: event.idempotency_key,
        runId: event.run_id,
        requestGroupId: event.request_group_id,
        sessionKey: event.session_key,
        threadKey: event.thread_key,
        chatId: findDetailValue(detail, ["chatId", "chat_id", "channelId", "channel_id", "slackChannelId", "telegramChatId"]),
        threadId: findDetailValue(detail, ["threadId", "thread_id", "threadTs", "messageThreadId"]),
        userId: findDetailValue(detail, ["userId", "user_id", "slackUserId", "fromId"]),
        messageId: findDetailValue(detail, ["messageId", "message_id", "messageTs", "ts"]),
        createdAt: event.created_at,
      }
    })

  const approvalCallbacks = ledgerEvents
    .filter(isApprovalEvent)
    .slice(0, limit)
    .map((event) => {
      const detail = sanitizeDetail(parseJson(event.detail_json))
      return {
        id: event.id,
        channel: event.channel,
        eventKind: event.event_kind,
        status: event.status,
        summary: redactText(event.summary),
        runId: event.run_id,
        requestGroupId: event.request_group_id,
        approvalId: findDetailValue(detail, ["approvalId", "approval_id", "requestId"]),
        callbackId: findDetailValue(detail, ["callbackId", "callback_id", "triggerId", "callbackQueryId"]),
        buttonPayload: findDetailValue(detail, ["buttonPayload", "payload", "actionId", "value"]),
        userId: findDetailValue(detail, ["userId", "user_id", "slackUserId", "fromId"]),
        chatId: findDetailValue(detail, ["chatId", "chat_id", "channelId", "channel_id", "slackChannelId", "telegramChatId"]),
        createdAt: event.created_at,
      }
    })

  return {
    summary: {
      channels: mappings.length,
      inbound: mappings.reduce((sum, row) => sum + row.inboundCount, 0),
      outbound: mappings.reduce((sum, row) => sum + row.outboundCount, 0),
      approvals: approvalCallbacks.length,
      receipts: ledgerReceipts.length,
    },
    mappings,
    ledgerReceipts,
    approvalCallbacks,
    degradedReasons: refs.degradedReasons,
  }
}

export function buildAdminRuntimeInspectors(input: InspectorInput): AdminRuntimeInspectors {
  return {
    memory: buildMemoryInspector(input),
    scheduler: buildSchedulerInspector(input),
    channels: buildChannelInspector(input),
  }
}
