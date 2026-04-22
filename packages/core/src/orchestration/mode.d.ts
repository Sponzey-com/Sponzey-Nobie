import { type OrchestrationConfig } from "../config/index.js";
import type { OrchestrationMode } from "../contracts/sub-agent-orchestration.js";
export type OrchestrationRuntimeStatus = "ready" | "disabled" | "degraded";
export type OrchestrationModeReasonCode = "feature_flag_off" | "mode_single_nobie" | "no_active_sub_agents" | "registry_load_failed" | "registry_load_timeout" | "orchestration_ready";
export interface OrchestrationRegistryAgentSnapshot {
    agentId: string;
    displayName: string;
    nickname?: string;
    source: "db" | "config";
}
export interface OrchestrationModeSnapshot {
    mode: OrchestrationMode;
    status: OrchestrationRuntimeStatus;
    featureFlagEnabled: boolean;
    requestedMode: OrchestrationMode;
    activeSubAgentCount: number;
    totalSubAgentCount: number;
    disabledSubAgentCount: number;
    activeSubAgents: OrchestrationRegistryAgentSnapshot[];
    reasonCode: OrchestrationModeReasonCode;
    reason: string;
    generatedAt: number;
}
export interface RegistryLoadResult {
    activeSubAgents: OrchestrationRegistryAgentSnapshot[];
    totalSubAgentCount: number;
    disabledSubAgentCount: number;
}
interface ResolveOrchestrationModeDependencies {
    getConfig?: () => Pick<{
        orchestration: OrchestrationConfig;
    }, "orchestration">;
    loadRegistry?: () => RegistryLoadResult | Promise<RegistryLoadResult>;
    now?: () => number;
    timeoutMs?: number;
}
interface ResolveOrchestrationModeSyncDependencies {
    getConfig?: () => Pick<{
        orchestration: OrchestrationConfig;
    }, "orchestration">;
    loadRegistry?: () => RegistryLoadResult;
    now?: () => number;
}
export declare function resolveOrchestrationModeSnapshotSync(dependencies?: ResolveOrchestrationModeSyncDependencies): OrchestrationModeSnapshot;
export declare function resolveOrchestrationModeSnapshot(dependencies?: ResolveOrchestrationModeDependencies): Promise<OrchestrationModeSnapshot>;
export declare function orchestrationCapabilityStatus(snapshot: OrchestrationModeSnapshot): {
    status: "ready" | "disabled" | "error";
    enabled: boolean;
};
export {};
//# sourceMappingURL=mode.d.ts.map