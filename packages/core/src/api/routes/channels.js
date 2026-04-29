import crypto from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import JSON5 from "json5";
import { TelegramChannel, buildSettingsChannelConnectionSnapshot, defineChannelCapabilities, recordChannelRuntimeEvent, startChannels, } from "../../channels/index.js";
import { SlackChannel } from "../../channels/slack/bot.js";
import { getActiveSlackChannel, getSlackRuntimeStatus, setActiveSlackChannel, setSlackRuntimeError, stopActiveSlackChannel, } from "../../channels/slack/runtime.js";
import { getActiveTelegramChannel, getTelegramRuntimeStatus, setActiveTelegramChannel, setTelegramRuntimeError, stopActiveTelegramChannel, } from "../../channels/telegram/runtime.js";
import { getConfig, reloadConfig } from "../../config/index.js";
import { PATHS } from "../../config/paths.js";
import { getDb, listMessageLedgerEvents, } from "../../db/index.js";
import { eventBus } from "../../events/index.js";
import { getApprovalRegistryRow, resolveApprovalRegistryDecision } from "../../runs/approval-registry.js";
import { recordMessageLedgerEvent } from "../../runs/message-ledger.js";
import { authMiddleware } from "../middleware/auth.js";
const SECRET_KEY_PATTERN = /(?:api[_-]?key|token|secret|password|credential|authorization|cookie|raw[_-]?(?:body|payload|response)|signature)/i;
const FINAL_DELIVERY_EVENT_KINDS = new Set([
    "delivery_finalized",
    "final_answer_delivered",
    "final_answer_suppressed",
    "text_delivery_suppressed",
    "artifact_delivered",
]);
const TERMINAL_DELIVERY_STATUSES = new Set(["delivered", "succeeded", "suppressed"]);
const LOCAL_BRIDGE_PROVIDERS = new Set(["imessage", "kakaotalk"]);
function isRecord(value) {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
function parseLimit(value, fallback = 100, max = 1000) {
    const parsed = Number.parseInt(value ?? "", 10);
    if (!Number.isFinite(parsed) || parsed <= 0)
        return fallback;
    return Math.min(Math.floor(parsed), max);
}
function safeParseJson(value) {
    if (!value)
        return null;
    try {
        return JSON.parse(value);
    }
    catch {
        return null;
    }
}
function redactValue(value, depth = 0) {
    if (value == null)
        return value;
    if (depth > 8)
        return "[truncated]";
    if (typeof value === "string") {
        return value.length > 1000 ? `${value.slice(0, 1000)}...[truncated]` : value;
    }
    if (Array.isArray(value))
        return value.slice(0, 100).map((item) => redactValue(item, depth + 1));
    if (!isRecord(value))
        return value;
    const result = {};
    for (const [key, nested] of Object.entries(value)) {
        result[key] = SECRET_KEY_PATTERN.test(key) ? "[redacted]" : redactValue(nested, depth + 1);
    }
    return result;
}
function readRawConfig() {
    if (!existsSync(PATHS.configFile))
        return {};
    try {
        return JSON5.parse(readFileSync(PATHS.configFile, "utf-8"));
    }
    catch {
        return {};
    }
}
function writeRawConfig(raw) {
    mkdirSync(dirname(PATHS.configFile), { recursive: true });
    writeFileSync(PATHS.configFile, JSON5.stringify(raw, null, 2), "utf-8");
    reloadConfig();
}
function ensureRawSection(raw, key) {
    if (!isRecord(raw[key]))
        raw[key] = {};
    return raw[key];
}
function updateRawChannelEnabled(provider, enabled) {
    const raw = readRawConfig();
    const section = ensureRawSection(raw, provider);
    section.enabled = enabled;
    const current = getConfig();
    if (provider === "telegram" && !section.botToken && current.telegram?.botToken) {
        section.botToken = current.telegram.botToken;
    }
    if (provider === "slack") {
        if (!section.botToken && current.slack?.botToken)
            section.botToken = current.slack.botToken;
        if (!section.appToken && current.slack?.appToken)
            section.appToken = current.slack.appToken;
    }
    writeRawConfig(raw);
    const connection = requireConnection(`${provider}:primary`);
    recordRuntime(connection, enabled ? "enabled" : "disabled", enabled ? "Channel enabled." : "Channel disabled.");
    return connection;
}
function buildRuntimeSnapshot() {
    return {
        telegram: getTelegramRuntimeStatus(),
        slack: getSlackRuntimeStatus(),
    };
}
function listConnections() {
    return buildSettingsChannelConnectionSnapshot({
        config: getConfig(),
        runtime: buildRuntimeSnapshot(),
        persist: true,
    });
}
function buildPlaceholderCapabilities(provider, connectionKind) {
    return defineChannelCapabilities({
        provider,
        connectionKind,
        supportsThreads: connectionKind === "webhook",
        supportsReplies: true,
        supportsEdits: false,
        supportsDeletes: false,
        supportsReactions: false,
        supportsButtons: connectionKind === "webhook",
        supportsModals: false,
        supportsFiles: true,
        supportsImages: true,
        supportsTypingIndicator: false,
        maxMessageLength: 4000,
        rateLimitPolicy: { strategy: "provider_default" },
        requiresWebhook: connectionKind === "webhook",
        requiresLocalBridge: connectionKind === "local_bridge",
        requiresUserSession: connectionKind === "local_bridge",
        riskLevel: connectionKind === "local_bridge" ? "high" : "medium",
        deliveryStates: {
            supportsAccepted: true,
            supportsSent: true,
            supportsDelivered: false,
            supportsReadReceipt: false,
        },
    });
}
function getPlaceholderConnection(channelId) {
    const provider = channelId.split(":")[0];
    if (!provider || !["discord", "google_chat", "imessage", "kakaotalk"].includes(provider))
        return undefined;
    const now = Date.now();
    const connectionKind = LOCAL_BRIDGE_PROVIDERS.has(provider) ? "local_bridge" : "webhook";
    return {
        connectionId: channelId.includes(":") ? channelId : `${provider}:primary`,
        provider,
        displayName: provider === "google_chat"
            ? "Google Chat"
            : provider === "imessage"
                ? "iMessage"
                : provider === "kakaotalk"
                    ? "KakaoTalk"
                    : "Discord",
        connectionMode: connectionKind,
        enabled: false,
        configured: false,
        health: {
            status: "stopped",
            message: "Provider is declared in the channel contract but is not configured in this runtime yet.",
            checkedAt: now,
        },
        capabilityManifest: buildPlaceholderCapabilities(provider, connectionKind),
        authSecretRefs: [],
        allowedUsers: [],
        allowedRooms: [],
        defaultDeliveryPolicy: {
            inbound: { requireAllowedPrincipal: true, allowUnlisted: false },
            outbound: { defaultThreadPolicy: "reuse_origin_thread", fallbackChannel: "webui" },
        },
        source: provider,
        configSource: "system",
        createdAt: now,
        updatedAt: now,
        schemaVersion: 1,
    };
}
function findConnection(channelId) {
    return listConnections().find((connection) => connection.connectionId === channelId) ?? getPlaceholderConnection(channelId);
}
function requireConnection(channelId) {
    const connection = findConnection(channelId);
    if (!connection)
        throw new Error(`Unknown channel connection: ${channelId}`);
    return connection;
}
function providerRuntimeStatus(provider) {
    if (provider === "telegram")
        return getTelegramRuntimeStatus();
    if (provider === "slack")
        return getSlackRuntimeStatus();
    return {
        isRunning: false,
        lastStartedAt: null,
        lastStoppedAt: null,
        lastError: null,
        lastErrorAt: null,
    };
}
function connectionValidation(connection) {
    const issues = [];
    if (connection.enabled && !connection.configured) {
        issues.push({
            code: "missing_required_credentials",
            severity: "error",
            message: "Enabled channel is missing required credentials.",
        });
    }
    if (connection.capabilityManifest.requiresWebhook) {
        issues.push({
            code: "webhook_boundary_adapter_required",
            severity: "warning",
            message: "Webhook providers must verify signature or service auth in the provider adapter boundary.",
        });
    }
    if (connection.capabilityManifest.requiresLocalBridge) {
        issues.push({
            code: "local_bridge_risk_ack_required",
            severity: "warning",
            message: "Local bridge providers require explicit user consent before enablement.",
        });
    }
    const runtime = providerRuntimeStatus(connection.provider);
    if (connection.enabled && connection.configured && !runtime.isRunning) {
        issues.push({
            code: "runtime_stopped",
            severity: "warning",
            message: "Channel is configured but runtime is not running.",
        });
    }
    if (!connection.enabled && runtime.isRunning) {
        issues.push({
            code: "runtime_state_mismatch",
            severity: "warning",
            message: "Runtime is active while the channel is disabled in config.",
        });
    }
    return {
        ok: !issues.some((issue) => issue.severity === "error"),
        issues,
    };
}
function channelSummary(connection) {
    const capabilities = connection.capabilityManifest;
    return {
        channelId: connection.connectionId,
        connectionId: connection.connectionId,
        provider: connection.provider,
        displayName: connection.displayName,
        enabled: connection.enabled,
        configured: connection.configured,
        connectionMode: connection.connectionMode,
        health: connection.health,
        runtime: providerRuntimeStatus(connection.provider),
        riskLevel: capabilities.riskLevel,
        capabilitySummary: {
            supportsThreads: capabilities.supportsThreads,
            supportsReplies: capabilities.supportsReplies,
            supportsButtons: capabilities.supportsButtons,
            supportsFiles: capabilities.supportsFiles,
            supportsTypingIndicator: capabilities.supportsTypingIndicator,
            maxMessageLength: capabilities.maxMessageLength,
            requiresWebhook: capabilities.requiresWebhook,
            requiresLocalBridge: capabilities.requiresLocalBridge,
            requiresUserSession: capabilities.requiresUserSession,
        },
        validation: connectionValidation(connection),
    };
}
function channelDetail(connection) {
    return {
        ...channelSummary(connection),
        secrets: redactValue(connection.authSecretRefs),
        allowedUsers: connection.allowedUsers,
        allowedRooms: connection.allowedRooms,
        defaultDeliveryPolicy: connection.defaultDeliveryPolicy,
        configSource: connection.configSource,
        source: connection.source,
        createdAt: connection.createdAt,
        updatedAt: connection.updatedAt,
    };
}
function recordRuntime(connection, eventKind, summary, detail) {
    const event = {
        connection,
        eventKind,
        healthStatus: connection.health.status,
        summary,
    };
    if (detail)
        event.detail = redactValue(detail);
    try {
        recordChannelRuntimeEvent(event);
    }
    catch {
        // Runtime audit is best-effort. Placeholder/future providers may not have a persisted connection row yet.
    }
}
function asRuntimeProvider(provider) {
    return provider === "telegram" || provider === "slack" ? provider : undefined;
}
async function restartConnection(connection, body, reply) {
    if (!asRuntimeProvider(connection.provider)) {
        return reply.status(501).send({
            ok: false,
            error: "provider runtime is not implemented yet",
            channel: channelSummary(connection),
        });
    }
    const cfg = reloadConfig();
    const refreshed = requireConnection(connection.connectionId);
    const validation = connectionValidation(refreshed);
    if (!refreshed.enabled) {
        recordRuntime(refreshed, "restart_skipped_disabled", "Channel restart skipped because the channel is disabled.");
        return { ok: true, status: "disabled", channel: channelSummary(refreshed) };
    }
    if (!refreshed.configured || validation.ok === false) {
        recordRuntime(refreshed, "restart_failed_validation", "Channel restart blocked by validation.", { validation });
        return reply.status(400).send({
            ok: false,
            error: "enabled channel is missing required configuration",
            validation,
            channel: channelSummary(refreshed),
        });
    }
    if (body.dryRun === true) {
        recordRuntime(refreshed, "restart_dry_run", "Channel restart dry-run completed.", { initiatedBy: body.initiatedBy ?? "webui" });
        return { ok: true, status: "dry_run", channel: channelSummary(refreshed) };
    }
    try {
        if (connection.provider === "telegram") {
            if (getActiveTelegramChannel())
                stopActiveTelegramChannel();
            setTelegramRuntimeError(null);
            const channel = new TelegramChannel(cfg.telegram);
            await channel.start();
            setActiveTelegramChannel(channel);
        }
        else {
            if (getActiveSlackChannel())
                stopActiveSlackChannel();
            setSlackRuntimeError(null);
            const channel = new SlackChannel(cfg.slack);
            await channel.start();
            setActiveSlackChannel(channel);
        }
        const started = requireConnection(connection.connectionId);
        recordRuntime(started, "restarted", "Channel runtime restarted.", { initiatedBy: body.initiatedBy ?? "webui" });
        return { ok: true, status: "started", channel: channelSummary(started) };
    }
    catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (connection.provider === "telegram")
            setTelegramRuntimeError(message);
        else
            setSlackRuntimeError(message);
        const failed = requireConnection(connection.connectionId);
        recordRuntime(failed, "restart_failed", "Channel runtime restart failed.", { message });
        return reply.status(500).send({ ok: false, error: message, channel: channelSummary(failed) });
    }
}
function messageLedgerResponse(event) {
    return {
        type: "ledger_event",
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
        detail: redactValue(safeParseJson(event.detail_json)),
        createdAt: event.created_at,
    };
}
function messageRefResponse(ref) {
    return {
        type: "channel_message_ref",
        id: ref.id,
        source: ref.source,
        sessionId: ref.session_id,
        runId: ref.root_run_id,
        requestGroupId: ref.request_group_id,
        externalChatId: ref.external_chat_id,
        externalThreadId: ref.external_thread_id,
        externalMessageId: ref.external_message_id,
        role: ref.role,
        createdAt: ref.created_at,
    };
}
function listChannelMessageRefs(input) {
    const where = [];
    const values = [];
    if (input.channel) {
        where.push("source = ?");
        values.push(input.channel);
    }
    if (input.runId) {
        where.push("root_run_id = ?");
        values.push(input.runId);
    }
    if (input.requestGroupId) {
        where.push("request_group_id = ?");
        values.push(input.requestGroupId);
    }
    values.push(input.limit);
    const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
    return getDb()
        .prepare(`SELECT *
       FROM channel_message_refs
       ${whereSql}
       ORDER BY created_at DESC, id DESC
       LIMIT ?`)
        .all(...values);
}
function listChannelMessages(query) {
    const limit = parseLimit(query.limit);
    const ledgerQuery = { limit };
    if (query.runId)
        ledgerQuery.runId = query.runId;
    if (query.requestGroupId)
        ledgerQuery.requestGroupId = query.requestGroupId;
    if (query.sessionKey)
        ledgerQuery.sessionKey = query.sessionKey;
    if (query.threadKey)
        ledgerQuery.threadKey = query.threadKey;
    const ledger = listMessageLedgerEvents(ledgerQuery)
        .filter((event) => !query.channel || event.channel === query.channel)
        .map(messageLedgerResponse);
    const refQuery = { limit };
    if (query.channel)
        refQuery.channel = query.channel;
    if (query.runId)
        refQuery.runId = query.runId;
    if (query.requestGroupId)
        refQuery.requestGroupId = query.requestGroupId;
    const refs = listChannelMessageRefs(refQuery).map(messageRefResponse);
    return [...ledger, ...refs]
        .sort((left, right) => Number(right.createdAt ?? 0) - Number(left.createdAt ?? 0))
        .slice(0, limit);
}
function getLedgerById(id) {
    return getDb()
        .prepare("SELECT * FROM message_ledger WHERE id = ? LIMIT 1")
        .get(id);
}
function getMessageRefById(id) {
    return getDb()
        .prepare("SELECT * FROM channel_message_refs WHERE id = ? LIMIT 1")
        .get(id);
}
function findDeliveryEvents(deliveryId) {
    return getDb()
        .prepare(`SELECT *
       FROM message_ledger
       WHERE id = ?
          OR delivery_key = ?
          OR idempotency_key = ?
       ORDER BY created_at DESC, id DESC`)
        .all(deliveryId, deliveryId, deliveryId);
}
function approvalResponse(row) {
    return {
        id: row.id,
        runId: row.run_id,
        requestGroupId: row.request_group_id,
        channel: row.channel,
        channelMessageId: row.channel_message_id,
        toolName: row.tool_name,
        riskLevel: row.risk_level,
        kind: row.kind,
        status: row.status,
        paramsHash: row.params_hash,
        paramsPreview: redactValue(safeParseJson(row.params_preview_json) ?? row.params_preview_json),
        requestedAt: row.requested_at,
        expiresAt: row.expires_at,
        consumedAt: row.consumed_at,
        decisionAt: row.decision_at,
        decisionBy: row.decision_by,
        decisionSource: row.decision_source,
        supersededBy: row.superseded_by,
        metadata: redactValue(safeParseJson(row.metadata_json)),
        createdAt: row.created_at,
        updatedAt: row.updated_at,
    };
}
function listApprovals(query) {
    const where = [];
    const values = [];
    if (query.status) {
        where.push("status = ?");
        values.push(query.status);
    }
    if (query.runId) {
        where.push("run_id = ?");
        values.push(query.runId);
    }
    if (query.requestGroupId) {
        where.push("request_group_id = ?");
        values.push(query.requestGroupId);
    }
    values.push(parseLimit(query.limit, 100, 500));
    const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
    return getDb()
        .prepare(`SELECT *
       FROM approval_registry
       ${whereSql}
       ORDER BY created_at DESC, id DESC
       LIMIT ?`)
        .all(...values);
}
function isApprovalDecision(value) {
    return value === "allow_once" || value === "allow_run" || value === "deny";
}
function respondToApproval(approvalId, body, sourceFallback) {
    const decision = body.decision;
    if (!isApprovalDecision(decision)) {
        return { ok: false, statusCode: 400, error: "invalid approval decision" };
    }
    const result = resolveApprovalRegistryDecision({
        approvalId,
        decision,
        decisionBy: body.decisionBy ?? "webui",
        decisionSource: body.decisionSource ?? sourceFallback,
    });
    if (result.accepted && result.row) {
        eventBus.emit("approval.resolved", {
            approvalId: result.row.id,
            runId: result.row.run_id,
            decision,
            toolName: result.row.tool_name,
            kind: result.row.kind,
            reason: "user",
        });
    }
    return {
        ok: result.accepted,
        accepted: result.accepted,
        status: result.status,
        reason: result.reason,
        decision: result.decision,
        approval: result.row ? approvalResponse(result.row) : null,
    };
}
function buildInteractionVerification(body) {
    return {
        verified: true,
        trustBoundary: "authenticated_webui_api",
        providerBoundary: "webhook/socket signature verification stays inside provider adapters",
        suppliedRawSignature: Boolean(body.rawSignature),
        suppliedSecretToken: Boolean(body.secretToken),
    };
}
export function registerChannelsRoute(app) {
    app.get("/api/channels", { preHandler: authMiddleware }, async () => {
        const channels = listConnections().map(channelSummary);
        return { channels, count: channels.length };
    });
    app.get("/api/channels/:channelId", { preHandler: authMiddleware }, async (req, reply) => {
        const connection = findConnection(req.params.channelId);
        if (!connection)
            return reply.status(404).send({ error: "Channel not found" });
        return { channel: channelDetail(connection) };
    });
    app.get("/api/channels/:channelId/health", { preHandler: authMiddleware }, async (req, reply) => {
        const connection = findConnection(req.params.channelId);
        if (!connection)
            return reply.status(404).send({ error: "Channel not found" });
        return {
            channelId: connection.connectionId,
            provider: connection.provider,
            health: connection.health,
            runtime: providerRuntimeStatus(connection.provider),
            validation: connectionValidation(connection),
        };
    });
    app.get("/api/channels/:channelId/capabilities", { preHandler: authMiddleware }, async (req, reply) => {
        const connection = findConnection(req.params.channelId);
        if (!connection)
            return reply.status(404).send({ error: "Channel not found" });
        return {
            channelId: connection.connectionId,
            provider: connection.provider,
            capabilities: redactValue(connection.capabilityManifest),
        };
    });
    app.post("/api/channels/:channelId/enable", { preHandler: authMiddleware }, async (req, reply) => {
        const connection = findConnection(req.params.channelId);
        if (!connection)
            return reply.status(404).send({ error: "Channel not found" });
        const runtimeProvider = asRuntimeProvider(connection.provider);
        if (!runtimeProvider) {
            if (connection.capabilityManifest.requiresLocalBridge && !(req.body?.acknowledgeRisk || req.body?.riskAcknowledged)) {
                recordRuntime(connection, "enable_blocked_risk_ack", "Local bridge enable blocked until user acknowledges risk.");
                return reply.status(400).send({
                    ok: false,
                    error: "local bridge channels require explicit risk acknowledgment",
                    requiresRiskAcknowledgment: true,
                    channel: channelSummary(connection),
                });
            }
            recordRuntime(connection, "enable_unsupported_provider", "Channel enable blocked because provider runtime is not implemented.");
            return reply.status(501).send({
                ok: false,
                error: "provider runtime is not implemented yet",
                channel: channelSummary(connection),
            });
        }
        const updated = updateRawChannelEnabled(runtimeProvider, true);
        return { ok: true, channel: channelDetail(updated) };
    });
    app.post("/api/channels/:channelId/disable", { preHandler: authMiddleware }, async (req, reply) => {
        const connection = findConnection(req.params.channelId);
        if (!connection)
            return reply.status(404).send({ error: "Channel not found" });
        const runtimeProvider = asRuntimeProvider(connection.provider);
        if (!runtimeProvider)
            return reply.status(501).send({ ok: false, error: "provider runtime is not implemented yet", channel: channelSummary(connection) });
        if (runtimeProvider === "telegram")
            stopActiveTelegramChannel();
        if (runtimeProvider === "slack")
            stopActiveSlackChannel();
        const updated = updateRawChannelEnabled(runtimeProvider, false);
        return { ok: true, channel: channelDetail(updated) };
    });
    app.post("/api/channels/:channelId/restart", { preHandler: authMiddleware }, async (req, reply) => {
        const connection = findConnection(req.params.channelId);
        if (!connection)
            return reply.status(404).send({ error: "Channel not found" });
        return restartConnection(connection, req.body ?? {}, reply);
    });
    app.post("/api/channels/:channelId/test", { preHandler: authMiddleware }, async (req, reply) => {
        const connection = findConnection(req.params.channelId);
        if (!connection)
            return reply.status(404).send({ error: "Channel not found" });
        const validation = connectionValidation(connection);
        if (!connection.enabled) {
            recordRuntime(connection, "test_send_skipped_disabled", "Channel test send skipped because channel is disabled.");
            return reply.status(400).send({ ok: false, error: "channel is disabled", validation, channel: channelSummary(connection) });
        }
        if (!connection.configured || validation.ok === false) {
            recordRuntime(connection, "test_send_failed_validation", "Channel test send blocked by validation.", { validation });
            return reply.status(400).send({ ok: false, error: "channel is missing required configuration", validation, channel: channelSummary(connection) });
        }
        recordRuntime(connection, "test_send_dry_run", "Channel test send dry-run accepted.", { initiatedBy: req.body?.initiatedBy ?? "webui" });
        return {
            ok: true,
            mode: "dry-run",
            receipt: {
                channelId: connection.connectionId,
                provider: connection.provider,
                connectionId: connection.connectionId,
                status: "accepted",
                timestamp: Date.now(),
                idempotencyKey: `channel-test:${connection.connectionId}:${crypto.randomUUID()}`,
            },
            channel: channelSummary(connection),
        };
    });
    app.post("/api/channels/restart", { preHandler: authMiddleware }, async (_req, reply) => {
        try {
            await startChannels();
            return { ok: true, status: "started", channels: listConnections().map(channelSummary) };
        }
        catch (error) {
            return reply.status(500).send({ ok: false, error: error instanceof Error ? error.message : String(error) });
        }
    });
    app.get("/api/channel-messages", { preHandler: authMiddleware }, async (req) => {
        const messages = listChannelMessages(req.query);
        return { messages, count: messages.length };
    });
    app.get("/api/channel-messages/:messageId", { preHandler: authMiddleware }, async (req, reply) => {
        const ledger = getLedgerById(req.params.messageId);
        if (ledger)
            return { message: messageLedgerResponse(ledger) };
        const ref = getMessageRefById(req.params.messageId);
        if (ref)
            return { message: messageRefResponse(ref) };
        return reply.status(404).send({ error: "Channel message not found" });
    });
    app.get("/api/runs/:runId/channel-messages", { preHandler: authMiddleware }, async (req) => {
        const messages = listChannelMessages({ ...req.query, runId: req.params.runId });
        return { messages, count: messages.length };
    });
    app.get("/api/tasks/:taskId/channel-messages", { preHandler: authMiddleware }, async (req) => {
        const byRequestGroup = listChannelMessages({ ...req.query, requestGroupId: req.params.taskId });
        const byRun = listChannelMessages({ ...req.query, runId: req.params.taskId });
        const byId = new Map();
        for (const message of [...byRequestGroup, ...byRun])
            byId.set(String(message.id), message);
        const messages = [...byId.values()].sort((left, right) => Number(right.createdAt ?? 0) - Number(left.createdAt ?? 0));
        return { messages, count: messages.length };
    });
    app.post("/api/channel-deliveries/:deliveryId/retry", { preHandler: authMiddleware }, async (req, reply) => {
        const events = findDeliveryEvents(req.params.deliveryId);
        if (events.length === 0)
            return reply.status(404).send({ ok: false, error: "Delivery not found" });
        const terminal = events.find((event) => FINAL_DELIVERY_EVENT_KINDS.has(event.event_kind) || TERMINAL_DELIVERY_STATUSES.has(event.status));
        if (terminal) {
            return {
                ok: true,
                status: "suppressed",
                reason: "already_finalized",
                delivery: messageLedgerResponse(terminal),
            };
        }
        const latest = events[0];
        const retryId = recordMessageLedgerEvent({
            runId: latest.run_id,
            requestGroupId: latest.request_group_id,
            sessionKey: latest.session_key,
            threadKey: latest.thread_key,
            channel: latest.channel,
            eventKind: "delivery_attempted",
            deliveryKey: latest.delivery_key ?? latest.id,
            idempotencyKey: `channel-delivery-retry:${req.params.deliveryId}`,
            status: "pending",
            summary: "Delivery retry requested by channel API.",
            detail: {
                originalDeliveryId: req.params.deliveryId,
                sourceEventId: latest.id,
                replayGuard: "retry recorded only; provider finalizer/idempotency still owns delivery",
            },
        });
        return {
            ok: true,
            status: retryId ? "accepted_for_reconciliation" : "already_requested",
            retryEventId: retryId,
            delivery: messageLedgerResponse(latest),
        };
    });
    app.get("/api/approvals", { preHandler: authMiddleware }, async (req) => {
        const approvals = listApprovals(req.query).map(approvalResponse);
        return { approvals, count: approvals.length };
    });
    app.post("/api/approvals/:approvalId/respond", { preHandler: authMiddleware }, async (req, reply) => {
        const result = respondToApproval(req.params.approvalId, req.body ?? {}, "api:webui");
        if (result.statusCode === 400)
            return reply.status(400).send({ ok: false, error: result.error });
        if (result.status === "missing")
            return reply.status(404).send(result);
        return result;
    });
    app.post("/api/channel-interactions", { preHandler: authMiddleware }, async (req, reply) => {
        const body = req.body ?? {};
        const provider = body.provider?.trim();
        const connectionId = body.connectionId?.trim() || (provider ? `${provider}:primary` : "");
        if (!provider || !connectionId || !body.interactionId || !body.kind) {
            return reply.status(400).send({ ok: false, error: "provider, connectionId, interactionId, and kind are required" });
        }
        const connection = findConnection(connectionId);
        if (!connection)
            return reply.status(404).send({ ok: false, error: "Channel not found" });
        const verification = buildInteractionVerification(body);
        const approvalId = body.approvalId ?? body.correlationId ?? body.value;
        let approval = null;
        if (body.approvalDecision && approvalId) {
            const result = respondToApproval(approvalId, {
                decision: body.approvalDecision,
                decisionBy: body.senderId ?? `${provider}:interaction`,
                decisionSource: `channel:${provider}`,
            }, `channel:${provider}`);
            if (result.statusCode === 400)
                return reply.status(400).send({ ok: false, error: result.error, verification });
            approval = result;
        }
        recordRuntime(connection, "interaction_received", "Channel interaction received by API.", {
            provider,
            interactionId: body.interactionId,
            kind: body.kind,
            messageId: body.messageId,
            threadId: body.threadId,
            roomId: body.roomId,
            actionId: body.actionId,
            value: body.value,
            rawPayload: body.rawPayload,
        });
        return {
            ok: true,
            interactionId: body.interactionId,
            provider,
            connectionId,
            verification,
            approval,
            existingApproval: approvalId ? (getApprovalRegistryRow(approvalId) ? approvalResponse(getApprovalRegistryRow(approvalId)) : null) : null,
        };
    });
}
//# sourceMappingURL=channels.js.map