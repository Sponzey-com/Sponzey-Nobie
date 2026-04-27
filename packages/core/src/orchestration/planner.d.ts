import type { CapabilityRiskLevel, DependencyEdgeContract, OrchestrationPlan, ResourceLockContract, StructuredTaskScope } from "../contracts/sub-agent-orchestration.js";
import type { OrchestrationModeSnapshot } from "./mode.js";
import { type OrchestrationRegistrySnapshot } from "./registry.js";
export declare const ORCHESTRATION_PLANNER_VERSION = "structured-v1";
export declare const FAST_PATH_CLASSIFIER_TARGET_P95_MS = 100;
export declare const ORCHESTRATION_PLANNER_TARGET_P95_MS = 700;
export type FastPathClassification = "direct_nobie" | "delegation_candidate" | "workflow_candidate";
export interface FastPathClassifierInput {
    userRequest: string;
    intent?: OrchestrationPlannerIntent;
    now?: () => number;
}
export interface FastPathClassificationResult {
    classification: FastPathClassification;
    reasonCodes: string[];
    targetP95Ms: number;
    latencyMs: number;
    explanation: string;
}
export interface OrchestrationPlannerDiagnostic {
    code: string;
    severity: "info" | "warning" | "invalid";
    message: string;
    agentId?: string;
    teamId?: string;
}
export interface OrchestrationPlannerIntent {
    explicitAgentId?: string;
    explicitTeamId?: string;
    requiredRoles?: string[];
    specialtyTags?: string[];
    requiredCapabilities?: string[];
    requiredSkillIds?: string[];
    requiredMcpServerIds?: string[];
    requiredToolNames?: string[];
    requiredRisk?: CapabilityRiskLevel;
}
export interface OrchestrationPlannerLearningHint {
    hintId?: string;
    suggestedAgentId?: string;
    suggestedTeamId?: string;
    confidence?: number;
    evidenceRefs?: string[];
    reasonCode?: string;
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
    learningHints?: OrchestrationPlannerLearningHint[];
    parentAgentId?: string;
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
    explanation: string;
    approvalRequired: boolean;
    approvalRisk?: CapabilityRiskLevel;
}
export interface OrchestrationPlanBuildResult {
    plan: OrchestrationPlan;
    registrySnapshot?: OrchestrationRegistrySnapshot;
    candidateScores: OrchestrationCandidateScore[];
    diagnostics: OrchestrationPlannerDiagnostic[];
    fastPathClassification: FastPathClassificationResult;
    timedOut: boolean;
    reasonCodes: string[];
}
export declare function classifyFastPath(input: FastPathClassifierInput): FastPathClassificationResult;
export declare function resolveExplicitTeamIdFromRequest(userRequest: string, registry: OrchestrationRegistrySnapshot): string | undefined;
export declare function buildDefaultStructuredTaskScope(userRequest: string): StructuredTaskScope;
export declare function buildOrchestrationPlan(input: OrchestrationPlannerInput): OrchestrationPlanBuildResult;
export declare function createOrchestrationPlanner(): {
    buildPlan: typeof buildOrchestrationPlan;
};
//# sourceMappingURL=planner.d.ts.map
