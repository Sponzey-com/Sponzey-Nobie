import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { getMqttBrokerSnapshot, getMqttExchangeLogs, getMqttExtensionSnapshots, } from "../mqtt/broker.js";
import { getDatabaseMigrationStatus } from "../config/operations.js";
import { PATHS } from "../config/paths.js";
import { getDb, insertAuditLog, insertDiagnosticEvent, listMessageLedgerEvents, } from "../db/index.js";
import { getActiveMigrationLock, getLatestMigrationLock, verifyMigrationState, } from "../db/migration-safety.js";
import { getControlTimeline, } from "../control-plane/timeline.js";
const EXPORT_JOBS = new Map();
const MAX_EXPORT_JOBS = 30;
const NODE_STALE_MS = 60_000;
const SECRET_KEY_PATTERN = /api[_-]?key|authorization|bearer|cookie|credential|password|refresh[_-]?token|secret|token|provider[_-]?raw|raw[_-]?(?:body|html|response)|html/i;
const LOCAL_PATH_PATTERN = /(?:\/Users\/[^\s"')]+|\/private\/[^\s"')]+|\/var\/folders\/[^\s"')]+|\/tmp\/[^\s"')]+|[A-Za-z]:\\[^\s"']+)/g;
const HTML_PATTERN = /<!doctype\s+html|<html\b|<head\b|<body\b|<script\b/i;
const TEXT_SECRET_PATTERNS = [
    [/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer ***"],
    [/\bsk-[A-Za-z0-9_-]{8,}\b/g, "sk-***"],
    [/xox[abprs]-[A-Za-z0-9-]{8,}/g, "xox-***"],
    [/\b\d{6,}:[A-Za-z0-9_-]{8,}\b/g, "***:***"],
    [/([A-Za-z0-9_-]{12,})\.([A-Za-z0-9_-]{12,})\.([A-Za-z0-9_-]{12,})/g, "***.***.***"],
];
function parseJson(raw) {
    if (!raw)
        return null;
    try {
        return JSON.parse(raw);
    }
    catch {
        return sanitizeExportValue(raw);
    }
}
function detailRecord(value) {
    return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}
function readString(record, ...keys) {
    if (!record)
        return null;
    for (const key of keys) {
        const value = record[key];
        if (typeof value === "string" && value.trim())
            return value.trim();
    }
    return null;
}
function readNumber(record, ...keys) {
    if (!record)
        return null;
    for (const key of keys) {
        const value = record[key];
        if (typeof value === "number" && Number.isFinite(value))
            return value;
        if (typeof value === "string" && value.trim() !== "") {
            const parsed = Number(value);
            if (Number.isFinite(parsed))
                return parsed;
        }
    }
    return null;
}
function readStringArray(record, key) {
    if (!record)
        return [];
    const value = record[key];
    if (typeof value === "string" && value.trim())
        return [value.trim()];
    if (Array.isArray(value))
        return value.filter((item) => typeof item === "string" && item.trim() !== "");
    return [];
}
function tableExists(name) {
    const row = getDb()
        .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?`)
        .get(name);
    return Boolean(row);
}
function sanitizeText(value) {
    let next = value;
    for (const [pattern, replacement] of TEXT_SECRET_PATTERNS)
        next = next.replace(pattern, replacement);
    if (HTML_PATTERN.test(next))
        return "[redacted-html]";
    next = next.replace(LOCAL_PATH_PATTERN, "[redacted-path]");
    return next.length > 4_000 ? `${next.slice(0, 3_990)}...` : next;
}
function sanitizeExportValue(value, parentKey = "", depth = 0) {
    if (value == null)
        return value;
    if (depth > 8)
        return "[truncated]";
    if (SECRET_KEY_PATTERN.test(parentKey))
        return "[redacted]";
    if (typeof value === "string")
        return sanitizeText(value);
    if (typeof value !== "object")
        return value;
    if (Array.isArray(value))
        return value.slice(0, 100).map((item) => sanitizeExportValue(item, parentKey, depth + 1));
    return Object.fromEntries(Object.entries(value).map(([key, nested]) => [key, sanitizeExportValue(nested, key, depth + 1)]));
}
function normalizeFilters(input) {
    const filters = {};
    if (typeof input?.runId === "string" && input.runId.trim())
        filters.runId = input.runId.trim();
    if (typeof input?.requestGroupId === "string" && input.requestGroupId.trim())
        filters.requestGroupId = input.requestGroupId.trim();
    if (typeof input?.sessionKey === "string" && input.sessionKey.trim())
        filters.sessionKey = input.sessionKey.trim();
    if (typeof input?.channel === "string" && input.channel.trim())
        filters.channel = input.channel.trim();
    return filters;
}
function buildTimelineQuery(filters, limit) {
    return {
        ...(filters.runId ? { runId: filters.runId } : {}),
        ...(filters.requestGroupId ? { requestGroupId: filters.requestGroupId } : {}),
        limit,
    };
}
function eventExtensionId(event) {
    const detail = detailRecord(event.detail);
    return readString(detail, "extensionId", "extension_id", "nodeId", "node_id");
}
function eventState(event) {
    const detail = detailRecord(event.detail);
    return readString(detail, "state", "status");
}
function isYeonjangTimelineEvent(event) {
    const haystack = `${event.component} ${event.eventType} ${event.summary}`.toLowerCase();
    return haystack.includes("yeonjang") || haystack.includes("mqtt");
}
function isOnlineState(state) {
    return state === "connected" || state === "online" || state === "ready" || state === "healthy";
}
function isDisconnectEvent(event) {
    const state = eventState(event);
    const haystack = `${event.eventType} ${event.summary}`.toLowerCase();
    return state === "offline" || state === "disconnected" || haystack.includes("disconnect");
}
function isReconnectEvent(event) {
    const haystack = `${event.eventType} ${event.summary}`.toLowerCase();
    return haystack.includes("reconnect");
}
function nodeFromExtensionSnapshot(snapshot) {
    const now = Date.now();
    return {
        extensionId: snapshot.extensionId,
        clientId: snapshot.clientId,
        displayName: snapshot.displayName,
        state: snapshot.state,
        message: snapshot.message,
        version: snapshot.version,
        protocolVersion: snapshot.protocolVersion ?? null,
        capabilityHash: snapshot.capabilityHash ?? null,
        methodCount: snapshot.methods.length,
        platform: snapshot.platform ?? snapshot.os ?? null,
        transport: snapshot.transport ?? [],
        lastSeenAt: snapshot.lastSeenAt,
        stale: now - snapshot.lastSeenAt > NODE_STALE_MS,
        heartbeatCount: 0,
        reconnectAttempts: 0,
        capabilities: snapshot.methods,
    };
}
function updateNodeFromTimeline(node, event) {
    const detail = detailRecord(event.detail);
    const methods = readStringArray(detail, "methods");
    const methodCount = readNumber(detail, "methodCount", "method_count");
    const reconnectAttempts = readNumber(detail, "reconnectAttempts", "reconnect_attempts") ?? (isReconnectEvent(event) ? 1 : 0);
    const state = eventState(event) ?? node.state;
    const at = event.at;
    return {
        ...node,
        state,
        message: readString(detail, "message") ?? node.message,
        protocolVersion: readString(detail, "protocolVersion", "protocol_version") ?? node.protocolVersion,
        capabilityHash: readString(detail, "capabilityHash", "capability_hash") ?? node.capabilityHash,
        methodCount: methodCount ?? (methods.length > 0 ? methods.length : node.methodCount),
        platform: readString(detail, "platform", "os") ?? node.platform,
        transport: readStringArray(detail, "transport").length > 0 ? readStringArray(detail, "transport") : node.transport,
        lastSeenAt: node.lastSeenAt == null ? at : Math.max(node.lastSeenAt, at),
        stale: Date.now() - at > NODE_STALE_MS,
        heartbeatCount: node.heartbeatCount + (event.eventType === "yeonjang.heartbeat" || event.eventType.includes("heartbeat") ? 1 : 0),
        reconnectAttempts: node.reconnectAttempts + reconnectAttempts,
        capabilities: methods.length > 0 ? methods : node.capabilities,
    };
}
function buildYeonjangInspector(timeline) {
    const broker = getMqttBrokerSnapshot();
    const degradedReasons = [];
    const nodes = new Map();
    for (const snapshot of getMqttExtensionSnapshots())
        nodes.set(snapshot.extensionId, nodeFromExtensionSnapshot(snapshot));
    const timelineLinks = timeline.events
        .filter(isYeonjangTimelineEvent)
        .sort((left, right) => left.at - right.at)
        .map((event) => {
        const detail = detailRecord(event.detail);
        const extensionId = eventExtensionId(event);
        if (extensionId) {
            const current = nodes.get(extensionId) ?? {
                extensionId,
                clientId: null,
                displayName: null,
                state: null,
                message: null,
                version: null,
                protocolVersion: null,
                capabilityHash: null,
                methodCount: 0,
                platform: null,
                transport: [],
                lastSeenAt: null,
                stale: true,
                heartbeatCount: 0,
                reconnectAttempts: 0,
                capabilities: [],
            };
            nodes.set(extensionId, updateNodeFromTimeline(current, event));
        }
        return {
            at: event.at,
            eventType: event.eventType,
            component: event.component,
            summary: event.summary,
            extensionId,
            state: eventState(event),
            reconnectAttempts: readNumber(detail, "reconnectAttempts", "reconnect_attempts"),
        };
    });
    if (!broker.enabled)
        degradedReasons.push("mqtt_disabled");
    if (broker.enabled && !broker.running)
        degradedReasons.push("mqtt_not_running");
    const nodeList = Array.from(nodes.values()).sort((left, right) => (right.lastSeenAt ?? 0) - (left.lastSeenAt ?? 0));
    const reconnectAttempts = nodeList.reduce((sum, node) => sum + node.reconnectAttempts, 0) + timeline.events.filter((event) => isYeonjangTimelineEvent(event) && isReconnectEvent(event)).length;
    return {
        summary: {
            brokerRunning: broker.running,
            enabled: broker.enabled,
            connectedClients: broker.clientCount,
            nodes: nodeList.length,
            onlineNodes: nodeList.filter((node) => isOnlineState(node.state)).length,
            heartbeats: timelineLinks.filter((event) => event.eventType === "yeonjang.heartbeat" || event.eventType.includes("heartbeat")).length,
            reconnectAttempts,
            disconnects: timeline.events.filter((event) => isYeonjangTimelineEvent(event) && isDisconnectEvent(event)).length,
        },
        broker,
        nodes: nodeList,
        timelineLinks: timelineLinks.slice(-50).reverse(),
        exchangeLog: getMqttExchangeLogs().slice(0, 30).map((entry) => ({
            id: entry.id,
            timestamp: entry.timestamp,
            direction: entry.direction,
            topic: entry.topic,
            extensionId: entry.extensionId,
            kind: entry.kind,
            clientId: entry.clientId,
            payloadPreview: sanitizeExportValue(entry.payload),
        })),
        degradedReasons,
    };
}
function listBackupSnapshots(limit) {
    const root = join(PATHS.stateDir, "backups", "snapshots");
    const degradedReasons = [];
    if (!existsSync(root))
        return { snapshots: [], degradedReasons };
    try {
        const snapshots = readdirSync(root, { withFileTypes: true })
            .filter((entry) => entry.isDirectory())
            .map((entry) => {
            const manifestPath = join(root, entry.name, "manifest.json");
            if (!existsSync(manifestPath))
                return null;
            const parsed = JSON.parse(readFileSync(manifestPath, "utf-8"));
            return {
                id: typeof parsed.id === "string" ? parsed.id : entry.name,
                createdAt: typeof parsed.createdAt === "number" ? parsed.createdAt : statSync(manifestPath).mtimeMs,
                schemaVersion: typeof parsed.schemaVersion === "number" ? parsed.schemaVersion : null,
                latestSchemaVersion: typeof parsed.latestSchemaVersion === "number" ? parsed.latestSchemaVersion : null,
                fileCount: Array.isArray(parsed.files) ? parsed.files.length : 0,
                manifestFile: basename(manifestPath),
            };
        })
            .filter((item) => Boolean(item))
            .sort((left, right) => right.createdAt - left.createdAt)
            .slice(0, limit);
        return { snapshots, degradedReasons };
    }
    catch (error) {
        degradedReasons.push(error instanceof Error ? error.message : String(error));
        return { snapshots: [], degradedReasons };
    }
}
function listMigrationDiagnostics(limit) {
    if (!tableExists("diagnostic_events"))
        return [];
    const rows = getDb()
        .prepare(`SELECT * FROM diagnostic_events
       WHERE lower(kind) LIKE '%migration%' OR lower(summary) LIKE '%migration%'
       ORDER BY created_at DESC
       LIMIT ${Math.max(1, Math.min(limit, 100))}`)
        .all();
    return rows.map((row) => ({
        id: row.id,
        kind: row.kind,
        summary: sanitizeText(row.summary),
        runId: row.run_id,
        requestGroupId: row.request_group_id,
        createdAt: row.created_at,
        detail: sanitizeExportValue(parseJson(row.detail_json)),
    }));
}
function buildDatabaseInspector(limit) {
    const degradedReasons = [];
    let migrations;
    try {
        migrations = getDatabaseMigrationStatus();
    }
    catch (error) {
        degradedReasons.push(`migration_status_failed:${error instanceof Error ? error.message : String(error)}`);
        migrations = {
            databasePath: resolve(PATHS.dbFile),
            exists: false,
            currentVersion: 0,
            latestVersion: 0,
            appliedVersions: [],
            pendingVersions: [],
            unknownAppliedVersions: [],
            upToDate: false,
        };
    }
    let integrity = null;
    let active = null;
    let latest = null;
    try {
        const db = getDb();
        integrity = verifyMigrationState(db);
        active = getActiveMigrationLock(db);
        latest = getLatestMigrationLock(db);
    }
    catch (error) {
        degradedReasons.push(`migration_verification_failed:${error instanceof Error ? error.message : String(error)}`);
    }
    const backups = listBackupSnapshots(limit);
    const diagnostics = listMigrationDiagnostics(limit);
    return {
        summary: {
            currentVersion: migrations.currentVersion,
            latestVersion: migrations.latestVersion,
            pendingMigrations: migrations.pendingVersions.length,
            unknownAppliedVersions: migrations.unknownAppliedVersions.length,
            migrationLockActive: Boolean(active),
            integrityOk: integrity?.ok ?? false,
            backupSnapshots: backups.snapshots.length,
            migrationDiagnostics: diagnostics.length,
        },
        migrations,
        lock: { active, latest },
        integrity,
        backups,
        diagnostics,
        degradedReasons: [...degradedReasons, ...backups.degradedReasons],
    };
}
function cloneJob(job) {
    return { ...job, filters: { ...job.filters } };
}
function rememberJob(job) {
    EXPORT_JOBS.set(job.id, job);
    const overflow = EXPORT_JOBS.size - MAX_EXPORT_JOBS;
    if (overflow <= 0)
        return;
    const ordered = Array.from(EXPORT_JOBS.values()).sort((left, right) => left.createdAt - right.createdAt);
    for (const old of ordered.slice(0, overflow))
        EXPORT_JOBS.delete(old.id);
}
function updateJob(id, patch) {
    const current = EXPORT_JOBS.get(id);
    if (!current)
        return null;
    const next = { ...current, ...patch, updatedAt: Date.now() };
    EXPORT_JOBS.set(id, next);
    return next;
}
function filterLedgerByChannel(events, channel) {
    return channel ? events.filter((event) => event.channel === channel) : events;
}
function readNestedString(value, keys, depth = 0) {
    if (!value || depth > 6)
        return null;
    if (Array.isArray(value)) {
        for (const item of value) {
            const found = readNestedString(item, keys, depth + 1);
            if (found)
                return found;
        }
        return null;
    }
    const record = detailRecord(value);
    if (!record)
        return null;
    const direct = readString(record, ...keys);
    if (direct)
        return direct;
    for (const nested of Object.values(record)) {
        const found = readNestedString(nested, keys, depth + 1);
        if (found)
            return found;
    }
    return null;
}
function readNestedNumber(value, keys, depth = 0) {
    if (!value || depth > 6)
        return null;
    if (Array.isArray(value)) {
        for (const item of value) {
            const found = readNestedNumber(item, keys, depth + 1);
            if (found != null)
                return found;
        }
        return null;
    }
    const record = detailRecord(value);
    if (!record)
        return null;
    const direct = readNumber(record, ...keys);
    if (direct != null)
        return direct;
    for (const nested of Object.values(record)) {
        const found = readNestedNumber(nested, keys, depth + 1);
        if (found != null)
            return found;
    }
    return null;
}
function isOrchestrationLedgerEvent(event, detail) {
    const haystack = `${event.event_kind} ${event.summary}`.toLowerCase();
    return haystack.includes("sub_session")
        || haystack.includes("orchestration")
        || Boolean(readNestedString(detail, ["orchestrationPlan", "orchestration_plan", "planId", "plan_id"]));
}
function buildPlatformOrchestrationInspector(input) {
    const limit = Math.max(1, Math.min(input.limit ?? 120, 500));
    const events = input.ledgerEvents
        .map((event) => ({ event, detail: sanitizeExportValue(parseJson(event.detail_json)) }))
        .filter(({ event, detail }) => isOrchestrationLedgerEvent(event, detail));
    const latestEvents = events
        .slice(0, limit)
        .map(({ event, detail }) => ({
        id: event.id,
        eventKind: event.event_kind,
        status: event.status,
        summary: sanitizeText(event.summary),
        runId: event.run_id,
        requestGroupId: event.request_group_id,
        subSessionId: readNestedString(detail, ["subSessionId", "sub_session_id"]),
        agentId: readNestedString(detail, ["agentId", "agent_id"]),
        latencyMs: readNestedNumber(detail, ["latencyMs", "durationMs", "elapsedMs", "windowMs"]),
        resourceLockWaitMs: readNestedNumber(detail, ["resourceLockWaitMs", "lockWaitMs", "waitMs"]),
        createdAt: event.created_at,
    }));
    return {
        summary: {
            orchestrationLedgerEvents: events.length,
            subSessionEvents: events.filter(({ event }) => event.event_kind.includes("sub_session")).length,
            latencyMetrics: latestEvents.filter((event) => event.latencyMs != null).length,
            resourceLockWaits: latestEvents.filter((event) => event.resourceLockWaitMs != null).length,
        },
        latestEvents,
    };
}
function listDiagnosticsForExport(filters, limit) {
    if (!tableExists("diagnostic_events"))
        return [];
    const where = [];
    const params = [];
    if (filters.runId) {
        where.push("run_id = ?");
        params.push(filters.runId);
    }
    if (filters.requestGroupId) {
        where.push("request_group_id = ?");
        params.push(filters.requestGroupId);
    }
    if (filters.sessionKey) {
        where.push("session_id = ?");
        params.push(filters.sessionKey);
    }
    const sql = `SELECT * FROM diagnostic_events ${where.length > 0 ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY created_at DESC LIMIT ?`;
    return getDb().prepare(sql).all(...params, limit);
}
function listAuditForExport(filters, limit) {
    if (!tableExists("audit_logs"))
        return [];
    const where = [];
    const params = [];
    if (filters.runId) {
        where.push("run_id = ?");
        params.push(filters.runId);
    }
    if (filters.requestGroupId) {
        where.push("request_group_id = ?");
        params.push(filters.requestGroupId);
    }
    if (filters.channel) {
        where.push("channel = ?");
        params.push(filters.channel);
    }
    const sql = `SELECT * FROM audit_logs ${where.length > 0 ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY timestamp DESC LIMIT ?`;
    return getDb().prepare(sql).all(...params, limit);
}
function buildExportBundle(input) {
    const filters = normalizeFilters(input);
    const limit = Math.max(1, Math.min(input.limit ?? 500, 1_000));
    const timeline = input.includeTimeline === false
        ? null
        : getControlTimeline(buildTimelineQuery(filters, limit), "user");
    const ledgerBase = listMessageLedgerEvents({
        ...(filters.runId ? { runId: filters.runId } : {}),
        ...(filters.requestGroupId ? { requestGroupId: filters.requestGroupId } : {}),
        ...(filters.sessionKey ? { sessionKey: filters.sessionKey } : {}),
        limit,
    });
    const ledgerEvents = filterLedgerByChannel(ledgerBase, filters.channel);
    const report = input.includeReport === false
        ? null
        : buildAdminPlatformInspectors({
            timeline: timeline ?? getControlTimeline(buildTimelineQuery(filters, limit), "user"),
            ledgerEvents,
            limit: Math.min(limit, 200),
            filters,
        });
    return sanitizeExportValue({
        kind: "nobie.admin.diagnostic_export",
        generatedAt: Date.now(),
        filters,
        includes: {
            timeline: input.includeTimeline !== false,
            report: input.includeReport !== false,
            ledger: true,
            diagnostics: true,
            audit: true,
        },
        timeline,
        ledger: ledgerEvents.map((event) => ({
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
            detail: parseJson(event.detail_json),
            createdAt: event.created_at,
        })),
        diagnostics: listDiagnosticsForExport(filters, limit).map((event) => ({
            id: event.id,
            kind: event.kind,
            summary: event.summary,
            runId: event.run_id,
            requestGroupId: event.request_group_id,
            sessionKey: event.session_id,
            recoveryKey: event.recovery_key,
            detail: parseJson(event.detail_json),
            createdAt: event.created_at,
        })),
        audit: listAuditForExport(filters, limit).map((event) => ({
            id: event.id,
            timestamp: event.timestamp,
            runId: event.run_id,
            requestGroupId: event.request_group_id,
            channel: event.channel,
            source: event.source,
            toolName: event.tool_name,
            params: parseJson(event.params),
            output: parseJson(event.output),
            result: event.result,
            approvalRequired: Boolean(event.approval_required),
            approvedBy: event.approved_by,
            errorCode: event.error_code,
            retryCount: event.retry_count,
            stopReason: event.stop_reason,
        })),
        report,
    });
}
async function runExportJob(id, input) {
    updateJob(id, { status: "running", progress: 10 });
    try {
        const bundle = buildExportBundle(input);
        updateJob(id, { progress: 70 });
        const outputDir = join(PATHS.stateDir, "admin-exports");
        mkdirSync(outputDir, { recursive: true });
        const bundleFile = `admin-export-${new Date().toISOString().replace(/[:.]/g, "-")}-${id}.json`;
        const bundlePath = join(outputDir, bundleFile);
        writeFileSync(bundlePath, JSON.stringify(bundle, null, 2) + "\n", "utf-8");
        const bundleBytes = statSync(bundlePath).size;
        updateJob(id, { status: "succeeded", progress: 100, bundlePath, bundleFile, bundleBytes, error: null });
        insertAuditLog({
            timestamp: Date.now(),
            session_id: null,
            source: "webui.admin",
            tool_name: "admin.diagnostic_export",
            params: JSON.stringify(sanitizeExportValue(normalizeFilters(input))),
            output: JSON.stringify({ jobId: id, bundleFile, bundleBytes }),
            result: "succeeded",
            duration_ms: null,
            approval_required: 0,
            approved_by: null,
        });
    }
    catch (error) {
        const message = sanitizeText(error instanceof Error ? error.message : String(error));
        updateJob(id, { status: "failed", progress: 100, error: message });
        insertDiagnosticEvent({
            kind: "admin.diagnostic_export.failed",
            summary: "Admin diagnostic export failed.",
            detail: { jobId: id, error: message },
        });
    }
}
export function buildAdminPlatformInspectors(input) {
    const limit = Math.max(1, Math.min(input.limit ?? 120, 500));
    return {
        yeonjang: buildYeonjangInspector(input.timeline),
        database: buildDatabaseInspector(limit),
        orchestration: buildPlatformOrchestrationInspector(input),
        exports: {
            jobs: listAdminDiagnosticExportJobs().slice(0, limit),
            defaults: {
                outputDirName: "admin-exports",
                sanitized: true,
                backgroundJob: true,
            },
        },
    };
}
export function startAdminDiagnosticExport(input = {}) {
    const now = Date.now();
    const job = {
        id: `admin-export-${randomUUID()}`,
        status: "queued",
        progress: 0,
        createdAt: now,
        updatedAt: now,
        filters: normalizeFilters(input),
        includeTimeline: input.includeTimeline !== false,
        includeReport: input.includeReport !== false,
        bundlePath: null,
        bundleFile: null,
        bundleBytes: null,
        error: null,
    };
    rememberJob(job);
    queueMicrotask(() => {
        void runExportJob(job.id, { ...input, ...job.filters });
    });
    return cloneJob(job);
}
export function getAdminDiagnosticExportJob(id) {
    const job = EXPORT_JOBS.get(id);
    return job ? cloneJob(job) : null;
}
export function listAdminDiagnosticExportJobs() {
    return Array.from(EXPORT_JOBS.values()).sort((left, right) => right.createdAt - left.createdAt).map(cloneJob);
}
//# sourceMappingURL=admin-platform-inspectors.js.map