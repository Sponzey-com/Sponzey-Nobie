import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { randomBytes } from "node:crypto";
import JSON5 from "json5";
import { getConfig, PATHS, reloadConfig } from "../config/index.js";
import { DEFAULT_CONFIG } from "../config/types.js";
import { buildMcpSetupDraft, buildSkillsSetupDraft, persistMcpSetupDraft, persistSkillsSetupDraft, } from "./setup-extensions.js";
import { getActiveTelegramChannel, getTelegramRuntimeError } from "../channels/telegram/runtime.js";
import { mcpRegistry } from "../mcp/registry.js";
import { updateActiveRunsMaxDelegationTurns } from "../runs/store.js";
import { OPENAI_CODEX_KNOWN_MODELS, resolveOpenAICodexAuthFilePath, resolveOpenAICodexBaseUrl } from "../auth/openai-codex-oauth.js";
const KNOWN_BACKENDS = [
    "provider:openai",
    "provider:anthropic",
    "provider:gemini",
    "provider:ollama",
    "provider:llama_cpp",
];
const GENERIC_BACKEND_REASONS = new Set([
    "계획·리서치 특화 provider runtime은 아직 gateway에 연결되지 않았습니다.",
    "엔드포인트와 모델 조회는 가능하지만 실제 라우팅 런타임은 아직 연결되지 않았습니다.",
    "로컬 경량 추론 provider runtime은 후속 Phase에서 연결합니다.",
    "사용자 추가 backend이며 실제 연결 테스트는 setup에서 확인합니다.",
]);
const GENERIC_BACKEND_SUMMARIES = new Set([
    "일반 대화, 검토, 도구 호출에 두루 쓰는 원격 추론 기본값",
    "Anthropic 계열 원격 추론 후보",
    "계획, 리서치, 긴 문맥 처리를 위한 후보",
    "로컬 모델 우선 후보",
    "로컬 대체 추론 서버",
    "사용자 추가 backend",
]);
function countCapabilities(items) {
    return items.reduce((acc, item) => {
        acc[item.status] += 1;
        return acc;
    }, { ready: 0, disabled: 0, planned: 0, error: 0 });
}
function toObject(value) {
    return value && typeof value === "object" && !Array.isArray(value)
        ? value
        : {};
}
function toStringArray(value) {
    return Array.isArray(value) ? value.filter((item) => typeof item === "string") : [];
}
function toCredentials(value) {
    const raw = toObject(value);
    const credentials = {};
    if (typeof raw.apiKey === "string")
        credentials.apiKey = raw.apiKey;
    if (typeof raw.username === "string")
        credentials.username = raw.username;
    if (typeof raw.password === "string")
        credentials.password = raw.password;
    if (typeof raw.oauthAuthFilePath === "string")
        credentials.oauthAuthFilePath = raw.oauthAuthFilePath;
    return credentials;
}
function sanitizeBackendReason(value) {
    if (typeof value !== "string")
        return undefined;
    const normalized = value.trim();
    if (!normalized)
        return undefined;
    if (GENERIC_BACKEND_REASONS.has(normalized))
        return undefined;
    return normalized;
}
function sanitizeBackendSummary(value) {
    if (typeof value !== "string")
        return "";
    const normalized = value.trim();
    if (!normalized)
        return "";
    if (GENERIC_BACKEND_SUMMARIES.has(normalized))
        return "";
    return normalized;
}
function toNumberArrayString(value) {
    if (!Array.isArray(value))
        return "";
    return value
        .filter((item) => typeof item === "number" && Number.isFinite(item))
        .join("\n");
}
function parseIdString(value) {
    return value
        .split(/[\s,]+/)
        .map((item) => Number(item.trim()))
        .filter((item) => Number.isFinite(item));
}
function ensureParentDir(filePath) {
    mkdirSync(dirname(filePath), { recursive: true });
}
function readRawConfig() {
    if (!existsSync(PATHS.configFile))
        return {};
    try {
        return toObject(JSON5.parse(readFileSync(PATHS.configFile, "utf-8")));
    }
    catch {
        return {};
    }
}
function writeRawConfig(raw) {
    ensureParentDir(PATHS.configFile);
    writeFileSync(PATHS.configFile, JSON5.stringify(raw, null, 2), "utf-8");
    reloadConfig();
}
function defaultSetupState() {
    return {
        version: 1,
        completed: false,
        currentStep: "welcome",
        skipped: {
            telegram: false,
            remoteAccess: false,
        },
    };
}
export function readSetupState() {
    if (!existsSync(PATHS.setupStateFile))
        return defaultSetupState();
    try {
        const parsed = JSON.parse(readFileSync(PATHS.setupStateFile, "utf-8"));
        const state = {
            ...defaultSetupState(),
            ...parsed,
            skipped: { ...defaultSetupState().skipped, ...(parsed.skipped ?? {}) },
        };
        if (!state.completed && state.currentStep === "done") {
            state.currentStep = "review";
            writeSetupState(state);
        }
        return state;
    }
    catch {
        return defaultSetupState();
    }
}
export function writeSetupState(state) {
    ensureParentDir(PATHS.setupStateFile);
    writeFileSync(PATHS.setupStateFile, JSON.stringify(state, null, 2), "utf-8");
    return state;
}
function createDefaultRoutingProfiles() {
    return [
        { id: "default", label: "기본", targets: ["provider:openai", "provider:gemini", "provider:ollama"] },
        { id: "general_chat", label: "일반 대화", targets: ["provider:openai", "provider:gemini", "provider:ollama"] },
        { id: "planning", label: "계획/설계", targets: ["provider:gemini", "provider:openai", "provider:anthropic"] },
        { id: "coding", label: "코딩", targets: ["provider:anthropic", "provider:openai", "provider:gemini"] },
        { id: "review", label: "리뷰", targets: ["provider:anthropic", "provider:openai", "provider:gemini"] },
        { id: "research", label: "리서치", targets: ["provider:gemini", "provider:openai", "provider:anthropic"] },
        { id: "private_local", label: "로컬 우선", targets: ["provider:ollama", "provider:llama_cpp"] },
        { id: "summarization", label: "요약", targets: ["provider:ollama", "provider:openai", "provider:gemini"] },
        { id: "operations", label: "운영", targets: ["provider:anthropic", "provider:openai", "provider:ollama"] },
    ];
}
function hasConfiguredAnthropicConnection(config) {
    return Boolean(config.ai.providers.anthropic?.apiKeys?.some((key) => key.trim().length > 0));
}
function hasConfiguredOpenAIConnection(config) {
    const openai = config.ai.providers.openai;
    const authMode = openai?.auth?.mode ?? "api_key";
    if (authMode === "chatgpt_oauth") {
        return existsSync(resolveOpenAICodexAuthFilePath({
            authFilePath: openai?.auth?.codexAuthFilePath,
            clientId: openai?.auth?.clientId,
        }));
    }
    return Boolean(openai?.apiKeys?.some((key) => key.trim().length > 0)
        || openai?.baseUrl?.trim());
}
function hasConfiguredGeminiConnection(config) {
    return Boolean(config.ai.providers.gemini?.apiKeys?.some((key) => key.trim().length > 0)
        || config.ai.providers.gemini?.baseUrl?.trim());
}
function createDefaultAiBackends(config) {
    const openaiApiKey = config.ai.providers.openai?.apiKeys?.[0] ?? "";
    const openaiAuthMode = config.ai.providers.openai?.auth?.mode ?? "api_key";
    const openaiOauthAuthFilePath = config.ai.providers.openai?.auth?.codexAuthFilePath ?? "";
    const geminiApiKey = config.ai.providers.gemini?.apiKeys?.[0] ?? "";
    const anthropicApiKey = config.ai.providers.anthropic?.apiKeys?.[0] ?? "";
    const hasOpenAIConnection = hasConfiguredOpenAIConnection(config);
    const hasGeminiConnection = hasConfiguredGeminiConnection(config);
    const hasAnthropicConnection = hasConfiguredAnthropicConnection(config);
    const openaiEndpoint = openaiAuthMode === "chatgpt_oauth"
        ? resolveOpenAICodexBaseUrl(config.ai.providers.openai?.baseUrl?.trim())
        : (config.ai.providers.openai?.baseUrl?.trim() || undefined);
    const geminiEndpoint = config.ai.providers.gemini?.baseUrl?.trim() || undefined;
    const ollamaEndpoint = config.ai.providers.ollama?.baseUrl?.trim() || undefined;
    const openaiModel = config.ai.defaultProvider === "openai" ? config.ai.defaultModel : "";
    const geminiModel = config.ai.defaultProvider === "gemini" ? config.ai.defaultModel : "";
    const anthropicModel = config.ai.defaultProvider === "anthropic" ? config.ai.defaultModel : "";
    return [
        {
            id: "provider:openai",
            label: "범용 원격 추론",
            kind: "provider",
            providerType: "openai",
            authMode: openaiAuthMode,
            credentials: {
                apiKey: openaiApiKey,
                oauthAuthFilePath: openaiOauthAuthFilePath,
            },
            local: false,
            enabled: hasOpenAIConnection,
            availableModels: [],
            defaultModel: openaiModel,
            status: hasOpenAIConnection ? "ready" : "planned",
            summary: "",
            tags: ["general", "review", "tool_use"],
            ...(openaiEndpoint ? { endpoint: openaiEndpoint } : {}),
        },
        {
            id: "provider:gemini",
            label: "계획·리서치 특화",
            kind: "provider",
            providerType: "gemini",
            authMode: "api_key",
            credentials: {
                apiKey: geminiApiKey,
            },
            local: false,
            enabled: hasGeminiConnection,
            availableModels: [],
            defaultModel: geminiModel,
            status: hasGeminiConnection ? "ready" : "planned",
            summary: "",
            tags: ["planning", "research", "long_context"],
            ...(geminiEndpoint ? { endpoint: geminiEndpoint } : {}),
        },
        {
            id: "provider:ollama",
            label: "로컬 모델 우선",
            kind: "provider",
            providerType: "ollama",
            authMode: "api_key",
            credentials: {},
            local: true,
            enabled: Boolean(ollamaEndpoint),
            availableModels: [],
            defaultModel: "",
            status: "disabled",
            summary: "",
            tags: ["local", "coding", "private_local"],
            ...(ollamaEndpoint ? { endpoint: ollamaEndpoint } : {}),
        },
        {
            id: "provider:llama_cpp",
            label: "로컬 경량 추론",
            kind: "provider",
            providerType: "llama",
            authMode: "api_key",
            credentials: {},
            local: true,
            enabled: false,
            availableModels: [],
            defaultModel: "",
            status: "planned",
            summary: "",
            tags: ["local", "private_local"],
        },
        {
            id: "provider:anthropic",
            label: "Anthropic 추론",
            kind: "provider",
            providerType: "anthropic",
            authMode: "api_key",
            credentials: {
                apiKey: anthropicApiKey,
            },
            local: false,
            enabled: hasAnthropicConnection,
            availableModels: [],
            defaultModel: anthropicModel,
            status: hasAnthropicConnection ? "ready" : "planned",
            summary: "",
            tags: ["coding", "operations", "review", "general"],
        },
    ];
}
function normalizeBackendProviderType(value) {
    return ["openai", "ollama", "llama", "anthropic", "gemini", "custom"].includes(String(value))
        ? value
        : undefined;
}
function mergeBackend(base, value) {
    if (value === undefined) {
        return {
            ...base,
            credentials: { ...base.credentials },
            availableModels: [],
        };
    }
    const raw = toObject(value);
    const merged = {
        ...base,
        enabled: typeof raw.enabled === "boolean" ? raw.enabled : base.enabled,
        local: typeof raw.local === "boolean" ? raw.local : base.local,
        providerType: normalizeBackendProviderType(raw.providerType) ?? base.providerType,
        credentials: toCredentials(raw.credentials),
        defaultModel: typeof raw.defaultModel === "string" ? raw.defaultModel : base.defaultModel,
        summary: typeof raw.summary === "string" ? sanitizeBackendSummary(raw.summary) : base.summary,
        tags: toStringArray(raw.tags).length > 0 ? toStringArray(raw.tags) : base.tags,
        status: ["ready", "disabled", "planned", "error"].includes(String(raw.status))
            ? raw.status
            : base.status,
        availableModels: [],
    };
    if (typeof raw.endpoint === "string" && raw.endpoint.trim())
        merged.endpoint = raw.endpoint.trim();
    const nextReason = sanitizeBackendReason(raw.reason);
    if (nextReason)
        merged.reason = nextReason;
    return merged;
}
function mergeBuiltinBackendState(base, value) {
    if (value === undefined) {
        return {
            ...base,
            credentials: { ...base.credentials },
            availableModels: [],
        };
    }
    const raw = toObject(value);
    return {
        ...base,
        enabled: raw.enabled === false ? false : base.enabled,
        credentials: { ...base.credentials },
        availableModels: [],
    };
}
function sanitizeRoutingProfiles(value) {
    if (!Array.isArray(value))
        return createDefaultRoutingProfiles();
    const parsed = value
        .map((entry) => {
        const row = toObject(entry);
        if (typeof row.id !== "string" || typeof row.label !== "string")
            return null;
        const targets = toStringArray(row.targets)
            .filter((target) => !target.startsWith("worker:"));
        return {
            id: row.id,
            label: row.label,
            targets: [...new Set(targets)],
        };
    })
        .filter((entry) => entry !== null && entry.targets.length > 0);
    return parsed.length > 0 ? parsed : createDefaultRoutingProfiles();
}
function sanitizeCustomBackends(value) {
    if (!Array.isArray(value))
        return [];
    return value
        .map((entry) => {
        const raw = toObject(entry);
        if (typeof raw.id !== "string" || typeof raw.label !== "string")
            return null;
        if (raw.id.startsWith("worker:") || raw.kind === "worker")
            return null;
        const kind = "provider";
        const reason = sanitizeBackendReason(raw.reason);
        const backend = {
            id: raw.id,
            label: raw.label,
            kind,
            providerType: normalizeBackendProviderType(raw.providerType) ?? "custom",
            credentials: toCredentials(raw.credentials),
            local: typeof raw.local === "boolean" ? raw.local : false,
            enabled: typeof raw.enabled === "boolean" ? raw.enabled : false,
            availableModels: [],
            defaultModel: typeof raw.defaultModel === "string" ? raw.defaultModel : "",
            status: ["ready", "disabled", "planned", "error"].includes(String(raw.status))
                ? raw.status
                : "disabled",
            summary: typeof raw.summary === "string" ? sanitizeBackendSummary(raw.summary) : "",
            tags: toStringArray(raw.tags),
            ...(reason ? { reason } : {}),
        };
        if (typeof raw.endpoint === "string")
            backend.endpoint = raw.endpoint;
        return backend;
    })
        .filter((entry) => entry !== null);
}
export function buildSetupDraft() {
    const config = getConfig();
    const raw = readRawConfig();
    const ai = toObject(raw.ai);
    const rawBackends = toObject(ai.backends);
    const defaults = createDefaultAiBackends(config).map((backend) => {
        const key = backend.id.split(":")[1] ?? backend.id;
        return mergeBuiltinBackendState(backend, rawBackends[key] ?? rawBackends[backend.id]);
    });
    const customBackends = sanitizeCustomBackends(ai.customBackends);
    return {
        personal: {
            profileName: config.profile.profileName ?? "",
            displayName: config.profile.displayName ?? "",
            language: config.profile.language ?? "ko",
            timezone: config.profile.timezone ?? config.scheduler.timezone,
            workspace: config.profile.workspace ?? "",
        },
        aiBackends: [...defaults, ...customBackends],
        routingProfiles: sanitizeRoutingProfiles(ai.routingProfiles),
        mcp: buildMcpSetupDraft(config),
        skills: buildSkillsSetupDraft(config),
        security: {
            approvalMode: config.security.approvalMode,
            approvalTimeout: config.security.approvalTimeout,
            approvalTimeoutFallback: config.security.approvalTimeoutFallback,
            maxDelegationTurns: config.orchestration.maxDelegationTurns,
        },
        channels: {
            telegramEnabled: config.telegram?.enabled ?? false,
            botToken: config.telegram?.botToken ?? "",
            allowedUserIds: toNumberArrayString(config.telegram?.allowedUserIds ?? []),
            allowedGroupIds: toNumberArrayString(config.telegram?.allowedGroupIds ?? []),
        },
        remoteAccess: {
            authEnabled: config.webui.auth.enabled,
            authToken: config.webui.auth.token ?? "",
            host: config.webui.host,
            port: config.webui.port,
        },
    };
}
function persistBackends(raw, draft) {
    if (!raw.ai)
        raw.ai = {};
    const ai = toObject(raw.ai);
    const backends = {};
    const customBackends = [];
    for (const backend of draft.aiBackends) {
        const persisted = {
            enabled: backend.enabled,
        };
        if (KNOWN_BACKENDS.includes(backend.id)) {
            const key = backend.id.split(":")[1] ?? backend.id;
            backends[key] = persisted;
        }
        else {
            persisted.kind = backend.kind;
            persisted.local = backend.local;
            persisted.defaultModel = backend.defaultModel;
            persisted.providerType = backend.providerType;
            persisted.authMode = backend.authMode ?? "api_key";
            persisted.credentials = backend.credentials;
            persisted.tags = backend.tags;
            persisted.status = backend.status;
            if (backend.summary.trim())
                persisted.summary = backend.summary.trim();
            if (backend.endpoint?.trim())
                persisted.endpoint = backend.endpoint.trim();
            if (backend.reason?.trim())
                persisted.reason = backend.reason.trim();
            customBackends.push({
                id: backend.id,
                label: backend.label,
                ...persisted,
            });
        }
    }
    ai.backends = backends;
    ai.customBackends = customBackends;
    ai.routingProfiles = draft.routingProfiles;
    raw.ai = ai;
}
export function saveSetupDraft(draft, state) {
    const raw = readRawConfig();
    raw.profile = {
        ...toObject(raw.profile),
        profileName: draft.personal.profileName,
        displayName: draft.personal.displayName,
        language: draft.personal.language,
        timezone: draft.personal.timezone,
        workspace: draft.personal.workspace,
    };
    raw.scheduler = {
        ...toObject(raw.scheduler),
        timezone: draft.personal.timezone,
    };
    raw.security = {
        ...toObject(raw.security),
        approvalMode: draft.security.approvalMode,
        approvalTimeout: draft.security.approvalTimeout,
        approvalTimeoutFallback: draft.security.approvalTimeoutFallback,
    };
    raw.orchestration = {
        ...toObject(raw.orchestration),
        maxDelegationTurns: Math.max(0, Math.floor(Number.isFinite(draft.security.maxDelegationTurns) ? draft.security.maxDelegationTurns : 5)),
    };
    raw.telegram = {
        ...toObject(raw.telegram),
        enabled: draft.channels.telegramEnabled,
        botToken: draft.channels.botToken,
        allowedUserIds: parseIdString(draft.channels.allowedUserIds),
        allowedGroupIds: parseIdString(draft.channels.allowedGroupIds),
    };
    raw.webui = {
        ...toObject(raw.webui),
        host: draft.remoteAccess.host,
        port: draft.remoteAccess.port,
        auth: {
            ...toObject(toObject(raw.webui).auth),
            enabled: draft.remoteAccess.authEnabled,
            token: draft.remoteAccess.authToken,
        },
    };
    if (!raw.ai)
        raw.ai = {};
    const rawAi = toObject(raw.ai);
    const rawProviders = toObject(rawAi.providers);
    const providerSelections = [];
    const openai = draft.aiBackends.find((backend) => backend.id === "provider:openai");
    if (openai) {
        const normalizedOpenAIEndpoint = openai.authMode === "chatgpt_oauth"
            ? resolveOpenAICodexBaseUrl(openai.endpoint)
            : openai.endpoint;
        const normalizedOpenAIDefaultModel = openai.defaultModel.trim();
        rawProviders.openai = {
            ...toObject(rawProviders.openai),
            baseUrl: normalizedOpenAIEndpoint,
            apiKeys: openai.credentials.apiKey?.trim() ? [openai.credentials.apiKey.trim()] : [],
            auth: {
                ...toObject(toObject(rawProviders.openai).auth),
                mode: openai.authMode ?? "api_key",
                codexAuthFilePath: openai.credentials.oauthAuthFilePath?.trim() || undefined,
                clientId: typeof toObject(toObject(rawProviders.openai).auth).clientId === "string"
                    ? toObject(toObject(rawProviders.openai).auth).clientId
                    : undefined,
            },
        };
        if (openai.enabled && normalizedOpenAIDefaultModel) {
            providerSelections.push({ providerId: "openai", model: normalizedOpenAIDefaultModel });
        }
    }
    const gemini = draft.aiBackends.find((backend) => backend.id === "provider:gemini");
    if (gemini) {
        rawProviders.gemini = {
            ...toObject(rawProviders.gemini),
            baseUrl: gemini.endpoint,
            apiKeys: gemini.credentials.apiKey?.trim() ? [gemini.credentials.apiKey.trim()] : [],
        };
        if (gemini.enabled && gemini.defaultModel.trim()) {
            providerSelections.push({ providerId: "gemini", model: gemini.defaultModel.trim() });
        }
    }
    const anthropic = draft.aiBackends.find((backend) => backend.id === "provider:anthropic");
    if (anthropic) {
        rawProviders.anthropic = {
            ...toObject(rawProviders.anthropic),
            apiKeys: anthropic.credentials.apiKey?.trim() ? [anthropic.credentials.apiKey.trim()] : [],
        };
        if (anthropic.enabled && anthropic.defaultModel.trim()) {
            providerSelections.push({ providerId: "anthropic", model: anthropic.defaultModel.trim() });
        }
    }
    const ollama = draft.aiBackends.find((backend) => backend.id === "provider:ollama");
    if (ollama) {
        rawProviders.ollama = {
            ...toObject(rawProviders.ollama),
            baseUrl: ollama.endpoint,
        };
    }
    rawAi.providers = rawProviders;
    const defaultTargets = draft.routingProfiles.find((profile) => profile.id === "default")?.targets ?? [];
    const routedSelection = defaultTargets
        .map((target) => providerSelections.find((selection) => `provider:${selection.providerId}` === target))
        .find((selection) => Boolean(selection));
    const selectedProvider = routedSelection ?? providerSelections[0];
    rawAi.defaultProvider = selectedProvider?.providerId ?? "";
    rawAi.defaultModel = selectedProvider?.model ?? "";
    raw.ai = rawAi;
    delete raw.llm;
    persistBackends(raw, draft);
    persistMcpSetupDraft(raw, draft.mcp);
    persistSkillsSetupDraft(raw, draft.skills);
    writeRawConfig(raw);
    updateActiveRunsMaxDelegationTurns(Math.max(0, Math.floor(Number.isFinite(draft.security.maxDelegationTurns) ? draft.security.maxDelegationTurns : 5)));
    const nextState = state ? writeSetupState(state) : readSetupState();
    return { draft: buildSetupDraft(), state: nextState };
}
export function resetSetupEnvironment() {
    writeRawConfig(JSON.parse(JSON.stringify(DEFAULT_CONFIG)));
    const state = writeSetupState(defaultSetupState());
    return {
        draft: buildSetupDraft(),
        state,
        checks: createSetupChecks(),
    };
}
export function completeSetup() {
    const current = readSetupState();
    return writeSetupState({
        ...current,
        completed: true,
        currentStep: "done",
        completedAt: Date.now(),
    });
}
export function createSetupChecks() {
    const config = getConfig();
    const state = readSetupState();
    return {
        stateDir: PATHS.stateDir,
        configFile: PATHS.configFile,
        setupStateFile: PATHS.setupStateFile,
        setupCompleted: state.completed,
        telegramConfigured: Boolean(config.telegram?.botToken),
        authEnabled: config.webui.auth.enabled,
        schedulerEnabled: config.scheduler.enabled,
    };
}
export function createTransientAuthToken() {
    return randomBytes(32).toString("hex");
}
export function createCapabilities() {
    const config = getConfig();
    const telegramRunning = getActiveTelegramChannel() !== null;
    const telegramRuntimeError = getTelegramRuntimeError();
    const mcpSummary = mcpRegistry.getSummary();
    const mcpStatuses = mcpRegistry.getStatuses();
    const mcpCapability = {
        key: "mcp.client",
        label: "MCP Client",
        area: "mcp",
        status: "disabled",
        implemented: true,
        enabled: false,
    };
    if (mcpSummary.serverCount === 0) {
        mcpCapability.reason = "MCP 서버가 설정되지 않았습니다.";
    }
    else if (mcpSummary.requiredFailures > 0) {
        mcpCapability.status = "error";
        mcpCapability.reason = `필수 MCP 서버 ${mcpSummary.requiredFailures}개가 준비되지 않았습니다.`;
    }
    else if (mcpSummary.readyCount > 0) {
        mcpCapability.status = "ready";
        mcpCapability.enabled = true;
        if (mcpSummary.readyCount < mcpSummary.serverCount) {
            mcpCapability.reason = `MCP 서버 ${mcpSummary.readyCount}/${mcpSummary.serverCount}개가 준비되었습니다.`;
        }
    }
    else {
        const firstError = mcpStatuses.find((item) => item.error)?.error;
        mcpCapability.reason = firstError ?? "설정된 MCP 서버가 아직 준비되지 않았습니다.";
    }
    const telegramCapability = {
        key: "telegram.channel",
        label: "Telegram Channel",
        area: "telegram",
        status: config.telegram?.botToken
            ? config.telegram.enabled
                ? telegramRunning
                    ? "ready"
                    : telegramRuntimeError ? "error" : "disabled"
                : "disabled"
            : "disabled",
        implemented: true,
        enabled: Boolean(config.telegram?.enabled && telegramRunning),
    };
    if (!config.telegram?.botToken) {
        telegramCapability.reason = "봇 토큰이 설정되지 않았습니다.";
    }
    else if (!config.telegram.enabled) {
        telegramCapability.reason = "Telegram 채널이 비활성화되어 있습니다.";
    }
    else if (telegramRuntimeError) {
        telegramCapability.reason = telegramRuntimeError;
    }
    else if (!telegramRunning) {
        telegramCapability.reason = "Telegram 설정은 저장되었지만 현재 런타임이 시작되지 않았습니다.";
    }
    return [
        { key: "setup.wizard", label: "Setup Wizard", area: "setup", status: "ready", implemented: true, enabled: true },
        { key: "dashboard.overview", label: "Dashboard Overview", area: "gateway", status: "ready", implemented: true, enabled: true },
        {
            key: "gateway.orchestrator",
            label: "Gateway Orchestrator",
            area: "gateway",
            status: "planned",
            implemented: false,
            enabled: false,
            reason: "실제 오케스트레이터와 위임 제어 루프는 Phase 0003 이후 연결합니다.",
        },
        { key: "runs.monitor", label: "Run Monitor", area: "runs", status: "ready", implemented: true, enabled: true },
        { key: "runs.cancel", label: "Run Cancel", area: "runs", status: "ready", implemented: true, enabled: true },
        {
            key: "chat.workspace",
            label: "Chat Workspace",
            area: "chat",
            status: "ready",
            implemented: true,
            enabled: true,
        },
        {
            key: "chat.streaming",
            label: "Chat Streaming",
            area: "chat",
            status: "disabled",
            implemented: true,
            enabled: false,
            reason: "채팅은 완료 응답 기준으로 동작하며, 토큰 단위 실시간 스트리밍 표시는 아직 정리 중입니다.",
        },
        { key: "ai.backends", label: "AI Backends", area: "ai", status: "ready", implemented: true, enabled: true },
        mcpCapability,
        { key: "ai.routing", label: "AI Routing", area: "ai", status: "ready", implemented: true, enabled: true },
        { key: "instructions.chain", label: "Active Instructions", area: "gateway", status: "ready", implemented: true, enabled: true },
        { key: "settings.control", label: "Settings Control", area: "security", status: "ready", implemented: true, enabled: true },
        {
            key: "audit.viewer",
            label: "Audit Viewer",
            area: "gateway",
            status: "disabled",
            implemented: true,
            enabled: false,
            reason: "기존 감사 로그 API는 있으나 run-centric 제어면과의 통합은 아직 정리 중입니다.",
        },
        {
            key: "ai.overrides",
            label: "AI Overrides",
            area: "ai",
            status: "planned",
            implemented: false,
            enabled: false,
            reason: "세션별/요청별 override는 후속 Phase에서 연결합니다.",
        },
        telegramCapability,
        (() => {
            const capability = {
                key: "scheduler.core",
                label: "Scheduler",
                area: "scheduler",
                status: config.scheduler.enabled ? "ready" : "disabled",
                implemented: true,
                enabled: config.scheduler.enabled,
            };
            if (!config.scheduler.enabled) {
                capability.reason = "스케줄러가 설정에서 비활성화되어 있습니다.";
            }
            return capability;
        })(),
        {
            key: "plugins.runtime",
            label: "Plugin Runtime",
            area: "plugins",
            status: "disabled",
            implemented: true,
            enabled: false,
            reason: "플러그인 런타임은 기존 구현이 있으나 WebUI-first 제어면과의 통합은 아직 완료되지 않았습니다.",
        },
        {
            key: "memory.semantic_search",
            label: "Semantic Search",
            area: "memory",
            status: "planned",
            implemented: false,
            enabled: false,
            reason: "시맨틱 메모리/검색 제어면은 후속 Phase 범위입니다.",
        },
    ];
}
export function createCapabilityCounts() {
    return countCapabilities(createCapabilities());
}
export function getPrimaryAiTarget() {
    const draft = buildSetupDraft();
    return draft.routingProfiles.find((profile) => profile.id === "default")?.targets[0] ?? null;
}
function normalizeEndpoint(endpoint) {
    return endpoint.trim().replace(/\/+$/, "");
}
function normalizeModelName(value) {
    return value.replace(/^models\//, "").trim();
}
function parseCommonModels(payload) {
    const rows = [
        ...toArray(toObject(payload).data),
        ...toArray(toObject(payload).models),
    ];
    return [...new Set(rows
            .map((row) => {
            const raw = toObject(row);
            return [
                raw.id,
                raw.name,
                raw.model,
                raw.baseModelId,
            ]
                .find((value) => typeof value === "string" && value.trim().length > 0);
        })
            .filter((value) => typeof value === "string")
            .map(normalizeModelName))];
}
function toArray(value) {
    return Array.isArray(value) ? value : [];
}
function stripKnownEndpointSuffix(endpoint) {
    const suffixes = [
        "/v1beta/openai",
        "/v1/models",
        "/v1beta/models",
        "/api/tags",
        "/models",
        "/v1beta",
        "/v1",
    ];
    for (const suffix of suffixes) {
        if (endpoint.endsWith(suffix)) {
            return endpoint.slice(0, -suffix.length) || endpoint;
        }
    }
    return endpoint;
}
function candidatePaths(providerType) {
    switch (providerType) {
        case "ollama":
            return ["/api/tags"];
        case "gemini":
            return ["/v1beta/models", "/v1/models", "/models"];
        case "anthropic":
            return ["/v1/models", "/models"];
        case "openai":
            return ["/v1/models", "/models"];
        case "llama":
            return ["/v1/models", "/models", "/api/tags"];
        case "custom":
            return ["/v1/models", "/models", "/v1beta/models", "/api/tags"];
    }
}
function candidateUrls(endpoint, providerType) {
    const normalized = normalizeEndpoint(endpoint);
    const root = stripKnownEndpointSuffix(normalized);
    return [...new Set(candidatePaths(providerType).map((path) => `${root}${path}`))];
}
function createDiscoveryHeaders(providerType, credentials) {
    const headers = {
        Accept: "application/json",
    };
    const username = credentials.username?.trim();
    const password = credentials.password?.trim();
    const apiKey = credentials.apiKey?.trim();
    if (username || password) {
        headers.Authorization = `Basic ${Buffer.from(`${username ?? ""}:${password ?? ""}`).toString("base64")}`;
        return headers;
    }
    if (!apiKey)
        return headers;
    switch (providerType) {
        case "anthropic":
            headers["x-api-key"] = apiKey;
            headers["anthropic-version"] = "2023-06-01";
            return headers;
        case "gemini":
            headers["x-goog-api-key"] = apiKey;
            return headers;
        case "openai":
        case "llama":
        case "custom":
            headers.Authorization = `Bearer ${apiKey}`;
            return headers;
        case "ollama":
            headers.Authorization = `Bearer ${apiKey}`;
            return headers;
    }
}
export async function discoverModelsFromEndpoint(endpoint, providerType = "custom", credentials = {}) {
    const normalized = normalizeEndpoint(endpoint);
    if (!normalized) {
        throw new Error("엔드포인트를 먼저 입력하세요.");
    }
    const errors = [];
    for (const candidate of candidateUrls(normalized, providerType)) {
        try {
            const response = await fetch(candidate, {
                method: "GET",
                headers: createDiscoveryHeaders(providerType, credentials),
            });
            if (!response.ok) {
                errors.push(`${candidate}: ${response.status} ${response.statusText}`);
                continue;
            }
            const payload = await response.json();
            const models = parseCommonModels(payload);
            if (models.length > 0) {
                return { models, sourceUrl: candidate };
            }
            errors.push(`${candidate}: 모델 없음`);
        }
        catch (error) {
            errors.push(`${candidate}: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
    throw new Error(errors[0] ?? "모델 목록을 가져오지 못했습니다.");
}
//# sourceMappingURL=index.js.map
