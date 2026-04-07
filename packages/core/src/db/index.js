import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import BetterSqlite3 from "better-sqlite3";
import { PATHS } from "../config/index.js";
import { runMigrations } from "./migrations.js";
let _db = null;
export function getDb() {
    if (_db)
        return _db;
    mkdirSync(dirname(PATHS.dbFile), { recursive: true });
    _db = new BetterSqlite3(PATHS.dbFile);
    _db.pragma("journal_mode = WAL");
    _db.pragma("foreign_keys = ON");
    _db.pragma("synchronous = NORMAL");
    runMigrations(_db);
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
function buildMemoryScopeWhere(filters) {
    const clauses = [
        "memory_scope = 'global'",
        "memory_scope IS NULL",
        "memory_scope = ''",
    ];
    const values = [];
    if (filters?.sessionId) {
        clauses.push("(memory_scope = 'session' AND session_id = ?)");
        values.push(filters.sessionId);
    }
    if (filters?.runId) {
        clauses.push("(memory_scope = 'task' AND run_id = ?)");
        values.push(filters.runId);
    }
    return { whereSql: `(${clauses.join(" OR ")})`, values };
}
export function insertAuditLog(log) {
    const id = crypto.randomUUID();
    getDb()
        .prepare(`INSERT INTO audit_logs
       (id, timestamp, session_id, source, tool_name, params, output, result,
        duration_ms, approval_required, approved_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(id, log.timestamp, log.session_id, log.source, log.tool_name, log.params, log.output, log.result, log.duration_ms, log.approval_required, log.approved_by);
}
export function insertMemoryItem(item) {
    const id = crypto.randomUUID();
    const now = Date.now();
    const db = getDb();
    db.prepare(`INSERT INTO memory_items
      (id, content, tags, source, memory_scope, session_id, run_id, request_group_id, type, importance, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(id, item.content, JSON.stringify(item.tags ?? []), "agent", item.scope ?? (item.runId ? "task" : item.sessionId ? "session" : "global"), item.sessionId ?? null, item.runId ?? null, item.requestGroupId ?? null, item.type ?? "user_fact", item.importance ?? "medium", now, now);
    // Sync into FTS index
    db.prepare(`INSERT INTO memory_fts(rowid, content, tags)
     SELECT rowid, content, tags FROM memory_items WHERE id = ?`).run(id);
    return id;
}
export function searchMemoryItems(query, limit = 5, filters) {
    const scopeFilter = buildMemoryScopeWhere(filters);
    return getDb()
        .prepare(`SELECT m.* FROM memory_fts f
       JOIN memory_items m ON m.rowid = f.rowid
       WHERE memory_fts MATCH ?
         AND ${scopeFilter.whereSql}
       ORDER BY rank
       LIMIT ?`)
        .all(query, ...scopeFilter.values, limit);
}
export function getRecentMemoryItems(limit = 10, filters) {
    const scopeFilter = buildMemoryScopeWhere(filters);
    return getDb()
        .prepare(`SELECT * FROM memory_items
       WHERE ${scopeFilter.whereSql}
       ORDER BY updated_at DESC LIMIT ?`)
        .all(...scopeFilter.values, limit);
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
        (SELECT r.started_at FROM schedule_runs r WHERE r.schedule_id = s.id ORDER BY r.started_at DESC LIMIT 1) AS last_run_at
       FROM schedules s ORDER BY s.created_at DESC`)
        .all();
}
export function getSchedule(id) {
    return getDb()
        .prepare(`SELECT s.*,
        (SELECT r.started_at FROM schedule_runs r WHERE r.schedule_id = s.id ORDER BY r.started_at DESC LIMIT 1) AS last_run_at
       FROM schedules s WHERE s.id = ?`)
        .get(id);
}
export function insertSchedule(s) {
    getDb()
        .prepare(`INSERT INTO schedules (id, name, cron_expression, prompt, enabled, target_channel, model, max_retries, timeout_sec, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(s.id, s.name, s.cron_expression, s.prompt, s.enabled, s.target_channel, s.model, s.max_retries, s.timeout_sec, s.created_at, s.updated_at);
}
export function updateSchedule(id, fields) {
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
    getDb().prepare("DELETE FROM schedules WHERE id = ?").run(id);
}
export function getScheduleRuns(scheduleId, limit, offset) {
    return getDb()
        .prepare("SELECT * FROM schedule_runs WHERE schedule_id = ? ORDER BY started_at DESC LIMIT ? OFFSET ?")
        .all(scheduleId, limit, offset);
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
