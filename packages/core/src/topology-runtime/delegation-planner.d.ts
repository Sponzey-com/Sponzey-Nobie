import { type EnterpriseMetadata, type EnterpriseTimestamp, type NodeResultStatus, type WorkOrder } from "../contracts/enterprise-topology.js";
import { type CompiledNode, type CompiledTopologySnapshot } from "../topology/compiler.js";
export declare const DEFAULT_TOPOLOGY_RUNTIME_MAX_DELEGATION_DEPTH = 5;
export type DelegationPlanStatus = "planned" | "partial" | "blocked" | "skipped";
export type DelegationPlanIssueCode = "parent_node_missing" | "child_node_missing" | "no_direct_child_candidates" | "grandchild_direct_delegation_forbidden" | "not_direct_child" | "max_delegation_depth_exceeded";
export interface DelegationPlanIssue {
    code: DelegationPlanIssueCode;
    reasonCode: DelegationPlanIssueCode;
    message: string;
    parentNodeId: string;
    childNodeId?: string;
}
export interface ChildDelegationCandidate {
    parentNodeId: string;
    childNode: CompiledNode;
    delegationDepth: number;
    reasonCodes: string[];
}
export interface PlannedChildWorkOrder {
    parentNodeId: string;
    childNodeId: string;
    childNode: CompiledNode;
    workOrder: WorkOrder;
    delegationDepth: number;
    reasonCodes: string[];
}
export interface DelegationPlan {
    ok: boolean;
    status: DelegationPlanStatus;
    parentNodeId: string;
    parentWorkOrderId: string;
    parentDelegationDepth: number;
    childDelegationDepth: number;
    maxDelegationDepth: number;
    directChildCandidates: ChildDelegationCandidate[];
    childWorkOrders: PlannedChildWorkOrder[];
    skipped: DelegationPlanIssue[];
    reasonCodes: string[];
}
export interface PlanChildDelegationInput {
    compiledTopologySnapshot: CompiledTopologySnapshot;
    parentWorkOrder: WorkOrder;
    parentNodeId?: string;
    targetChildNodeIds?: string[];
    maxDelegationDepth?: number;
    childObjectiveByNodeId?: Record<string, string>;
    childInputByNodeId?: Record<string, EnterpriseMetadata>;
    childWorkOrderIdByNodeId?: Record<string, string>;
    now?: () => number;
}
export interface TopologyNestedDelegationCompatibilityBoundary {
    topologyRuntimeBoundary: "compiled_topology_direct_child_work_order";
    existingOrchestrationBoundary: "orchestration_nested_delegation_command_request";
    sharedRules: string[];
    separatedResponsibilities: string[];
}
export declare function listDirectChildDelegationCandidates(input: {
    compiledTopologySnapshot: CompiledTopologySnapshot;
    parentNodeId: string;
    parentWorkOrder: WorkOrder;
}): ChildDelegationCandidate[];
export declare function planChildDelegation(input: PlanChildDelegationInput): DelegationPlan;
export declare function buildChildWorkOrder(input: {
    parentWorkOrder: WorkOrder;
    parentNodeId: string;
    childNode: CompiledNode;
    delegationDepth: number;
    objective?: string;
    input?: EnterpriseMetadata;
    workOrderId?: string;
    createdAt: EnterpriseTimestamp;
}): WorkOrder;
export declare function calculateWorkOrderDelegationDepth(workOrder: WorkOrder): number;
export declare function isTopologyChildFailureStatus(status: NodeResultStatus): boolean;
export declare function describeTopologyNestedDelegationCompatibilityBoundary(): TopologyNestedDelegationCompatibilityBoundary;
//# sourceMappingURL=delegation-planner.d.ts.map