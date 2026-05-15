import type { ExecutorGraphWorkspace } from "./executor-graph.js";
import { type NodeDelegationResolution } from "./executor-delegation-resolution.js";
import { type NodeTaskAnalysis } from "./executor-task-analysis.js";
import { type ExecutionPolicySnapshot } from "../runs/execution-policy.js";
export interface CancellationPolicySnapshot {
    userCancelPriority: true;
    cancellationOutcome: "cancelled";
}
export interface NodeExecutionPlan {
    executorId: string;
    nodeContractId: string;
    taskAnalysis: NodeTaskAnalysis;
    delegationResolution: NodeDelegationResolution;
    inputBindings: string[];
    outputBindings: string[];
}
export interface EdgeExecutionPlan {
    edgeId: string;
    sourceExecutorId: string;
    targetExecutorId: string;
    relationKind: string;
    executionBehavior: "handoff" | "approval" | "review" | "report" | "exception" | "reference" | "collaboration";
    propagation: "sequential" | "parallel" | "conditional";
}
export interface GraphExecutionPlan {
    graphExecutionPlanId: string;
    topologyId: string;
    workspaceId: string;
    entryExecutorIds: string[];
    nodePlans: NodeExecutionPlan[];
    edgePlans: EdgeExecutionPlan[];
    recoveryPolicy: ExecutionPolicySnapshot;
    cancellationPolicy: CancellationPolicySnapshot;
    validationWarnings: string[];
    createdAt: string;
}
export declare function buildGraphExecutionPlan(input: {
    workspaceId: string;
    graph: ExecutorGraphWorkspace;
    now?: string;
}): GraphExecutionPlan;
export declare function validateGraphExecutionPlan(input: {
    nodePlans: NodeExecutionPlan[];
    edgePlans: EdgeExecutionPlan[];
}): string[];
//# sourceMappingURL=graph-execution-plan.d.ts.map