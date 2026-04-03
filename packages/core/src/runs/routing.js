import { buildSetupDraft } from "../control-plane/index.js";
import { getConfig } from "../config/index.js";
import { AnthropicProvider } from "../ai/providers/anthropic.js";
import { GeminiProvider } from "../ai/providers/gemini.js";
import { OpenAIProvider } from "../ai/providers/openai.js";
export function resolveRunRoute(input) {
    return resolveRunRouteFromDraft(buildSetupDraft(), input);
}
export function resolveRunRouteFromDraft(draft, input, options) {
    const candidates = buildConfiguredCandidateTargets(draft, input);
    for (const targetId of candidates) {
        const backend = draft.aiBackends.find((item) => item.id === targetId);
        if (!backend || !backend.enabled)
            continue;
        const resolved = resolveBackend(backend, input.fallbackModel, options);
        if (resolved) {
            return {
                targetId: backend.id,
                targetLabel: backend.label,
                ...resolved,
                reason: `routing:${backend.id}`,
            };
        }
    }
    return {
        reason: "routing:no-configured-ai-backend",
    };
}
function buildConfiguredCandidateTargets(draft, input) {
    const result = [];
    const defaultTargets = draft.routingProfiles.find((item) => item.id === "default")?.targets ?? [];
    const configuredProvider = getConfig().ai.defaultProvider.trim();
    const configuredProviderTarget = normalizeTargetId(configuredProvider) ?? configuredProvider;
    const configuredTarget = defaultTargets.find((targetId) => {
        const backend = draft.aiBackends.find((item) => item.id === targetId && item.enabled);
        if (!backend)
            return false;
        if (!configuredProvider)
            return true;
        return backend.id === configuredProviderTarget || backend.providerType === configuredProvider;
    });
    const avoided = new Set((input.avoidTargets ?? [])
        .flatMap((value) => expandAvoidTargetIds(normalizeTargetId(value) ?? value))
        .filter((value) => typeof value === "string" && value.trim().length > 0));
    const add = (value) => {
        if (!value || result.includes(value) || avoided.has(value))
            return;
        result.push(value);
    };
    if (!configuredTarget)
        return result;
    add(configuredTarget);
    return result;
}
function expandAvoidTargetIds(value) {
    if (!value)
        return [];
    const normalized = value.trim();
    if (!normalized)
        return [];
    if (normalized.includes(":"))
        return [normalized];
    return [normalized, `provider:${normalized}`];
}
function resolveBackend(backend, _fallbackModel, _options) {
    const model = resolveConfiguredModel(backend);
    if (!model)
        return null;
    switch (backend.providerType) {
        case "anthropic": {
            const apiKey = backend.credentials.apiKey?.trim();
            if (!apiKey)
                return null;
            return {
                providerId: "anthropic",
                model,
                provider: new AnthropicProvider(buildProfile([apiKey])),
            };
        }
        case "openai": {
            const profile = buildProfile([backend.credentials.apiKey?.trim() || "nobie-local"]);
            return {
                providerId: "openai",
                model,
                provider: new OpenAIProvider(profile, backend.endpoint?.trim() || undefined),
            };
        }
        case "ollama":
        case "llama": {
            const endpoint = backend.endpoint?.trim()
                || (backend.providerType === "ollama" ? getConfig().ai.providers.ollama?.baseUrl?.trim() : undefined);
            if (!endpoint)
                return null;
            const profile = buildProfile([backend.credentials.apiKey?.trim() || "nobie-local"]);
            return {
                providerId: "openai",
                model,
                provider: new OpenAIProvider(profile, endpoint),
            };
        }
        case "custom": {
            const endpoint = backend.endpoint?.trim();
            if (!endpoint)
                return null;
            const apiKey = backend.credentials.apiKey?.trim() || "nobie-custom";
            return {
                providerId: "openai",
                model,
                provider: new OpenAIProvider(buildProfile([apiKey]), endpoint),
            };
        }
        case "gemini": {
            const apiKey = backend.credentials.apiKey?.trim();
            if (!apiKey)
                return null;
            return {
                providerId: "gemini",
                model,
                provider: new GeminiProvider(buildProfile([apiKey]), backend.endpoint?.trim() || undefined),
            };
        }
    }
}
function buildProfile(apiKeys) {
    return {
        apiKeys,
        currentKeyIndex: 0,
        cooldowns: new Map(),
    };
}
function normalizeTargetId(value) {
    if (!value)
        return undefined;
    const normalized = value.trim();
    if (!normalized || normalized === "auto" || normalized === "embedded" || normalized === "local_reasoner") {
        return undefined;
    }
    if (normalized === "anthropic") {
        return "provider:anthropic";
    }
    if (normalized === "openai")
        return "provider:openai";
    if (normalized === "gemini")
        return "provider:gemini";
    if (normalized === "ollama")
        return "provider:ollama";
    if (normalized === "llama" || normalized === "llama_cpp")
        return "provider:llama_cpp";
    return normalized;
}
function resolveConfiguredModel(backend) {
    if (backend.defaultModel.trim())
        return backend.defaultModel.trim();
    return "";
}
//# sourceMappingURL=routing.js.map
