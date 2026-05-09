import { buildSetupDraft } from "../control-plane/index.js";
import { resolveProviderForConnection, } from "../ai/index.js";
import { attachCapabilityProfileToTrace, getProviderCapabilityMatrix } from "../ai/capabilities.js";
export function resolveRunRoute(input) {
    return resolveRunRouteFromDraft(buildSetupDraft(), input);
}
export function isExplicitProviderRouteTarget(value) {
    return normalizeTargetId(value) !== undefined;
}
export function resolveRunRouteFromDraft(draft, input, options) {
    const candidates = buildConfiguredCandidateTargets(draft, input);
    if (candidates.length === 0) {
        return {
            reason: "routing:no-explicit-provider-target",
        };
    }
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
                reason: `explicit_provider:${backend.id}`,
            };
        }
    }
    return {
        reason: "routing:no-configured-ai-backend",
    };
}
function buildConfiguredCandidateTargets(draft, input) {
    const result = [];
    const avoided = new Set((input.avoidTargets ?? [])
        .flatMap((value) => expandAvoidTargetIds(normalizeTargetId(value) ?? value))
        .filter((value) => typeof value === "string" && value.trim().length > 0));
    const add = (value) => {
        if (!value || result.includes(value) || avoided.has(value))
            return;
        result.push(value);
    };
    add(normalizeTargetId(input.preferredTarget));
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
    const connection = backendToConnection(backend);
    const resolved = resolveProviderForConnection(connection);
    if (!resolved)
        return null;
    return {
        providerId: resolved.providerId,
        model: resolved.model,
        provider: resolved.provider,
        providerTrace: attachCapabilityProfileToTrace(resolved.resolution.auditTrace, backend.capabilityMatrix ?? getProviderCapabilityMatrix({ connection })),
    };
}
function backendToConnection(backend) {
    const endpoint = backend.endpoint?.trim();
    return {
        provider: backend.providerType,
        model: resolveConfiguredModel(backend),
        ...(endpoint ? { endpoint } : {}),
        auth: {
            mode: backend.authMode ?? "api_key",
            ...(backend.credentials.apiKey?.trim() ? { apiKey: backend.credentials.apiKey.trim() } : {}),
            ...(backend.credentials.username?.trim() ? { username: backend.credentials.username.trim() } : {}),
            ...(backend.credentials.password ? { password: backend.credentials.password } : {}),
            ...(backend.credentials.oauthAuthFilePath?.trim() ? { oauthAuthFilePath: backend.credentials.oauthAuthFilePath.trim() } : {}),
        },
    };
}
function normalizeTargetId(value) {
    if (!value)
        return undefined;
    const normalized = value.trim();
    if (!normalized || normalized === "auto" || normalized === "embedded" || normalized === "local_reasoner") {
        return undefined;
    }
    if (normalized.startsWith("provider:") || normalized.startsWith("model:") || normalized.startsWith("worker:")) {
        return normalized;
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
    return undefined;
}
function resolveConfiguredModel(backend) {
    if (backend.defaultModel.trim())
        return backend.defaultModel.trim();
    return "";
}
//# sourceMappingURL=routing.js.map
