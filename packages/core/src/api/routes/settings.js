import { readFileSync, writeFileSync, existsSync } from "node:fs";
import JSON5 from "json5";
import { getConfig, reloadConfig } from "../../config/index.js";
import { getProvider, getDefaultModel, resetAIProviderCache, resolveProviderResolutionSnapshot } from "../../ai/index.js";
import { attachCapabilityProfileToTrace, getProviderCapabilityMatrix } from "../../ai/capabilities.js";
import { PATHS } from "../../config/paths.js";
import { authMiddleware } from "../middleware/auth.js";
import { getActiveSlackChannel, getSlackRuntimeStatus, setSlackRuntimeError, stopActiveSlackChannel } from "../../channels/slack/runtime.js";
import { CHANNEL_REGISTRY_RUNTIME_FEATURE_KEY, buildChannelRegistryRuntimeDiagnostics, resolveChannelRegistryRuntimeMode, startChannels, } from "../../channels/index.js";
import { getActiveTelegramChannel, getTelegramRuntimeStatus, setActiveTelegramChannel, setTelegramRuntimeError, stopActiveTelegramChannel } from "../../channels/telegram/runtime.js";
import { getDiscordRuntimeStatus, setDiscordRuntimeError, stopDiscordRuntime } from "../../channels/discord/runtime.js";
import { getGoogleChatRuntimeStatus, setGoogleChatRuntimeError, stopGoogleChatRuntime } from "../../channels/google-chat/runtime.js";
import { buildSetupDraft, createSetupChecks, readSetupState, resetSetupEnvironment, saveSetupDraft } from "../../control-plane/index.js";
import { disconnectMqttExtension, getMqttExchangeLogs, getMqttExtensionSnapshots, restartMqttBrokerFromConfig } from "../../mqtt/broker.js";
import { updateActiveRunsMaxDelegationTurns } from "../../runs/store.js";
import { getVectorBackendStatus, resetEmbeddingProvider } from "../../memory/embedding.js";
import { sanitizeUserFacingError } from "../../runs/error-sanitizer.js";
import { chatWithContextPreflight } from "../../runs/context-preflight.js";
import { applyChannelConnectionSettingsCompatPatch, buildSettingsChannelConnectionSnapshot, } from "../../channels/connections.js";
import { getFeatureFlag } from "../../runtime/rollout-safety.js";
function isOrchestrationMode(value) {
    return value === "single_nobie" || value === "orchestration";
}
function buildLegacySettingsSnapshot() {
    const cfg = getConfig();
    const telegramChannel = getActiveTelegramChannel();
    const slackChannel = getActiveSlackChannel();
    const telegramRuntime = getTelegramRuntimeStatus();
    const slackRuntime = getSlackRuntimeStatus();
    const discordRuntime = getDiscordRuntimeStatus();
    const googleChatRuntime = getGoogleChatRuntimeStatus();
    const connection = cfg.ai.connection;
    const providerCapability = getProviderCapabilityMatrix({ connection, memory: cfg.memory });
    const channelRuntimeFeatureFlag = getFeatureFlag(CHANNEL_REGISTRY_RUNTIME_FEATURE_KEY);
    const channelConnections = buildSettingsChannelConnectionSnapshot({
        config: cfg,
        runtime: {
            telegram: telegramRuntime,
            slack: slackRuntime,
            discord: discordRuntime,
            googleChat: googleChatRuntime,
        },
    });
    return {
        ai: {
            provider: connection.provider,
            model: connection.model,
            authMode: connection.auth?.mode ?? "api_key",
            endpoint: connection.endpoint ?? "",
            hasApiKey: Boolean(connection.auth?.apiKey),
            oauthAuthFilePath: connection.auth?.oauthAuthFilePath ?? "",
            providerCapability,
        },
        security: {
            approvalMode: cfg.security.approvalMode,
            approvalTimeout: cfg.security.approvalTimeout,
            approvalTimeoutFallback: cfg.security.approvalTimeoutFallback,
            maxDelegationTurns: cfg.orchestration.maxDelegationTurns,
            allowedCommands: cfg.security.allowedCommands,
            allowedPaths: cfg.security.allowedPaths,
        },
        orchestration: {
            mode: cfg.orchestration.mode ?? "single_nobie",
            featureFlagEnabled: cfg.orchestration.featureFlagEnabled === true,
            maxDelegationTurns: cfg.orchestration.maxDelegationTurns,
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
        discord: {
            enabled: cfg.discord?.enabled ?? false,
            hasBotToken: Boolean(cfg.discord?.botToken),
            applicationId: cfg.discord?.applicationId ?? "",
            hasPublicKey: Boolean(cfg.discord?.publicKey),
            allowedUserIds: cfg.discord?.allowedUserIds ?? [],
            allowedGuildIds: cfg.discord?.allowedGuildIds ?? [],
            allowedChannelIds: cfg.discord?.allowedChannelIds ?? [],
            isRunning: discordRuntime.isRunning,
            runtime: discordRuntime,
        },
        googleChat: {
            enabled: cfg.googleChat?.enabled ?? false,
            projectId: cfg.googleChat?.projectId ?? "",
            hasAppCredentialJson: Boolean(cfg.googleChat?.appCredentialJson),
            serviceAccountEmail: cfg.googleChat?.serviceAccountEmail ?? "",
            webhookUrl: cfg.googleChat?.webhookUrl ?? "",
            hasVerificationToken: Boolean(cfg.googleChat?.verificationToken),
            allowedUserIds: cfg.googleChat?.allowedUserIds ?? [],
            allowedSpaceIds: cfg.googleChat?.allowedSpaceIds ?? [],
            deployedSpaceIds: cfg.googleChat?.deployedSpaceIds ?? [],
            grantedScopes: cfg.googleChat?.grantedScopes ?? [],
            appPublished: cfg.googleChat?.appPublished === true,
            domainWideDelegation: cfg.googleChat?.domainWideDelegation === true,
            isRunning: googleChatRuntime.isRunning,
            runtime: googleChatRuntime,
        },
        imessage: {
            enabled: cfg.imessage?.enabled ?? false,
            mode: cfg.imessage?.mode ?? "manual_confirm",
            localBridgeEnabled: cfg.imessage?.localBridgeEnabled === true,
            yeonjangBridgeEnabled: cfg.imessage?.yeonjangBridgeEnabled === true,
            riskAcknowledged: cfg.imessage?.riskAcknowledged === true,
            messagesAppAvailable: cfg.imessage?.messagesAppAvailable === true,
            userSessionActive: cfg.imessage?.userSessionActive === true,
            automationPermissionGranted: cfg.imessage?.automationPermissionGranted === true,
            allowedRecipientIds: cfg.imessage?.allowedRecipientIds ?? [],
            manualConfirmationRequired: cfg.imessage?.manualConfirmationRequired !== false,
            isRunning: false,
            runtime: {
                isRunning: false,
                lastStartedAt: null,
                lastStoppedAt: null,
                lastError: null,
                lastErrorAt: null,
            },
        },
        kakaoTalk: {
            enabled: cfg.kakaoTalk?.enabled ?? false,
            mode: cfg.kakaoTalk?.mode ?? "local_bridge",
            businessApiEnabled: cfg.kakaoTalk?.businessApiEnabled === true,
            hasBusinessApiKey: Boolean(cfg.kakaoTalk?.businessApiKey),
            channelId: cfg.kakaoTalk?.channelId ?? "",
            localBridgeEnabled: cfg.kakaoTalk?.localBridgeEnabled === true,
            yeonjangBridgeEnabled: cfg.kakaoTalk?.yeonjangBridgeEnabled === true,
            riskAcknowledged: cfg.kakaoTalk?.riskAcknowledged === true,
            kakaoTalkAppAvailable: cfg.kakaoTalk?.kakaoTalkAppAvailable === true,
            userSessionActive: cfg.kakaoTalk?.userSessionActive === true,
            automationPermissionGranted: cfg.kakaoTalk?.automationPermissionGranted === true,
            allowedUserIds: cfg.kakaoTalk?.allowedUserIds ?? [],
            allowedRoomIds: cfg.kakaoTalk?.allowedRoomIds ?? [],
            manualConfirmationRequired: cfg.kakaoTalk?.manualConfirmationRequired !== false,
            rateLimitPerMinute: cfg.kakaoTalk?.rateLimitPerMinute ?? 6,
            isRunning: false,
            runtime: {
                isRunning: false,
                lastStartedAt: null,
                lastStoppedAt: null,
                lastError: null,
                lastErrorAt: null,
            },
        },
        channels: {
            connections: channelConnections,
            runtime: {
                mode: resolveChannelRegistryRuntimeMode(channelRuntimeFeatureFlag),
                featureFlag: {
                    featureKey: channelRuntimeFeatureFlag.featureKey,
                    mode: channelRuntimeFeatureFlag.mode,
                    compatibilityMode: channelRuntimeFeatureFlag.compatibilityMode,
                },
                diagnostics: buildChannelRegistryRuntimeDiagnostics(cfg),
            },
        },
        channelConnections,
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
            extensions: getMqttExtensionSnapshots().map((snapshot) => ({
                extensionId: snapshot.extensionId,
                clientId: snapshot.clientId,
                displayName: snapshot.displayName,
                instanceId: snapshot.instanceId ?? null,
                instanceAlias: snapshot.instanceAlias ?? null,
                state: snapshot.state,
                message: snapshot.message,
                version: snapshot.version,
                protocolVersion: snapshot.protocolVersion ?? null,
                gitTag: snapshot.gitTag ?? null,
                gitCommit: snapshot.gitCommit ?? null,
                buildTarget: snapshot.buildTarget ?? null,
                platform: snapshot.platform ?? null,
                os: snapshot.os ?? null,
                arch: snapshot.arch ?? null,
                transport: snapshot.transport ?? [],
                capabilityHash: snapshot.capabilityHash ?? null,
                methods: snapshot.methods ?? [],
                methodCount: snapshot.methods.length,
                permissions: snapshot.permissions ?? {},
                toolHealth: snapshot.toolHealth ?? {},
                capabilityMatrix: snapshot.capabilityMatrix ?? {},
                lastCapabilityRefreshAt: snapshot.lastCapabilityRefreshAt ?? null,
                lastSeenAt: snapshot.lastSeenAt,
                sessionId: snapshot.sessionId ?? null,
            })),
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
        if (body.orchestration && typeof body.orchestration === "object") {
            const orchestration = body.orchestration;
            if (!raw.orchestration)
                raw.orchestration = {};
            const rawOrchestration = raw.orchestration;
            if (isOrchestrationMode(orchestration.mode))
                rawOrchestration.mode = orchestration.mode;
            if (typeof orchestration.featureFlagEnabled === "boolean") {
                rawOrchestration.featureFlagEnabled = orchestration.featureFlagEnabled;
            }
            if (typeof orchestration.maxDelegationTurns === "number") {
                rawOrchestration.maxDelegationTurns = Math.max(0, Math.floor(orchestration.maxDelegationTurns));
            }
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
        if (body.slack && typeof body.slack === "object") {
            const slack = body.slack;
            if (!raw.slack)
                raw.slack = {};
            const rawSlack = raw.slack;
            if (typeof slack.enabled === "boolean")
                rawSlack.enabled = slack.enabled;
            if (typeof slack.botToken === "string" && slack.botToken && slack.botToken !== "***") {
                rawSlack.botToken = slack.botToken;
            }
            else if (!rawSlack.botToken) {
                const inMemToken = getConfig().slack?.botToken;
                if (inMemToken)
                    rawSlack.botToken = inMemToken;
            }
            if (typeof slack.appToken === "string" && slack.appToken && slack.appToken !== "***") {
                rawSlack.appToken = slack.appToken;
            }
            else if (!rawSlack.appToken) {
                const inMemToken = getConfig().slack?.appToken;
                if (inMemToken)
                    rawSlack.appToken = inMemToken;
            }
            if (Array.isArray(slack.allowedUserIds))
                rawSlack.allowedUserIds = slack.allowedUserIds;
            if (Array.isArray(slack.allowedChannelIds))
                rawSlack.allowedChannelIds = slack.allowedChannelIds;
        }
        if (body.discord && typeof body.discord === "object") {
            const discord = body.discord;
            if (!raw.discord)
                raw.discord = {};
            const rawDiscord = raw.discord;
            if (typeof discord.enabled === "boolean")
                rawDiscord.enabled = discord.enabled;
            if (typeof discord.botToken === "string" && discord.botToken && discord.botToken !== "***") {
                rawDiscord.botToken = discord.botToken;
            }
            else if (!rawDiscord.botToken) {
                const inMemToken = getConfig().discord?.botToken;
                if (inMemToken)
                    rawDiscord.botToken = inMemToken;
            }
            if (typeof discord.applicationId === "string")
                rawDiscord.applicationId = discord.applicationId.trim();
            if (typeof discord.publicKey === "string" && discord.publicKey && discord.publicKey !== "***") {
                rawDiscord.publicKey = discord.publicKey.trim();
            }
            else if (!rawDiscord.publicKey) {
                const inMemPublicKey = getConfig().discord?.publicKey;
                if (inMemPublicKey)
                    rawDiscord.publicKey = inMemPublicKey;
            }
            if (Array.isArray(discord.allowedUserIds))
                rawDiscord.allowedUserIds = discord.allowedUserIds;
            if (Array.isArray(discord.allowedGuildIds))
                rawDiscord.allowedGuildIds = discord.allowedGuildIds;
            if (Array.isArray(discord.allowedChannelIds))
                rawDiscord.allowedChannelIds = discord.allowedChannelIds;
            if (Array.isArray(discord.grantedIntents))
                rawDiscord.grantedIntents = discord.grantedIntents;
            if (Array.isArray(discord.botPermissions))
                rawDiscord.botPermissions = discord.botPermissions;
            if (Array.isArray(discord.installedGuildIds))
                rawDiscord.installedGuildIds = discord.installedGuildIds;
            if (typeof discord.largeGuildMode === "boolean")
                rawDiscord.largeGuildMode = discord.largeGuildMode;
        }
        if (body.googleChat && typeof body.googleChat === "object") {
            const googleChat = body.googleChat;
            if (!raw.googleChat)
                raw.googleChat = {};
            const rawGoogleChat = raw.googleChat;
            if (typeof googleChat.enabled === "boolean")
                rawGoogleChat.enabled = googleChat.enabled;
            if (typeof googleChat.projectId === "string")
                rawGoogleChat.projectId = googleChat.projectId.trim();
            if (typeof googleChat.appCredentialJson === "string" && googleChat.appCredentialJson && googleChat.appCredentialJson !== "***") {
                rawGoogleChat.appCredentialJson = googleChat.appCredentialJson;
            }
            else if (!rawGoogleChat.appCredentialJson) {
                const inMemCredential = getConfig().googleChat?.appCredentialJson;
                if (inMemCredential)
                    rawGoogleChat.appCredentialJson = inMemCredential;
            }
            if (typeof googleChat.serviceAccountEmail === "string")
                rawGoogleChat.serviceAccountEmail = googleChat.serviceAccountEmail.trim();
            if (typeof googleChat.webhookUrl === "string")
                rawGoogleChat.webhookUrl = googleChat.webhookUrl.trim();
            if (typeof googleChat.verificationToken === "string" && googleChat.verificationToken && googleChat.verificationToken !== "***") {
                rawGoogleChat.verificationToken = googleChat.verificationToken;
            }
            else if (!rawGoogleChat.verificationToken) {
                const inMemToken = getConfig().googleChat?.verificationToken;
                if (inMemToken)
                    rawGoogleChat.verificationToken = inMemToken;
            }
            if (Array.isArray(googleChat.allowedUserIds))
                rawGoogleChat.allowedUserIds = googleChat.allowedUserIds;
            if (Array.isArray(googleChat.allowedSpaceIds))
                rawGoogleChat.allowedSpaceIds = googleChat.allowedSpaceIds;
            if (Array.isArray(googleChat.deployedSpaceIds))
                rawGoogleChat.deployedSpaceIds = googleChat.deployedSpaceIds;
            if (Array.isArray(googleChat.grantedScopes))
                rawGoogleChat.grantedScopes = googleChat.grantedScopes;
            if (typeof googleChat.appPublished === "boolean")
                rawGoogleChat.appPublished = googleChat.appPublished;
            if (typeof googleChat.domainWideDelegation === "boolean")
                rawGoogleChat.domainWideDelegation = googleChat.domainWideDelegation;
        }
        if (body.imessage && typeof body.imessage === "object") {
            const imessage = body.imessage;
            if (!raw.imessage)
                raw.imessage = {};
            const rawIMessage = raw.imessage;
            if (typeof imessage.enabled === "boolean")
                rawIMessage.enabled = imessage.enabled;
            if (imessage.mode === "outgoing_only" || imessage.mode === "manual_confirm")
                rawIMessage.mode = imessage.mode;
            if (typeof imessage.localBridgeEnabled === "boolean")
                rawIMessage.localBridgeEnabled = imessage.localBridgeEnabled;
            if (typeof imessage.yeonjangBridgeEnabled === "boolean")
                rawIMessage.yeonjangBridgeEnabled = imessage.yeonjangBridgeEnabled;
            if (typeof imessage.riskAcknowledged === "boolean")
                rawIMessage.riskAcknowledged = imessage.riskAcknowledged;
            if (typeof imessage.messagesAppAvailable === "boolean")
                rawIMessage.messagesAppAvailable = imessage.messagesAppAvailable;
            if (typeof imessage.userSessionActive === "boolean")
                rawIMessage.userSessionActive = imessage.userSessionActive;
            if (typeof imessage.automationPermissionGranted === "boolean")
                rawIMessage.automationPermissionGranted = imessage.automationPermissionGranted;
            if (Array.isArray(imessage.allowedRecipientIds))
                rawIMessage.allowedRecipientIds = imessage.allowedRecipientIds;
            if (typeof imessage.manualConfirmationRequired === "boolean")
                rawIMessage.manualConfirmationRequired = imessage.manualConfirmationRequired;
        }
        if (body.kakaoTalk && typeof body.kakaoTalk === "object") {
            const kakaoTalk = body.kakaoTalk;
            if (!raw.kakaoTalk)
                raw.kakaoTalk = {};
            const rawKakaoTalk = raw.kakaoTalk;
            if (typeof kakaoTalk.enabled === "boolean")
                rawKakaoTalk.enabled = kakaoTalk.enabled;
            if (kakaoTalk.mode === "official" || kakaoTalk.mode === "local_bridge")
                rawKakaoTalk.mode = kakaoTalk.mode;
            if (typeof kakaoTalk.businessApiEnabled === "boolean")
                rawKakaoTalk.businessApiEnabled = kakaoTalk.businessApiEnabled;
            if (typeof kakaoTalk.businessApiKey === "string" && kakaoTalk.businessApiKey && kakaoTalk.businessApiKey !== "***")
                rawKakaoTalk.businessApiKey = kakaoTalk.businessApiKey;
            if (typeof kakaoTalk.channelId === "string")
                rawKakaoTalk.channelId = kakaoTalk.channelId.trim();
            if (typeof kakaoTalk.localBridgeEnabled === "boolean")
                rawKakaoTalk.localBridgeEnabled = kakaoTalk.localBridgeEnabled;
            if (typeof kakaoTalk.yeonjangBridgeEnabled === "boolean")
                rawKakaoTalk.yeonjangBridgeEnabled = kakaoTalk.yeonjangBridgeEnabled;
            if (typeof kakaoTalk.riskAcknowledged === "boolean")
                rawKakaoTalk.riskAcknowledged = kakaoTalk.riskAcknowledged;
            if (typeof kakaoTalk.kakaoTalkAppAvailable === "boolean")
                rawKakaoTalk.kakaoTalkAppAvailable = kakaoTalk.kakaoTalkAppAvailable;
            if (typeof kakaoTalk.userSessionActive === "boolean")
                rawKakaoTalk.userSessionActive = kakaoTalk.userSessionActive;
            if (typeof kakaoTalk.automationPermissionGranted === "boolean")
                rawKakaoTalk.automationPermissionGranted = kakaoTalk.automationPermissionGranted;
            if (Array.isArray(kakaoTalk.allowedUserIds))
                rawKakaoTalk.allowedUserIds = kakaoTalk.allowedUserIds;
            if (Array.isArray(kakaoTalk.allowedRoomIds))
                rawKakaoTalk.allowedRoomIds = kakaoTalk.allowedRoomIds;
            if (typeof kakaoTalk.manualConfirmationRequired === "boolean")
                rawKakaoTalk.manualConfirmationRequired = kakaoTalk.manualConfirmationRequired;
            if (typeof kakaoTalk.rateLimitPerMinute === "number")
                rawKakaoTalk.rateLimitPerMinute = Math.max(1, Math.floor(kakaoTalk.rateLimitPerMinute));
        }
        applyChannelConnectionSettingsCompatPatch(raw, "channels" in body ? body.channels : body.channelConnections);
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
        resetEmbeddingProvider();
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
        stopDiscordRuntime();
        stopGoogleChatRuntime();
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
        resetEmbeddingProvider();
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
            stopDiscordRuntime();
            stopGoogleChatRuntime();
            setSlackRuntimeError(null);
            setTelegramRuntimeError(null);
            setDiscordRuntimeError(null);
            setGoogleChatRuntimeError(null);
            const hasTelegramConfig = Boolean(cfg.telegram?.botToken);
            const hasSlackConfig = Boolean(cfg.slack?.botToken && cfg.slack?.appToken);
            const hasDiscordConfig = Boolean(cfg.discord?.botToken && cfg.discord?.applicationId);
            const hasGoogleChatCredential = Boolean(cfg.googleChat?.projectId || cfg.googleChat?.appCredentialJson || cfg.googleChat?.serviceAccountEmail);
            const hasGoogleChatConfig = Boolean(hasGoogleChatCredential && cfg.googleChat?.verificationToken);
            if ((cfg.telegram?.enabled && !hasTelegramConfig)
                || (cfg.slack?.enabled && !hasSlackConfig)
                || (cfg.discord?.enabled && !hasDiscordConfig)
                || (cfg.googleChat?.enabled && !hasGoogleChatConfig)) {
                if (cfg.discord?.enabled && !hasDiscordConfig)
                    setDiscordRuntimeError("Discord bot token or application id is missing.");
                if (cfg.googleChat?.enabled && !hasGoogleChatConfig)
                    setGoogleChatRuntimeError("Google Chat app credential/project id and verification token are missing.");
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
            setDiscordRuntimeError(message);
            setGoogleChatRuntimeError(message);
            return reply.status(500).send({ ok: false, error: message });
        }
    });
    // POST /api/settings/test-ai
    app.post("/api/settings/test-ai", { preHandler: authMiddleware }, async (_req, reply) => {
        try {
            const model = getDefaultModel();
            const provider = getProvider();
            const providerCapability = getProviderCapabilityMatrix({ connection: getConfig().ai.connection, memory: getConfig().memory });
            const providerResolution = attachCapabilityProfileToTrace(resolveProviderResolutionSnapshot().auditTrace, providerCapability);
            const chunks = [];
            for await (const chunk of chatWithContextPreflight({
                provider,
                model,
                messages: [{ role: "user", content: "Reply with just: OK" }],
                system: "You are a connection test. Reply with exactly: OK",
                tools: [],
                signal: new AbortController().signal,
                metadata: { operation: "settings_test_ai" },
            })) {
                if (chunk.type === "text_delta")
                    chunks.push(chunk.delta);
                if (chunk.type === "message_stop")
                    break;
            }
            return { ok: true, response: chunks.join("").trim(), model, providerResolution, providerCapability };
        }
        catch (err) {
            const sanitized = sanitizeUserFacingError(err instanceof Error ? err.message : String(err));
            return reply.status(503).send({
                ok: false,
                error: sanitized.userMessage,
                kind: sanitized.kind,
                actionHint: sanitized.actionHint,
            });
        }
    });
}
//# sourceMappingURL=settings.js.map