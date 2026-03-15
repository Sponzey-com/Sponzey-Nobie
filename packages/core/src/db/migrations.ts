import type Database from "better-sqlite3"

export interface Migration {
  version: number
  up: (db: Database.Database) => void
}

export const MIGRATIONS: Migration[] = [
  {
    version: 1,
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS sessions (
          id        TEXT PRIMARY KEY,
          source    TEXT NOT NULL,
          source_id TEXT,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL,
          summary   TEXT,
          token_count INTEGER DEFAULT 0
        );

        CREATE TABLE IF NOT EXISTS messages (
          id          TEXT PRIMARY KEY,
          session_id  TEXT NOT NULL,
          role        TEXT NOT NULL,
          content     TEXT NOT NULL,
          tool_calls  TEXT,
          tool_call_id TEXT,
          created_at  INTEGER NOT NULL,
          FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
        );

        CREATE INDEX IF NOT EXISTS idx_messages_session
          ON messages(session_id, created_at);

        CREATE TABLE IF NOT EXISTS memory_items (
          id         TEXT PRIMARY KEY,
          content    TEXT NOT NULL,
          tags       TEXT,
          source     TEXT,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        );

        CREATE VIRTUAL TABLE IF NOT EXISTS memory_fts
          USING fts5(content, tags, content=memory_items, content_rowid=rowid);

        CREATE TABLE IF NOT EXISTS schedules (
          id              TEXT PRIMARY KEY,
          name            TEXT NOT NULL,
          cron_expression TEXT NOT NULL,
          prompt          TEXT NOT NULL,
          enabled         INTEGER DEFAULT 1,
          target_channel  TEXT DEFAULT 'telegram',
          model           TEXT,
          max_retries     INTEGER DEFAULT 3,
          timeout_sec     INTEGER DEFAULT 300,
          created_at      INTEGER NOT NULL,
          updated_at      INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS schedule_runs (
          id          TEXT PRIMARY KEY,
          schedule_id TEXT NOT NULL,
          started_at  INTEGER NOT NULL,
          finished_at INTEGER,
          success     INTEGER,
          summary     TEXT,
          error       TEXT,
          FOREIGN KEY (schedule_id) REFERENCES schedules(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS audit_logs (
          id               TEXT PRIMARY KEY,
          timestamp        INTEGER NOT NULL,
          session_id       TEXT,
          source           TEXT NOT NULL,
          tool_name        TEXT NOT NULL,
          params           TEXT,
          result           TEXT NOT NULL,
          duration_ms      INTEGER,
          approval_required INTEGER DEFAULT 0,
          approved_by      TEXT
        );

        CREATE INDEX IF NOT EXISTS idx_audit_timestamp
          ON audit_logs(timestamp DESC);
      `)
    },
  },
]

export function runMigrations(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version    INTEGER PRIMARY KEY,
      applied_at INTEGER NOT NULL
    )
  `)

  const appliedStmt = db.prepare<[], { version: number }>(
    "SELECT version FROM schema_migrations ORDER BY version",
  )
  const applied = new Set(appliedStmt.all().map((r) => r.version))

  for (const migration of MIGRATIONS) {
    if (applied.has(migration.version)) continue

    const apply = db.transaction(() => {
      migration.up(db)
      db.prepare("INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)").run(
        migration.version,
        Date.now(),
      )
    })
    apply()
  }
}
