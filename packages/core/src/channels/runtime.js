import { insertChannelRuntimeEvent, } from "../db/index.js";
import { getFeatureFlag, shouldUseNewPath } from "../runtime/rollout-safety.js";
import { persistChannelConnections, } from "./connections.js";
export const CHANNEL_REGISTRY_RUNTIME_FEATURE_KEY = "channel_registry_runtime";
export function resolveChannelRegistryRuntimeMode(flag = getFeatureFlag(CHANNEL_REGISTRY_RUNTIME_FEATURE_KEY)) {
    return shouldUseNewPath(flag) ? "registry" : "legacy";
}
export function recordChannelRuntimeEvent(input) {
    return insertChannelRuntimeEvent({
        connectionId: input.connection.connectionId,
        provider: input.connection.provider,
        eventKind: input.eventKind,
        healthStatus: input.healthStatus ?? null,
        summary: input.summary,
        detail: input.detail ?? {},
        createdAt: input.now ?? Date.now(),
    });
}
export function updateConnectionRuntimeHealth(connection, health) {
    const updated = {
        ...connection,
        health: {
            status: health.status,
            message: health.message,
            checkedAt: health.checkedAt,
        },
        updatedAt: health.checkedAt,
    };
    persistChannelConnections([updated]);
    return updated;
}
export function buildChannelRuntimeSummary(input) {
    const capabilities = input.capabilities ?? input.connection.capabilityManifest;
    return {
        connectionId: input.connection.connectionId,
        provider: input.connection.provider,
        displayName: input.connection.displayName,
        enabled: input.connection.enabled,
        configured: input.connection.configured,
        supported: input.supported,
        disposition: input.disposition,
        health: input.health,
        capabilities,
        diagnostics: {
            connectionMode: input.connection.connectionMode,
            requiresLocalBridge: capabilities.requiresLocalBridge,
            requiresUserSession: capabilities.requiresUserSession,
            riskLevel: capabilities.riskLevel,
            manualConfirmationRequired: capabilities.manualConfirmationRequired === true,
            configSource: input.connection.configSource,
        },
    };
}
//# sourceMappingURL=runtime.js.map