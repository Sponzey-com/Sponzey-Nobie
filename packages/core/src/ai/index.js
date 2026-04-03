import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { getConfig } from "../config/index.js";
import { AnthropicProvider } from "./providers/anthropic.js";
import { GeminiProvider } from "./providers/gemini.js";
import { OpenAIProvider } from "./providers/openai.js";
const profiles = new Map();
const providers = new Map();
function buildProfile(apiKeys) {
    return { apiKeys, currentKeyIndex: 0, cooldowns: new Map() };
}
function resolveOpenAICodexAuthFilePath(config) {
    const configured = config?.authFilePath?.trim();
    if (configured)
        return configured.startsWith("~/") ? join(homedir(), configured.slice(2)) : configured;
    const codexHome = process.env["CODEX_HOME"]?.trim();
    if (codexHome)
        return join(codexHome.startsWith("~/") ? join(homedir(), codexHome.slice(2)) : codexHome, "auth.json");
    return join(homedir(), ".codex", "auth.json");
}
function isOpenAIOAuthConfigured(config = getConfig()) {
    const openai = config.ai.providers.openai;
    if (openai?.auth?.mode !== "chatgpt_oauth")
        return false;
    return existsSync(resolveOpenAICodexAuthFilePath({
        authFilePath: openai.auth.codexAuthFilePath,
        clientId: openai.auth.clientId,
    }));
}
function hasConfiguredAnthropicProvider(config = getConfig()) {
    return (config.ai.providers.anthropic?.apiKeys ?? []).filter(Boolean).length > 0;
}
function hasConfiguredOpenAIProvider(config = getConfig()) {
    const cfg = config.ai.providers;
    const authMode = cfg.openai?.auth?.mode ?? "api_key";
    if (authMode === "chatgpt_oauth") {
        return isOpenAIOAuthConfigured(config);
    }
    return (cfg.openai?.apiKeys ?? []).filter(Boolean).length > 0
        || !!cfg.openai?.baseUrl?.trim();
}
function hasConfiguredGeminiProvider(config = getConfig()) {
    return ((cfg) => (cfg.gemini?.apiKeys ?? []).filter(Boolean).length > 0 || !!cfg.gemini?.baseUrl?.trim())(config.ai.providers);
}
function hasConfiguredProvider(providerId, config = getConfig()) {
    if (providerId === "anthropic")
        return hasConfiguredAnthropicProvider(config);
    if (providerId === "openai")
        return hasConfiguredOpenAIProvider(config);
    if (providerId === "gemini")
        return hasConfiguredGeminiProvider(config);
    return false;
}
export function getProvider(providerId) {
    const config = getConfig();
    const id = providerId?.trim() || detectAvailableProvider();
    if (!id) {
        throw new Error("No configured AI backend is available. Connect an AI in settings first.");
    }
    if (providers.has(id))
        return providers.get(id);
    const cfg = config.ai.providers;
    if (id === "anthropic") {
        if (!hasConfiguredAnthropicProvider(config)) {
            throw new Error("Anthropic AI is not configured. Connect it in settings before using it.");
        }
        const keys = (cfg.anthropic?.apiKeys ?? []).filter(Boolean);
        const profile = buildProfile(keys);
        profiles.set(id, profile);
        const p = new AnthropicProvider(profile);
        providers.set(id, p);
        return p;
    }
    if (id === "openai") {
        if (!hasConfiguredOpenAIProvider(config)) {
            throw new Error("OpenAI AI is not configured. Connect it in settings before using it.");
        }
        const authMode = cfg.openai?.auth?.mode ?? "api_key";
        const keys = (cfg.openai?.apiKeys ?? []).filter(Boolean);
        const profile = buildProfile(keys);
        profiles.set(id, profile);
        const p = new OpenAIProvider(profile, cfg.openai?.baseUrl, authMode === "chatgpt_oauth"
            ? {
                authFilePath: cfg.openai?.auth?.codexAuthFilePath,
                clientId: cfg.openai?.auth?.clientId,
            }
            : undefined);
        providers.set(id, p);
        return p;
    }
    if (id === "gemini") {
        if (!hasConfiguredGeminiProvider(config)) {
            throw new Error("Gemini AI is not configured. Connect it in settings before using it.");
        }
        const keys = (cfg.gemini?.apiKeys ?? []).filter(Boolean);
        const profile = buildProfile(keys);
        profiles.set(id, profile);
        const p = new GeminiProvider(profile, cfg.gemini?.baseUrl);
        providers.set(id, p);
        return p;
    }
    throw new Error(`Unsupported AI backend: "${id}"`);
}
const MODEL_PROVIDER_PREFIXES = [
    [/^gpt-/i, "openai"],
    [/^o\d/i, "openai"],
    [/^claude-/i, "anthropic"],
    [/^gemini-/i, "gemini"],
];
const LLAMA_MODEL_PATTERN = /\bllama(?:[.\-:\w]*)?\b/i;
const OLLAMA_BASEURL_PATTERN = /(^|\/\/)(?:[^/]*ollama|127\.0\.0\.1:11434|localhost:11434)/i;
export function detectAvailableProvider() {
    const config = getConfig();
    const configured = config.ai.defaultProvider.trim();
    if (!configured)
        return "";
    return hasConfiguredProvider(configured, config) ? configured : "";
}
export function getDefaultModel() {
    const config = getConfig();
    const availableProvider = detectAvailableProvider();
    if (!availableProvider) {
        return "";
    }
    return config.ai.defaultModel.trim();
}
export function inferProviderId(model) {
    for (const [pattern, id] of MODEL_PROVIDER_PREFIXES) {
        if (pattern.test(model))
            return id;
    }
    return detectAvailableProvider();
}
export function shouldForceReasoningMode(providerId, model) {
    const config = getConfig();
    const openaiBaseUrl = config.ai.providers.openai?.baseUrl?.trim() ?? "";
    const ollamaBaseUrl = config.ai.providers.ollama?.baseUrl?.trim() ?? "";
    if (providerId === "ollama")
        return true;
    if (LLAMA_MODEL_PATTERN.test(model))
        return true;
    if (OLLAMA_BASEURL_PATTERN.test(openaiBaseUrl))
        return true;
    if (OLLAMA_BASEURL_PATTERN.test(ollamaBaseUrl))
        return true;
    return false;
}
//# sourceMappingURL=index.js.map
