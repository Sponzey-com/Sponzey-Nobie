import type { NodeTaskAnalysis } from "./executor-task-analysis.js";
import type { AgentExecutionDecision } from "../orchestration/execution-decision-contract.js";
import type { ExecutionGraphSnapshot } from "../orchestration/execution-graph-snapshot.js";
import type { OrchestrationRegistrySnapshot } from "../orchestration/registry.js";
export type DelegationRoute = "sub_agent" | "yeonjang" | "nobie_direct" | "manual_approval" | "external";
export interface DelegationCandidate {
    targetId: string;
    targetLabel: string;
    targetType: "agent" | "team" | "yeonjang" | "nobie";
    matchedCapabilities: string[];
    missingCapabilities: string[];
    confidence: number;
    availability: "available" | "busy" | "offline" | "permission_required";
}
export interface DelegationFallbackRoute {
    route: DelegationRoute;
    reason: string;
}
export type DelegationPathValidationStatus = "not_requested" | "not_checked" | "valid" | "selected_executor_missing" | "selected_executor_not_direct_child" | "selected_connection_path_invalid";
export interface DelegationPathValidation {
    ok: boolean;
    status: DelegationPathValidationStatus;
    currentExecutorId: string;
    selectedExecutorId?: string;
    selectedConnectionPath: string[];
    normalizedConnectionPath: string[];
    issues: string[];
}
export interface NodeDelegationResolution {
    resolutionId: string;
    executorId: string;
    nodeContractId: string;
    selectedRoute: DelegationRoute;
    selectedTargetId: string;
    selectedTargetLabel: string;
    candidateTargets: DelegationCandidate[];
    selectionReason: string;
    fallbackRoutes: DelegationFallbackRoute[];
    pathValidation: DelegationPathValidation;
    visibility: "visible_node" | "system_preparation";
    requiresUserApproval: boolean;
    createdAt: string;
}
export interface DelegationRegistryCandidateInput {
    registry: Pick<OrchestrationRegistrySnapshot, "agents" | "teams">;
    taskAnalysis?: Pick<NodeTaskAnalysis, "requiredCapabilities" | "requiredTools">;
    includeTeams?: boolean;
}
export declare function resolveNodeDelegation(input: {
    executorId: string;
    nodeContractId?: string;
    taskAnalysis: Pick<NodeTaskAnalysis, "executorId" | "taskUnits" | "needsUserConfirmation" | "requiredCapabilities" | "requiredTools">;
    candidates?: DelegationCandidate[];
    executionDecision?: Pick<AgentExecutionDecision, "selected_executor_id" | "selected_connection_path" | "execution_route" | "reason">;
    executionGraphSnapshot?: Pick<ExecutionGraphSnapshot, "currentExecutorId" | "agentsById" | "directChildAgentIdsByParent" | "edgeIndex" | "allActiveExecutorIds" | "allRegisteredExecutorIds">;
    now?: string;
}): NodeDelegationResolution;
export declare function validateDelegationPath(input: {
    currentExecutorId: string;
    executionDecision?: Pick<AgentExecutionDecision, "selected_executor_id" | "selected_connection_path">;
    executionGraphSnapshot?: Pick<ExecutionGraphSnapshot, "currentExecutorId" | "agentsById" | "directChildAgentIdsByParent" | "edgeIndex" | "allActiveExecutorIds" | "allRegisteredExecutorIds">;
}): DelegationPathValidation;
export declare function delegationCandidatesFromRegistry(input: DelegationRegistryCandidateInput): DelegationCandidate[];
//# sourceMappingURL=executor-delegation-resolution.d.ts.map