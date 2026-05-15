import type { NobieConfig } from "../config/types.js";
import { type DbChannelConnectionHealthStatus } from "../db/index.js";
import { type RuntimeFeatureFlag } from "../runtime/rollout-safety.js";
import { type ChannelConnectionRecord } from "./connections.js";
import type { ChannelCapabilities, ChannelProvider } from "./contracts.js";
export declare const CHANNEL_REGISTRY_RUNTIME_FEATURE_KEY = "channel_registry_runtime";
export type ChannelRegistryRuntimeMode = "legacy" | "registry";
export type ChannelRuntimeStartDisposition = "ready" | "started" | "skipped_disabled" | "skipped_unconfigured" | "unsupported_provider" | "failed";
export interface ChannelRuntimeAdapter {
    readonly provider: ChannelProvider;
    readonly connectionId: string;
    start(): Promise<void>;
    stop(): Promise<void> | void;
    healthCheck(): Promise<ChannelRuntimeHealth>;
    getCapabilities(): ChannelCapabilities;
}
export interface ChannelRuntimeHealth {
    status: DbChannelConnectionHealthStatus;
    message: string | null;
    checkedAt: number;
    detail?: Record<string, unknown>;
}
export interface ChannelProviderFactoryContext {
    config: NobieConfig;
    connection: ChannelConnectionRecord;
}
export interface ChannelProviderFactory {
    readonly provider: ChannelProvider;
    create(context: ChannelProviderFactoryContext): ChannelRuntimeAdapter;
}
export interface ChannelRuntimeSummary {
    connectionId: string;
    provider: ChannelProvider;
    displayName: string;
    enabled: boolean;
    configured: boolean;
    supported: boolean;
    disposition: ChannelRuntimeStartDisposition;
    health: ChannelRuntimeHealth;
    capabilities: ChannelCapabilities;
    diagnostics: {
        connectionMode: ChannelConnectionRecord["connectionMode"];
        requiresLocalBridge: boolean;
        requiresUserSession: boolean;
        riskLevel: ChannelCapabilities["riskLevel"];
        manualConfirmationRequired: boolean;
        configSource: ChannelConnectionRecord["configSource"];
    };
}
export interface ChannelRuntimeStartResult {
    mode: ChannelRegistryRuntimeMode;
    featureFlag: Pick<RuntimeFeatureFlag, "featureKey" | "mode" | "compatibilityMode">;
    summaries: ChannelRuntimeSummary[];
}
export declare function resolveChannelRegistryRuntimeMode(flag?: RuntimeFeatureFlag): ChannelRegistryRuntimeMode;
export declare function recordChannelRuntimeEvent(input: {
    connection: ChannelConnectionRecord;
    eventKind: string;
    healthStatus?: DbChannelConnectionHealthStatus | null;
    summary: string;
    detail?: Record<string, unknown>;
    now?: number;
}): string;
export declare function updateConnectionRuntimeHealth(connection: ChannelConnectionRecord, health: ChannelRuntimeHealth): ChannelConnectionRecord;
export declare function buildChannelRuntimeSummary(input: {
    connection: ChannelConnectionRecord;
    capabilities?: ChannelCapabilities;
    health: ChannelRuntimeHealth;
    supported: boolean;
    disposition: ChannelRuntimeStartDisposition;
}): ChannelRuntimeSummary;
//# sourceMappingURL=runtime.d.ts.map