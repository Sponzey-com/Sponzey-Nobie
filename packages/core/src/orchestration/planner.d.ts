import { type CapabilityRiskLevel, type DependencyEdgeContract, type OrchestrationPlan, type ResourceLockContract, type StructuredTaskScope } from "../contracts/sub-agent-orchestration.js";
import type { OrchestrationModeSnapshot } from "./mode.js";
import { type OrchestrationRegistrySnapshot } from "./registry.js";
export declare const ORCHESTRATION_PLANNER_VERSION = "structured-v1";
export interface OrchestrationPlannerIntent {
    explicitAgentId?: string;
    explicitTeamId?: string;
    specialtyTags?: string[];
    requiredCapabilities?: string[];
    requiredSkillIds?: string[];
    requiredMcpServerIds?: string[];
    requiredToolNames?: string[];
    requiredRisk?: CapabilityRiskLevel;
}
export interface OrchestrationPlannerInput {
    parentRunId: string;
    parentRequestId: string;
    userRequest: string;
    modeSnapshot: OrchestrationModeSnapshot;
    registrySnapshot?: OrchestrationRegistrySnapshot;
    loadRegistrySnapshot?: () => OrchestrationRegistrySnapshot;
    taskScopes?: StructuredTaskScope[];
    intent?: OrchestrationPlannerIntent;
    resourceLocks?: ResourceLockContract[];
    resourceLocksByTaskId?: Record<string, ResourceLockContract[]>;
    dependencyEdges?: DependencyEdgeContract[];
    timeoutMs?: number;
    now?: () => number;
    idProvider?: () => string;
}
export interface OrchestrationCandidateScore {
    agentId: string;
    teamIds: string[];
    score: number;
    selected: boolean;
    reasonCodes: string[];
    excludedReasonCodes: string[];
    approvalRequired: boolean;
    approvalRisk?: CapabilityRiskLevel;
}
export interface OrchestrationPlanBuildResult {
    plan: OrchestrationPlan;
    registrySnapshot?: OrchestrationRegistrySnapshot;
    candidateScores: OrchestrationCandidateScore[];
    timedOut: boolean;
    reasonCodes: string[];
}
export declare function buildDefaultStructuredTaskScope(userRequest: string): StructuredTaskScope;
export declare function buildOrchestrationPlan(input: OrchestrationPlannerInput): OrchestrationPlanBuildResult;
export declare function createOrchestrationPlanner(): {
    buildPlan: typeof buildOrchestrationPlan;
};
//# sourceMappingURL=planner.d.ts.map