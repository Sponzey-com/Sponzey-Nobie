import { mkdirSync } from "node:fs"
import { dirname } from "node:path"
import BetterSqlite3 from "better-sqlite3"
import { PATHS } from "../config/index.js"

const MAX_STORED_CONTENT_CHARS = 4_000
const MAX_SUMMARY_CHARS = 320
const ERROR_LINE_PATTERN = /(error|failed?|exception|invalid|timeout|timed out|not found|permission|unauthorized|forbidden|refused|disconnect|offline|denied|cannot|unable|권한|실패|오류|예외|끊김|중단|거부|찾을 수 없|시간 초과|연결)/i

let _memoryDb: BetterSqlite3.Database | null = null

export type MemoryJournalKind = "instruction" | "success" | "failure" | "response"

export interface MemoryJournalRecord {
  id: string
  kind: MemoryJournalKind
  session_id: string | null
  run_id: string | null
  request_group_id: string | null
  title: string
  content: string
  summary: string
  tags: string | null
  source: string | null
  created_at: number
  updated_at: number
}

export interface MemoryJournalRecordInput {
  kind: MemoryJournalKind
  content: string
  title?: string
  summary?: string
  sessionId?: string
  runId?: string
  requestGroupId?: string
  source?: string
  tags?: string[]
}

function getMemoryJournalDb(): BetterSqlite3.Database {
  if (_memoryDb) return _memoryDb

  mkdirSync(dirname(PATHS.memoryDbFile), { recursive: true })
  _memoryDb = new BetterSqlite3(PATHS.memoryDbFile)
  _memoryDb.pragma("journal_mode = WAL")
  _memoryDb.pragma("synchronous = NORMAL")
  _memoryDb.pragma("foreign_keys = ON")
  _memoryDb.exec(`
    CREATE TABLE IF NOT EXISTS memory_records (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL,
      session_id TEXT,
      run_id TEXT,
      request_group_id TEXT,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      summary TEXT NOT NULL,
      tags TEXT,
      source TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_memory_records_kind_created_at
      ON memory_records(kind, created_at DESC);

    CREATE INDEX IF NOT EXISTS idx_memory_records_request_group
      ON memory_records(request_group_id, created_at DESC);

    CREATE VIRTUAL TABLE IF NOT EXISTS memory_records_fts
      USING fts5(title, content, summary, tags, content='memory_records', content_rowid='rowid');
  `)

  return _memoryDb
}

export function closeMemoryJournalDb(): void {
  _memoryDb?.close()
  _memoryDb = null
}

function normalizeWhitespace(text: string): string {
  return text
    .replace(/\r/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
}

export function condenseMemoryText(text: string, maxChars = MAX_SUMMARY_CHARS): string {
  const normalized = normalizeWhitespace(text).replace(/\s+/g, " ").trim()
  if (!normalized) return ""
  if (normalized.length <= maxChars) return normalized
  return `${normalized.slice(0, Math.max(0, maxChars - 1)).trimEnd()}…`
}

export function extractFocusedErrorMessage(text: string, maxChars = MAX_SUMMARY_CHARS): string {
  const normalized = normalizeWhitespace(text)
  if (!normalized) return ""

  const lines = normalized
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)

  const focusedLines = lines.filter((line) => ERROR_LINE_PATTERN.test(line))
  const selected = (focusedLines.length > 0 ? focusedLines : lines).slice(0, 3)
  const joined = selected.join(" | ")
  return condenseMemoryText(joined || normalized, maxChars)
}

function buildStoredContent(text: string): string {
  const normalized = normalizeWhitespace(text)
  if (normalized.length <= MAX_STORED_CONTENT_CHARS) return normalized
  return `${normalized.slice(0, MAX_STORED_CONTENT_CHARS).trimEnd()}…`
}

function defaultTitle(kind: MemoryJournalKind, summary: string): string {
  const prefix = (() => {
    switch (kind) {
      case "instruction":
        return "instruction"
      case "success":
        return "success"
      case "failure":
        return "failure"
      case "response":
        return "response"
      default:
        return "memory"
    }
  })()

  const condensed = condenseMemoryText(summary, 72)
  return condensed ? `${prefix}: ${condensed}` : prefix
}

export function insertMemoryJournalRecord(input: MemoryJournalRecordInput): string {
  const db = getMemoryJournalDb()
  const id = crypto.randomUUID()
  const now = Date.now()
  const content = buildStoredContent(input.content)
  const summary = (
    input.summary?.trim()
    || (input.kind === "failure" ? extractFocusedErrorMessage(content) : condenseMemoryText(content))
  ) || defaultTitle(input.kind, content)
  const title = input.title?.trim() || defaultTitle(input.kind, summary)
  const tags = JSON.stringify(input.tags ?? [])

  db.prepare(
    `INSERT INTO memory_records
      (id, kind, session_id, run_id, request_group_id, title, content, summary, tags, source, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    input.kind,
    input.sessionId ?? null,
    input.runId ?? null,
    input.requestGroupId ?? null,
    title,
    content,
    summary,
    tags,
    input.source ?? "nobie",
    now,
    now,
  )

  db.prepare(
    `INSERT INTO memory_records_fts(rowid, title, content, summary, tags)
     SELECT rowid, title, content, summary, tags
     FROM memory_records
     WHERE id = ?`,
  ).run(id)

  return id
}

function buildFtsQuery(query: string): string {
  const tokens = Array.from(
    new Set(
      (normalizeWhitespace(query).match(/[0-9A-Za-z가-힣._:-]{2,}/g) ?? [])
        .map((token) => token.replace(/"/g, "").trim())
        .filter(Boolean),
    ),
  ).slice(0, 8)

  if (tokens.length > 0) {
    return tokens.map((token) => `${token}*`).join(" OR ")
  }

  const condensed = condenseMemoryText(query, 48).replace(/"/g, "")
  return condensed ? `"${condensed}"` : ""
}

export function searchMemoryJournal(
  query: string,
  options?: {
    limit?: number
    kinds?: MemoryJournalKind[]
  },
): MemoryJournalRecord[] {
  const ftsQuery = buildFtsQuery(query)
  if (!ftsQuery) return []

  const limit = options?.limit ?? 6
  const kinds = options?.kinds ?? []
  const db = getMemoryJournalDb()
  const whereKind = kinds.length > 0 ? `AND m.kind IN (${kinds.map(() => "?").join(", ")})` : ""

  return db
    .prepare<unknown[], MemoryJournalRecord>(
      `SELECT m.*
       FROM memory_records_fts f
       JOIN memory_records m ON m.rowid = f.rowid
       WHERE memory_records_fts MATCH ?
       ${whereKind}
       ORDER BY bm25(memory_records_fts), m.created_at DESC
       LIMIT ?`,
    )
    .all(ftsQuery, ...kinds, limit)
}

function kindLabel(kind: MemoryJournalKind): string {
  switch (kind) {
    case "instruction":
      return "instruction"
    case "success":
      return "success"
    case "failure":
      return "failure"
    case "response":
      return "response"
    default:
      return "memory"
  }
}

export function buildMemoryJournalContext(query: string, limit = 6): string {
  const records = searchMemoryJournal(query, {
    limit,
    kinds: ["instruction", "failure", "success", "response"],
  })
  if (!records.length) return ""

  const lines = records.map((record) => `- [${kindLabel(record.kind)}] ${record.summary}`)
  return `[Execution Reference Memory]\n${lines.join("\n")}`
}
