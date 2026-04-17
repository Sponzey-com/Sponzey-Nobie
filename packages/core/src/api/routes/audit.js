import { getDb, insertDiagnosticEvent } from "../../db/index.js";
import { sanitizeUserFacingError } from "../../runs/error-sanitizer.js";
import { authMiddleware } from "../middleware/auth.js";
const SENSITIVE_KEYS = /api[_-]?key|authorization|auth|bearer|cookie|credential|password|refresh[_-]?token|secret|token|chat[_-]?id|external[_-]?chat[_-]?id|channel[_-]?target|raw[_-]?(body|response)|provider[_-]?raw/i;
const TEXT_SECRET_PATTERNS = [
    [/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer ***"],
    [/(api[_-]?key|authorization|password|refresh[_-]?token|secret|token)(["'\s:=]+)([^"'\s,}]+)/gi, "$1$2***"],
    [/(chat[_-]?id|chatId|external[_-]?chat[_-]?id)(["'\s:=]+)([^"'\s,}]+)/gi, "$1$2***"],
    [/\b(telegram|chat)[:#-]\d{6,}\b/gi, "$1:***"],
    [/([A-Za-z0-9_-]{12,})\.([A-Za-z0-9_-]{12,})\.([A-Za-z0-9_-]{12,})/g, "***.***.***"],
];
const AUDIT_EVENTS_CTE = `
WITH audit_events AS (
  SELECT
    id,
    timestamp AS at,
    'tool_call' AS kind,
    'tool' AS timeline_kind,
    result AS status,
    tool_name || ' ' || result AS summary,
    source,
    session_id,
    run_id,
    request_group_id,
    COALESCE(channel, source) AS channel,
    tool_name,
    params,
    output,
    duration_ms,
    approval_required,
    approved_by,
    error_code,
    retry_count,
    stop_reason,
    NULL AS detail_json
  FROM audit_logs

  UNION ALL

  SELECT
    id,
    created_at AS at,
    'diagnostic' AS kind,
    CASE
      WHEN recovery_key IS NOT NULL OR lower(kind) LIKE '%recovery%' OR summary LIKE '%복구%' THEN 'recovery'
      WHEN lower(kind) LIKE '%completion%' OR summary LIKE '%완료%' THEN 'completion'
      WHEN lower(kind) LIKE '%delivery%' OR summary LIKE '%전달%' THEN 'delivery'
      WHEN lower(kind) LIKE '%memory%' OR summary LIKE '%메모리%' THEN 'memory'
      WHEN lower(kind) LIKE '%intake%' THEN 'intake'
      ELSE 'contract'
    END AS timeline_kind,
    CASE
      WHEN lower(kind) LIKE '%fail%' OR lower(summary) LIKE '%fail%' OR summary LIKE '%실패%' THEN 'failed'
      WHEN lower(kind) LIKE '%blocked%' OR summary LIKE '%차단%' THEN 'blocked'
      ELSE 'info'
    END AS status,
    summary,
    'system' AS source,
    session_id,
    run_id,
    request_group_id,
    NULL AS channel,
    kind AS tool_name,
    NULL AS params,
    NULL AS output,
    NULL AS duration_ms,
    0 AS approval_required,
    NULL AS approved_by,
    kind AS error_code,
    NULL AS retry_count,
    recovery_key AS stop_reason,
    detail_json
  FROM diagnostic_events

  UNION ALL

  SELECT
    e.id,
    e.at,
    'run_event' AS kind,
    CASE
      WHEN lower(e.label) LIKE '%ingress%' OR e.label LIKE '%요청 수신%' THEN 'ingress'
      WHEN lower(e.label) LIKE '%intake%' OR e.label LIKE '%분류%' THEN 'intake'
      WHEN lower(e.label) LIKE '%contract%' OR e.label LIKE '%계약%' THEN 'contract'
      WHEN lower(e.label) LIKE '%memory%' OR e.label LIKE '%메모리%' THEN 'memory'
      WHEN lower(e.label) LIKE '%delivery%' OR e.label LIKE '%전달%' THEN 'delivery'
      WHEN lower(e.label) LIKE '%recovery%' OR e.label LIKE '%복구%' THEN 'recovery'
      WHEN lower(e.label) LIKE '%completion%' OR e.label LIKE '%완료%' THEN 'completion'
      ELSE 'contract'
    END AS timeline_kind,
    'info' AS status,
    e.label AS summary,
    r.source,
    r.session_id,
    e.run_id,
    r.request_group_id,
    r.source AS channel,
    NULL AS tool_name,
    NULL AS params,
    NULL AS output,
    NULL AS duration_ms,
    0 AS approval_required,
    NULL AS approved_by,
    NULL AS error_code,
    NULL AS retry_count,
    NULL AS stop_reason,
    NULL AS detail_json
  FROM run_events e
  LEFT JOIN root_runs r ON r.id = e.run_id

  UNION ALL

  SELECT
    id,
    created_at AS at,
    'artifact' AS kind,
    'delivery' AS timeline_kind,
    CASE WHEN deleted_at IS NULL THEN 'info' ELSE 'deleted' END AS status,
    artifact_path AS summary,
    owner_channel AS source,
    NULL AS session_id,
    source_run_id AS run_id,
    request_group_id,
    owner_channel AS channel,
    'artifact' AS tool_name,
    NULL AS params,
    NULL AS output,
    NULL AS duration_ms,
    0 AS approval_required,
    NULL AS approved_by,
    mime_type AS error_code,
    NULL AS retry_count,
    retention_policy AS stop_reason,
    metadata_json AS detail_json
  FROM artifacts

  UNION ALL

  SELECT
    id,
    COALESCE(delivered_at, created_at) AS at,
    'delivery' AS kind,
    'delivery' AS timeline_kind,
    CASE WHEN delivered_at IS NULL THEN 'pending' ELSE 'success' END AS status,
    artifact_path AS summary,
    channel AS source,
    NULL AS session_id,
    run_id,
    request_group_id,
    channel,
    'artifact_delivery' AS tool_name,
    NULL AS params,
    delivery_receipt_json AS output,
    NULL AS duration_ms,
    0 AS approval_required,
    NULL AS approved_by,
    mime_type AS error_code,
    NULL AS retry_count,
    NULL AS stop_reason,
    json_object('mimeType', mime_type, 'sizeBytes', size_bytes) AS detail_json
  FROM artifact_receipts

  UNION ALL

  SELECT
    id,
    created_at AS at,
    'decision_trace' AS kind,
    CASE
      WHEN lower(decision_kind) LIKE '%ingress%' THEN 'ingress'
      WHEN lower(decision_kind) LIKE '%intake%' THEN 'intake'
      WHEN lower(decision_kind) LIKE '%memory%' THEN 'memory'
      WHEN lower(decision_kind) LIKE '%tool%' THEN 'tool'
      WHEN lower(decision_kind) LIKE '%delivery%' THEN 'delivery'
      WHEN lower(decision_kind) LIKE '%recovery%' THEN 'recovery'
      WHEN lower(decision_kind) LIKE '%completion%' THEN 'completion'
      ELSE 'contract'
    END AS timeline_kind,
    'info' AS status,
    decision_kind || ': ' || reason_code AS summary,
    source,
    session_id,
    run_id,
    request_group_id,
    channel,
    decision_kind AS tool_name,
    input_contract_ids_json AS params,
    receipt_ids_json AS output,
    NULL AS duration_ms,
    0 AS approval_required,
    NULL AS approved_by,
    reason_code AS error_code,
    NULL AS retry_count,
    reason_code AS stop_reason,
    sanitized_detail_json AS detail_json
  FROM decision_traces

  UNION ALL

  SELECT
    id,
    created_at AS at,
    'message_ledger' AS kind,
    CASE
      WHEN lower(event_kind) LIKE '%ingress%' OR lower(event_kind) LIKE '%receipt%' THEN 'ingress'
      WHEN lower(event_kind) LIKE '%approval%' THEN 'intake'
      WHEN lower(event_kind) LIKE '%tool%' THEN 'tool'
      WHEN lower(event_kind) LIKE '%delivery%' OR lower(event_kind) LIKE '%delivered%' OR lower(event_kind) LIKE '%artifact%' THEN 'delivery'
      WHEN lower(event_kind) LIKE '%recovery%' THEN 'recovery'
      WHEN lower(event_kind) LIKE '%final%' OR lower(event_kind) LIKE '%answer%' THEN 'completion'
      ELSE 'contract'
    END AS timeline_kind,
    status,
    summary,
    channel AS source,
    session_key AS session_id,
    run_id,
    request_group_id,
    channel,
    event_kind AS tool_name,
    idempotency_key AS params,
    delivery_key AS output,
    NULL AS duration_ms,
    0 AS approval_required,
    NULL AS approved_by,
    CASE WHEN status IN ('failed', 'degraded', 'suppressed') THEN event_kind ELSE NULL END AS error_code,
    NULL AS retry_count,
    CASE WHEN status IN ('failed', 'degraded', 'suppressed', 'skipped') THEN event_kind ELSE NULL END AS stop_reason,
    detail_json
  FROM message_ledger

  UNION ALL

  SELECT
    id,
    created_at AS at,
    'queue_backpressure' AS kind,
    CASE
      WHEN queue_name IN ('fast_receipt', 'interactive_run', 'schedule_tick') THEN 'intake'
      WHEN queue_name IN ('tool_execution', 'web_browser') THEN 'tool'
      WHEN queue_name = 'delivery' THEN 'delivery'
      WHEN queue_name IN ('memory_index', 'diagnostic') THEN 'memory'
      ELSE 'contract'
    END AS timeline_kind,
    CASE
      WHEN event_kind IN ('dead_letter', 'rejected', 'timeout') THEN 'failed'
      WHEN event_kind = 'retry_scheduled' THEN 'degraded'
      WHEN event_kind = 'queued' THEN 'pending'
      ELSE 'info'
    END AS status,
    queue_name || ': ' || action_taken AS summary,
    'system' AS source,
    NULL AS session_id,
    run_id,
    request_group_id,
    NULL AS channel,
    queue_name AS tool_name,
    recovery_key AS params,
    action_taken AS output,
    NULL AS duration_ms,
    0 AS approval_required,
    NULL AS approved_by,
    event_kind AS error_code,
    retry_count,
    CASE WHEN event_kind IN ('dead_letter', 'rejected', 'timeout') THEN action_taken ELSE NULL END AS stop_reason,
    detail_json
  FROM queue_backpressure_events
)
`;
function parsePositiveInt(value, fallback, max) {
    const parsed = Number.parseInt(value ?? "", 10);
    if (!Number.isFinite(parsed) || parsed <= 0)
        return fallback;
    return Math.min(parsed, max);
}
function parseTime(value) {
    if (!value)
        return null;
    const numeric = Number(value);
    if (Number.isFinite(numeric) && numeric > 0)
        return numeric;
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : null;
}
function redactDeep(value) {
    if (Array.isArray(value))
        return value.map(redactDeep);
    if (!value || typeof value !== "object")
        return typeof value === "string" ? sanitizeText(value) : value;
    const result = {};
    for (const [key, nested] of Object.entries(value)) {
        result[key] = SENSITIVE_KEYS.test(key) ? "***" : redactDeep(nested);
    }
    return result;
}
function sanitizeText(raw) {
    if (raw == null)
        return null;
    let value = raw;
    for (const [pattern, replacement] of TEXT_SECRET_PATTERNS) {
        value = value.replace(pattern, replacement);
    }
    if (/(<!doctype\s+html|<html\b|<head\b|<body\b|<script\b)/i.test(value)) {
        value = sanitizeUserFacingError(value).userMessage;
    }
    return value.length > 4000 ? `${value.slice(0, 3990)}…` : value;
}
function sanitizeIdentifier(raw) {
    const sanitized = sanitizeText(raw);
    if (sanitized == null)
        return null;
    return sanitized.replace(/\b\d{6,}\b/g, "***");
}
function parseAndRedactJson(raw) {
    if (!raw)
        return null;
    try {
        return redactDeep(JSON.parse(raw));
    }
    catch {
        return sanitizeText(raw);
    }
}
function mapEvent(row) {
    return {
        id: row.id,
        at: row.at,
        kind: row.kind,
        timelineKind: row.timeline_kind,
        status: row.status,
        summary: sanitizeText(row.summary) ?? "",
        source: sanitizeText(row.source),
        sessionId: sanitizeIdentifier(row.session_id),
        runId: row.run_id,
        requestGroupId: row.request_group_id,
        channel: sanitizeText(row.channel),
        toolName: sanitizeText(row.tool_name),
        params: parseAndRedactJson(row.params),
        output: sanitizeText(row.output),
        durationMs: row.duration_ms,
        approvalRequired: Boolean(row.approval_required),
        approvedBy: sanitizeText(row.approved_by),
        errorCode: sanitizeText(row.error_code),
        retryCount: row.retry_count,
        stopReason: sanitizeText(row.stop_reason),
        detail: parseAndRedactJson(row.detail_json),
    };
}
function buildWhere(query) {
    const conditions = [];
    const bindings = [];
    const status = query.status ?? query.result;
    if (query.kind) {
        conditions.push("kind = ?");
        bindings.push(query.kind);
    }
    if (query.timelineKind) {
        conditions.push("timeline_kind = ?");
        bindings.push(query.timelineKind);
    }
    if (status) {
        conditions.push("status = ?");
        bindings.push(status);
    }
    if (query.toolName) {
        conditions.push("tool_name LIKE ?");
        bindings.push(`%${query.toolName}%`);
    }
    if (query.channel) {
        conditions.push("channel = ?");
        bindings.push(query.channel);
    }
    if (query.runId) {
        conditions.push("run_id = ?");
        bindings.push(query.runId);
    }
    if (query.requestGroupId) {
        conditions.push("request_group_id = ?");
        bindings.push(query.requestGroupId);
    }
    if (query.sessionId) {
        conditions.push("session_id = ?");
        bindings.push(query.sessionId);
    }
    const from = parseTime(query.from);
    if (from != null) {
        conditions.push("at >= ?");
        bindings.push(from);
    }
    const to = parseTime(query.to);
    if (to != null) {
        conditions.push("at <= ?");
        bindings.push(to);
    }
    if (query.q?.trim()) {
        const needle = `%${query.q.trim()}%`;
        conditions.push("(summary LIKE ? OR tool_name LIKE ? OR error_code LIKE ? OR stop_reason LIKE ? OR detail_json LIKE ?)");
        bindings.push(needle, needle, needle, needle, needle);
    }
    return {
        where: conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "",
        bindings,
    };
}
export function listAuditEvents(query) {
    const limit = parsePositiveInt(query.limit, 50, 500);
    const page = parsePositiveInt(query.page, 1, 100000);
    const offset = (page - 1) * limit;
    const { where, bindings } = buildWhere(query);
    const db = getDb();
    const total = db.prepare(`${AUDIT_EVENTS_CTE} SELECT COUNT(*) AS n FROM audit_events ${where}`).get(...bindings);
    const rows = db
        .prepare(`${AUDIT_EVENTS_CTE} SELECT * FROM audit_events ${where} ORDER BY at DESC, id DESC LIMIT ? OFFSET ?`)
        .all(...bindings, limit, offset);
    return {
        items: rows.map(mapEvent),
        total: total.n,
        page,
        pages: Math.max(1, Math.ceil(total.n / limit)),
        limit,
    };
}
function getAuditEventRowById(id) {
    return getDb()
        .prepare(`${AUDIT_EVENTS_CTE} SELECT * FROM audit_events WHERE id = ? LIMIT 1`)
        .get(id);
}
export function getAuditEventById(id) {
    const row = getAuditEventRowById(id);
    return row ? mapEvent(row) : null;
}
export function promoteAuditEventToErrorCorpusCandidate(eventId, note) {
    const row = getAuditEventRowById(eventId);
    if (!row)
        return null;
    const event = mapEvent(row);
    const diagnosticEventId = insertDiagnosticEvent({
        kind: "error_corpus_candidate",
        summary: `장애 샘플 후보: ${event.summary}`,
        ...(row.run_id ? { runId: row.run_id } : {}),
        ...(row.session_id ? { sessionId: row.session_id } : {}),
        ...(row.request_group_id ? { requestGroupId: row.request_group_id } : {}),
        recoveryKey: `error-corpus:${event.kind}:${event.id}`,
        detail: {
            sourceEventId: event.id,
            eventKind: event.kind,
            timelineKind: event.timelineKind,
            status: event.status,
            summary: event.summary,
            channel: event.channel,
            toolName: event.toolName,
            errorCode: event.errorCode,
            stopReason: event.stopReason,
            params: event.params,
            output: event.output,
            detail: event.detail,
            note: sanitizeText(note ?? null),
        },
    });
    return { diagnosticEventId, event };
}
function resolveRunTimelineQuery(runId, limit) {
    const run = getDb()
        .prepare("SELECT request_group_id FROM root_runs WHERE id = ?")
        .get(runId);
    return run?.request_group_id && run.request_group_id !== runId
        ? { requestGroupId: run.request_group_id, limit: limit ?? "500" }
        : { runId, limit: limit ?? "500" };
}
function renderMarkdown(events) {
    const lines = ["# Audit Timeline", ""];
    for (const event of events) {
        lines.push(`- ${new Date(event.at).toISOString()} [${event.timelineKind}/${event.kind}/${event.status}] ${event.summary}`);
        const meta = [
            event.runId ? `run=${event.runId}` : null,
            event.requestGroupId ? `group=${event.requestGroupId}` : null,
            event.channel ? `channel=${event.channel}` : null,
            event.toolName ? `tool=${event.toolName}` : null,
            event.errorCode ? `code=${event.errorCode}` : null,
            event.stopReason ? `reason=${event.stopReason}` : null,
        ].filter(Boolean);
        if (meta.length > 0)
            lines.push(`  - ${meta.join(" | ")}`);
    }
    return `${lines.join("\n")}\n`;
}
export function registerAuditRoute(app) {
    app.get("/api/audit", { preHandler: authMiddleware }, async (req) => listAuditEvents(req.query));
    app.get("/api/audit/runs/:runId/timeline", { preHandler: authMiddleware }, async (req) => listAuditEvents(resolveRunTimelineQuery(req.params.runId, req.query.limit)));
    app.get("/api/audit/runs/:runId/export", { preHandler: authMiddleware }, async (req) => {
        const events = listAuditEvents(resolveRunTimelineQuery(req.params.runId, req.query.limit)).items;
        const format = req.query.format === "json" ? "json" : "markdown";
        return {
            format,
            content: format === "json" ? JSON.stringify({ runId: req.params.runId, events }, null, 2) : renderMarkdown(events),
            events,
        };
    });
    app.post("/api/audit/events/:id/promote-error-corpus", { preHandler: authMiddleware }, async (req, reply) => {
        const result = promoteAuditEventToErrorCorpusCandidate(req.params.id, req.body?.note);
        if (!result) {
            reply.code(404);
            return { ok: false, message: "audit event not found" };
        }
        return { ok: true, ...result };
    });
    app.delete("/api/audit", { preHandler: authMiddleware }, async (req) => {
        const before = req.query.all === "true" ? Date.now() + 1 : parseTime(req.query.before);
        if (before == null)
            return { ok: false, deleted: { auditLogs: 0, diagnosticEvents: 0, decisionTraces: 0 }, message: "before 또는 all=true가 필요합니다." };
        const db = getDb();
        const auditLogs = db.prepare("DELETE FROM audit_logs WHERE timestamp < ?").run(before).changes;
        const diagnosticEvents = db.prepare("DELETE FROM diagnostic_events WHERE created_at < ?").run(before).changes;
        const decisionTraces = db.prepare("DELETE FROM decision_traces WHERE created_at < ?").run(before).changes;
        const messageLedger = db.prepare("DELETE FROM message_ledger WHERE created_at < ?").run(before).changes;
        return { ok: true, deleted: { auditLogs, diagnosticEvents, decisionTraces, messageLedger }, before };
    });
}
//# sourceMappingURL=audit.js.map