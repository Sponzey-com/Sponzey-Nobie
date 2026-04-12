import { readFileSync, writeFileSync, existsSync } from "node:fs";
import JSON5 from "json5";
import { getConfig, reloadConfig } from "../../config/index.js";
import { getProvider, getDefaultModel, resetAIProviderCache } from "../../ai/index.js";
import { PATHS } from "../../config/paths.js";
import { authMiddleware } from "../middleware/auth.js";
import { getActiveSlackChannel, getSlackRuntimeStatus, setSlackRuntimeError, stopActiveSlackChannel } from "../../channels/slack/runtime.js";
import { startChannels } from "../../channels/index.js";
import { getActiveTelegramChannel, getTelegramRuntimeStatus, setActiveTelegramChannel, setTelegramRuntimeError, stopActiveTelegramChannel } from "../../channels/telegram/runtime.js";
import { buildSetupDraft, createSetupChecks, readSetupState, resetSetupEnvironment, saveSetupDraft } from "../../control-plane/index.js";
import { disconnectMqttExtension, getMqttExchangeLogs, getMqttExtensionSnapshots, restartMqttBrokerFromConfig } from "../../mqtt/broker.js";
import { updateActiveRunsMaxDelegationTurns } from "../../runs/store.js";
import { getVectorBackendStatus } from "../../memory/embedding.js";
function buildLegacySettingsSnapshot() {
    const cfg = getConfig();
    const telegramChannel = getActiveTelegramChannel();
    const slackChannel = getActiveSlackChannel();
    const telegramRuntime = getTelegramRuntimeStatus();
    const slackRuntime = getSlackRuntimeStatus();
    const connection = cfg.ai.connection;
    return {
        ai: {
            provider: connection.provider,
            model: connection.model,
            authMode: connection.auth?.mode ?? "api_key",
            endpoint: connection.endpoint ?? "",
            hasApiKey: Boolean(connection.auth?.apiKey),
            oauthAuthFilePath: connection.auth?.oauthAuthFilePath ?? "",
        },
        security: {
            approvalMode: cfg.security.approvalMode,
            approvalTimeout: cfg.security.approvalTimeout,
            approvalTimeoutFallback: cfg.security.approvalTimeoutFallback,
            maxDelegationTurns: cfg.orchestration.maxDelegationTurns,
            allowedCommands: cfg.security.allowedCommands,
            allowedPaths: cfg.security.allowedPaths,
        },
        search: {
            webProvider: cfg.search.web?.provider ?? "duckduckgo",
            webMaxResults: cfg.search.web?.maxResults ?? 5,
        },
        memory: {
            searchMode: cfg.memory.searchMode ?? "fts",
            vectorBackend: getVectorBackendStatus(),
        },
        webui: {
            port: cfg.webui.port,
            host: cfg.webui.host,
            authEnabled: cfg.webui.auth.enabled,
        },
        telegram: {
            enabled: cfg.telegram?.enabled ?? false,
            botToken: cfg.telegram?.botToken ? "***" : "",
            hasBotToken: Boolean(cfg.telegram?.botToken),
            allowedUserIds: cfg.telegram?.allowedUserIds ?? [],
            allowedGroupIds: cfg.telegram?.allowedGroupIds ?? [],
            isRunning: telegramChannel !== null,
            runtime: telegramRuntime,
        },
        slack: {
            enabled: cfg.slack?.enabled ?? false,
            hasBotToken: Boolean(cfg.slack?.botToken),
            hasAppToken: Boolean(cfg.slack?.appToken),
            allowedUserIds: cfg.slack?.allowedUserIds ?? [],
            allowedChannelIds: cfg.slack?.allowedChannelIds ?? [],
            isRunning: slackChannel !== null,
            runtime: slackRuntime,
        },
        mqtt: {
            enabled: cfg.mqtt.enabled,
            host: cfg.mqtt.host,
            port: cfg.mqtt.port,
            username: cfg.mqtt.username,
            hasPassword: Boolean(cfg.mqtt.password),
            allowAnonymous: cfg.mqtt.allowAnonymous,
        },
    };
}
function buildSettingsResponse() {
    const legacy = buildLegacySettingsSnapshot();
    return {
        ...legacy,
        draft: buildSetupDraft(),
        state: readSetupState(),
        checks: createSetupChecks(),
        legacy,
    };
}
export function registerSettingsRoute(app) {
    app.get("/api/settings", { preHandler: authMiddleware }, async () => {
        return buildSettingsResponse();
    });
    app.get("/api/settings/mqtt/runtime", { preHandler: authMiddleware }, async () => {
        return {
            extensions: getMqttExtensionSnapshots(),
            logs: getMqttExchangeLogs(),
        };
    });
    app.post("/api/settings/mqtt/extensions/:extensionId/disconnect", { preHandler: authMiddleware }, async (req) => {
        return disconnectMqttExtension(req.params.extensionId);
    });
    app.put("/api/settings", { preHandler: authMiddleware }, async (req, reply) => {
        const body = req.body;
        if (body &&
            typeof body === "object" &&
            "draft" in body &&
            body.draft &&
            typeof body.draft === "object") {
            const payload = body;
            const saved = saveSetupDraft(payload.draft, payload.state);
            try {
                await restartMqttBrokerFromConfig();
            }
            catch {
                // The config save itself succeeded. Runtime issues are exposed through MQTT status/capabilities.
            }
            return reply.status(200).send({
                ok: true,
                draft: saved.draft,
                state: saved.state,
                checks: createSetupChecks(),
                legacy: buildLegacySettingsSnapshot(),
            });
        }
        let raw = {};
        if (existsSync(PATHS.configFile)) {
            try {
                raw = JSON5.parse(readFileSync(PATHS.configFile, "utf-8"));
            }
            catch {
                // start from an empty object when the file is unreadable
            }
        }
        const aiBody = body.ai && typeof body.ai === "object"
            ? body.ai
            : null;
        if (aiBody) {
            if (!raw.ai)
                raw.ai = {};
            const rawAi = raw.ai;
            const currentConnection = rawAi.connection && typeof rawAi.connection === "object"
                ? rawAi.connection
                : {};
            const currentAuth = currentConnection.auth && typeof currentConnection.auth === "object"
                ? currentConnection.auth
                : {};
            rawAi.connection = {
                ...currentConnection,
                ...(typeof aiBody.provider === "string" ? { provider: aiBody.provider.trim() } : {}),
                ...(typeof aiBody.model === "string" ? { model: aiBody.model.trim() } : {}),
                ...(typeof aiBody.endpoint === "string" ? { endpoint: aiBody.endpoint.trim() } : {}),
                auth: {
                    ...currentAuth,
                    ...(typeof aiBody.authMode === "string" ? { mode: aiBody.authMode } : {}),
                    ...(typeof aiBody.apiKey === "string" ? { apiKey: aiBody.apiKey } : {}),
                    ...(typeof aiBody.oauthAuthFilePath === "string" ? { oauthAuthFilePath: aiBody.oauthAuthFilePath.trim() } : {}),
                },
            };
            delete rawAi.providers;
            delete rawAi.defaultProvider;
            delete rawAi.defaultModel;
        }
        if (body.security && typeof body.security === "object") {
            const sec = body.security;
            if (!raw.security)
                raw.security = {};
            const rawSec = raw.security;
            if (typeof sec.approvalMode === "string")
                rawSec.approvalMode = sec.approvalMode;
            if (typeof sec.approvalTimeout === "number")
                rawSec.approvalTimeout = sec.approvalTimeout;
            if (typeof sec.approvalTimeoutFallback === "string")
                rawSec.approvalTimeoutFallback = sec.approvalTimeoutFallback;
            if (typeof sec.maxDelegationTurns === "number") {
                if (!raw.orchestration)
                    raw.orchestration = {};
                raw.orchestration.maxDelegationTurns = Math.max(0, Math.floor(sec.maxDelegationTurns));
            }
            if (Array.isArray(sec.allowedCommands))
                rawSec.allowedCommands = sec.allowedCommands;
            if (Array.isArray(sec.allowedPaths))
                rawSec.allowedPaths = sec.allowedPaths;
        }
        if (body.search && typeof body.search === "object") {
            const s = body.search;
            if (!raw.search)
                raw.search = {};
            const rawSearch = raw.search;
            if (!rawSearch.web)
                rawSearch.web = {};
            const web = rawSearch.web;
            if (typeof s.webProvider === "string")
                web.provider = s.webProvider;
            if (typeof s.webMaxResults === "number")
                web.maxResults = s.webMaxResults;
        }
        if (body.telegram && typeof body.telegram === "object") {
            const tg = body.telegram;
            if (!raw.telegram)
                raw.telegram = {};
            const rawTg = raw.telegram;
            if (typeof tg.enabled === "boolean")
                rawTg.enabled = tg.enabled;
            // Only write botToken when user supplies a real new value
            if (typeof tg.botToken === "string" && tg.botToken && tg.botToken !== "***") {
                rawTg.botToken = tg.botToken;
            }
            else if (!rawTg.botToken) {
                // Not in file either — pull from current in-memory config as last resort
                const inMemToken = getConfig().telegram?.botToken;
                if (inMemToken)
                    rawTg.botToken = inMemToken;
            }
            if (Array.isArray(tg.allowedUserIds))
                rawTg.allowedUserIds = tg.allowedUserIds;
            if (Array.isArray(tg.allowedGroupIds))
                rawTg.allowedGroupIds = tg.allowedGroupIds;
        }
        if (body.mqtt && typeof body.mqtt === "object") {
            const mqtt = body.mqtt;
            if (!raw.mqtt)
                raw.mqtt = {};
            const rawMqtt = raw.mqtt;
            if (typeof mqtt.enabled === "boolean")
                rawMqtt.enabled = mqtt.enabled;
            if (typeof mqtt.host === "string")
                rawMqtt.host = mqtt.host.trim();
            if (typeof mqtt.port === "number")
                rawMqtt.port = Math.max(1, Math.min(65535, Math.floor(mqtt.port)));
            if (typeof mqtt.username === "string")
                rawMqtt.username = mqtt.username.trim();
            if (typeof mqtt.password === "string")
                rawMqtt.password = mqtt.password;
            rawMqtt.allowAnonymous = false;
        }
        writeFileSync(PATHS.configFile, JSON5.stringify(raw, null, 2), "utf-8");
        const reloaded = reloadConfig();
        resetAIProviderCache();
        updateActiveRunsMaxDelegationTurns(reloaded.orchestration.maxDelegationTurns);
        try {
            await restartMqttBrokerFromConfig();
        }
        catch {
            // The config save succeeded; runtime failure is surfaced by MQTT status/capabilities.
        }
        return reply.status(200).send({ ok: true, ...buildSettingsResponse() });
    });
    app.post("/api/settings/reset", { preHandler: authMiddleware }, async () => {
        stopActiveSlackChannel();
        stopActiveTelegramChannel();
        const snapshot = resetSetupEnvironment();
        try {
            await restartMqttBrokerFromConfig();
        }
        catch {
            // Keep returning the reset snapshot even when MQTT runtime restart fails.
        }
        return {
            ok: true,
            ...snapshot,
            legacy: buildLegacySettingsSnapshot(),
        };
    });
    app.post("/api/settings/reload", { preHandler: authMiddleware }, async () => {
        reloadConfig();
        resetAIProviderCache();
        try {
            await restartMqttBrokerFromConfig();
        }
        catch {
            // Keep returning the reloaded snapshot even when MQTT runtime restart fails.
        }
        return { ok: true, ...buildSettingsResponse() };
    });
    app.post("/api/settings/telegram/restart", { preHandler: authMiddleware }, async (_req, reply) => {
        const cfg = reloadConfig();
        if (!cfg.telegram?.botToken) {
            setTelegramRuntimeError("봇 토큰이 설정되지 않았습니다.");
            return reply.status(400).send({ ok: false, error: "봇 토큰이 설정되지 않았습니다. 토큰을 입력하고 저장해 주세요." });
        }
        try {
            if (getActiveTelegramChannel())
                stopActiveTelegramChannel();
            setTelegramRuntimeError(null);
            if (!cfg.telegram.enabled) {
                return { ok: true, status: "disabled" };
            }
            const { TelegramChannel } = await import("../../channels/telegram/bot.js");
            const ch = new TelegramChannel(cfg.telegram);
            await ch.start();
            setActiveTelegramChannel(ch);
            return { ok: true, status: "started" };
        }
        catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            setTelegramRuntimeError(message);
            return reply.status(500).send({ ok: false, error: message });
        }
    });
    app.post("/api/settings/channels/restart", { preHandler: authMiddleware }, async (_req, reply) => {
        const cfg = reloadConfig();
        try {
            stopActiveSlackChannel();
            stopActiveTelegramChannel();
            setSlackRuntimeError(null);
            setTelegramRuntimeError(null);
            const hasTelegramConfig = Boolean(cfg.telegram?.botToken);
            const hasSlackConfig = Boolean(cfg.slack?.botToken && cfg.slack?.appToken);
            if ((cfg.telegram?.enabled && !hasTelegramConfig) || (cfg.slack?.enabled && !hasSlackConfig)) {
                return reply.status(400).send({
                    ok: false,
                    error: "활성화된 채널의 필수 토큰이 비어 있습니다.",
                });
            }
            await startChannels();
            return { ok: true, status: "started" };
        }
        catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            setSlackRuntimeError(message);
            setTelegramRuntimeError(message);
            return reply.status(500).send({ ok: false, error: message });
        }
    });
    // POST /api/settings/test-ai
    app.post("/api/settings/test-ai", { preHandler: authMiddleware }, async (_req, reply) => {
        try {
            const model = getDefaultModel();
            const provider = getProvider();
            const chunks = [];
            for await (const chunk of provider.chat({
                model,
                messages: [{ role: "user", content: "Reply with just: OK" }],
                system: "You are a connection test. Reply with exactly: OK",
                tools: [],
                signal: new AbortController().signal,
            })) {
                if (chunk.type === "text_delta")
                    chunks.push(chunk.delta);
                if (chunk.type === "message_stop")
                    break;
            }
            return { ok: true, response: chunks.join("").trim(), model };
        }
        catch (err) {
            return reply.status(503).send({
                ok: false,
                error: err instanceof Error ? err.message : String(err),
            });
        }
    });
}
//# sourceMappingURL=settings.js.map