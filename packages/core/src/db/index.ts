import { mkdirSync } from "node:fs"
import { dirname } from "node:path"
import BetterSqlite3 from "better-sqlite3"
import { PATHS } from "../config/index.js"
import { runMigrations } from "./migrations.js"

let _db: BetterSqlite3.Database | null = null

export function getDb(): BetterSqlite3.Database {
  if (_db) return _db

  mkdirSync(dirname(PATHS.dbFile), { recursive: true })

  _db = new BetterSqlite3(PATHS.dbFile)
  _db.pragma("journal_mode = WAL")
  _db.pragma("foreign_keys = ON")
  _db.pragma("synchronous = NORMAL")

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
  source: string
  tool_name: string
  params: string | null
  output: string | null
  result: string
  duration_ms: number | null
  approval_required: number
  approved_by: string | null
}

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

export function insertAuditLog(log: Omit<DbAuditLog, "id">): void {
  const id = crypto.randomUUID()
  getDb()
    .prepare(
      `INSERT INTO audit_logs
       (id, timestamp, session_id, source, tool_name, params, output, result,
        duration_ms, approval_required, approved_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      log.timestamp,
      log.session_id,
      log.source,
      log.tool_name,
      log.params,
      log.output,
      log.result,
      log.duration_ms,
      log.approval_required,
      log.approved_by,
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

// ── Memory Items ───────────────────────────────────────────────────────────

export interface DbMemoryItem {
  id: string
  content: string
  tags: string | null           // JSON array
  source: string | null
  memory_scope: "global" | "session" | "task" | null
  session_id: string | null
  run_id: string | null
  request_group_id: string | null
  type: string | null           // "user_fact" | "session_summary" | "project_note"
  importance: string | null     // "low" | "medium" | "high"
  embedding: Buffer | null
  created_at: number
  updated_at: number
}

export function insertMemoryItem(item: {
  content: string
  tags?: string[]
  scope?: "global" | "session" | "task"
  sessionId?: string
  runId?: string
  requestGroupId?: string
  type?: string
  importance?: string
}): string {
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
}): { clause: string; values: string[] } {
  const clauses = [`m.memory_scope = 'global'`, `m.memory_scope IS NULL`, `m.memory_scope = ''`]
  const values: string[] = []

  if (filters?.sessionId) {
    clauses.push(`(m.memory_scope = 'session' AND m.session_id = ?)`)
    values.push(filters.sessionId)
  }

  if (filters?.runId) {
    clauses.push(`(m.memory_scope = 'task' AND m.run_id = ?)`)
    values.push(filters.runId)
  }

  return {
    clause: `(${clauses.join(" OR ")})`,
    values,
  }
}

export function searchMemoryItems(query: string, limit = 5, filters?: {
  sessionId?: string
  runId?: string
}): DbMemoryItem[] {
  const scope = buildMemoryScopeWhere(filters)
  return getDb()
    .prepare<unknown[], DbMemoryItem>(
      `SELECT m.* FROM memory_fts f
       JOIN memory_items m ON m.rowid = f.rowid
       WHERE memory_fts MATCH ?
         AND ${scope.clause}
       ORDER BY rank
       LIMIT ?`,
    )
    .all(query, ...scope.values, limit)
}

export function getRecentMemoryItems(limit = 10, filters?: {
  sessionId?: string
  runId?: string
}): DbMemoryItem[] {
  const scope = buildMemoryScopeWhere(filters)
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
  created_at: number
  updated_at: number
  // computed / optional
  last_run_at?: number | null
  next_run_at?: number | null
}

export interface DbScheduleRun {
  id: string
  schedule_id: string
  started_at: number
  finished_at: number | null
  success: number | null   // 0 | 1
  summary: string | null
  error: string | null
}

export function getSchedules(): DbSchedule[] {
  return getDb()
    .prepare<[], DbSchedule>(
      `SELECT s.*,
        (SELECT r.started_at FROM schedule_runs r WHERE r.schedule_id = s.id ORDER BY r.started_at DESC LIMIT 1) AS last_run_at
       FROM schedules s ORDER BY s.created_at DESC`,
    )
    .all()
}

export function getSchedule(id: string): DbSchedule | undefined {
  return getDb()
    .prepare<[string], DbSchedule>(
      `SELECT s.*,
        (SELECT r.started_at FROM schedule_runs r WHERE r.schedule_id = s.id ORDER BY r.started_at DESC LIMIT 1) AS last_run_at
       FROM schedules s WHERE s.id = ?`,
    )
    .get(id)
}

export function getSchedulesForSession(sessionId: string, enabledOnly = false): DbSchedule[] {
  const enabledClause = enabledOnly ? "AND s.enabled = 1" : ""
  return getDb()
    .prepare<[string], DbSchedule>(
      `SELECT s.*,
        (SELECT r.started_at FROM schedule_runs r WHERE r.schedule_id = s.id ORDER BY r.started_at DESC LIMIT 1) AS last_run_at
       FROM schedules s
       WHERE s.target_session_id = ?
       ${enabledClause}
       ORDER BY s.created_at DESC`,
    )
    .all(sessionId)
}

export function insertSchedule(s: Omit<DbSchedule, "last_run_at" | "next_run_at">): void {
  getDb()
    .prepare(
      `INSERT INTO schedules (id, name, cron_expression, prompt, enabled, target_channel, target_session_id, execution_driver, origin_run_id, origin_request_group_id, model, max_retries, timeout_sec, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      s.id,
      s.name,
      s.cron_expression,
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
  fields: Partial<Pick<DbScheduleRun, "finished_at" | "success" | "summary" | "error">>,
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
