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
  {
    version: 2,
    up(db) {
      // Add output column to audit_logs for tool result storage
      db.exec(`ALTER TABLE audit_logs ADD COLUMN output TEXT`)
    },
  },
  {
    version: 3,
    up(db) {
      // Context compression tracking on messages
      db.exec(`ALTER TABLE messages ADD COLUMN compressed INTEGER DEFAULT 0`)
      db.exec(`ALTER TABLE messages ADD COLUMN summary_id TEXT`)
      // Extend memory_items with session/type/importance/embedding columns
      db.exec(`ALTER TABLE memory_items ADD COLUMN session_id TEXT`)
      db.exec(`ALTER TABLE memory_items ADD COLUMN type TEXT DEFAULT 'user_fact'`)
      db.exec(`ALTER TABLE memory_items ADD COLUMN importance TEXT DEFAULT 'medium'`)
      db.exec(`ALTER TABLE memory_items ADD COLUMN embedding BLOB`)
    },
  },
  {
    version: 4,
    up(db) {
      // File indexing tables for semantic search
      db.exec(`
        CREATE TABLE IF NOT EXISTS file_chunks (
          id          TEXT PRIMARY KEY,
          file_path   TEXT NOT NULL,
          chunk_index INTEGER NOT NULL,
          content     TEXT NOT NULL,
          embedding   BLOB,
          mtime       REAL NOT NULL,
          indexed_at  INTEGER NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_file_chunks_path
          ON file_chunks(file_path);

        CREATE VIRTUAL TABLE IF NOT EXISTS file_chunks_fts
          USING fts5(content, content=file_chunks, content_rowid=rowid);
      `)

      // Plugin registry table
      db.exec(`
        CREATE TABLE IF NOT EXISTS plugins (
          id           TEXT PRIMARY KEY,
          name         TEXT NOT NULL UNIQUE,
          version      TEXT NOT NULL,
          description  TEXT,
          entry_path   TEXT NOT NULL,
          enabled      INTEGER DEFAULT 1,
          config       TEXT DEFAULT '{}',
          installed_at INTEGER NOT NULL,
          updated_at   INTEGER NOT NULL
        );
      `)
    },
  },
  {
    version: 5,
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS root_runs (
          id TEXT PRIMARY KEY,
          session_id TEXT NOT NULL,
          title TEXT NOT NULL,
          prompt TEXT NOT NULL,
          source TEXT NOT NULL,
          status TEXT NOT NULL,
          task_profile TEXT NOT NULL,
          target_id TEXT,
          delegation_turn_count INTEGER DEFAULT 0,
          max_delegation_turns INTEGER DEFAULT 5,
          current_step_key TEXT NOT NULL,
          current_step_index INTEGER NOT NULL,
          total_steps INTEGER NOT NULL,
          summary TEXT NOT NULL,
          can_cancel INTEGER DEFAULT 1,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL,
          FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
        );

        CREATE INDEX IF NOT EXISTS idx_root_runs_updated_at
          ON root_runs(updated_at DESC);

        CREATE TABLE IF NOT EXISTS run_steps (
          id TEXT PRIMARY KEY,
          run_id TEXT NOT NULL,
          step_key TEXT NOT NULL,
          title TEXT NOT NULL,
          step_index INTEGER NOT NULL,
          status TEXT NOT NULL,
          summary TEXT NOT NULL,
          started_at INTEGER,
          finished_at INTEGER,
          FOREIGN KEY (run_id) REFERENCES root_runs(id) ON DELETE CASCADE
        );

        CREATE UNIQUE INDEX IF NOT EXISTS idx_run_steps_run_key
          ON run_steps(run_id, step_key);

        CREATE TABLE IF NOT EXISTS run_events (
          id TEXT PRIMARY KEY,
          run_id TEXT NOT NULL,
          at INTEGER NOT NULL,
          label TEXT NOT NULL,
          FOREIGN KEY (run_id) REFERENCES root_runs(id) ON DELETE CASCADE
        );

        CREATE INDEX IF NOT EXISTS idx_run_events_run_at
          ON run_events(run_id, at DESC);
      `)

      const messageColumns = db.prepare(`PRAGMA table_info(messages)`).all() as Array<{ name: string }>
      if (!messageColumns.some((column) => column.name === "root_run_id")) {
        db.exec(`ALTER TABLE messages ADD COLUMN root_run_id TEXT`)
      }
      db.exec(`CREATE INDEX IF NOT EXISTS idx_messages_root_run ON messages(root_run_id, created_at)`)
    },
  },
  {
    version: 6,
    up(db) {
      const rootRunColumns = db.prepare(`PRAGMA table_info(root_runs)`).all() as Array<{ name: string }>
      if (!rootRunColumns.some((column) => column.name === "request_group_id")) {
        db.exec(`ALTER TABLE root_runs ADD COLUMN request_group_id TEXT`)
      }
      db.exec(`UPDATE root_runs SET request_group_id = id WHERE request_group_id IS NULL OR request_group_id = ''`)
      db.exec(`CREATE INDEX IF NOT EXISTS idx_root_runs_request_group ON root_runs(request_group_id, updated_at DESC)`)
    },
  },
  {
    version: 7,
    up(db) {
      const rootRunColumns = db.prepare(`PRAGMA table_info(root_runs)`).all() as Array<{ name: string }>
      if (!rootRunColumns.some((column) => column.name === "target_label")) {
        db.exec(`ALTER TABLE root_runs ADD COLUMN target_label TEXT`)
      }
      if (!rootRunColumns.some((column) => column.name === "worker_runtime_kind")) {
        db.exec(`ALTER TABLE root_runs ADD COLUMN worker_runtime_kind TEXT`)
      }
      if (!rootRunColumns.some((column) => column.name === "worker_session_id")) {
        db.exec(`ALTER TABLE root_runs ADD COLUMN worker_session_id TEXT`)
      }
      if (!rootRunColumns.some((column) => column.name === "context_mode")) {
        db.exec(`ALTER TABLE root_runs ADD COLUMN context_mode TEXT`)
      }
      db.exec(`UPDATE root_runs SET context_mode = 'full' WHERE context_mode IS NULL OR context_mode = ''`)
      db.exec(`CREATE INDEX IF NOT EXISTS idx_root_runs_worker_session ON root_runs(worker_session_id, updated_at DESC)`)
    },
  },
  {
    version: 8,
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS channel_message_refs (
          id TEXT PRIMARY KEY,
          source TEXT NOT NULL,
          session_id TEXT NOT NULL,
          root_run_id TEXT NOT NULL,
          request_group_id TEXT NOT NULL,
          external_chat_id TEXT NOT NULL,
          external_thread_id TEXT,
          external_message_id TEXT NOT NULL,
          role TEXT NOT NULL,
          created_at INTEGER NOT NULL
        );

        CREATE UNIQUE INDEX IF NOT EXISTS idx_channel_message_refs_source_chat_message
          ON channel_message_refs(source, external_chat_id, external_message_id);

        CREATE INDEX IF NOT EXISTS idx_channel_message_refs_request_group
          ON channel_message_refs(request_group_id, created_at DESC);
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
