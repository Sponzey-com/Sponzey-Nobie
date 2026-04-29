import type { NobieConfig } from "../config/types.js";
import { type ChannelConnectionRecord } from "./connections.js";
import { type ChannelProviderFactory, type ChannelRuntimeStartResult, type ChannelRuntimeSummary } from "./runtime.js";
export interface ChannelRegistryOptions {
    config: NobieConfig;
    connections?: ChannelConnectionRecord[];
    factories?: ChannelProviderFactory[];
    now?: () => number;
}
export interface ChannelRegistryPlanItem {
    connection: ChannelConnectionRecord;
    factory: ChannelProviderFactory | null;
    shouldStart: boolean;
    reason: "enabled_configured" | "disabled" | "unconfigured" | "unsupported_provider";
}
export declare class ChannelRegistry {
    private readonly config;
    private readonly now;
    private readonly factories;
    private readonly adapters;
    private readonly fixedConnections;
    constructor(options: ChannelRegistryOptions);
    registerFactory(factory: ChannelProviderFactory): void;
    loadConnections(): ChannelConnectionRecord[];
    plan(): ChannelRegistryPlanItem[];
    startEnabled(): Promise<ChannelRuntimeStartResult>;
    stopAll(): Promise<ChannelRuntimeSummary[]>;
    getCapabilitySummaries(): ChannelRuntimeSummary[];
    private health;
}
export declare function createBuiltInChannelProviderFactories(): ChannelProviderFactory[];
export declare function buildChannelRegistryRuntimeDiagnostics(config: NobieConfig): ChannelRuntimeSummary[];
//# sourceMappingURL=registry.d.ts.map