import { randomUUID } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { beginMigrationLock, ensureMigrationSafetyTables, failMigrationLock, getActiveMigrationLock, releaseMigrationLock, updateMigrationLockPhase, verifyMigrationState, } from "./migration-safety.js";
const MEMORY_SCOPE_SQL = "'global', 'session', 'task', 'artifact', 'diagnostic', 'long-term', 'short-term', 'schedule', 'flash-feedback'";
function rebuildMemoryScopeTables(db) {
    db.exec(`
    PRAGMA foreign_keys = OFF;
    PRAGMA defer_foreign_keys = ON;

    DROP TABLE IF EXISTS memory_chunks_fts;

    CREATE TABLE IF NOT EXISTS memory_documents_v18 (
      id TEXT PRIMARY KEY,
      scope TEXT NOT NULL CHECK(scope IN (${MEMORY_SCOPE_SQL})),
      owner_id TEXT NOT NULL,
      source_type TEXT NOT NULL,
      source_ref TEXT,
      title TEXT,
      raw_text TEXT NOT NULL,
      checksum TEXT NOT NULL,
      metadata_json TEXT,
      archived_at INTEGER,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    INSERT INTO memory_documents_v18
      (id, scope, owner_id, source_type, source_ref, title, raw_text, checksum, metadata_json, archived_at, created_at, updated_at)
    SELECT id, scope, owner_id, source_type, source_ref, title, raw_text, checksum, metadata_json, archived_at, created_at, updated_at
    FROM memory_documents;

    CREATE TABLE IF NOT EXISTS memory_chunks_v18 (
      id TEXT PRIMARY KEY,
      document_id TEXT NOT NULL,
      scope TEXT NOT NULL CHECK(scope IN (${MEMORY_SCOPE_SQL})),
      owner_id TEXT NOT NULL,
      ordinal INTEGER NOT NULL,
      token_estimate INTEGER NOT NULL,
      content TEXT NOT NULL,
      checksum TEXT NOT NULL,
      metadata_json TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY (document_id) REFERENCES memory_documents(id) ON DELETE CASCADE
    );

    INSERT INTO memory_chunks_v18
      (id, document_id, scope, owner_id, ordinal, token_estimate, content, checksum, metadata_json, created_at, updated_at)
    SELECT id, document_id, scope, owner_id, ordinal, token_estimate, content, checksum, metadata_json, created_at, updated_at
    FROM memory_chunks;

    DROP TABLE memory_chunks;
    DROP TABLE memory_documents;
    ALTER TABLE memory_documents_v18 RENAME TO memory_documents;
    ALTER TABLE memory_chunks_v18 RENAME TO memory_chunks;

    CREATE UNIQUE INDEX IF NOT EXISTS idx_memory_documents_scope_owner_checksum
      ON memory_documents(scope, owner_id, checksum);

    CREATE INDEX IF NOT EXISTS idx_memory_documents_scope_owner
      ON memory_documents(scope, owner_id, updated_at DESC);

    CREATE UNIQUE INDEX IF NOT EXISTS idx_memory_chunks_document_ordinal
      ON memory_chunks(document_id, ordinal);

    CREATE INDEX IF NOT EXISTS idx_memory_chunks_scope_owner
      ON memory_chunks(scope, owner_id, updated_at DESC);

    CREATE INDEX IF NOT EXISTS idx_memory_chunks_checksum
      ON memory_chunks(checksum);

    CREATE VIRTUAL TABLE IF NOT EXISTS memory_chunks_fts
      USING fts5(content, metadata_json, content='memory_chunks', content_rowid='rowid');

    INSERT INTO memory_chunks_fts(memory_chunks_fts) VALUES('rebuild');

    CREATE TABLE IF NOT EXISTS memory_writeback_queue_v18 (
      id TEXT PRIMARY KEY,
      scope TEXT NOT NULL CHECK(scope IN (${MEMORY_SCOPE_SQL})),
      owner_id TEXT NOT NULL,
      source_type TEXT NOT NULL,
      content TEXT NOT NULL,
      metadata_json TEXT,
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'writing', 'failed', 'completed', 'discarded')),
      retry_count INTEGER NOT NULL DEFAULT 0,
      last_error TEXT,
      run_id TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    INSERT INTO memory_writeback_queue_v18
      (id, scope, owner_id, source_type, content, metadata_json, status, retry_count, last_error, run_id, created_at, updated_at)
    SELECT id, scope, owner_id, source_type, content, metadata_json, status, retry_count, last_error, run_id, created_at, updated_at
    FROM memory_writeback_queue;

    DROP TABLE memory_writeback_queue;
    ALTER TABLE memory_writeback_queue_v18 RENAME TO memory_writeback_queue;

    CREATE INDEX IF NOT EXISTS idx_memory_writeback_queue_status
      ON memory_writeback_queue(status, updated_at ASC);

    PRAGMA foreign_keys = ON;
  `);
}
export const MIGRATIONS = [
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
          timezone        TEXT,
          prompt          TEXT NOT NULL,
          enabled         INTEGER DEFAULT 1,
          target_channel  TEXT DEFAULT 'telegram',
          execution_driver TEXT DEFAULT 'internal',
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
      `);
        },
    },
    {
        version: 2,
        up(db) {
            // Add output column to audit_logs for tool result storage
            db.exec(`ALTER TABLE audit_logs ADD COLUMN output TEXT`);
        },
    },
    {
        version: 3,
        up(db) {
            // Context compression tracking on messages
            db.exec(`ALTER TABLE messages ADD COLUMN compressed INTEGER DEFAULT 0`);
            db.exec(`ALTER TABLE messages ADD COLUMN summary_id TEXT`);
            // Extend memory_items with session/type/importance/embedding columns
            db.exec(`ALTER TABLE memory_items ADD COLUMN session_id TEXT`);
            db.exec(`ALTER TABLE memory_items ADD COLUMN type TEXT DEFAULT 'user_fact'`);
            db.exec(`ALTER TABLE memory_items ADD COLUMN importance TEXT DEFAULT 'medium'`);
            db.exec(`ALTER TABLE memory_items ADD COLUMN embedding BLOB`);
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
      `);
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
      `);
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
      `);
            const messageColumns = db.prepare(`PRAGMA table_info(messages)`).all();
            if (!messageColumns.some((column) => column.name === "root_run_id")) {
                db.exec(`ALTER TABLE messages ADD COLUMN root_run_id TEXT`);
            }
            db.exec(`CREATE INDEX IF NOT EXISTS idx_messages_root_run ON messages(root_run_id, created_at)`);
        },
    },
    {
        version: 6,
        up(db) {
            const rootRunColumns = db.prepare(`PRAGMA table_info(root_runs)`).all();
            if (!rootRunColumns.some((column) => column.name === "request_group_id")) {
                db.exec(`ALTER TABLE root_runs ADD COLUMN request_group_id TEXT`);
            }
            db.exec(`UPDATE root_runs SET request_group_id = id WHERE request_group_id IS NULL OR request_group_id = ''`);
            db.exec(`CREATE INDEX IF NOT EXISTS idx_root_runs_request_group ON root_runs(request_group_id, updated_at DESC)`);
        },
    },
    {
        version: 7,
        up(db) {
            const rootRunColumns = db.prepare(`PRAGMA table_info(root_runs)`).all();
            if (!rootRunColumns.some((column) => column.name === "target_label")) {
                db.exec(`ALTER TABLE root_runs ADD COLUMN target_label TEXT`);
            }
            if (!rootRunColumns.some((column) => column.name === "worker_runtime_kind")) {
                db.exec(`ALTER TABLE root_runs ADD COLUMN worker_runtime_kind TEXT`);
            }
            if (!rootRunColumns.some((column) => column.name === "worker_session_id")) {
                db.exec(`ALTER TABLE root_runs ADD COLUMN worker_session_id TEXT`);
            }
            if (!rootRunColumns.some((column) => column.name === "context_mode")) {
                db.exec(`ALTER TABLE root_runs ADD COLUMN context_mode TEXT`);
            }
            db.exec(`UPDATE root_runs SET context_mode = 'full' WHERE context_mode IS NULL OR context_mode = ''`);
            db.exec(`CREATE INDEX IF NOT EXISTS idx_root_runs_worker_session ON root_runs(worker_session_id, updated_at DESC)`);
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
      `);
        },
    },
    {
        version: 9,
        up(db) {
            const scheduleColumns = db.prepare(`PRAGMA table_info(schedules)`).all();
            if (!scheduleColumns.some((column) => column.name === "target_session_id")) {
                db.exec(`ALTER TABLE schedules ADD COLUMN target_session_id TEXT`);
            }
        },
    },
    {
        version: 10,
        up(db) {
            const scheduleColumns = db.prepare(`PRAGMA table_info(schedules)`).all();
            if (!scheduleColumns.some((column) => column.name === "execution_driver")) {
                db.exec(`ALTER TABLE schedules ADD COLUMN execution_driver TEXT DEFAULT 'internal'`);
            }
            db.exec(`UPDATE schedules SET execution_driver = 'internal' WHERE execution_driver IS NULL OR execution_driver = ''`);
        },
    },
    {
        version: 11,
        up(db) {
            const scheduleColumns = db.prepare(`PRAGMA table_info(schedules)`).all();
            if (!scheduleColumns.some((column) => column.name === "origin_run_id")) {
                db.exec(`ALTER TABLE schedules ADD COLUMN origin_run_id TEXT`);
            }
            if (!scheduleColumns.some((column) => column.name === "origin_request_group_id")) {
                db.exec(`ALTER TABLE schedules ADD COLUMN origin_request_group_id TEXT`);
            }
        },
    },
    {
        version: 12,
        up(db) {
            const rootRunColumns = db.prepare(`PRAGMA table_info(root_runs)`).all();
            if (!rootRunColumns.some((column) => column.name === "lineage_root_run_id")) {
                db.exec(`ALTER TABLE root_runs ADD COLUMN lineage_root_run_id TEXT`);
            }
            if (!rootRunColumns.some((column) => column.name === "parent_run_id")) {
                db.exec(`ALTER TABLE root_runs ADD COLUMN parent_run_id TEXT`);
            }
            if (!rootRunColumns.some((column) => column.name === "run_scope")) {
                db.exec(`ALTER TABLE root_runs ADD COLUMN run_scope TEXT`);
            }
            if (!rootRunColumns.some((column) => column.name === "handoff_summary")) {
                db.exec(`ALTER TABLE root_runs ADD COLUMN handoff_summary TEXT`);
            }
            db.exec(`UPDATE root_runs SET lineage_root_run_id = request_group_id WHERE lineage_root_run_id IS NULL OR lineage_root_run_id = ''`);
            db.exec(`UPDATE root_runs SET run_scope = 'root' WHERE run_scope IS NULL OR run_scope = ''`);
            db.exec(`CREATE INDEX IF NOT EXISTS idx_root_runs_lineage_root ON root_runs(lineage_root_run_id, updated_at DESC)`);
            const memoryColumns = db.prepare(`PRAGMA table_info(memory_items)`).all();
            if (!memoryColumns.some((column) => column.name === "memory_scope")) {
                db.exec(`ALTER TABLE memory_items ADD COLUMN memory_scope TEXT`);
            }
            if (!memoryColumns.some((column) => column.name === "run_id")) {
                db.exec(`ALTER TABLE memory_items ADD COLUMN run_id TEXT`);
            }
            if (!memoryColumns.some((column) => column.name === "request_group_id")) {
                db.exec(`ALTER TABLE memory_items ADD COLUMN request_group_id TEXT`);
            }
            db.exec(`
        UPDATE memory_items
        SET memory_scope = CASE
          WHEN session_id IS NULL OR session_id = '' THEN 'global'
          ELSE 'session'
        END
        WHERE memory_scope IS NULL OR memory_scope = ''
      `);
            db.exec(`CREATE INDEX IF NOT EXISTS idx_memory_items_scope_updated ON memory_items(memory_scope, updated_at DESC)`);
            db.exec(`CREATE INDEX IF NOT EXISTS idx_memory_items_run_scope ON memory_items(run_id, memory_scope, updated_at DESC)`);
        },
    },
    {
        version: 13,
        up(db) {
            db.exec(`
        CREATE TABLE IF NOT EXISTS prompt_sources (
          source_id TEXT NOT NULL,
          locale TEXT NOT NULL,
          path TEXT NOT NULL,
          version TEXT NOT NULL,
          priority INTEGER NOT NULL,
          enabled INTEGER NOT NULL DEFAULT 1,
          is_required INTEGER NOT NULL DEFAULT 0,
          usage_scope TEXT NOT NULL,
          checksum TEXT NOT NULL,
          updated_at INTEGER NOT NULL,
          PRIMARY KEY (source_id, locale)
        );

        CREATE INDEX IF NOT EXISTS idx_prompt_sources_usage_priority
          ON prompt_sources(usage_scope, priority, source_id, locale);
      `);
            const rootRunColumns = db.prepare(`PRAGMA table_info(root_runs)`).all();
            if (!rootRunColumns.some((column) => column.name === "prompt_source_snapshot")) {
                db.exec(`ALTER TABLE root_runs ADD COLUMN prompt_source_snapshot TEXT`);
            }
        },
    },
    {
        version: 14,
        up(db) {
            db.exec(`
        CREATE TABLE IF NOT EXISTS memory_documents (
          id TEXT PRIMARY KEY,
          scope TEXT NOT NULL CHECK(scope IN ('global', 'session', 'task', 'artifact', 'diagnostic')),
          owner_id TEXT NOT NULL,
          source_type TEXT NOT NULL,
          source_ref TEXT,
          title TEXT,
          raw_text TEXT NOT NULL,
          checksum TEXT NOT NULL,
          metadata_json TEXT,
          archived_at INTEGER,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        );

        CREATE UNIQUE INDEX IF NOT EXISTS idx_memory_documents_scope_owner_checksum
          ON memory_documents(scope, owner_id, checksum);

        CREATE INDEX IF NOT EXISTS idx_memory_documents_scope_owner
          ON memory_documents(scope, owner_id, updated_at DESC);

        CREATE TABLE IF NOT EXISTS memory_chunks (
          id TEXT PRIMARY KEY,
          document_id TEXT NOT NULL,
          scope TEXT NOT NULL CHECK(scope IN ('global', 'session', 'task', 'artifact', 'diagnostic')),
          owner_id TEXT NOT NULL,
          ordinal INTEGER NOT NULL,
          token_estimate INTEGER NOT NULL,
          content TEXT NOT NULL,
          checksum TEXT NOT NULL,
          metadata_json TEXT,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL,
          FOREIGN KEY (document_id) REFERENCES memory_documents(id) ON DELETE CASCADE
        );

        CREATE UNIQUE INDEX IF NOT EXISTS idx_memory_chunks_document_ordinal
          ON memory_chunks(document_id, ordinal);

        CREATE INDEX IF NOT EXISTS idx_memory_chunks_scope_owner
          ON memory_chunks(scope, owner_id, updated_at DESC);

        CREATE INDEX IF NOT EXISTS idx_memory_chunks_checksum
          ON memory_chunks(checksum);

        CREATE VIRTUAL TABLE IF NOT EXISTS memory_chunks_fts
          USING fts5(content, metadata_json, content='memory_chunks', content_rowid='rowid');

        CREATE TABLE IF NOT EXISTS memory_embeddings (
          id TEXT PRIMARY KEY,
          chunk_id TEXT NOT NULL,
          provider TEXT NOT NULL,
          model TEXT NOT NULL,
          dimensions INTEGER NOT NULL,
          text_checksum TEXT NOT NULL,
          vector BLOB NOT NULL,
          created_at INTEGER NOT NULL,
          FOREIGN KEY (chunk_id) REFERENCES memory_chunks(id) ON DELETE CASCADE,
          UNIQUE(provider, model, dimensions, text_checksum)
        );

        CREATE INDEX IF NOT EXISTS idx_memory_embeddings_chunk
          ON memory_embeddings(chunk_id);

        CREATE TABLE IF NOT EXISTS memory_index_jobs (
          id TEXT PRIMARY KEY,
          document_id TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'indexing', 'failed', 'completed')),
          retry_count INTEGER NOT NULL DEFAULT 0,
          last_error TEXT,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL,
          FOREIGN KEY (document_id) REFERENCES memory_documents(id) ON DELETE CASCADE
        );

        CREATE INDEX IF NOT EXISTS idx_memory_index_jobs_status
          ON memory_index_jobs(status, updated_at ASC);

        CREATE TABLE IF NOT EXISTS memory_access_log (
          id TEXT PRIMARY KEY,
          run_id TEXT,
          session_id TEXT,
          request_group_id TEXT,
          document_id TEXT,
          chunk_id TEXT,
          query TEXT NOT NULL,
          result_source TEXT NOT NULL,
          score REAL,
          latency_ms INTEGER,
          created_at INTEGER NOT NULL,
          FOREIGN KEY (document_id) REFERENCES memory_documents(id) ON DELETE SET NULL,
          FOREIGN KEY (chunk_id) REFERENCES memory_chunks(id) ON DELETE SET NULL
        );

        CREATE INDEX IF NOT EXISTS idx_memory_access_log_run
          ON memory_access_log(run_id, created_at DESC);

        CREATE TABLE IF NOT EXISTS memory_writeback_queue (
          id TEXT PRIMARY KEY,
          scope TEXT NOT NULL CHECK(scope IN ('global', 'session', 'task', 'artifact', 'diagnostic')),
          owner_id TEXT NOT NULL,
          source_type TEXT NOT NULL,
          content TEXT NOT NULL,
          metadata_json TEXT,
          status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'writing', 'failed', 'completed', 'discarded')),
          retry_count INTEGER NOT NULL DEFAULT 0,
          last_error TEXT,
          run_id TEXT,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_memory_writeback_queue_status
          ON memory_writeback_queue(status, updated_at ASC);

        CREATE TABLE IF NOT EXISTS session_snapshots (
          id TEXT PRIMARY KEY,
          session_id TEXT NOT NULL,
          snapshot_version INTEGER NOT NULL,
          summary TEXT NOT NULL,
          preserved_facts TEXT,
          active_task_ids TEXT,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_session_snapshots_session
          ON session_snapshots(session_id, updated_at DESC);

        CREATE UNIQUE INDEX IF NOT EXISTS idx_session_snapshots_session_version
          ON session_snapshots(session_id, snapshot_version);

        CREATE TABLE IF NOT EXISTS task_continuity (
          lineage_root_run_id TEXT PRIMARY KEY,
          parent_run_id TEXT,
          handoff_summary TEXT,
          last_good_state TEXT,
          pending_approvals TEXT,
          pending_delivery TEXT,
          updated_at INTEGER NOT NULL
        );
      `);
        },
    },
    {
        version: 15,
        up(db) {
            db.exec(`
        DROP INDEX IF EXISTS idx_memory_documents_checksum;

        CREATE UNIQUE INDEX IF NOT EXISTS idx_memory_documents_scope_owner_checksum
          ON memory_documents(scope, owner_id, checksum);
      `);
        },
    },
    {
        version: 16,
        up(db) {
            db.exec(`
        CREATE UNIQUE INDEX IF NOT EXISTS idx_session_snapshots_session_version
          ON session_snapshots(session_id, snapshot_version);
      `);
        },
    },
    {
        version: 17,
        up(db) {
            const continuityColumns = db.prepare(`PRAGMA table_info(task_continuity)`).all();
            if (!continuityColumns.some((column) => column.name === "last_tool_receipt")) {
                db.exec(`ALTER TABLE task_continuity ADD COLUMN last_tool_receipt TEXT`);
            }
            if (!continuityColumns.some((column) => column.name === "last_delivery_receipt")) {
                db.exec(`ALTER TABLE task_continuity ADD COLUMN last_delivery_receipt TEXT`);
            }
            if (!continuityColumns.some((column) => column.name === "failed_recovery_key")) {
                db.exec(`ALTER TABLE task_continuity ADD COLUMN failed_recovery_key TEXT`);
            }
            if (!continuityColumns.some((column) => column.name === "failure_kind")) {
                db.exec(`ALTER TABLE task_continuity ADD COLUMN failure_kind TEXT`);
            }
            if (!continuityColumns.some((column) => column.name === "recovery_budget")) {
                db.exec(`ALTER TABLE task_continuity ADD COLUMN recovery_budget TEXT`);
            }
            if (!continuityColumns.some((column) => column.name === "continuity_status")) {
                db.exec(`ALTER TABLE task_continuity ADD COLUMN continuity_status TEXT`);
            }
        },
    },
    {
        version: 18,
        transaction: false,
        up(db) {
            rebuildMemoryScopeTables(db);
            db.exec(`
        CREATE TABLE IF NOT EXISTS flash_feedback (
          id TEXT PRIMARY KEY,
          session_id TEXT NOT NULL,
          run_id TEXT,
          request_group_id TEXT,
          content TEXT NOT NULL,
          severity TEXT NOT NULL DEFAULT 'normal' CHECK(severity IN ('low', 'normal', 'high')),
          expires_at INTEGER NOT NULL,
          metadata_json TEXT,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_flash_feedback_session_expires
          ON flash_feedback(session_id, expires_at DESC);

        CREATE TABLE IF NOT EXISTS schedule_entries (
          id TEXT PRIMARY KEY,
          schedule_id TEXT NOT NULL UNIQUE,
          session_id TEXT,
          request_group_id TEXT,
          title TEXT,
          prompt TEXT NOT NULL,
          cron_expression TEXT,
          next_run_at INTEGER,
          enabled INTEGER NOT NULL DEFAULT 1,
          metadata_json TEXT,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_schedule_entries_enabled_next_run
          ON schedule_entries(enabled, next_run_at ASC);

        CREATE TABLE IF NOT EXISTS artifact_receipts (
          id TEXT PRIMARY KEY,
          run_id TEXT,
          request_group_id TEXT,
          channel TEXT NOT NULL,
          artifact_path TEXT NOT NULL,
          mime_type TEXT,
          size_bytes INTEGER,
          delivery_receipt_json TEXT,
          delivered_at INTEGER,
          created_at INTEGER NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_artifact_receipts_run
          ON artifact_receipts(run_id, created_at DESC);

        CREATE INDEX IF NOT EXISTS idx_artifact_receipts_request_group
          ON artifact_receipts(request_group_id, created_at DESC);

        CREATE TABLE IF NOT EXISTS diagnostic_events (
          id TEXT PRIMARY KEY,
          run_id TEXT,
          session_id TEXT,
          request_group_id TEXT,
          recovery_key TEXT,
          kind TEXT NOT NULL,
          summary TEXT NOT NULL,
          detail_json TEXT,
          created_at INTEGER NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_diagnostic_events_run
          ON diagnostic_events(run_id, created_at DESC);

        CREATE INDEX IF NOT EXISTS idx_diagnostic_events_recovery_key
          ON diagnostic_events(recovery_key, created_at DESC);
      `);
        },
    },
    {
        version: 19,
        up(db) {
            const scheduleColumns = db.prepare(`PRAGMA table_info(schedules)`).all();
            if (!scheduleColumns.some((column) => column.name === "timezone")) {
                db.exec(`ALTER TABLE schedules ADD COLUMN timezone TEXT`);
            }
        },
    },
    {
        version: 20,
        up(db) {
            db.exec(`
        CREATE TABLE IF NOT EXISTS artifacts (
          id TEXT PRIMARY KEY,
          source_run_id TEXT,
          request_group_id TEXT,
          owner_channel TEXT NOT NULL,
          channel_target TEXT,
          artifact_path TEXT NOT NULL,
          mime_type TEXT NOT NULL,
          size_bytes INTEGER,
          retention_policy TEXT NOT NULL DEFAULT 'standard' CHECK(retention_policy IN ('ephemeral', 'standard', 'permanent')),
          expires_at INTEGER,
          metadata_json TEXT,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL,
          deleted_at INTEGER
        );

        CREATE INDEX IF NOT EXISTS idx_artifacts_source_run
          ON artifacts(source_run_id, created_at DESC);

        CREATE INDEX IF NOT EXISTS idx_artifacts_request_group
          ON artifacts(request_group_id, created_at DESC);

        CREATE INDEX IF NOT EXISTS idx_artifacts_path
          ON artifacts(artifact_path, created_at DESC);

        CREATE INDEX IF NOT EXISTS idx_artifacts_expiry
          ON artifacts(expires_at, deleted_at);
      `);
        },
    },
    {
        version: 21,
        up(db) {
            const auditColumns = db.prepare(`PRAGMA table_info(audit_logs)`).all();
            if (!auditColumns.some((column) => column.name === "run_id")) {
                db.exec(`ALTER TABLE audit_logs ADD COLUMN run_id TEXT`);
            }
            if (!auditColumns.some((column) => column.name === "request_group_id")) {
                db.exec(`ALTER TABLE audit_logs ADD COLUMN request_group_id TEXT`);
            }
            if (!auditColumns.some((column) => column.name === "channel")) {
                db.exec(`ALTER TABLE audit_logs ADD COLUMN channel TEXT`);
            }
            if (!auditColumns.some((column) => column.name === "error_code")) {
                db.exec(`ALTER TABLE audit_logs ADD COLUMN error_code TEXT`);
            }
            if (!auditColumns.some((column) => column.name === "retry_count")) {
                db.exec(`ALTER TABLE audit_logs ADD COLUMN retry_count INTEGER`);
            }
            if (!auditColumns.some((column) => column.name === "stop_reason")) {
                db.exec(`ALTER TABLE audit_logs ADD COLUMN stop_reason TEXT`);
            }
            db.exec(`
        CREATE INDEX IF NOT EXISTS idx_audit_run
          ON audit_logs(run_id, timestamp DESC);

        CREATE INDEX IF NOT EXISTS idx_audit_request_group
          ON audit_logs(request_group_id, timestamp DESC);

        CREATE INDEX IF NOT EXISTS idx_audit_channel
          ON audit_logs(channel, timestamp DESC);
      `);
        },
    },
    {
        version: 22,
        up(db) {
            const scheduleColumns = db.prepare(`PRAGMA table_info(schedules)`).all();
            const hasColumn = (name) => scheduleColumns.some((column) => column.name === name);
            if (!hasColumn("contract_json")) {
                db.exec(`ALTER TABLE schedules ADD COLUMN contract_json TEXT`);
            }
            if (!hasColumn("identity_key")) {
                db.exec(`ALTER TABLE schedules ADD COLUMN identity_key TEXT`);
            }
            if (!hasColumn("payload_hash")) {
                db.exec(`ALTER TABLE schedules ADD COLUMN payload_hash TEXT`);
            }
            if (!hasColumn("delivery_key")) {
                db.exec(`ALTER TABLE schedules ADD COLUMN delivery_key TEXT`);
            }
            if (!hasColumn("contract_schema_version")) {
                db.exec(`ALTER TABLE schedules ADD COLUMN contract_schema_version INTEGER`);
            }
            db.exec(`
        CREATE INDEX IF NOT EXISTS idx_schedules_identity_key
          ON schedules(identity_key);

        CREATE INDEX IF NOT EXISTS idx_schedules_payload_hash
          ON schedules(payload_hash);

        CREATE INDEX IF NOT EXISTS idx_schedules_delivery_key
          ON schedules(delivery_key);
      `);
        },
    },
    {
        version: 23,
        up(db) {
            const scheduleRunsTable = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'schedule_runs'").get();
            if (scheduleRunsTable) {
                const scheduleRunColumns = db.prepare(`PRAGMA table_info(schedule_runs)`).all();
                const hasRunColumn = (name) => scheduleRunColumns.some((column) => column.name === name);
                if (!hasRunColumn("execution_success")) {
                    db.exec(`ALTER TABLE schedule_runs ADD COLUMN execution_success INTEGER`);
                }
                if (!hasRunColumn("delivery_success")) {
                    db.exec(`ALTER TABLE schedule_runs ADD COLUMN delivery_success INTEGER`);
                }
                if (!hasRunColumn("delivery_dedupe_key")) {
                    db.exec(`ALTER TABLE schedule_runs ADD COLUMN delivery_dedupe_key TEXT`);
                }
                if (!hasRunColumn("delivery_error")) {
                    db.exec(`ALTER TABLE schedule_runs ADD COLUMN delivery_error TEXT`);
                }
            }
            db.exec(`
        CREATE TABLE IF NOT EXISTS schedule_delivery_receipts (
          dedupe_key TEXT PRIMARY KEY,
          schedule_id TEXT NOT NULL,
          schedule_run_id TEXT NOT NULL,
          due_at TEXT NOT NULL,
          target_channel TEXT NOT NULL,
          target_session_id TEXT,
          payload_hash TEXT NOT NULL,
          delivery_status TEXT NOT NULL CHECK(delivery_status IN ('delivered', 'failed', 'skipped')),
          summary TEXT,
          error TEXT,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL,
          FOREIGN KEY (schedule_id) REFERENCES schedules(id) ON DELETE CASCADE,
          FOREIGN KEY (schedule_run_id) REFERENCES schedule_runs(id) ON DELETE CASCADE
        );

        CREATE INDEX IF NOT EXISTS idx_schedule_delivery_receipts_schedule_due
          ON schedule_delivery_receipts(schedule_id, due_at);

        CREATE INDEX IF NOT EXISTS idx_schedule_delivery_receipts_run
          ON schedule_delivery_receipts(schedule_run_id);
      `);
        },
    },
    {
        version: 24,
        up(db) {
            db.exec(`
        CREATE TABLE IF NOT EXISTS channel_smoke_runs (
          id TEXT PRIMARY KEY,
          mode TEXT NOT NULL CHECK(mode IN ('dry-run', 'live-run')),
          status TEXT NOT NULL CHECK(status IN ('running', 'passed', 'failed', 'skipped')),
          started_at INTEGER NOT NULL,
          finished_at INTEGER,
          scenario_count INTEGER NOT NULL DEFAULT 0,
          passed_count INTEGER NOT NULL DEFAULT 0,
          failed_count INTEGER NOT NULL DEFAULT 0,
          skipped_count INTEGER NOT NULL DEFAULT 0,
          initiated_by TEXT,
          summary TEXT,
          metadata_json TEXT
        );

        CREATE TABLE IF NOT EXISTS channel_smoke_steps (
          id TEXT PRIMARY KEY,
          run_id TEXT NOT NULL,
          scenario_id TEXT NOT NULL,
          channel TEXT NOT NULL CHECK(channel IN ('webui', 'telegram', 'slack')),
          scenario_kind TEXT NOT NULL,
          status TEXT NOT NULL CHECK(status IN ('passed', 'failed', 'skipped')),
          reason TEXT,
          failures_json TEXT NOT NULL DEFAULT '[]',
          trace_json TEXT,
          audit_log_id TEXT,
          started_at INTEGER NOT NULL,
          finished_at INTEGER NOT NULL,
          FOREIGN KEY (run_id) REFERENCES channel_smoke_runs(id) ON DELETE CASCADE
        );

        CREATE INDEX IF NOT EXISTS idx_channel_smoke_runs_started
          ON channel_smoke_runs(started_at DESC);

        CREATE INDEX IF NOT EXISTS idx_channel_smoke_runs_status
          ON channel_smoke_runs(status, started_at DESC);

        CREATE INDEX IF NOT EXISTS idx_channel_smoke_steps_run
          ON channel_smoke_steps(run_id, started_at ASC);

        CREATE INDEX IF NOT EXISTS idx_channel_smoke_steps_channel
          ON channel_smoke_steps(channel, status, started_at DESC);
      `);
        },
    },
    {
        version: 25,
        up(db) {
            db.exec(`
        CREATE TABLE IF NOT EXISTS decision_traces (
          id TEXT PRIMARY KEY,
          run_id TEXT,
          request_group_id TEXT,
          session_id TEXT,
          source TEXT,
          channel TEXT,
          decision_kind TEXT NOT NULL,
          reason_code TEXT NOT NULL,
          input_contract_ids_json TEXT,
          receipt_ids_json TEXT,
          sanitized_detail_json TEXT,
          created_at INTEGER NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_decision_traces_run
          ON decision_traces(run_id, created_at DESC);

        CREATE INDEX IF NOT EXISTS idx_decision_traces_request_group
          ON decision_traces(request_group_id, created_at DESC);

        CREATE INDEX IF NOT EXISTS idx_decision_traces_kind
          ON decision_traces(decision_kind, created_at DESC);
      `);
        },
    },
    {
        version: 26,
        up(db) {
            const rootRunColumns = db.prepare(`PRAGMA table_info(root_runs)`).all();
            if (!rootRunColumns.some((column) => column.name === "runtime_manifest_id")) {
                db.exec(`ALTER TABLE root_runs ADD COLUMN runtime_manifest_id TEXT`);
            }
            db.exec(`CREATE INDEX IF NOT EXISTS idx_root_runs_runtime_manifest ON root_runs(runtime_manifest_id, updated_at DESC)`);
        },
    },
    {
        version: 27,
        up(db) {
            db.exec(`
        CREATE TABLE IF NOT EXISTS message_ledger (
          id TEXT PRIMARY KEY,
          run_id TEXT,
          request_group_id TEXT,
          session_key TEXT,
          thread_key TEXT,
          channel TEXT NOT NULL,
          event_kind TEXT NOT NULL,
          delivery_key TEXT,
          idempotency_key TEXT,
          status TEXT NOT NULL CHECK(status IN ('received', 'pending', 'started', 'generated', 'sent', 'delivered', 'succeeded', 'failed', 'skipped', 'suppressed', 'degraded')),
          summary TEXT NOT NULL,
          detail_json TEXT,
          created_at INTEGER NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_message_ledger_run
          ON message_ledger(run_id, created_at ASC);

        CREATE INDEX IF NOT EXISTS idx_message_ledger_request_group
          ON message_ledger(request_group_id, created_at ASC);

        CREATE INDEX IF NOT EXISTS idx_message_ledger_thread
          ON message_ledger(channel, session_key, thread_key, created_at ASC);

        CREATE INDEX IF NOT EXISTS idx_message_ledger_delivery
          ON message_ledger(delivery_key, created_at DESC);

        CREATE UNIQUE INDEX IF NOT EXISTS idx_message_ledger_idempotency
          ON message_ledger(idempotency_key)
          WHERE idempotency_key IS NOT NULL AND idempotency_key != '';
      `);
        },
    },
    {
        version: 28,
        up(db) {
            db.exec(`
        CREATE TABLE IF NOT EXISTS approval_registry (
          id TEXT PRIMARY KEY,
          run_id TEXT NOT NULL,
          request_group_id TEXT,
          channel TEXT NOT NULL,
          channel_message_id TEXT,
          tool_name TEXT NOT NULL,
          risk_level TEXT NOT NULL,
          kind TEXT NOT NULL CHECK(kind IN ('approval', 'screen_confirmation')),
          status TEXT NOT NULL CHECK(status IN ('requested', 'approved_once', 'approved_run', 'denied', 'expired', 'superseded', 'consumed')),
          params_hash TEXT NOT NULL,
          params_preview_json TEXT,
          requested_at INTEGER NOT NULL,
          expires_at INTEGER,
          consumed_at INTEGER,
          decision_at INTEGER,
          decision_by TEXT,
          decision_source TEXT,
          superseded_by TEXT,
          metadata_json TEXT,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_approval_registry_run_status
          ON approval_registry(run_id, status, created_at DESC);

        CREATE INDEX IF NOT EXISTS idx_approval_registry_request_group_status
          ON approval_registry(request_group_id, status, created_at DESC);

        CREATE INDEX IF NOT EXISTS idx_approval_registry_channel_message
          ON approval_registry(channel, channel_message_id, created_at DESC);

        CREATE INDEX IF NOT EXISTS idx_approval_registry_expires
          ON approval_registry(status, expires_at);
      `);
        },
    },
    {
        version: 29,
        up(db) {
            db.exec(`
        CREATE TABLE IF NOT EXISTS tool_policy_decisions (
          id TEXT PRIMARY KEY,
          run_id TEXT,
          request_group_id TEXT,
          session_id TEXT,
          channel TEXT,
          tool_name TEXT NOT NULL,
          risk_level TEXT NOT NULL,
          source_trust TEXT NOT NULL,
          approval_id TEXT,
          permission_scope TEXT NOT NULL,
          params_hash TEXT NOT NULL,
          decision TEXT NOT NULL CHECK(decision IN ('allow', 'deny')),
          reason_code TEXT NOT NULL,
          user_message TEXT,
          diagnostic_json TEXT,
          created_at INTEGER NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_tool_policy_decisions_run
          ON tool_policy_decisions(run_id, created_at DESC);

        CREATE INDEX IF NOT EXISTS idx_tool_policy_decisions_request_group
          ON tool_policy_decisions(request_group_id, created_at DESC);

        CREATE INDEX IF NOT EXISTS idx_tool_policy_decisions_tool
          ON tool_policy_decisions(tool_name, decision, created_at DESC);
      `);
        },
    },
    {
        version: 30,
        up(db) {
            db.exec(`
        CREATE TABLE IF NOT EXISTS queue_backpressure_events (
          id TEXT PRIMARY KEY,
          created_at INTEGER NOT NULL,
          queue_name TEXT NOT NULL,
          event_kind TEXT NOT NULL,
          run_id TEXT,
          request_group_id TEXT,
          pending_count INTEGER NOT NULL DEFAULT 0,
          retry_count INTEGER NOT NULL DEFAULT 0,
          retry_budget_remaining INTEGER,
          recovery_key TEXT,
          action_taken TEXT NOT NULL,
          detail_json TEXT
        );

        CREATE INDEX IF NOT EXISTS idx_queue_backpressure_events_queue
          ON queue_backpressure_events(queue_name, created_at DESC);

        CREATE INDEX IF NOT EXISTS idx_queue_backpressure_events_run
          ON queue_backpressure_events(run_id, created_at DESC);

        CREATE INDEX IF NOT EXISTS idx_queue_backpressure_events_request_group
          ON queue_backpressure_events(request_group_id, created_at DESC);

        CREATE INDEX IF NOT EXISTS idx_queue_backpressure_events_recovery_key
          ON queue_backpressure_events(recovery_key, created_at DESC);
      `);
        },
    },
    {
        version: 31,
        up(db) {
            const tableColumns = (table) => new Set(db.prepare(`PRAGMA table_info(${table})`).all().map((column) => column.name));
            const chunkColumns = tableColumns("memory_chunks");
            if (!chunkColumns.has("source_checksum")) {
                db.exec(`ALTER TABLE memory_chunks ADD COLUMN source_checksum TEXT`);
            }
            db.exec(`
        UPDATE memory_chunks
        SET source_checksum = (
          SELECT checksum FROM memory_documents d WHERE d.id = memory_chunks.document_id
        )
        WHERE source_checksum IS NULL OR source_checksum = '';

        CREATE INDEX IF NOT EXISTS idx_memory_chunks_source_checksum
          ON memory_chunks(source_checksum);
      `);
            const accessColumns = tableColumns("memory_access_log");
            if (!accessColumns.has("source_checksum")) {
                db.exec(`ALTER TABLE memory_access_log ADD COLUMN source_checksum TEXT`);
            }
            if (!accessColumns.has("scope")) {
                db.exec(`ALTER TABLE memory_access_log ADD COLUMN scope TEXT`);
            }
            if (!accessColumns.has("reason")) {
                db.exec(`ALTER TABLE memory_access_log ADD COLUMN reason TEXT`);
            }
            db.exec(`
        CREATE INDEX IF NOT EXISTS idx_memory_access_log_scope
          ON memory_access_log(scope, created_at DESC);
      `);
            db.exec(`
        PRAGMA foreign_keys = OFF;

        CREATE TABLE IF NOT EXISTS memory_index_jobs_v31 (
          id TEXT PRIMARY KEY,
          document_id TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'queued' CHECK(status IN ('queued', 'indexing', 'embedded', 'failed', 'stale', 'disabled')),
          retry_count INTEGER NOT NULL DEFAULT 0,
          last_error TEXT,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL,
          FOREIGN KEY (document_id) REFERENCES memory_documents(id) ON DELETE CASCADE
        );

        INSERT INTO memory_index_jobs_v31
          (id, document_id, status, retry_count, last_error, created_at, updated_at)
        SELECT
          id,
          document_id,
          CASE status
            WHEN 'pending' THEN 'queued'
            WHEN 'completed' THEN 'embedded'
            ELSE status
          END AS status,
          retry_count,
          last_error,
          created_at,
          updated_at
        FROM memory_index_jobs;

        DROP TABLE memory_index_jobs;
        ALTER TABLE memory_index_jobs_v31 RENAME TO memory_index_jobs;

        CREATE INDEX IF NOT EXISTS idx_memory_index_jobs_status
          ON memory_index_jobs(status, updated_at ASC);
        CREATE INDEX IF NOT EXISTS idx_memory_index_jobs_document
          ON memory_index_jobs(document_id, updated_at DESC);

        PRAGMA foreign_keys = ON;
      `);
        },
    },
    {
        version: 32,
        up(db) {
            db.exec(`
        CREATE TABLE IF NOT EXISTS control_events (
          id TEXT PRIMARY KEY,
          created_at INTEGER NOT NULL,
          event_type TEXT NOT NULL,
          correlation_id TEXT NOT NULL,
          run_id TEXT,
          request_group_id TEXT,
          session_key TEXT,
          component TEXT NOT NULL,
          severity TEXT NOT NULL CHECK(severity IN ('debug', 'info', 'warning', 'error')),
          summary TEXT NOT NULL,
          detail_json TEXT
        );

        CREATE INDEX IF NOT EXISTS idx_control_events_request_group
          ON control_events(request_group_id, created_at ASC);

        CREATE INDEX IF NOT EXISTS idx_control_events_run
          ON control_events(run_id, created_at ASC);

        CREATE INDEX IF NOT EXISTS idx_control_events_correlation
          ON control_events(correlation_id, created_at ASC);

        CREATE INDEX IF NOT EXISTS idx_control_events_type
          ON control_events(event_type, created_at DESC);

        CREATE INDEX IF NOT EXISTS idx_control_events_created
          ON control_events(created_at DESC);
      `);
        },
    },
    {
        version: 33,
        up(db) {
            db.exec(`
        CREATE TABLE IF NOT EXISTS migration_locks (
          id TEXT PRIMARY KEY,
          status TEXT NOT NULL CHECK(status IN ('active', 'released', 'failed')),
          locked_by TEXT NOT NULL,
          phase TEXT NOT NULL CHECK(phase IN ('preflight', 'backup', 'lock', 'apply', 'verify', 'unlock', 'failed')),
          started_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL,
          released_at INTEGER,
          backup_snapshot_id TEXT,
          pending_versions_json TEXT,
          verify_report_json TEXT,
          error_message TEXT,
          rollback_runbook_ref TEXT
        );

        CREATE INDEX IF NOT EXISTS idx_migration_locks_status
          ON migration_locks(status, updated_at DESC);

        CREATE TABLE IF NOT EXISTS runtime_feature_flags (
          feature_key TEXT PRIMARY KEY,
          mode TEXT NOT NULL CHECK(mode IN ('off', 'shadow', 'dual_write', 'enforced', 'rollback')),
          compatibility_mode INTEGER NOT NULL DEFAULT 1,
          updated_at INTEGER NOT NULL,
          updated_by TEXT,
          reason TEXT,
          evidence_json TEXT
        );

        CREATE INDEX IF NOT EXISTS idx_runtime_feature_flags_mode
          ON runtime_feature_flags(mode, updated_at DESC);

        CREATE TABLE IF NOT EXISTS rollout_shadow_compares (
          id TEXT PRIMARY KEY,
          created_at INTEGER NOT NULL,
          feature_key TEXT NOT NULL,
          target_kind TEXT NOT NULL,
          target_id TEXT,
          run_id TEXT,
          request_group_id TEXT,
          old_hash TEXT NOT NULL,
          new_hash TEXT NOT NULL,
          match INTEGER NOT NULL,
          summary TEXT NOT NULL,
          detail_json TEXT
        );

        CREATE INDEX IF NOT EXISTS idx_rollout_shadow_compares_feature
          ON rollout_shadow_compares(feature_key, created_at DESC);

        CREATE INDEX IF NOT EXISTS idx_rollout_shadow_compares_run
          ON rollout_shadow_compares(run_id, created_at DESC);

        CREATE INDEX IF NOT EXISTS idx_rollout_shadow_compares_request_group
          ON rollout_shadow_compares(request_group_id, created_at DESC);

        CREATE TABLE IF NOT EXISTS rollout_evidence (
          id TEXT PRIMARY KEY,
          created_at INTEGER NOT NULL,
          feature_key TEXT NOT NULL,
          mode TEXT NOT NULL CHECK(mode IN ('off', 'shadow', 'dual_write', 'enforced', 'rollback')),
          stage TEXT NOT NULL,
          status TEXT NOT NULL CHECK(status IN ('ok', 'warning', 'blocked')),
          run_id TEXT,
          request_group_id TEXT,
          summary TEXT NOT NULL,
          detail_json TEXT
        );

        CREATE INDEX IF NOT EXISTS idx_rollout_evidence_feature
          ON rollout_evidence(feature_key, created_at DESC);

        CREATE INDEX IF NOT EXISTS idx_rollout_evidence_status
          ON rollout_evidence(status, created_at DESC);
      `);
        },
    },
];
function schemaMigrationsTableExists(db) {
    return Boolean(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'schema_migrations'").get());
}
export function getAppliedMigrationVersions(db) {
    if (!schemaMigrationsTableExists(db))
        return [];
    return db.prepare("SELECT version FROM schema_migrations ORDER BY version").all().map((row) => row.version);
}
export function getPendingMigrationVersions(db) {
    const applied = new Set(getAppliedMigrationVersions(db));
    return MIGRATIONS.filter((migration) => !applied.has(migration.version)).map((migration) => migration.version);
}
export function createPreMigrationBackupIfNeeded(db, dbPath, backupDir) {
    if (!existsSync(dbPath))
        return null;
    const pendingVersions = getPendingMigrationVersions(db);
    if (pendingVersions.length === 0)
        return null;
    mkdirSync(backupDir, { recursive: true });
    try {
        db.pragma("wal_checkpoint(TRUNCATE)");
    }
    catch {
        // A copy backup is still better than entering migration without any restore point.
    }
    const latestPending = pendingVersions[pendingVersions.length - 1];
    const backupPath = join(backupDir, `pre-migration-v${pendingVersions[0]}-to-v${latestPending}-${Date.now()}.sqlite3`);
    copyFileSync(dbPath, backupPath);
    for (const suffix of ["-wal", "-shm"]) {
        const sidecar = `${dbPath}${suffix}`;
        if (existsSync(sidecar))
            copyFileSync(sidecar, `${backupPath}${suffix}`);
    }
    return backupPath;
}
export function runMigrations(db, options = {}) {
    ensureMigrationSafetyTables(db);
    db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version    INTEGER PRIMARY KEY,
      applied_at INTEGER NOT NULL
    )
  `);
    const appliedStmt = db.prepare("SELECT version FROM schema_migrations ORDER BY version");
    const applied = new Set(appliedStmt.all().map((r) => r.version));
    const pendingMigrations = MIGRATIONS.filter((migration) => !applied.has(migration.version));
    if (pendingMigrations.length === 0)
        return;
    const activeLock = getActiveMigrationLock(db);
    if (activeLock)
        return;
    const lock = beginMigrationLock(db, {
        id: `migration-${Date.now()}-${randomUUID().slice(0, 8)}`,
        pendingVersions: pendingMigrations.map((migration) => migration.version),
        backupSnapshotId: options.backupSnapshotId ?? null,
        ...(options.lockedBy ? { lockedBy: options.lockedBy } : {}),
    });
    try {
        updateMigrationLockPhase(db, lock.id, "apply");
        for (const migration of pendingMigrations) {
            if (applied.has(migration.version))
                continue;
            if (migration.transaction === false) {
                migration.up(db);
                db.prepare("INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)").run(migration.version, Date.now());
                continue;
            }
            const apply = db.transaction(() => {
                migration.up(db);
                db.prepare("INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)").run(migration.version, Date.now());
            });
            apply();
        }
        updateMigrationLockPhase(db, lock.id, "verify");
        const verifyReport = verifyMigrationState(db);
        if (!verifyReport.ok) {
            throw new Error(`Migration verify failed: missing tables=${verifyReport.missingTables.join(",")}; missing indexes=${verifyReport.missingIndexes.join(",")}; integrity=${verifyReport.integrityCheck}`);
        }
        releaseMigrationLock(db, { lockId: lock.id, verifyReport });
    }
    catch (error) {
        let verifyReport = null;
        try {
            verifyReport = verifyMigrationState(db);
        }
        catch {
            verifyReport = null;
        }
        failMigrationLock(db, {
            lockId: lock.id,
            error: error instanceof Error ? error.message : String(error),
            verifyReport,
        });
        throw error;
    }
}
//# sourceMappingURL=migrations.js.map