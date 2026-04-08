import { getDb } from "../../db/index.js"
import type { DbSession } from "../../db/index.js"

export function resolveSlackSessionKey(channelId: string, threadTs: string): string {
  return `slack:${channelId}:${threadTs}`
}

export function getOrCreateSlackSession(sessionKey: string): string {
  const db = getDb()

  const existing = db
    .prepare<[string, string], DbSession>(
      "SELECT * FROM sessions WHERE source = ? AND source_id = ? LIMIT 1",
    )
    .get("slack", sessionKey)

  if (existing) return existing.id

  const sessionId = crypto.randomUUID()
  const now = Date.now()
  db.prepare(
    `INSERT INTO sessions (id, source, source_id, created_at, updated_at, summary)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(sessionId, "slack", sessionKey, now, now, null)
  return sessionId
}

export function newSlackSession(sessionKey: string): string {
  const db = getDb()
  const sessionId = crypto.randomUUID()
  const now = Date.now()

  db.prepare("DELETE FROM sessions WHERE source = ? AND source_id = ?").run("slack", sessionKey)
  db.prepare(
    `INSERT INTO sessions (id, source, source_id, created_at, updated_at, summary)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(sessionId, "slack", sessionKey, now, now, null)

  return sessionId
}
