import { existsSync } from "node:fs";
import { getConfig } from "../config/index.js";
import { resolveOpenAICodexAuthFilePath } from "../auth/openai-codex-oauth.js";
import { AnthropicProvider } from "./providers/anthropic.js";
import { GeminiProvider } from "./providers/gemini.js";
import { OpenAIProvider } from "./providers/openai.js";
const profiles = new Map();
const providers = new Map();
const providerFingerprints = new Map();
function buildProfile(apiKeys) {
    return { apiKeys, currentKeyIndex: 0, cooldowns: new Map() };
}
function buildOpenAICompatibleProfile(providerId, apiKey) {
    if (apiKey)
        return buildProfile([apiKey]);
    if (providerId === "ollama")
        return buildProfile(["nobie-local"]);
    if (providerId === "llama")
        return buildProfile(["nobie-llama"]);
    if (providerId === "custom")
        return buildProfile(["nobie-custom"]);
    return buildProfile([]);
}
function normalizeOpenAICompatibleEndpoint(providerId, endpoint) {
    const normalized = endpoint?.trim();
    if (!normalized)
        return undefined;
    if (providerId !== "ollama")
        return normalized;
    return /\/v1\/?$/i.test(normalized) ? normalized.replace(/\/+$/, "") : `${normalized.replace(/\/+$/, "")}/v1`;
}
function buildProviderFingerprint(connection) {
    const providerId = connection.provider.trim();
    const authMode = connection.auth?.mode ?? "api_key";
    const endpoint = providerId === "openai" || providerId === "ollama" || providerId === "llama" || providerId === "custom"
        ? normalizeOpenAICompatibleEndpoint(providerId, connection.endpoint) ?? ""
        : connection.endpoint?.trim() ?? "";
    const model = connection.model.trim();
    const oauthAuthFilePath = connection.auth?.oauthAuthFilePath?.trim() ?? "";
    const clientId = connection.auth?.clientId?.trim() ?? "";
    const apiKeyFingerprint = connection.auth?.apiKey?.trim() ? "api-key:set" : "api-key:empty";
    return [providerId, authMode, endpoint, model, oauthAuthFilePath, clientId, apiKeyFingerprint].join("|");
}
export function resetAIProviderCache() {
    providers.clear();
    profiles.clear();
    providerFingerprints.clear();
}
export function getActiveAIConnection(config = getConfig()) {
    return config.ai.connection;
}
function isOpenAIOAuthConfigured(connection = getActiveAIConnection()) {
    if (connection.provider !== "openai")
        return false;
    if (connection.auth?.mode !== "chatgpt_oauth")
        return false;
    return existsSync(resolveOpenAICodexAuthFilePath({
        authFilePath: connection.auth?.oauthAuthFilePath,
        clientId: connection.auth?.clientId,
    }));
}
function hasConfiguredConnection(connection = getActiveAIConnection()) {
    const providerId = connection.provider.trim();
    if (!providerId)
        return false;
    if (providerId === "openai") {
        const authMode = connection.auth?.mode ?? "api_key";
        if (authMode === "chatgpt_oauth")
            return isOpenAIOAuthConfigured(connection);
        return Boolean(connection.auth?.apiKey?.trim() || connection.endpoint?.trim());
    }
    if (providerId === "anthropic" || providerId === "gemini") {
        return Boolean(connection.auth?.apiKey?.trim() || connection.endpoint?.trim());
    }
    if (providerId === "ollama" || providerId === "llama" || providerId === "custom") {
        return Boolean(connection.endpoint?.trim());
    }
    return false;
}
export function detectAvailableProvider() {
    const connection = getActiveAIConnection();
    return hasConfiguredConnection(connection) ? connection.provider.trim() : "";
}
export function getDefaultModel() {
    const connection = getActiveAIConnection();
    if (!hasConfiguredConnection(connection))
        return "";
    return connection.model.trim();
}
export function inferProviderId(_model) {
    return detectAvailableProvider();
}
export function getProvider(providerId) {
    const connection = getActiveAIConnection();
    const activeProviderId = detectAvailableProvider();
    const requestedProviderId = providerId?.trim() ?? "";
    const currentFingerprint = buildProviderFingerprint(connection);
    if (!activeProviderId) {
        throw new Error("No configured AI backend is available. Connect an AI in settings first.");
    }
    if (requestedProviderId && requestedProviderId !== activeProviderId) {
        throw new Error(`Only the configured active AI backend can be used. Active backend: "${activeProviderId}".`);
    }
    if (providers.has(activeProviderId) && providerFingerprints.get(activeProviderId) === currentFingerprint) {
        return providers.get(activeProviderId);
    }
    providers.delete(activeProviderId);
    profiles.delete(activeProviderId);
    providerFingerprints.set(activeProviderId, currentFingerprint);
    if (activeProviderId === "anthropic") {
        const apiKey = connection.auth?.apiKey?.trim();
        if (!apiKey) {
            throw new Error("Anthropic AI is not configured. Connect it in settings before using it.");
        }
        const profile = buildProfile([apiKey]);
        profiles.set(activeProviderId, profile);
        const provider = new AnthropicProvider(profile);
        providers.set(activeProviderId, provider);
        return provider;
    }
    if (activeProviderId === "gemini") {
        const apiKey = connection.auth?.apiKey?.trim();
        if (!apiKey && !connection.endpoint?.trim()) {
            throw new Error("Gemini AI is not configured. Connect it in settings before using it.");
        }
        const profile = buildProfile(apiKey ? [apiKey] : []);
        profiles.set(activeProviderId, profile);
        const provider = new GeminiProvider(profile, connection.endpoint?.trim() || undefined);
        providers.set(activeProviderId, provider);
        return provider;
    }
    if (activeProviderId === "openai" || activeProviderId === "ollama" || activeProviderId === "custom") {
        const authMode = connection.auth?.mode ?? "api_key";
        const apiKey = connection.auth?.apiKey?.trim();
        const profile = buildOpenAICompatibleProfile(activeProviderId, apiKey);
        const endpoint = normalizeOpenAICompatibleEndpoint(activeProviderId, connection.endpoint);
        profiles.set(activeProviderId, profile);
        const provider = new OpenAIProvider(profile, endpoint, activeProviderId === "openai" && authMode === "chatgpt_oauth"
            ? {
                authFilePath: connection.auth?.oauthAuthFilePath,
                clientId: connection.auth?.clientId,
            }
            : undefined);
        providers.set(activeProviderId, provider);
        return provider;
    }
    throw new Error(`Unsupported AI backend: "${activeProviderId}"`);
}
const LLAMA_MODEL_PATTERN = /\bllama(?:[.\-:\w]*)?\b/i;
const OLLAMA_BASEURL_PATTERN = /(^|\/\/)(?:[^/]*ollama|127\.0\.0\.1:11434|localhost:11434)/i;
export function shouldForceReasoningMode(providerId, model) {
    const connection = getActiveAIConnection();
    const endpoint = connection.endpoint?.trim() ?? "";
    if (providerId === "ollama" || providerId === "llama")
        return true;
    if (LLAMA_MODEL_PATTERN.test(model))
        return true;
    if (OLLAMA_BASEURL_PATTERN.test(endpoint))
        return true;
    return false;
}
//# sourceMappingURL=index.js.map