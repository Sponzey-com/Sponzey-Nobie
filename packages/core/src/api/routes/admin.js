import { authMiddleware } from "../middleware/auth.js";
import { buildRuntimeManifest } from "../../runtime/manifest.js";
import { insertAuditLog, insertDiagnosticEvent, listMessageLedgerEvents } from "../../db/index.js";
import { getUiModeState, isAdminUiEnabled, resolveAdminUiActivation } from "../../ui/mode.js";
import { getControlTimeline } from "../../control-plane/timeline.js";
import { buildQueueBackpressureSnapshot } from "../../runs/queue-backpressure.js";
import { listRootRuns } from "../../runs/store.js";
import { buildAdminToolRetrievalLab, runAdminWebRetrievalFixtureReplay } from "../../runs/admin-tool-lab.js";
import { buildAdminRuntimeInspectors } from "../../runs/admin-runtime-inspectors.js";
import { buildAdminPlatformInspectors, getAdminDiagnosticExportJob, listAdminDiagnosticExportJobs, startAdminDiagnosticExport, } from "../../runs/admin-platform-inspectors.js";
const DANGEROUS_ADMIN_ACTIONS = [
    { id: "retry", label: "Retry", description: "Re-run a failed or interrupted unit of work." },
    { id: "purge", label: "Purge", description: "Delete historical or temporary runtime state." },
    { id: "replay", label: "Replay", description: "Replay a stored event or request path." },
    { id: "export", label: "Export", description: "Export diagnostic or runtime data." },
];
const SENSITIVE_KEY_PATTERN = /api[_-]?key|token|secret|password|credential|authorization|cookie|session/i;
const SECRET_VALUE_PATTERNS = [
    /sk-[A-Za-z0-9_-]{8,}/g,
    /xox[abprs]-[A-Za-z0-9-]{8,}/g,
    /\b\d{6,}:[A-Za-z0-9_-]{8,}\b/g,
    /Bearer\s+[A-Za-z0-9._~+/=-]+/gi,
];
const CONTROL_SEVERITIES = ["debug", "info", "warning", "error"];
const LEDGER_STATUSES = ["received", "pending", "started", "generated", "sent", "delivered", "succeeded", "failed", "skipped", "suppressed", "degraded"];
const ADMIN_STAGE_LABELS = {
    ingress: "Ingress",
    planning: "Planning",
    tool_call: "Tool call",
    approval: "Approval",
    delivery: "Delivery",
    recovery: "Recovery",
    completion: "Completion",
};
const ADMIN_STAGE_ORDER = ["ingress", "planning", "tool_call", "approval", "delivery", "recovery", "completion"];
function confirmationFor(action) {
    return `CONFIRM ${action.toUpperCase()}`;
}
function isDangerousAction(value) {
    return typeof value === "string" && DANGEROUS_ADMIN_ACTIONS.some((action) => action.id === value);
}
function sanitizeText(value) {
    let next = value;
    for (const pattern of SECRET_VALUE_PATTERNS)
        next = next.replace(pattern, "***");
    return next;
}
function sanitizeAdminAuditValue(value) {
    if (typeof value === "string")
        return sanitizeText(value);
    if (Array.isArray(value))
        return value.map(sanitizeAdminAuditValue);
    if (value && typeof value === "object") {
        return Object.fromEntries(Object.entries(value).map(([key, item]) => {
            if (SENSITIVE_KEY_PATTERN.test(key))
                return [key, "***"];
            return [key, sanitizeAdminAuditValue(item)];
        }));
    }
    return value;
}
function auditJson(value) {
    return JSON.stringify(sanitizeAdminAuditValue(value));
}
function parseLimit(value, fallback = 200, max = 1000) {
    const parsed = Number.parseInt(value ?? "", 10);
    if (!Number.isFinite(parsed))
        return fallback;
    return Math.max(1, Math.min(max, parsed));
}
function parseSeverity(value) {
    return CONTROL_SEVERITIES.includes(value) ? value : undefined;
}
function parseLedgerStatus(value) {
    return LEDGER_STATUSES.includes(value) ? value : undefined;
}
function parseJson(raw) {
    if (!raw)
        return null;
    try {
        return JSON.parse(raw);
    }
    catch {
        return raw;
    }
}
function recomputeTimelineSummary(events) {
    const severityCounts = { debug: 0, info: 0, warning: 0, error: 0 };
    for (const event of events)
        severityCounts[event.severity] += 1;
    return {
        total: events.length,
        duplicateToolCount: events.filter((event) => event.duplicate?.kind === "tool").length,
        duplicateAnswerCount: events.filter((event) => event.duplicate?.kind === "answer").length,
        deliveryRetryCount: events.filter((event) => event.duplicate?.kind === "delivery").length,
        recoveryReentryCount: events.filter((event) => event.duplicate?.kind === "recovery").length,
        severityCounts,
    };
}
function getFilteredTimeline(query, limit) {
    const severity = parseSeverity(query.severity);
    const timelineQuery = {
        ...(query.runId ? { runId: query.runId } : {}),
        ...(query.requestGroupId ? { requestGroupId: query.requestGroupId } : {}),
        ...(query.component ? { component: query.component } : {}),
        ...(severity ? { severity } : {}),
        limit,
    };
    const timeline = getControlTimeline(timelineQuery, "developer");
    const events = query.sessionKey ? timeline.events.filter((event) => event.sessionKey === query.sessionKey) : timeline.events;
    return events === timeline.events ? timeline : { events, summary: recomputeTimelineSummary(events) };
}
function stageForRunStep(step) {
    if (step.key === "received")
        return "ingress";
    if (step.key === "classified" || step.key === "target_selected")
        return "planning";
    if (step.key === "executing")
        return "tool_call";
    if (step.key === "awaiting_approval")
        return "approval";
    if (step.key === "awaiting_user")
        return "recovery";
    if (step.key === "finalizing" || step.key === "completed" || step.key === "reviewing")
        return "completion";
    return "planning";
}
function stageForControlEvent(event) {
    const type = event.eventType.toLowerCase();
    const component = event.component.toLowerCase();
    if (type.includes("delivery") || component.includes("delivery"))
        return "delivery";
    if (type.includes("approval") || component.includes("approval"))
        return "approval";
    if (type.includes("recovery") || component.includes("recovery"))
        return "recovery";
    if (type.includes("tool") || component.includes("tool"))
        return "tool_call";
    if (type.includes("complete") || type.includes("final") || type.includes("failed"))
        return "completion";
    if (type.includes("ingress") || type.includes("created") || component.includes("channel"))
        return "ingress";
    return "planning";
}
function stageForLedgerEvent(event) {
    const kind = event.event_kind;
    if (kind === "ingress_received" || kind === "fast_receipt_sent")
        return "ingress";
    if (kind.startsWith("approval_"))
        return "approval";
    if (kind.startsWith("tool_"))
        return "tool_call";
    if (kind.includes("delivery") || kind.includes("delivered") || kind.includes("suppressed"))
        return "delivery";
    if (kind === "recovery_stop_generated")
        return "recovery";
    if (kind === "final_answer_generated")
        return "completion";
    return "planning";
}
function stepStatusToStageStatus(status) {
    if (status === "failed" || status === "cancelled")
        return "failed";
    if (status === "running")
        return "running";
    if (status === "completed")
        return "completed";
    return "pending";
}
function worseStageStatus(left, right) {
    const rank = { pending: 0, completed: 1, running: 2, warning: 3, failed: 4 };
    return rank[right] > rank[left] ? right : left;
}
function isLedgerDeliveryEvent(event) {
    return event.event_kind.includes("delivery") || event.event_kind.includes("delivered") || event.event_kind.includes("suppressed");
}
function isLedgerFailure(event) {
    return event.status === "failed" || event.status === "suppressed" || event.status === "degraded" || event.event_kind.endsWith("_failed") || event.event_kind === "recovery_stop_generated";
}
function isLedgerSuccess(event) {
    return event.status === "delivered" || event.status === "succeeded" || event.status === "sent";
}
function channelTargetFromDetail(detail) {
    if (!detail || typeof detail !== "object" || Array.isArray(detail))
        return null;
    const record = detail;
    const direct = record.channelTarget ?? record.target ?? record.targetId ?? record.chatId ?? record.threadId;
    return typeof direct === "string" && direct.trim() ? direct.trim() : null;
}
function mapLedgerEvent(event) {
    const detail = parseJson(event.detail_json);
    return {
        id: event.id,
        runId: event.run_id,
        requestGroupId: event.request_group_id,
        sessionKey: event.session_key,
        threadKey: event.thread_key,
        channel: event.channel,
        eventKind: event.event_kind,
        deliveryKey: event.delivery_key,
        idempotencyKey: event.idempotency_key,
        status: event.status,
        summary: event.summary,
        channelTarget: channelTargetFromDetail(detail),
        detail,
        createdAt: event.created_at,
    };
}
function filterLedgerEvents(events, query) {
    const status = parseLedgerStatus(query.status);
    return events.filter((event) => {
        if (query.channel && event.channel !== query.channel)
            return false;
        if (query.eventKind && event.event_kind !== query.eventKind)
            return false;
        if (status && event.status !== status)
            return false;
        if (query.deliveryKey && event.delivery_key !== query.deliveryKey)
            return false;
        if (query.idempotencyKey && event.idempotency_key !== query.idempotencyKey)
            return false;
        return true;
    });
}
function buildLedgerDuplicates(events) {
    const groups = new Map();
    for (const event of events) {
        if (event.delivery_key) {
            const key = `delivery:${event.delivery_key}`;
            const group = groups.get(key) ?? { kind: "delivery", events: [] };
            group.events.push(event);
            groups.set(key, group);
        }
        if (event.idempotency_key) {
            const key = `idempotency:${event.idempotency_key}`;
            const group = groups.get(key) ?? { kind: "idempotency", events: [] };
            group.events.push(event);
            groups.set(key, group);
        }
    }
    return [...groups.entries()]
        .filter(([, group]) => group.events.length > 1)
        .map(([key, group]) => {
        const ordered = [...group.events].sort((a, b) => a.created_at - b.created_at);
        return {
            key: key.replace(/^(delivery|idempotency):/, ""),
            kind: group.kind,
            count: group.events.length,
            firstAt: ordered[0]?.created_at ?? 0,
            lastAt: ordered.at(-1)?.created_at ?? 0,
            statuses: [...new Set(group.events.map((event) => event.status))],
        };
    });
}
function buildLedgerSummary(events, duplicates) {
    const statusCounts = Object.fromEntries(LEDGER_STATUSES.map((status) => [status, 0]));
    for (const event of events)
        statusCounts[event.status] += 1;
    return {
        total: events.length,
        delivered: events.filter((event) => isLedgerDeliveryEvent(event) && isLedgerSuccess(event)).length,
        deliveryFailures: events.filter((event) => isLedgerDeliveryEvent(event) && isLedgerFailure(event)).length,
        suppressed: events.filter((event) => event.status === "suppressed" || event.event_kind.includes("suppressed")).length,
        duplicates: duplicates.length,
        statusCounts,
    };
}
function buildDeliverySummary(events) {
    const deliveryEvents = events.filter(isLedgerDeliveryEvent);
    const failed = deliveryEvents.filter(isLedgerFailure);
    const delivered = deliveryEvents.filter(isLedgerSuccess);
    const suppressed = deliveryEvents.filter((event) => event.status === "suppressed" || event.event_kind.includes("suppressed"));
    const latest = deliveryEvents.at(-1);
    const status = suppressed.length > 0
        ? "suppressed"
        : failed.length > 0 && delivered.length > 0
            ? "partial_success"
            : failed.length > 0
                ? "failed"
                : delivered.length > 0
                    ? "delivered"
                    : deliveryEvents.some((event) => event.status === "pending" || event.status === "started" || event.status === "generated")
                        ? "pending"
                        : "not_requested";
    return {
        status,
        summary: latest?.summary ?? null,
        failureReason: failed.at(-1)?.summary ?? null,
        eventCount: deliveryEvents.length,
    };
}
function buildRunLifecycle(run, timelineEvents, ledgerEvents) {
    const buckets = new Map();
    for (const key of ADMIN_STAGE_ORDER) {
        buckets.set(key, { status: "pending", startedAt: null, finishedAt: null, eventCount: 0, ledgerCount: 0, summary: null, failureReason: null });
    }
    const touchTime = (bucket, at) => {
        if (!at)
            return;
        bucket.startedAt = bucket.startedAt == null ? at : Math.min(bucket.startedAt, at);
        bucket.finishedAt = bucket.finishedAt == null ? at : Math.max(bucket.finishedAt, at);
    };
    for (const step of run.steps) {
        const bucket = buckets.get(stageForRunStep(step));
        bucket.status = worseStageStatus(bucket.status, stepStatusToStageStatus(step.status));
        bucket.summary = step.summary || bucket.summary;
        if (step.status === "failed" || step.status === "cancelled")
            bucket.failureReason = step.summary || bucket.failureReason;
        touchTime(bucket, step.startedAt);
        touchTime(bucket, step.finishedAt);
    }
    for (const event of timelineEvents) {
        const bucket = buckets.get(stageForControlEvent(event));
        bucket.eventCount += 1;
        bucket.summary = event.summary || bucket.summary;
        if (event.severity === "error") {
            bucket.status = "failed";
            bucket.failureReason = event.summary;
        }
        else if (event.severity === "warning") {
            bucket.status = worseStageStatus(bucket.status, "warning");
        }
        else if (bucket.status === "pending") {
            bucket.status = "completed";
        }
        touchTime(bucket, event.at);
    }
    for (const event of ledgerEvents) {
        const bucket = buckets.get(stageForLedgerEvent(event));
        bucket.ledgerCount += 1;
        bucket.summary = event.summary || bucket.summary;
        if (event.status === "failed" || event.status === "suppressed") {
            bucket.status = "failed";
            bucket.failureReason = event.summary;
        }
        else if (event.status === "degraded") {
            bucket.status = worseStageStatus(bucket.status, "warning");
            bucket.failureReason = event.summary;
        }
        else if (bucket.status === "pending") {
            bucket.status = "completed";
        }
        touchTime(bucket, event.created_at);
    }
    const ingress = buckets.get("ingress");
    touchTime(ingress, run.createdAt);
    if (ingress.status === "pending")
        ingress.status = "completed";
    const completion = buckets.get("completion");
    if (run.status === "completed")
        completion.status = "completed";
    if (run.status === "failed" || run.status === "cancelled" || run.status === "interrupted") {
        completion.status = "failed";
        completion.failureReason = run.summary;
    }
    touchTime(completion, run.updatedAt);
    return ADMIN_STAGE_ORDER.map((key) => {
        const bucket = buckets.get(key);
        const durationMs = bucket.startedAt != null && bucket.finishedAt != null ? Math.max(0, bucket.finishedAt - bucket.startedAt) : null;
        return { key, label: ADMIN_STAGE_LABELS[key], ...bucket, durationMs };
    });
}
function buildRunsInspector(runs, timeline, ledgerEvents) {
    return runs.map((run) => {
        const runTimeline = timeline.events.filter((event) => event.runId === run.id || event.requestGroupId === run.requestGroupId);
        const runLedger = ledgerEvents.filter((event) => event.run_id === run.id || event.request_group_id === run.requestGroupId);
        const delivery = buildDeliverySummary(runLedger);
        const recoveryEvents = runLedger.filter((event) => stageForLedgerEvent(event) === "recovery");
        const recoveryTimeline = runTimeline.filter((event) => stageForControlEvent(event) === "recovery");
        return {
            id: run.id,
            requestGroupId: run.requestGroupId,
            sessionKey: run.sessionId,
            source: run.source,
            title: run.title,
            status: run.status,
            createdAt: run.createdAt,
            updatedAt: run.updatedAt,
            lifecycle: buildRunLifecycle(run, runTimeline, runLedger),
            failureReversal: run.status === "completed" && (runTimeline.some((event) => event.severity === "error" || event.severity === "warning") || runLedger.some(isLedgerFailure)),
            delivery,
            recovery: {
                eventCount: recoveryEvents.length + recoveryTimeline.length,
                lastSummary: recoveryEvents.at(-1)?.summary ?? recoveryTimeline.at(-1)?.summary ?? null,
            },
        };
    });
}
function buildStreamStatus() {
    const manifest = buildRuntimeManifest({ includeEnvironment: false, includeReleasePackage: false });
    const queues = buildQueueBackpressureSnapshot();
    const affected = queues.filter((queue) => queue.status !== "ok");
    const aggregateStatus = affected.some((queue) => queue.status === "stopped")
        ? "stopped"
        : affected.some((queue) => queue.status === "recovering")
            ? "recovering"
            : affected.some((queue) => queue.status === "waiting")
                ? "waiting"
                : "ok";
    return {
        status: affected.length > 0 ? "backpressure" : manifest.adminUi.subscriptionCount > 0 ? "connected" : "waiting_for_subscriber",
        subscriptionCount: manifest.adminUi.subscriptionCount,
        reconnect: {
            supported: true,
            strategy: "websocket_auto_reconnect",
            eventType: "control.event",
        },
        backpressure: {
            status: aggregateStatus,
            totalQueues: queues.length,
            affectedQueues: affected.length,
            queues,
        },
    };
}
function buildAdminLive(query) {
    const limit = parseLimit(query.limit);
    const timeline = getFilteredTimeline(query, limit);
    const runs = listRootRuns(limit).filter((run) => {
        if (query.runId && run.id !== query.runId)
            return false;
        if (query.requestGroupId && run.requestGroupId !== query.requestGroupId)
            return false;
        if (query.sessionKey && run.sessionId !== query.sessionKey)
            return false;
        return true;
    });
    const ledgerBase = listMessageLedgerEvents({
        ...(query.runId ? { runId: query.runId } : {}),
        ...(query.requestGroupId ? { requestGroupId: query.requestGroupId } : {}),
        ...(query.sessionKey ? { sessionKey: query.sessionKey } : {}),
        limit,
    });
    const ledgerEvents = filterLedgerEvents(ledgerBase, query);
    const duplicates = buildLedgerDuplicates(ledgerEvents);
    return {
        ok: true,
        generatedAt: Date.now(),
        filters: {
            runId: query.runId ?? null,
            requestGroupId: query.requestGroupId ?? null,
            sessionKey: query.sessionKey ?? null,
            component: query.component ?? null,
            severity: parseSeverity(query.severity) ?? null,
            channel: query.channel ?? null,
            eventKind: query.eventKind ?? null,
            status: parseLedgerStatus(query.status) ?? null,
            deliveryKey: query.deliveryKey ?? null,
            idempotencyKey: query.idempotencyKey ?? null,
            limit,
        },
        stream: buildStreamStatus(),
        timeline,
        runsInspector: { runs: buildRunsInspector(runs, timeline, ledgerBase) },
        messageLedger: {
            events: ledgerEvents.map(mapLedgerEvent),
            duplicates,
            summary: buildLedgerSummary(ledgerEvents, duplicates),
        },
    };
}
function recordAdminAudit(input) {
    insertAuditLog({
        timestamp: Date.now(),
        session_id: null,
        source: "webui.admin",
        tool_name: input.toolName,
        params: input.params === undefined ? null : auditJson(input.params),
        output: input.output === undefined ? null : auditJson(input.output),
        result: input.result,
        duration_ms: null,
        approval_required: input.approvalRequired ? 1 : 0,
        approved_by: input.approvedBy ?? null,
        error_code: input.errorCode ?? null,
        stop_reason: input.stopReason ?? null,
    });
}
function recordAdminGuardFailure(req) {
    try {
        const activation = resolveAdminUiActivation();
        const params = {
            method: req.method,
            url: req.url,
            remoteAddress: req.socket.remoteAddress ?? null,
            activation,
        };
        insertDiagnosticEvent({
            kind: "admin.guard.denied",
            summary: "Admin API access denied because Admin UI is not enabled.",
            detail: params,
        });
        recordAdminAudit({
            toolName: "admin.guard",
            params,
            output: { ok: false, error: "admin_ui_disabled" },
            result: "blocked",
            errorCode: "admin_ui_disabled",
            stopReason: "admin_guard_disabled",
        });
    }
    catch {
        // Guard diagnostics must not turn a blocked admin request into a 500.
    }
}
function buildAdminShell() {
    const manifest = buildRuntimeManifest({ includeEnvironment: false, includeReleasePackage: false });
    return {
        kind: "admin_shell",
        title: "Admin tools",
        warning: "Developer diagnostics are active. Dangerous actions require explicit confirmation and audit logging.",
        badges: [
            { label: manifest.adminUi.enabled ? "ADMIN ENABLED" : "ADMIN DISABLED", tone: manifest.adminUi.enabled ? "danger" : "neutral" },
            { label: `WS SUBSCRIBERS ${manifest.adminUi.subscriptionCount}`, tone: "neutral" },
            { label: "AUDIT REQUIRED", tone: "warning" },
        ],
        dangerousActions: DANGEROUS_ADMIN_ACTIONS.map((action) => ({
            ...action,
            requiredConfirmation: confirmationFor(action.id),
            auditRequired: true,
        })),
        subscriptions: {
            webSocketClients: manifest.adminUi.subscriptionCount,
        },
        auditRequired: true,
    };
}
function normalizeActionBody(body) {
    if (!body || typeof body !== "object")
        return {};
    return body;
}
function normalizeFixtureReplayBody(body) {
    if (!body || typeof body !== "object")
        return {};
    return body;
}
function normalizeDiagnosticExportBody(body) {
    if (!body || typeof body !== "object")
        return {};
    return body;
}
function normalizeFixtureIds(value) {
    if (!Array.isArray(value))
        return [];
    return value.filter((item) => typeof item === "string" && item.trim().length > 0).map((item) => item.trim());
}
function optionalString(value) {
    return typeof value === "string" && value.trim() ? value.trim() : undefined;
}
function optionalBoolean(value, fallback) {
    return typeof value === "boolean" ? value : fallback;
}
function optionalLimit(value, fallback = 500, max = 1000) {
    if (typeof value === "number" && Number.isFinite(value))
        return Math.max(1, Math.min(max, Math.floor(value)));
    if (typeof value === "string")
        return parseLimit(value, fallback, max);
    return fallback;
}
async function adminGuard(req, reply) {
    if (isAdminUiEnabled())
        return;
    recordAdminGuardFailure(req);
    await reply.status(403).send({
        ok: false,
        error: "admin_ui_disabled",
        message: "Admin UI is disabled for this runtime.",
    });
}
export function registerAdminRoute(app) {
    app.get("/api/admin/runtime", { preHandler: [authMiddleware, adminGuard] }, async () => {
        return {
            ok: true,
            mode: getUiModeState(),
            manifest: buildRuntimeManifest({ includeEnvironment: false, includeReleasePackage: false }),
        };
    });
    app.get("/api/admin/shell", { preHandler: [authMiddleware, adminGuard] }, async () => {
        return {
            ok: true,
            shell: buildAdminShell(),
            mode: getUiModeState(),
            manifest: buildRuntimeManifest({ includeEnvironment: false, includeReleasePackage: false }),
        };
    });
    app.get("/api/admin/live", { preHandler: [authMiddleware, adminGuard] }, async (req) => {
        return buildAdminLive(req.query);
    });
    app.get("/api/admin/tool-lab", { preHandler: [authMiddleware, adminGuard] }, async (req) => {
        const limit = parseLimit(req.query.limit, 120, 500);
        const timeline = getFilteredTimeline(req.query, limit);
        const ledgerBase = listMessageLedgerEvents({
            ...(req.query.runId ? { runId: req.query.runId } : {}),
            ...(req.query.requestGroupId ? { requestGroupId: req.query.requestGroupId } : {}),
            ...(req.query.sessionKey ? { sessionKey: req.query.sessionKey } : {}),
            limit,
        });
        const ledgerEvents = filterLedgerEvents(ledgerBase, req.query);
        return {
            ok: true,
            generatedAt: Date.now(),
            filters: {
                runId: req.query.runId ?? null,
                requestGroupId: req.query.requestGroupId ?? null,
                sessionKey: req.query.sessionKey ?? null,
                query: req.query.query ?? null,
                limit,
            },
            ...buildAdminToolRetrievalLab({ timeline, ledgerEvents, ...(req.query.query ? { query: req.query.query } : {}), limit }),
        };
    });
    app.get("/api/admin/runtime-inspectors", { preHandler: [authMiddleware, adminGuard] }, async (req) => {
        const limit = parseLimit(req.query.limit, 120, 500);
        const timeline = getFilteredTimeline(req.query, limit);
        const ledgerBase = listMessageLedgerEvents({
            ...(req.query.runId ? { runId: req.query.runId } : {}),
            ...(req.query.requestGroupId ? { requestGroupId: req.query.requestGroupId } : {}),
            ...(req.query.sessionKey ? { sessionKey: req.query.sessionKey } : {}),
            limit,
        });
        const ledgerEvents = filterLedgerEvents(ledgerBase, req.query);
        return {
            ok: true,
            generatedAt: Date.now(),
            filters: {
                runId: req.query.runId ?? null,
                requestGroupId: req.query.requestGroupId ?? null,
                sessionKey: req.query.sessionKey ?? null,
                channel: req.query.channel ?? null,
                limit,
            },
            ...buildAdminRuntimeInspectors({
                timeline,
                ledgerEvents,
                limit,
                filters: {
                    ...(req.query.runId ? { runId: req.query.runId } : {}),
                    ...(req.query.requestGroupId ? { requestGroupId: req.query.requestGroupId } : {}),
                    ...(req.query.sessionKey ? { sessionKey: req.query.sessionKey } : {}),
                    ...(req.query.channel ? { channel: req.query.channel } : {}),
                },
            }),
        };
    });
    app.get("/api/admin/platform-inspectors", { preHandler: [authMiddleware, adminGuard] }, async (req) => {
        const limit = parseLimit(req.query.limit, 120, 500);
        const timeline = getFilteredTimeline(req.query, limit);
        const ledgerBase = listMessageLedgerEvents({
            ...(req.query.runId ? { runId: req.query.runId } : {}),
            ...(req.query.requestGroupId ? { requestGroupId: req.query.requestGroupId } : {}),
            ...(req.query.sessionKey ? { sessionKey: req.query.sessionKey } : {}),
            limit,
        });
        const ledgerEvents = filterLedgerEvents(ledgerBase, req.query);
        return {
            ok: true,
            generatedAt: Date.now(),
            filters: {
                runId: req.query.runId ?? null,
                requestGroupId: req.query.requestGroupId ?? null,
                sessionKey: req.query.sessionKey ?? null,
                channel: req.query.channel ?? null,
                limit,
            },
            ...buildAdminPlatformInspectors({
                timeline,
                ledgerEvents,
                limit,
                filters: {
                    ...(req.query.runId ? { runId: req.query.runId } : {}),
                    ...(req.query.requestGroupId ? { requestGroupId: req.query.requestGroupId } : {}),
                    ...(req.query.sessionKey ? { sessionKey: req.query.sessionKey } : {}),
                    ...(req.query.channel ? { channel: req.query.channel } : {}),
                },
            }),
        };
    });
    app.post("/api/admin/diagnostic-exports", { preHandler: [authMiddleware, adminGuard] }, async (req, reply) => {
        const body = normalizeDiagnosticExportBody(req.body);
        const runId = optionalString(body.runId);
        const requestGroupId = optionalString(body.requestGroupId);
        const sessionKey = optionalString(body.sessionKey);
        const channel = optionalString(body.channel);
        const job = startAdminDiagnosticExport({
            ...(runId ? { runId } : {}),
            ...(requestGroupId ? { requestGroupId } : {}),
            ...(sessionKey ? { sessionKey } : {}),
            ...(channel ? { channel } : {}),
            includeTimeline: optionalBoolean(body.includeTimeline, true),
            includeReport: optionalBoolean(body.includeReport, true),
            limit: optionalLimit(body.limit),
        });
        return reply.status(202).send({ ok: true, job });
    });
    app.get("/api/admin/diagnostic-exports", { preHandler: [authMiddleware, adminGuard] }, async () => {
        return {
            ok: true,
            generatedAt: Date.now(),
            jobs: listAdminDiagnosticExportJobs(),
        };
    });
    app.get("/api/admin/diagnostic-exports/:id", { preHandler: [authMiddleware, adminGuard] }, async (req, reply) => {
        const job = getAdminDiagnosticExportJob(req.params.id);
        if (!job)
            return reply.status(404).send({ ok: false, error: "diagnostic_export_not_found" });
        return { ok: true, job };
    });
    app.post("/api/admin/web-retrieval-fixtures/replay", { preHandler: [authMiddleware, adminGuard] }, async (req) => {
        const body = normalizeFixtureReplayBody(req.body);
        return runAdminWebRetrievalFixtureReplay({ fixtureIds: normalizeFixtureIds(body.fixtureIds) });
    });
    app.post("/api/admin/actions", { preHandler: [authMiddleware, adminGuard] }, async (req, reply) => {
        const body = normalizeActionBody(req.body);
        if (!isDangerousAction(body.action)) {
            const output = { ok: false, error: "invalid_admin_action", allowedActions: DANGEROUS_ADMIN_ACTIONS.map((action) => action.id) };
            recordAdminAudit({
                toolName: "admin.action",
                params: body,
                output,
                result: "blocked",
                errorCode: "invalid_admin_action",
                stopReason: "invalid_admin_action",
            });
            insertDiagnosticEvent({
                kind: "admin.action.invalid",
                summary: "Admin dangerous action was rejected because the action id is invalid.",
                detail: { body: sanitizeAdminAuditValue(body) },
            });
            return reply.status(400).send(output);
        }
        const action = body.action;
        const requiredConfirmation = confirmationFor(action);
        const targetId = typeof body.targetId === "string" ? body.targetId : null;
        const confirmation = typeof body.confirmation === "string" ? body.confirmation.trim() : "";
        const actionParams = { action, targetId, reason: body.reason, params: body.params };
        if (confirmation !== requiredConfirmation) {
            const output = {
                ok: false,
                error: "admin_action_confirmation_required",
                action,
                targetId,
                status: "needs_confirmation",
                requiredConfirmation,
            };
            recordAdminAudit({
                toolName: `admin.action.${action}`,
                params: actionParams,
                output,
                result: "blocked",
                approvalRequired: true,
                errorCode: "confirmation_required",
                stopReason: "missing_explicit_confirmation",
            });
            insertDiagnosticEvent({
                kind: "admin.action.confirmation_required",
                summary: "Admin dangerous action was blocked until explicit confirmation is provided.",
                detail: { action, targetId, requiredConfirmation },
            });
            return reply.status(409).send(output);
        }
        const output = {
            ok: true,
            action,
            targetId,
            status: "accepted",
            summary: `Admin action ${action} accepted after explicit confirmation.`,
        };
        recordAdminAudit({
            toolName: `admin.action.${action}`,
            params: actionParams,
            output,
            result: "accepted",
            approvalRequired: true,
            approvedBy: "explicit_confirmation",
        });
        insertDiagnosticEvent({
            kind: "admin.action.accepted",
            summary: "Admin dangerous action accepted after explicit confirmation.",
            detail: { action, targetId },
        });
        return reply.status(202).send(output);
    });
    app.all("/api/admin/*", { preHandler: [authMiddleware, adminGuard] }, async (_req, reply) => {
        return reply.status(404).send({ ok: false, error: "admin_api_not_found" });
    });
}
//# sourceMappingURL=admin.js.map