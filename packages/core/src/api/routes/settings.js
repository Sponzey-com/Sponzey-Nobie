import { readFileSync, writeFileSync, existsSync } from "node:fs";
import JSON5 from "json5";
import { getConfig, reloadConfig } from "../../config/index.js";
import { getProvider, getDefaultModel } from "../../ai/index.js";
import { PATHS } from "../../config/paths.js";
import { authMiddleware } from "../middleware/auth.js";
import { getActiveTelegramChannel, setActiveTelegramChannel, setTelegramRuntimeError, stopActiveTelegramChannel } from "../../channels/telegram/runtime.js";
import { buildSetupDraft, createSetupChecks, readSetupState, resetSetupEnvironment, saveSetupDraft } from "../../control-plane/index.js";
import { updateActiveRunsMaxDelegationTurns } from "../../runs/store.js";
function buildLegacySettingsSnapshot() {
    const cfg = getConfig();
    const telegramChannel = getActiveTelegramChannel();
    return {
        ai: {
            defaultProvider: cfg.ai.defaultProvider,
            defaultModel: cfg.ai.defaultModel,
            hasAnthropicKey: (cfg.ai.providers.anthropic?.apiKeys ?? []).filter(Boolean).length > 0,
            hasOpenAIKey: (cfg.ai.providers.openai?.apiKeys ?? []).filter(Boolean).length > 0,
            hasGeminiKey: (cfg.ai.providers.gemini?.apiKeys ?? []).filter(Boolean).length > 0,
            ollamaBaseUrl: cfg.ai.providers.ollama?.baseUrl ?? "",
            openAIBaseUrl: cfg.ai.providers.openai?.baseUrl ?? "",
            geminiBaseUrl: cfg.ai.providers.gemini?.baseUrl ?? "",
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
    app.put("/api/settings", { preHandler: authMiddleware }, async (req, reply) => {
        const body = req.body;
        if (body &&
            typeof body === "object" &&
            "draft" in body &&
            body.draft &&
            typeof body.draft === "object") {
            const payload = body;
            const saved = saveSetupDraft(payload.draft, payload.state);
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
        if (body.ai && typeof body.ai === "object") {
            const ai = body.ai;
            if (!raw.ai)
                raw.ai = {};
            const rawAi = raw.ai;
            if (typeof ai.defaultProvider === "string")
                rawAi.defaultProvider = ai.defaultProvider;
            if (typeof ai.defaultModel === "string")
                rawAi.defaultModel = ai.defaultModel;
            if (typeof ai.ollamaBaseUrl === "string") {
                if (!rawAi.providers)
                    rawAi.providers = {};
                const p = rawAi.providers;
                if (!p.ollama)
                    p.ollama = {};
                p.ollama.baseUrl = ai.ollamaBaseUrl;
            }
            if (typeof ai.openAIBaseUrl === "string") {
                if (!rawAi.providers)
                    rawAi.providers = {};
                const p = rawAi.providers;
                if (!p.openai)
                    p.openai = {};
                p.openai.baseUrl = ai.openAIBaseUrl;
            }
            if (typeof ai.geminiBaseUrl === "string") {
                if (!rawAi.providers)
                    rawAi.providers = {};
                const p = rawAi.providers;
                if (!p.gemini)
                    p.gemini = {};
                p.gemini.baseUrl = ai.geminiBaseUrl;
            }
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
        writeFileSync(PATHS.configFile, JSON5.stringify(raw, null, 2), "utf-8");
        const reloaded = reloadConfig();
        updateActiveRunsMaxDelegationTurns(reloaded.orchestration.maxDelegationTurns);
        return reply.status(200).send({ ok: true, ...buildSettingsResponse() });
    });
    app.post("/api/settings/reset", { preHandler: authMiddleware }, async () => {
        stopActiveTelegramChannel();
        const snapshot = resetSetupEnvironment();
        return {
            ok: true,
            ...snapshot,
            legacy: buildLegacySettingsSnapshot(),
        };
    });
    app.post("/api/settings/reload", { preHandler: authMiddleware }, async () => {
        reloadConfig();
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
