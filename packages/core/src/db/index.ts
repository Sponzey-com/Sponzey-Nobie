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
  role: string
  content: string
  tool_calls: string | null
  tool_call_id: string | null
  created_at: number
}

export interface DbAuditLog {
  id: string
  timestamp: number
  session_id: string | null
  source: string
  tool_name: string
  params: string | null
  result: string
  duration_ms: number | null
  approval_required: number
  approved_by: string | null
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
       (id, session_id, role, content, tool_calls, tool_call_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      msg.id,
      msg.session_id,
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

export function insertAuditLog(log: Omit<DbAuditLog, "id">): void {
  const id = crypto.randomUUID()
  getDb()
    .prepare(
      `INSERT INTO audit_logs
       (id, timestamp, session_id, source, tool_name, params, result,
        duration_ms, approval_required, approved_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      log.timestamp,
      log.session_id,
      log.source,
      log.tool_name,
      log.params,
      log.result,
      log.duration_ms,
      log.approval_required,
      log.approved_by,
    )
}
