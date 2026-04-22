import { type OrchestrationConfig } from "../config/index.js";
import { type AgentConfigPersistenceOptions, type TeamConfigPersistenceOptions } from "../db/index.js";
import { type AgentConfig, type CapabilityPolicy, type PermissionProfile, type SubAgentConfig, type TeamConfig } from "../contracts/sub-agent-orchestration.js";
export interface AgentRuntimeLoadSnapshot {
    activeSubSessions: number;
    queuedSubSessions: number;
    failedSubSessions: number;
    completedSubSessions: number;
    maxParallelSessions: number;
    utilization: number;
}
export interface AgentFailureRateSnapshot {
    windowMs: number;
    consideredSubSessions: number;
    failedSubSessions: number;
    value: number;
}
export interface AgentSkillMcpSummary {
    enabledSkillIds: string[];
    enabledMcpServerIds: string[];
    enabledToolNames: string[];
    disabledToolNames: string[];
    secretScopeId?: string;
}
export interface AgentRegistryEntry {
    agentId: string;
    displayName: string;
    nickname?: string;
    status: SubAgentConfig["status"];
    role: string;
    specialtyTags: string[];
    avoidTasks: string[];
    teamIds: string[];
    delegationEnabled: boolean;
    retryBudget: number;
    source: "db" | "config";
    config: SubAgentConfig;
    permissionProfile: PermissionProfile;
    capabilityPolicy: CapabilityPolicy;
    skillMcpSummary: AgentSkillMcpSummary;
    currentLoad: AgentRuntimeLoadSnapshot;
    failureRate: AgentFailureRateSnapshot;
}
export interface TeamRegistryEntry {
    teamId: string;
    displayName: string;
    nickname?: string;
    status: TeamConfig["status"];
    purpose: string;
    roleHints: string[];
    memberAgentIds: string[];
    activeMemberAgentIds: string[];
    unresolvedMemberAgentIds: string[];
    source: "db" | "config";
    config: TeamConfig;
}
export interface OrchestrationRegistrySnapshot {
    generatedAt: number;
    agents: AgentRegistryEntry[];
    teams: TeamRegistryEntry[];
    membershipEdges: Array<{
        teamId: string;
        agentId: string;
        status: "active" | "unresolved" | "removed";
        roleHint?: string;
    }>;
    diagnostics: Array<{
        code: string;
        message: string;
    }>;
}
export interface RegistryServiceDependencies {
    getConfig?: () => Pick<{
        orchestration: OrchestrationConfig;
    }, "orchestration">;
    now?: () => number;
    failureWindowMs?: number;
}
export declare function buildOrchestrationRegistrySnapshot(dependencies?: RegistryServiceDependencies): OrchestrationRegistrySnapshot;
export declare function createAgentRegistryService(dependencies?: RegistryServiceDependencies): {
    get(agentId: string): AgentConfig | undefined;
    list(): AgentConfig[];
    snapshot(): OrchestrationRegistrySnapshot;
    createOrUpdate(input: AgentConfig, options?: AgentConfigPersistenceOptions): void;
    disable(agentId: string): boolean;
    archive(agentId: string): boolean;
};
export declare function createTeamRegistryService(dependencies?: RegistryServiceDependencies): {
    get(teamId: string): TeamConfig | undefined;
    list(): TeamConfig[];
    snapshot(): OrchestrationRegistrySnapshot;
    createOrUpdate(input: TeamConfig, options?: TeamConfigPersistenceOptions): void;
    disable(teamId: string): boolean;
    archive(teamId: string): boolean;
};
//# sourceMappingURL=registry.d.ts.map