import type { NodeContract, NodeResultReport, NodeResultStatus, NodeRuntimeState, TraceEvent } from "../contracts/enterprise-topology.js";
import type { CompiledTopologySnapshot } from "../topology/compiler.js";
import type { DelegationPlan, PlannedChildWorkOrder } from "./delegation-planner.js";
import { type WorkOrderAuthorityPreflightInput, type WorkOrderRuntimeBridgeIssue, type WorkOrderRuntimeEnvelope } from "./work-order.js";
export type ChildDispatchStatus = "completed" | "partial_success" | "failed_candidate" | "permission_limited";
export interface ChildRuntimeRunnerInput {
    planItem: PlannedChildWorkOrder;
    childNodeContractSnapshot: NodeContract;
    childEnvelope: WorkOrderRuntimeEnvelope;
    compiledTopologySnapshot: CompiledTopologySnapshot;
}
export interface ChildRuntimeRunnerResult {
    status: NodeResultStatus;
    finalState?: NodeRuntimeState;
    nodeResultReport?: NodeResultReport;
    traceEvents?: TraceEvent[];
    risksOrGaps?: string[];
}
export type ChildRuntimeRunner = (input: ChildRuntimeRunnerInput) => ChildRuntimeRunnerResult | Promise<ChildRuntimeRunnerResult>;
export interface ChildDispatchResult {
    childNodeId: string;
    childWorkOrderId: string;
    workOrder: PlannedChildWorkOrder["workOrder"];
    status: ChildDispatchStatus;
    failureCandidate: boolean;
    reasonCodes: string[];
    envelope?: WorkOrderRuntimeEnvelope;
    nodeResultReport?: NodeResultReport;
    traceEvents: TraceEvent[];
    bridgeIssues: WorkOrderRuntimeBridgeIssue[];
    risksOrGaps: string[];
}
export interface ChildDispatchSummary {
    status: "dispatched" | "partial" | "blocked" | "skipped";
    plan: DelegationPlan;
    results: ChildDispatchResult[];
    failureCandidateResults: ChildDispatchResult[];
    traceEvents: TraceEvent[];
    reasonCodes: string[];
}
export interface DispatchChildWorkOrdersInput {
    plan: DelegationPlan;
    compiledTopologySnapshot: CompiledTopologySnapshot;
    childNodeContractsById: Record<string, NodeContract>;
    childRunner: ChildRuntimeRunner;
    now?: () => number;
    authorityPreflightByNodeId?: Record<string, WorkOrderAuthorityPreflightInput>;
}
export declare function dispatchChildWorkOrders(input: DispatchChildWorkOrdersInput): Promise<ChildDispatchSummary>;
//# sourceMappingURL=child-dispatcher.d.ts.map