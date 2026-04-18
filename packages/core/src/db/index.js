import { existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import BetterSqlite3 from "better-sqlite3";
import { PATHS } from "../config/index.js";
import { createPreMigrationBackupIfNeeded, runMigrations } from "./migrations.js";
import { assertMigrationWriteAllowed } from "./migration-safety.js";
import { buildDeliveryKey, buildPayloadHash, buildScheduleIdentityKey, formatContractValidationFailureForUser, toCanonicalJson, validateScheduleContract, } from "../contracts/index.js";
let _db = null;
export function getDb() {
    if (_db)
        return _db;
    mkdirSync(dirname(PATHS.dbFile), { recursive: true });
    const dbExisted = existsSync(PATHS.dbFile);
    _db = new BetterSqlite3(PATHS.dbFile);
    _db.pragma("journal_mode = WAL");
    _db.pragma("foreign_keys = ON");
    _db.pragma("synchronous = NORMAL");
    const backupSnapshotId = dbExisted
        ? createPreMigrationBackupIfNeeded(_db, PATHS.dbFile, join(PATHS.stateDir, "backups", "db"))
        : null;
    runMigrations(_db, { backupSnapshotId, lockedBy: `gateway:${process.pid}` });
    return _db;
}
export function closeDb() {
    _db?.close();
    _db = null;
}
export function insertSession(session) {
    const db = getDb();
    db.prepare(`INSERT OR REPLACE INTO sessions
     (id, source, source_id, created_at, updated_at, summary)
     VALUES (?, ?, ?, ?, ?, ?)`).run(session.id, session.source, session.source_id, session.created_at, session.updated_at, session.summary);
}
export function getSession(id) {
    return getDb()
        .prepare("SELECT * FROM sessions WHERE id = ?")
        .get(id);
}
export function insertMessage(msg) {
    getDb()
        .prepare(`INSERT INTO messages
       (id, session_id, root_run_id, role, content, tool_calls, tool_call_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(msg.id, msg.session_id, msg.root_run_id ?? null, msg.role, msg.content, msg.tool_calls, msg.tool_call_id, msg.created_at);
}
export function getMessages(sessionId) {
    return getDb()
        .prepare("SELECT * FROM messages WHERE session_id = ? ORDER BY created_at ASC")
        .all(sessionId);
}
export function getMessagesForRequestGroup(sessionId, requestGroupId) {
    return getDb()
        .prepare(`SELECT m.*
       FROM messages m
       JOIN root_runs r ON r.id = m.root_run_id
       WHERE m.session_id = ?
         AND r.request_group_id = ?
       ORDER BY m.created_at ASC`)
        .all(sessionId, requestGroupId);
}
export function getMessagesForRequestGroupWithRunMeta(sessionId, requestGroupId) {
    return getDb()
        .prepare(`SELECT m.*, r.prompt AS run_prompt, r.request_group_id AS run_request_group_id,
              r.worker_session_id AS run_worker_session_id, r.context_mode AS run_context_mode
       FROM messages m
       JOIN root_runs r ON r.id = m.root_run_id
       WHERE m.session_id = ?
         AND r.request_group_id = ?
       ORDER BY m.created_at ASC`)
        .all(sessionId, requestGroupId);
}
export function getMessagesForRun(sessionId, runId) {
    return getDb()
        .prepare(`SELECT * FROM messages
       WHERE session_id = ?
         AND root_run_id = ?
       ORDER BY created_at ASC`)
        .all(sessionId, runId);
}
export function insertAuditLog(log) {
    const id = crypto.randomUUID();
    getDb()
        .prepare(`INSERT INTO audit_logs
       (id, timestamp, session_id, run_id, request_group_id, channel, source, tool_name, params, output, result,
        duration_ms, approval_required, approved_by, error_code, retry_count, stop_reason)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(id, log.timestamp, log.session_id, log.run_id ?? null, log.request_group_id ?? null, log.channel ?? null, log.source, log.tool_name, log.params, log.output, log.result, log.duration_ms, log.approval_required, log.approved_by, log.error_code ?? null, log.retry_count ?? null, log.stop_reason ?? null);
}
export function insertChannelMessageRef(ref) {
    const id = crypto.randomUUID();
    getDb()
        .prepare(`INSERT INTO channel_message_refs
       (id, source, session_id, root_run_id, request_group_id, external_chat_id, external_thread_id, external_message_id, role, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(id, ref.source, ref.session_id, ref.root_run_id, ref.request_group_id, ref.external_chat_id, ref.external_thread_id, ref.external_message_id, ref.role, ref.created_at);
    return id;
}
export function insertDecisionTrace(input) {
    const id = input.id ?? crypto.randomUUID();
    getDb()
        .prepare(`INSERT INTO decision_traces
       (id, run_id, request_group_id, session_id, source, channel, decision_kind, reason_code,
        input_contract_ids_json, receipt_ids_json, sanitized_detail_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(id, input.runId ?? null, input.requestGroupId ?? null, input.sessionId ?? null, input.source ?? null, input.channel ?? null, input.decisionKind, input.reasonCode, input.inputContractIds ? JSON.stringify(input.inputContractIds) : null, input.receiptIds ? JSON.stringify(input.receiptIds) : null, toJsonOrNull(input.detail), input.createdAt ?? Date.now());
    return id;
}
export function insertMessageLedgerEvent(input) {
    const id = input.id ?? crypto.randomUUID();
    try {
        getDb()
            .prepare(`INSERT INTO message_ledger
         (id, run_id, request_group_id, session_key, thread_key, channel, event_kind,
          delivery_key, idempotency_key, status, summary, detail_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
            .run(id, input.runId ?? null, input.requestGroupId ?? null, input.sessionKey ?? null, input.threadKey ?? null, input.channel, input.eventKind, input.deliveryKey ?? null, input.idempotencyKey ?? null, input.status, input.summary, toJsonOrNull(input.detail), input.createdAt ?? Date.now());
        return id;
    }
    catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (message.toLowerCase().includes("unique") && message.includes("message_ledger")) {
            return null;
        }
        throw error;
    }
}
export function getMessageLedgerEventByIdempotencyKey(idempotencyKey) {
    return getDb()
        .prepare(`SELECT *
       FROM message_ledger
       WHERE idempotency_key = ?
       ORDER BY created_at DESC
       LIMIT 1`)
        .get(idempotencyKey);
}
export function insertQueueBackpressureEvent(input) {
    const id = input.id ?? crypto.randomUUID();
    getDb()
        .prepare(`INSERT INTO queue_backpressure_events
       (id, created_at, queue_name, event_kind, run_id, request_group_id, pending_count,
        retry_count, retry_budget_remaining, recovery_key, action_taken, detail_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(id, input.createdAt ?? Date.now(), input.queueName, input.eventKind, input.runId ?? null, input.requestGroupId ?? null, input.pendingCount ?? 0, input.retryCount ?? 0, input.retryBudgetRemaining ?? null, input.recoveryKey ?? null, input.actionTaken, toJsonOrNull(input.detail));
    return id;
}
export function listQueueBackpressureEvents(input = {}) {
    const conditions = [];
    const bindings = [];
    if (input.queueName) {
        conditions.push("queue_name = ?");
        bindings.push(input.queueName);
    }
    if (input.eventKind) {
        conditions.push("event_kind = ?");
        bindings.push(input.eventKind);
    }
    if (input.recoveryKey) {
        conditions.push("recovery_key = ?");
        bindings.push(input.recoveryKey);
    }
    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    const limit = Math.max(1, Math.min(500, Math.floor(input.limit ?? 100)));
    return getDb()
        .prepare(`SELECT * FROM queue_backpressure_events ${where} ORDER BY created_at DESC, id DESC LIMIT ?`)
        .all(...bindings, limit);
}
export function listMessageLedgerEvents(params = {}) {
    const where = [];
    const values = [];
    if (params.runId) {
        where.push("run_id = ?");
        values.push(params.runId);
    }
    if (params.requestGroupId) {
        where.push("request_group_id = ?");
        values.push(params.requestGroupId);
    }
    if (params.sessionKey) {
        where.push("session_key = ?");
        values.push(params.sessionKey);
    }
    if (params.threadKey) {
        where.push("thread_key = ?");
        values.push(params.threadKey);
    }
    const limit = Math.max(1, Math.min(1000, Math.floor(params.limit ?? 500)));
    values.push(limit);
    const whereSql = where.length > 0 ? `WHERE ${where.join(" AND ")}` : "";
    return getDb()
        .prepare(`SELECT *
       FROM message_ledger
       ${whereSql}
       ORDER BY created_at ASC, id ASC
       LIMIT ?`)
        .all(...values);
}
export function insertControlEvent(input) {
    const id = input.id ?? crypto.randomUUID();
    getDb()
        .prepare(`INSERT INTO control_events
       (id, created_at, event_type, correlation_id, run_id, request_group_id, session_key,
        component, severity, summary, detail_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(id, input.createdAt ?? Date.now(), input.eventType, input.correlationId, input.runId ?? null, input.requestGroupId ?? null, input.sessionKey ?? null, input.component, input.severity ?? "info", input.summary, toJsonOrNull(input.detail));
    return id;
}
export function listControlEvents(params = {}) {
    const where = [];
    const values = [];
    if (params.runId) {
        where.push("run_id = ?");
        values.push(params.runId);
    }
    if (params.requestGroupId) {
        where.push("request_group_id = ?");
        values.push(params.requestGroupId);
    }
    if (params.correlationId) {
        where.push("correlation_id = ?");
        values.push(params.correlationId);
    }
    if (params.eventType) {
        where.push("event_type = ?");
        values.push(params.eventType);
    }
    if (params.component) {
        where.push("component = ?");
        values.push(params.component);
    }
    if (params.severity) {
        where.push("severity = ?");
        values.push(params.severity);
    }
    const limit = Math.max(1, Math.min(2_000, Math.floor(params.limit ?? 500)));
    values.push(limit);
    const whereSql = where.length > 0 ? `WHERE ${where.join(" AND ")}` : "";
    return getDb()
        .prepare(`SELECT *
       FROM control_events
       ${whereSql}
       ORDER BY created_at ASC, id ASC
       LIMIT ?`)
        .all(...values);
}
export function upsertWebRetrievalCacheEntry(input) {
    getDb()
        .prepare(`INSERT INTO web_retrieval_cache
       (cache_key, target_hash, source_evidence_id, verdict_id, freshness_policy, ttl_ms,
        fetch_timestamp, created_at, expires_at, value_json, evidence_json, verdict_json, metadata_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(cache_key) DO UPDATE SET
         target_hash = excluded.target_hash,
         source_evidence_id = excluded.source_evidence_id,
         verdict_id = excluded.verdict_id,
         freshness_policy = excluded.freshness_policy,
         ttl_ms = excluded.ttl_ms,
         fetch_timestamp = excluded.fetch_timestamp,
         created_at = excluded.created_at,
         expires_at = excluded.expires_at,
         value_json = excluded.value_json,
         evidence_json = excluded.evidence_json,
         verdict_json = excluded.verdict_json,
         metadata_json = excluded.metadata_json`)
        .run(input.cacheKey, input.targetHash, input.sourceEvidenceId, input.verdictId, input.freshnessPolicy, input.ttlMs, input.fetchTimestamp, input.createdAt, input.expiresAt, JSON.stringify(input.value), JSON.stringify(input.evidence), JSON.stringify(input.verdict), toJsonOrNull(input.metadata));
}
export function getWebRetrievalCacheEntry(cacheKey) {
    return getDb()
        .prepare(`SELECT * FROM web_retrieval_cache WHERE cache_key = ? LIMIT 1`)
        .get(cacheKey);
}
export function listWebRetrievalCacheEntries(params = {}) {
    const where = [];
    const values = [];
    if (params.targetHash) {
        where.push("target_hash = ?");
        values.push(params.targetHash);
    }
    if (params.freshnessPolicy) {
        where.push("freshness_policy = ?");
        values.push(params.freshnessPolicy);
    }
    if (params.now !== undefined) {
        where.push("expires_at >= ?");
        values.push(params.now);
    }
    const limit = Math.max(1, Math.min(200, Math.floor(params.limit ?? 20)));
    values.push(limit);
    const whereSql = where.length > 0 ? `WHERE ${where.join(" AND ")}` : "";
    return getDb()
        .prepare(`SELECT * FROM web_retrieval_cache
       ${whereSql}
       ORDER BY expires_at DESC, created_at DESC
       LIMIT ?`)
        .all(...values);
}
export function findChannelMessageRef(params) {
    const withThread = params.externalThreadId
        ? getDb()
            .prepare(`SELECT *
           FROM channel_message_refs
           WHERE source = ?
             AND external_chat_id = ?
             AND external_message_id = ?
             AND (external_thread_id = ? OR external_thread_id IS NULL)
           ORDER BY created_at DESC
           LIMIT 1`)
            .get(params.source, params.externalChatId, params.externalMessageId, params.externalThreadId)
        : undefined;
    if (withThread)
        return withThread;
    return getDb()
        .prepare(`SELECT *
       FROM channel_message_refs
       WHERE source = ?
         AND external_chat_id = ?
         AND external_message_id = ?
       ORDER BY created_at DESC
       LIMIT 1`)
        .get(params.source, params.externalChatId, params.externalMessageId);
}
export function insertChannelSmokeRun(input) {
    const id = input.id ?? crypto.randomUUID();
    const startedAt = input.startedAt ?? Date.now();
    getDb()
        .prepare(`INSERT INTO channel_smoke_runs
       (id, mode, status, started_at, finished_at, scenario_count, passed_count, failed_count, skipped_count, initiated_by, summary, metadata_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(id, input.mode, input.status ?? "running", startedAt, input.finishedAt ?? null, input.scenarioCount ?? 0, input.passedCount ?? 0, input.failedCount ?? 0, input.skippedCount ?? 0, input.initiatedBy ?? null, input.summary ?? null, toJsonOrNull(input.metadata));
    return id;
}
export function updateChannelSmokeRun(id, fields) {
    const sets = [];
    const values = [];
    const push = (column, value) => {
        sets.push(`${column} = ?`);
        values.push(value);
    };
    if (fields.status !== undefined)
        push("status", fields.status);
    if (fields.finishedAt !== undefined)
        push("finished_at", fields.finishedAt);
    if (fields.scenarioCount !== undefined)
        push("scenario_count", fields.scenarioCount);
    if (fields.passedCount !== undefined)
        push("passed_count", fields.passedCount);
    if (fields.failedCount !== undefined)
        push("failed_count", fields.failedCount);
    if (fields.skippedCount !== undefined)
        push("skipped_count", fields.skippedCount);
    if (fields.summary !== undefined)
        push("summary", fields.summary);
    if (fields.metadata !== undefined)
        push("metadata_json", toJsonOrNull(fields.metadata));
    if (sets.length === 0)
        return;
    values.push(id);
    getDb().prepare(`UPDATE channel_smoke_runs SET ${sets.join(", ")} WHERE id = ?`).run(...values);
}
export function insertChannelSmokeStep(input) {
    const id = input.id ?? crypto.randomUUID();
    const startedAt = input.startedAt ?? Date.now();
    const finishedAt = input.finishedAt ?? startedAt;
    getDb()
        .prepare(`INSERT INTO channel_smoke_steps
       (id, run_id, scenario_id, channel, scenario_kind, status, reason, failures_json, trace_json, audit_log_id, started_at, finished_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(id, input.runId, input.scenarioId, input.channel, input.scenarioKind, input.status, input.reason ?? null, JSON.stringify(input.failures ?? []), input.trace ? JSON.stringify(input.trace) : null, input.auditLogId ?? null, startedAt, finishedAt);
    return id;
}
export function getChannelSmokeRun(id) {
    return getDb()
        .prepare("SELECT * FROM channel_smoke_runs WHERE id = ?")
        .get(id);
}
export function listChannelSmokeRuns(limit = 20) {
    return getDb()
        .prepare(`SELECT * FROM channel_smoke_runs
       ORDER BY started_at DESC
       LIMIT ?`)
        .all(Math.max(1, Math.min(limit, 200)));
}
export function listChannelSmokeSteps(runId) {
    return getDb()
        .prepare(`SELECT * FROM channel_smoke_steps
       WHERE run_id = ?
       ORDER BY started_at ASC, id ASC`)
        .all(runId);
}
export function upsertPromptSources(sources) {
    if (sources.length === 0)
        return;
    const now = Date.now();
    const db = getDb();
    const insert = db.prepare(`INSERT INTO prompt_sources
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
       updated_at = excluded.updated_at`);
    const tx = db.transaction(() => {
        for (const source of sources) {
            insert.run(source.sourceId, source.locale, source.path, source.version, source.priority, source.enabled ? 1 : 0, source.required ? 1 : 0, source.usageScope, source.checksum, now);
        }
    });
    tx();
}
export function updateRunPromptSourceSnapshot(runId, snapshot) {
    getDb()
        .prepare(`UPDATE root_runs SET prompt_source_snapshot = ?, updated_at = ? WHERE id = ?`)
        .run(JSON.stringify(snapshot), Date.now(), runId);
}
export function getPromptSourceStates() {
    return getDb()
        .prepare(`SELECT source_id AS sourceId, locale, enabled
       FROM prompt_sources`)
        .all()
        .map((row) => ({
        sourceId: row.sourceId,
        locale: row.locale,
        enabled: row.enabled === 1,
    }));
}
function resolveMemoryOwnerId(scope, ownerId) {
    if (scope === "global" || scope === "long-term")
        return ownerId?.trim() || "global";
    const normalized = ownerId?.trim();
    if (!normalized) {
        throw new Error(`${scope} memory requires an owner id`);
    }
    return normalized;
}
function toJsonOrNull(value) {
    return value ? JSON.stringify(value) : null;
}
export function storeMemoryDocument(input) {
    const ownerId = resolveMemoryOwnerId(input.scope, input.ownerId);
    const db = getDb();
    const now = Date.now();
    const existing = db
        .prepare(`SELECT id FROM memory_documents WHERE scope = ? AND owner_id = ? AND checksum = ? LIMIT 1`)
        .get(input.scope, ownerId, input.checksum);
    if (existing) {
        const chunks = db
            .prepare(`SELECT id FROM memory_chunks WHERE document_id = ? ORDER BY ordinal ASC`)
            .all(existing.id);
        return { documentId: existing.id, chunkIds: chunks.map((chunk) => chunk.id), deduplicated: true };
    }
    const documentId = crypto.randomUUID();
    const chunkIds = [];
    const insertDocument = db.prepare(`INSERT INTO memory_documents
     (id, scope, owner_id, source_type, source_ref, title, raw_text, checksum, metadata_json, archived_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)`);
    const insertChunk = db.prepare(`INSERT INTO memory_chunks
     (id, document_id, scope, owner_id, ordinal, token_estimate, content, checksum, source_checksum, metadata_json, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    const insertChunkFts = db.prepare(`INSERT INTO memory_chunks_fts(rowid, content, metadata_json)
     SELECT rowid, content, metadata_json FROM memory_chunks WHERE id = ?`);
    const insertIndexJob = db.prepare(`INSERT INTO memory_index_jobs (id, document_id, status, retry_count, created_at, updated_at)
     VALUES (?, ?, 'queued', 0, ?, ?)`);
    const tx = db.transaction(() => {
        insertDocument.run(documentId, input.scope, ownerId, input.sourceType, input.sourceRef ?? null, input.title ?? null, input.rawText, input.checksum, toJsonOrNull(input.metadata), now, now);
        for (const chunk of input.chunks) {
            const chunkId = crypto.randomUUID();
            chunkIds.push(chunkId);
            insertChunk.run(chunkId, documentId, input.scope, ownerId, chunk.ordinal, chunk.tokenEstimate, chunk.content, chunk.checksum, input.checksum, toJsonOrNull(chunk.metadata), now, now);
            insertChunkFts.run(chunkId);
        }
        insertIndexJob.run(crypto.randomUUID(), documentId, now, now);
    });
    tx();
    return { documentId, chunkIds, deduplicated: false };
}
export function insertMemoryEmbeddingIfMissing(input) {
    const id = crypto.randomUUID();
    getDb()
        .prepare(`INSERT OR IGNORE INTO memory_embeddings
       (id, chunk_id, provider, model, dimensions, text_checksum, vector, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(id, input.chunkId, input.provider, input.model, input.dimensions, input.textChecksum, input.vector, Date.now());
    const existing = getDb()
        .prepare(`SELECT id FROM memory_embeddings
       WHERE provider = ? AND model = ? AND dimensions = ? AND text_checksum = ?`)
        .get(input.provider, input.model, input.dimensions, input.textChecksum);
    return existing?.id ?? id;
}
export function rebuildMemorySearchIndexes() {
    getDb().exec(`
    INSERT INTO memory_fts(memory_fts) VALUES('rebuild');
    INSERT INTO memory_chunks_fts(memory_chunks_fts) VALUES('rebuild');
  `);
}
export function markMemoryIndexJobCompleted(documentId) {
    getDb()
        .prepare(`UPDATE memory_index_jobs SET status = 'embedded', updated_at = ? WHERE document_id = ?`)
        .run(Date.now(), documentId);
}
export function markMemoryIndexJobDisabled(documentId, reason) {
    getDb()
        .prepare(`UPDATE memory_index_jobs
       SET status = 'disabled', last_error = ?, updated_at = ?
       WHERE document_id = ?`)
        .run(reason, Date.now(), documentId);
}
export function markMemoryIndexJobStale(documentId, reason) {
    getDb()
        .prepare(`UPDATE memory_index_jobs
       SET status = 'stale', last_error = ?, updated_at = ?
       WHERE document_id = ? AND status != 'failed'`)
        .run(reason, Date.now(), documentId);
}
export function markMemoryIndexJobFailed(documentId, error) {
    getDb()
        .prepare(`UPDATE memory_index_jobs
       SET status = 'failed', retry_count = retry_count + 1, last_error = ?, updated_at = ?
       WHERE document_id = ?`)
        .run(error, Date.now(), documentId);
}
export function recordMemoryAccessLog(input) {
    const id = crypto.randomUUID();
    getDb()
        .prepare(`INSERT INTO memory_access_log
       (id, run_id, session_id, request_group_id, document_id, chunk_id, source_checksum, scope, query, result_source, score, latency_ms, reason, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(id, input.runId ?? null, input.sessionId ?? null, input.requestGroupId ?? null, input.documentId ?? null, input.chunkId ?? null, input.sourceChecksum ?? null, input.scope ?? null, input.query, input.resultSource, input.score ?? null, input.latencyMs ?? null, input.reason ?? null, Date.now());
    return id;
}
export function listMemoryAccessTraceForRun(runId, limit = 100) {
    const normalized = runId.trim();
    if (!normalized)
        return [];
    return getDb()
        .prepare(`SELECT id, run_id, session_id, request_group_id, document_id, chunk_id,
              source_checksum, scope, query, result_source, score, latency_ms, reason, created_at
       FROM memory_access_log
       WHERE run_id = ?
       ORDER BY created_at DESC
       LIMIT ?`)
        .all(normalized, Math.max(1, Math.min(500, Math.floor(limit))));
}
export function insertFlashFeedback(input) {
    const sessionId = input.sessionId.trim();
    if (!sessionId)
        throw new Error("flash-feedback requires a session id");
    const id = crypto.randomUUID();
    const now = Date.now();
    const ttlMs = Math.max(1, input.ttlMs ?? 30 * 60 * 1000);
    getDb()
        .prepare(`INSERT INTO flash_feedback
       (id, session_id, run_id, request_group_id, content, severity, expires_at, metadata_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(id, sessionId, input.runId ?? null, input.requestGroupId ?? null, input.content, input.severity ?? "normal", now + ttlMs, toJsonOrNull(input.metadata), now, now);
    return id;
}
export function upsertScheduleMemoryEntry(input) {
    const scheduleId = input.scheduleId.trim();
    if (!scheduleId)
        throw new Error("schedule memory requires a schedule id");
    assertMigrationWriteAllowed(getDb(), "schedule.memory.upsert");
    const id = crypto.randomUUID();
    const now = Date.now();
    getDb()
        .prepare(`INSERT INTO schedule_entries
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
         updated_at = excluded.updated_at`)
        .run(id, scheduleId, input.sessionId ?? null, input.requestGroupId ?? null, input.title ?? null, input.prompt, input.cronExpression ?? null, input.nextRunAt ?? null, input.enabled === false ? 0 : 1, toJsonOrNull(input.metadata), now, now);
    const row = getDb()
        .prepare(`SELECT id FROM schedule_entries WHERE schedule_id = ? LIMIT 1`)
        .get(scheduleId);
    return row?.id ?? id;
}
export function insertArtifactReceipt(input) {
    const id = crypto.randomUUID();
    getDb()
        .prepare(`INSERT INTO artifact_receipts
       (id, run_id, request_group_id, channel, artifact_path, mime_type, size_bytes, delivery_receipt_json, delivered_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(id, input.runId ?? null, input.requestGroupId ?? null, input.channel, input.artifactPath, input.mimeType ?? null, input.sizeBytes ?? null, toJsonOrNull(input.deliveryReceipt), input.deliveredAt ?? null, Date.now());
    return id;
}
export function hasArtifactReceipt(input) {
    const row = getDb()
        .prepare(`SELECT id FROM artifact_receipts
       WHERE run_id = ? AND channel = ? AND artifact_path = ?
       LIMIT 1`)
        .get(input.runId, input.channel, input.artifactPath);
    return Boolean(row);
}
export function insertArtifactMetadata(input) {
    const id = crypto.randomUUID();
    const now = Date.now();
    getDb()
        .prepare(`INSERT INTO artifacts
       (id, source_run_id, request_group_id, owner_channel, channel_target, artifact_path, mime_type, size_bytes,
        retention_policy, expires_at, metadata_json, created_at, updated_at, deleted_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`)
        .run(id, input.sourceRunId ?? null, input.requestGroupId ?? null, input.ownerChannel, input.channelTarget ?? null, input.artifactPath, input.mimeType ?? "application/octet-stream", input.sizeBytes ?? null, input.retentionPolicy ?? "standard", input.expiresAt ?? null, toJsonOrNull(input.metadata), input.createdAt ?? now, input.updatedAt ?? input.createdAt ?? now);
    return id;
}
export function getLatestArtifactMetadataByPath(artifactPath) {
    return getDb()
        .prepare(`SELECT * FROM artifacts
       WHERE artifact_path = ?
       ORDER BY created_at DESC
       LIMIT 1`)
        .get(artifactPath);
}
export function getArtifactMetadata(id) {
    return getDb()
        .prepare(`SELECT * FROM artifacts
       WHERE id = ?
       LIMIT 1`)
        .get(id);
}
export function listExpiredArtifactMetadata(now = Date.now()) {
    return getDb()
        .prepare(`SELECT * FROM artifacts
       WHERE expires_at IS NOT NULL
         AND expires_at <= ?
         AND deleted_at IS NULL
       ORDER BY expires_at ASC`)
        .all(now);
}
export function listActiveArtifactMetadata() {
    return getDb()
        .prepare(`SELECT * FROM artifacts
       WHERE deleted_at IS NULL
       ORDER BY created_at ASC, id ASC`)
        .all();
}
export function markArtifactDeleted(id, deletedAt = Date.now()) {
    getDb()
        .prepare(`UPDATE artifacts SET deleted_at = ?, updated_at = ? WHERE id = ?`)
        .run(deletedAt, deletedAt, id);
}
export function insertDiagnosticEvent(input) {
    const id = crypto.randomUUID();
    getDb()
        .prepare(`INSERT INTO diagnostic_events
       (id, run_id, session_id, request_group_id, recovery_key, kind, summary, detail_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(id, input.runId ?? null, input.sessionId ?? null, input.requestGroupId ?? null, input.recoveryKey ?? null, input.kind, input.summary, toJsonOrNull(input.detail), Date.now());
    return id;
}
export function enqueueMemoryWritebackCandidate(input) {
    const ownerId = resolveMemoryOwnerId(input.scope, input.ownerId);
    const id = crypto.randomUUID();
    const now = Date.now();
    const status = input.status ?? "pending";
    getDb()
        .prepare(`INSERT INTO memory_writeback_queue
       (id, scope, owner_id, source_type, content, metadata_json, status, retry_count, last_error, run_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?)`)
        .run(id, input.scope, ownerId, input.sourceType, input.content, toJsonOrNull(input.metadata), status, input.lastError ?? null, input.runId ?? null, now, now);
    return id;
}
export function listMemoryWritebackCandidates(input = {}) {
    const status = input.status ?? "pending";
    const limit = Math.max(1, Math.min(500, Math.floor(input.limit ?? 100)));
    if (status === "all") {
        return getDb()
            .prepare(`SELECT * FROM memory_writeback_queue ORDER BY updated_at DESC LIMIT ?`)
            .all(limit);
    }
    return getDb()
        .prepare(`SELECT * FROM memory_writeback_queue WHERE status = ? ORDER BY updated_at DESC LIMIT ?`)
        .all(status, limit);
}
export function getMemoryWritebackCandidate(id) {
    return getDb()
        .prepare(`SELECT * FROM memory_writeback_queue WHERE id = ? LIMIT 1`)
        .get(id);
}
export function updateMemoryWritebackCandidate(input) {
    const current = getMemoryWritebackCandidate(input.id);
    if (!current)
        return undefined;
    const nextContent = input.content ?? current.content;
    const nextMetadata = input.metadata !== undefined ? toJsonOrNull(input.metadata) : current.metadata_json;
    const nextLastError = Object.prototype.hasOwnProperty.call(input, "lastError") ? input.lastError ?? null : current.last_error;
    getDb()
        .prepare(`UPDATE memory_writeback_queue
       SET status = ?, content = ?, metadata_json = ?, last_error = ?, updated_at = ?
       WHERE id = ?`)
        .run(input.status, nextContent, nextMetadata, nextLastError, Date.now(), input.id);
    return getMemoryWritebackCandidate(input.id);
}
export function upsertSessionSnapshot(input) {
    const id = crypto.randomUUID();
    const now = Date.now();
    getDb()
        .prepare(`INSERT INTO session_snapshots
       (id, session_id, snapshot_version, summary, preserved_facts, active_task_ids, created_at, updated_at)
       VALUES (?, ?, 1, ?, ?, ?, ?, ?)
       ON CONFLICT(session_id, snapshot_version) DO UPDATE SET
         summary = excluded.summary,
         preserved_facts = excluded.preserved_facts,
         active_task_ids = excluded.active_task_ids,
         updated_at = excluded.updated_at`)
        .run(id, input.sessionId, input.summary, JSON.stringify(input.preservedFacts ?? []), JSON.stringify(input.activeTaskIds ?? []), now, now);
    const row = getDb()
        .prepare(`SELECT id FROM session_snapshots WHERE session_id = ? AND snapshot_version = 1 LIMIT 1`)
        .get(input.sessionId);
    return row?.id ?? id;
}
export function upsertTaskContinuity(input) {
    const hasField = (key) => Object.prototype.hasOwnProperty.call(input, key);
    getDb()
        .prepare(`INSERT INTO task_continuity
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
         updated_at = excluded.updated_at`)
        .run(input.lineageRootRunId, input.parentRunId ?? null, input.handoffSummary ?? null, input.lastGoodState ?? null, hasField("pendingApprovals") ? JSON.stringify(input.pendingApprovals ?? []) : null, hasField("pendingDelivery") ? JSON.stringify(input.pendingDelivery ?? []) : null, input.lastToolReceipt ?? null, input.lastDeliveryReceipt ?? null, input.failedRecoveryKey ?? null, input.failureKind ?? null, input.recoveryBudget ?? null, input.status ?? null, Date.now());
}
function parseContinuityStringArray(value) {
    if (!value)
        return [];
    try {
        const parsed = JSON.parse(value);
        return Array.isArray(parsed)
            ? parsed.filter((item) => typeof item === "string" && item.trim().length > 0)
            : [];
    }
    catch {
        return [];
    }
}
function mapTaskContinuity(row) {
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
    };
}
export function getTaskContinuity(lineageRootRunId) {
    const row = getDb()
        .prepare(`SELECT * FROM task_continuity WHERE lineage_root_run_id = ?`)
        .get(lineageRootRunId);
    return row ? mapTaskContinuity(row) : undefined;
}
export function listTaskContinuityForLineages(lineageRootRunIds) {
    const ids = [...new Set(lineageRootRunIds.filter((value) => value.trim().length > 0))];
    if (ids.length === 0)
        return [];
    const placeholders = ids.map(() => "?").join(", ");
    return getDb()
        .prepare(`SELECT * FROM task_continuity WHERE lineage_root_run_id IN (${placeholders})`)
        .all(...ids)
        .map(mapTaskContinuity);
}
export function insertMemoryItem(item) {
    if ((item.scope === "session" || item.scope === "short-term" || item.scope === "flash-feedback") && !item.sessionId) {
        throw new Error(`${item.scope} memory requires a session id`);
    }
    if (item.scope === "task" && !item.runId && !item.requestGroupId) {
        throw new Error("task memory requires a runId or requestGroupId");
    }
    if (item.scope === "schedule" && !item.requestGroupId) {
        throw new Error("schedule memory requires a schedule id");
    }
    const id = crypto.randomUUID();
    const now = Date.now();
    const db = getDb();
    db.prepare(`INSERT INTO memory_items (id, content, tags, source, memory_scope, session_id, run_id, request_group_id, type, importance, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(id, item.content, JSON.stringify(item.tags ?? []), "agent", item.scope ?? "global", item.sessionId ?? null, item.runId ?? null, item.requestGroupId ?? null, item.type ?? "user_fact", item.importance ?? "medium", now, now);
    // Sync into FTS index
    db.prepare(`INSERT INTO memory_fts(rowid, content, tags)
     SELECT rowid, content, tags FROM memory_items WHERE id = ?`).run(id);
    return id;
}
function buildMemoryScopeWhere(filters, alias = "m") {
    const prefix = alias ? `${alias}.` : "";
    const clauses = [`${prefix}memory_scope = 'global'`, `${prefix}memory_scope = 'long-term'`, `${prefix}memory_scope IS NULL`, `${prefix}memory_scope = ''`];
    const values = [];
    if (filters?.sessionId) {
        clauses.push(`(${prefix}memory_scope IN ('session', 'short-term', 'flash-feedback') AND ${prefix}session_id = ?)`);
        values.push(filters.sessionId);
    }
    const taskOwners = [filters?.requestGroupId, filters?.runId].filter((value) => Boolean(value));
    if (taskOwners.length > 0) {
        const placeholders = taskOwners.map(() => "?").join(", ");
        clauses.push(`(${prefix}memory_scope = 'task' AND (${prefix}request_group_id IN (${placeholders}) OR ${prefix}run_id IN (${placeholders})))`);
        values.push(...taskOwners, ...taskOwners);
    }
    if (filters?.includeSchedule && filters.scheduleId) {
        clauses.push(`(${prefix}memory_scope = 'schedule' AND ${prefix}request_group_id = ?)`);
        values.push(filters.scheduleId);
    }
    return {
        clause: `(${clauses.join(" OR ")})`,
        values,
    };
}
function sanitizeMemoryFtsQuery(query) {
    const terms = query
        .normalize("NFKC")
        .match(/[\p{L}\p{N}_]+/gu)
        ?.map((term) => term.trim())
        .filter(Boolean)
        .slice(0, 12) ?? [];
    return terms.length > 0 ? terms.map((term) => `"${term.replace(/"/g, '""')}"`).join(" OR ") : null;
}
function escapeMemoryLike(query) {
    return query.replace(/[\\%_]/g, (match) => `\\${match}`);
}
export function searchMemoryItems(query, limit = 5, filters) {
    const scope = buildMemoryScopeWhere(filters);
    const sanitized = sanitizeMemoryFtsQuery(query);
    if (sanitized) {
        try {
            return getDb()
                .prepare(`SELECT m.* FROM memory_fts f
           JOIN memory_items m ON m.rowid = f.rowid
           WHERE memory_fts MATCH ?
             AND ${scope.clause}
           ORDER BY rank
           LIMIT ?`)
                .all(sanitized, ...scope.values, limit);
        }
        catch {
            // Fall through to LIKE search when MATCH rejects special input or the FTS table is unavailable.
        }
    }
    const likeScope = buildMemoryScopeWhere(filters, "");
    const pattern = `%${escapeMemoryLike(query.normalize("NFKC").trim())}%`;
    return getDb()
        .prepare(`SELECT * FROM memory_items
       WHERE content LIKE ? ESCAPE '\\'
         AND ${likeScope.clause}
       ORDER BY updated_at DESC
       LIMIT ?`)
        .all(pattern, ...likeScope.values, limit);
}
export function getRecentMemoryItems(limit = 10, filters) {
    const scope = buildMemoryScopeWhere(filters, "");
    return getDb()
        .prepare(`SELECT * FROM memory_items
       WHERE ${scope.clause}
       ORDER BY updated_at DESC LIMIT ?`)
        .all(...scope.values, limit);
}
export function markMessagesCompressed(ids, summaryId) {
    if (!ids.length)
        return;
    const db = getDb();
    const update = db.prepare("UPDATE messages SET compressed = 1, summary_id = ? WHERE id = ?");
    const tx = db.transaction(() => {
        for (const id of ids)
            update.run(summaryId, id);
    });
    tx();
}
export function getSchedules() {
    return getDb()
        .prepare(`SELECT s.*,
        (SELECT r.started_at FROM schedule_runs r WHERE r.schedule_id = s.id ORDER BY r.started_at DESC LIMIT 1) AS last_run_at,
        CASE WHEN s.contract_json IS NULL OR s.contract_schema_version IS NULL THEN 1 ELSE 0 END AS legacy
       FROM schedules s ORDER BY s.created_at DESC`)
        .all();
}
export function getSchedule(id) {
    return getDb()
        .prepare(`SELECT s.*,
        (SELECT r.started_at FROM schedule_runs r WHERE r.schedule_id = s.id ORDER BY r.started_at DESC LIMIT 1) AS last_run_at,
        CASE WHEN s.contract_json IS NULL OR s.contract_schema_version IS NULL THEN 1 ELSE 0 END AS legacy
       FROM schedules s WHERE s.id = ?`)
        .get(id);
}
export function getSchedulesForSession(sessionId, enabledOnly = false) {
    const enabledClause = enabledOnly ? "AND s.enabled = 1" : "";
    return getDb()
        .prepare(`SELECT s.*,
        (SELECT r.started_at FROM schedule_runs r WHERE r.schedule_id = s.id ORDER BY r.started_at DESC LIMIT 1) AS last_run_at,
        CASE WHEN s.contract_json IS NULL OR s.contract_schema_version IS NULL THEN 1 ELSE 0 END AS legacy
       FROM schedules s
       WHERE s.target_session_id = ?
       ${enabledClause}
       ORDER BY s.created_at DESC`)
        .all(sessionId);
}
export function prepareScheduleContractPersistence(contract) {
    const validation = validateScheduleContract(contract);
    if (!validation.ok) {
        throw new Error(formatContractValidationFailureForUser(validation.issues));
    }
    return {
        contract_json: toCanonicalJson(contract),
        identity_key: buildScheduleIdentityKey(contract),
        payload_hash: buildPayloadHash(contract.payload),
        delivery_key: buildDeliveryKey(contract.delivery),
        contract_schema_version: contract.schemaVersion,
    };
}
export function isLegacySchedule(schedule) {
    return !schedule.contract_json || schedule.contract_schema_version == null;
}
export function insertSchedule(s) {
    assertMigrationWriteAllowed(getDb(), "schedule.insert");
    const contractFields = s.contract
        ? prepareScheduleContractPersistence(s.contract)
        : {
            contract_json: s.contract_json ?? null,
            identity_key: s.identity_key ?? null,
            payload_hash: s.payload_hash ?? null,
            delivery_key: s.delivery_key ?? null,
            contract_schema_version: s.contract_schema_version ?? null,
        };
    getDb()
        .prepare(`INSERT INTO schedules (id, name, cron_expression, timezone, prompt, enabled, target_channel, target_session_id, execution_driver, origin_run_id, origin_request_group_id, model, max_retries, timeout_sec, contract_json, identity_key, payload_hash, delivery_key, contract_schema_version, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(s.id, s.name, s.cron_expression, s.timezone ?? null, s.prompt, s.enabled, s.target_channel, s.target_session_id, s.execution_driver, s.origin_run_id, s.origin_request_group_id, s.model, s.max_retries, s.timeout_sec, contractFields.contract_json, contractFields.identity_key, contractFields.payload_hash, contractFields.delivery_key, contractFields.contract_schema_version, s.created_at, s.updated_at);
}
export function updateSchedule(id, fields) {
    assertMigrationWriteAllowed(getDb(), "schedule.update");
    const sets = [];
    const vals = [];
    for (const [k, v] of Object.entries(fields)) {
        sets.push(`${k} = ?`);
        vals.push(v);
    }
    if (!sets.length)
        return;
    vals.push(Date.now(), id);
    getDb().prepare(`UPDATE schedules SET ${sets.join(", ")}, updated_at = ? WHERE id = ?`).run(...vals);
}
export function deleteSchedule(id) {
    assertMigrationWriteAllowed(getDb(), "schedule.delete");
    getDb().prepare("DELETE FROM schedules WHERE id = ?").run(id);
}
export function getScheduleRuns(scheduleId, limit, offset) {
    return getDb()
        .prepare("SELECT * FROM schedule_runs WHERE schedule_id = ? ORDER BY started_at DESC LIMIT ? OFFSET ?")
        .all(scheduleId, limit, offset);
}
export function listUnfinishedScheduleRuns(limit = 200) {
    return getDb()
        .prepare(`SELECT * FROM schedule_runs
       WHERE finished_at IS NULL OR success IS NULL
       ORDER BY started_at DESC
       LIMIT ?`)
        .all(Math.max(1, Math.min(1000, Math.floor(limit))));
}
export function interruptUnfinishedScheduleRunsOnStartup(input = {}) {
    const rows = listUnfinishedScheduleRuns(input.limit ?? 200);
    if (!rows.length)
        return [];
    const finishedAt = input.finishedAt ?? Date.now();
    const error = input.error ?? "Interrupted by daemon restart; not retried automatically.";
    const update = getDb().prepare(`UPDATE schedule_runs
     SET finished_at = ?, success = 0, error = COALESCE(error, ?)
     WHERE id = ? AND (finished_at IS NULL OR success IS NULL)`);
    const tx = getDb().transaction(() => {
        for (const row of rows)
            update.run(finishedAt, error, row.id);
    });
    tx();
    return rows;
}
export function countScheduleRuns(scheduleId) {
    return getDb()
        .prepare("SELECT COUNT(*) as n FROM schedule_runs WHERE schedule_id = ?")
        .get(scheduleId).n;
}
export function insertScheduleRun(r) {
    getDb()
        .prepare(`INSERT INTO schedule_runs (id, schedule_id, started_at, finished_at, success, summary, error)
       VALUES (?, ?, ?, ?, ?, ?, ?)`)
        .run(r.id, r.schedule_id, r.started_at, r.finished_at, r.success, r.summary, r.error);
}
export function updateScheduleRun(id, fields) {
    const sets = [];
    const vals = [];
    for (const [k, v] of Object.entries(fields)) {
        sets.push(`${k} = ?`);
        vals.push(v);
    }
    if (!sets.length)
        return;
    vals.push(id);
    getDb().prepare(`UPDATE schedule_runs SET ${sets.join(", ")} WHERE id = ?`).run(...vals);
}
export function getScheduleDeliveryReceipt(dedupeKey) {
    return getDb()
        .prepare("SELECT * FROM schedule_delivery_receipts WHERE dedupe_key = ?")
        .get(dedupeKey);
}
export function insertScheduleDeliveryReceipt(input) {
    const now = Date.now();
    const createdAt = input.created_at ?? now;
    const updatedAt = input.updated_at ?? now;
    getDb()
        .prepare(`INSERT INTO schedule_delivery_receipts
       (dedupe_key, schedule_id, schedule_run_id, due_at, target_channel, target_session_id, payload_hash, delivery_status, summary, error, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(dedupe_key) DO UPDATE SET
         schedule_run_id = excluded.schedule_run_id,
         delivery_status = excluded.delivery_status,
         summary = excluded.summary,
         error = excluded.error,
         updated_at = excluded.updated_at`)
        .run(input.dedupe_key, input.schedule_id, input.schedule_run_id, input.due_at, input.target_channel, input.target_session_id, input.payload_hash, input.delivery_status, input.summary, input.error, createdAt, updatedAt);
}
export function getScheduleStats(scheduleId) {
    const row = getDb()
        .prepare(`SELECT
         COUNT(*) as total,
         SUM(CASE WHEN success = 1 THEN 1 ELSE 0 END) as successes,
         SUM(CASE WHEN success = 0 THEN 1 ELSE 0 END) as failures,
         AVG(CASE WHEN finished_at IS NOT NULL THEN finished_at - started_at END) as avg_ms,
         MAX(started_at) as last_run
       FROM schedule_runs WHERE schedule_id = ?`)
        .get(scheduleId);
    return {
        total: row?.total ?? 0,
        successes: row?.successes ?? 0,
        failures: row?.failures ?? 0,
        avgDurationMs: row?.avg_ms ? Math.round(row.avg_ms) : null,
        lastRunAt: row?.last_run ?? null,
    };
}
//# sourceMappingURL=index.js.map