import { type OrchestrationConfig } from "../config/index.js";
import { type AgentConfig, type AgentRelationship, type CapabilityPolicy, type PermissionProfile, type SubAgentConfig, type TeamConfig } from "../contracts/sub-agent-orchestration.js";
import { type AgentConfigPersistenceOptions, type TeamConfigPersistenceOptions } from "../db/index.js";
import { type AgentCapabilitySummary, type AgentModelSummary } from "./capability-model.js";
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
export type OrchestrationRegistryStatus = "ready" | "degraded";
export type OrchestrationRegistryDiagnosticSeverity = "info" | "warning" | "invalid";
export interface OrchestrationRegistryDiagnostic {
    code: string;
    message: string;
    severity?: OrchestrationRegistryDiagnosticSeverity;
    agentId?: string;
    teamId?: string;
    parentAgentId?: string;
    childAgentId?: string;
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
    capabilitySummary: AgentCapabilitySummary;
    modelSummary: AgentModelSummary;
    degradedReasonCodes: string[];
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
    coverage?: RegistryTeamCoverageSnapshot;
    health?: RegistryTeamHealthSnapshot;
}
export interface RegistryHierarchyDirectChildSnapshot {
    parentAgentId: string;
    childAgentId: string;
    edgeId: string;
    relationshipStatus: AgentRelationship["status"] | "fallback";
    executionCandidate: boolean;
    reasonCodes: string[];
}
export interface RegistryHierarchySnapshot {
    rootAgentId: string;
    fallbackActive: boolean;
    directChildrenByParent: Record<string, string[]>;
    topLevelSubAgentIds: string[];
    directChildren: RegistryHierarchyDirectChildSnapshot[];
    diagnostics: OrchestrationRegistryDiagnostic[];
}
export interface RegistryCoverageDimensionSnapshot {
    required: string[];
    covered: string[];
    missing: string[];
    providers: Record<string, string[]>;
}
export interface RegistryTeamMemberCoverageSnapshot {
    agentId: string;
    membershipId: string;
    primaryRole: string;
    teamRoles: string[];
    required: boolean;
    executionState: "active" | "reference" | "unresolved" | "excluded" | "fallback";
    directChild: boolean;
    active: boolean;
    reasonCodes: string[];
    specialtyTags: string[];
    capabilityIds: string[];
    modelAvailability?: AgentModelSummary["availability"];
    capabilityAvailability?: AgentCapabilitySummary["availability"];
}
export interface RegistryTeamCoverageSnapshot {
    teamId: string;
    ownerAgentId: string;
    leadAgentId?: string;
    generatedAt: number;
    executionCandidate: boolean;
    activeMemberAgentIds: string[];
    referenceMemberAgentIds: string[];
    unresolvedMemberAgentIds: string[];
    excludedMemberAgentIds: string[];
    members: RegistryTeamMemberCoverageSnapshot[];
    roleCoverage: RegistryCoverageDimensionSnapshot;
    capabilityCoverage: RegistryCoverageDimensionSnapshot;
    diagnostics: OrchestrationRegistryDiagnostic[];
    recalculationKeys: string[];
}
export interface RegistryTeamHealthSnapshot {
    teamId: string;
    status: "healthy" | "degraded" | "invalid";
    executionCandidate: boolean;
    activeMemberCount: number;
    referenceMemberCount: number;
    unresolvedMemberCount: number;
    excludedMemberCount: number;
    diagnostics: OrchestrationRegistryDiagnostic[];
    coverageSummary: {
        missingRoles: string[];
        missingCapabilityTags: string[];
        recalculationKeys: string[];
    };
}
export interface AgentCapabilityIndexCandidate {
    parentAgentId: string;
    agentId: string;
    eligible: boolean;
    reasonCodes: string[];
    specialtyTags: string[];
    enabledSkillIds: string[];
    enabledMcpServerIds: string[];
    enabledToolNames: string[];
    modelAvailability: AgentModelSummary["availability"];
    capabilityAvailability: AgentCapabilitySummary["availability"];
    load: AgentRuntimeLoadSnapshot;
    failureRate: AgentFailureRateSnapshot;
}
export interface AgentCapabilityIndexMetrics {
    buildLatencyMs: number;
    targetP95Ms: number;
}
export interface AgentCapabilityIndex {
    generatedAt: number;
    cacheKey: string;
    rootAgentId: string;
    topLevelCandidateAgentIds: string[];
    directChildAgentIdsByParent: Record<string, string[]>;
    candidateAgentIdsByParent: Record<string, string[]>;
    excludedCandidatesByParent: Record<string, Array<{
        agentId: string;
        reasonCodes: string[];
    }>>;
    candidatesByAgentId: Record<string, AgentCapabilityIndexCandidate[]>;
    diagnostics: OrchestrationRegistryDiagnostic[];
    metrics: AgentCapabilityIndexMetrics;
}
export interface RegistryInvalidationTableFingerprint {
    rowCount: number;
    maxUpdatedAt: number;
    missing?: boolean;
}
export interface RegistryInvalidationSnapshot {
    cacheKey: string;
    configHash: string;
    tables: Record<string, RegistryInvalidationTableFingerprint>;
}
export interface OrchestrationRegistryLatencyMetrics {
    buildLatencyMs: number;
    coldSnapshotTargetP95Ms: number;
    hotIndexTargetP95Ms: number;
}
export interface OrchestrationRegistrySnapshot {
    status?: OrchestrationRegistryStatus;
    generatedAt: number;
    agents: AgentRegistryEntry[];
    teams: TeamRegistryEntry[];
    hierarchy?: RegistryHierarchySnapshot;
    capabilityIndex?: AgentCapabilityIndex;
    invalidation?: RegistryInvalidationSnapshot;
    metrics?: OrchestrationRegistryLatencyMetrics;
    fallback?: {
        mode: "single_nobie";
        reasonCode: "registry_load_failed";
        reason: string;
    };
    membershipEdges: Array<{
        teamId: string;
        agentId: string;
        status: "active" | "unresolved" | "removed";
        roleHint?: string;
    }>;
    diagnostics: OrchestrationRegistryDiagnostic[];
}
export interface RegistryServiceDependencies {
    getConfig?: () => Pick<{
        orchestration: OrchestrationConfig;
    }, "orchestration">;
    now?: () => number;
    failureWindowMs?: number;
}
export declare function clearAgentCapabilityIndexCache(): void;
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
    delete(teamId: string): boolean;
};
//# sourceMappingURL=registry.d.ts.map