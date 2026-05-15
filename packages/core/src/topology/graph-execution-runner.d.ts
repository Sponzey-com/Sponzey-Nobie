import type { GraphExecutionPlan } from "./graph-execution-plan.js";
import type { NodeExecutionPlan } from "./graph-execution-plan.js";
import type { WorkOrder } from "../contracts/enterprise-topology.js";
import type { NonTerminalRecoveryReason, TerminalFailureReason } from "../runs/execution-policy.js";
export type GraphExecutionEventType = "graph_plan_created" | "node_execution_planning" | "node_delegation_started" | "node_execution_started" | "node_recovery_started" | "node_execution_completed" | "node_execution_failed" | "node_execution_cancelled" | "edge_handoff_started" | "edge_handoff_completed" | "graph_execution_completed" | "graph_execution_cancelled";
export type GraphNodeExecutionStatus = "pending" | "planning" | "delegating" | "running" | "waiting" | "recovering" | "completed" | "failed" | "cancelled";
export type GraphExecutionOutcomeStatus = "completed" | "cancelled" | "failed" | "waiting_for_user";
export interface GraphExecutionOutcome {
    status: GraphExecutionOutcomeStatus;
    terminalReason?: TerminalFailureReason;
    cancellationReason?: "user_cancelled" | "channel_cancelled" | "node_cancelled";
    recoveryState: "not_needed" | "needs_alternative" | "waiting_for_user" | "no_safe_alternative" | "cancelled";
    recoverySignal?: NonTerminalRecoveryReason;
    diagnosticId?: string;
}
export interface GraphEdgeHandoffEnvelope {
    edgeId: string;
    sourceExecutorId: string;
    targetExecutorId: string;
    relationKind: string;
    outputBinding: string;
    inputBinding: string;
}
export interface GraphExecutionEvent {
    eventId: string;
    graphExecutionPlanId: string;
    type: GraphExecutionEventType;
    executorId?: string;
    edgeId?: string;
    status?: GraphNodeExecutionStatus | GraphExecutionOutcomeStatus;
    activeExecutorIds: string[];
    activeEdgeIds: string[];
    terminalReason?: TerminalFailureReason;
    recoveryReason?: NonTerminalRecoveryReason;
    cancellationReason?: GraphExecutionOutcome["cancellationReason"];
    payload?: unknown;
    at: string;
}
export interface GraphExecutionRunResult {
    status: GraphExecutionOutcomeStatus;
    outcome: GraphExecutionOutcome;
    activeExecutorIds: string[];
    activeEdgeIds: string[];
    events: GraphExecutionEvent[];
}
export interface GraphWorkOrderMetadata {
    graphExecutionPlanId: string;
    topologyId: string;
    workspaceId: string;
    executorId: string;
    nodeContractId: string;
    edgeId?: string;
    delegationResolutionId: string;
    taskAnalysisId: string;
    selectedRoute: string;
    selectedTargetId: string;
    systemPreparation: boolean;
}
export type VisibleUserWorkOrderGuardResult = {
    ok: true;
    metadata: GraphWorkOrderMetadata;
} | {
    ok: false;
    reasonCode: "missing_graph_metadata" | "missing_executor_id" | "system_preparation_user_result_blocked";
};
export declare function simulateGraphExecutionPlan(input: {
    plan: GraphExecutionPlan;
    cancelled?: boolean;
    failure?: {
        executorId: string;
        reason: string;
        explicitUserLimit?: boolean;
    };
    now?: string;
}): GraphExecutionRunResult;
export declare function buildWorkOrderFromNodeExecutionPlan(input: {
    plan: GraphExecutionPlan;
    nodePlan: NodeExecutionPlan;
    topologyRunId?: string;
    parentWorkOrderId?: string | null;
    edgeId?: string;
    systemPreparation?: boolean;
    createdAt?: number | string;
}): WorkOrder;
export declare function readGraphWorkOrderMetadata(workOrder: WorkOrder): GraphWorkOrderMetadata | null;
export declare function assertVisibleUserWorkOrder(workOrder: WorkOrder): VisibleUserWorkOrderGuardResult;
export declare function normalizeGraphExecutionOutcome(input: {
    status: GraphExecutionOutcomeStatus;
    terminalReason?: string;
    cancellationReason?: GraphExecutionOutcome["cancellationReason"];
    explicitUserLimit?: boolean;
}): GraphExecutionOutcome;
//# sourceMappingURL=graph-execution-runner.d.ts.map