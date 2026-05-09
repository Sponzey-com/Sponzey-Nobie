import { type EnterpriseMetadata, type EnterpriseTimestamp, type FailureReport, type NodeContract, type NodeResultOutput, type NodeResultReport, type NodeResultStatus, type NodeRuntimeProfileSnapshot, type NodeRuntimeState, type TraceEvent, type WorkOrder } from "../contracts/enterprise-topology.js";
import type { ResultReport } from "../contracts/sub-agent-orchestration.js";
import type { CompiledTopologySnapshot } from "../topology/compiler.js";
import { type AggregationResult, type AggregationStrategy } from "./aggregation.js";
import { type NodeRuntimeAuthorityDecision } from "./authority-checker.js";
import { type ChildDispatchSummary, type ChildRuntimeRunner } from "./child-dispatcher.js";
import { type NodeExhaustionCheckResult } from "./exhaustion-checker.js";
import { type NodeRuntimePermissionDecision } from "./permission-checker.js";
import { type NodeRecoveryControllerOptions, type NodeRecoveryControllerResult } from "./recovery-controller.js";
import { type AggregatedNodeValidationResult } from "./validation.js";
import { type NodeToolExecutionSummary, type TopologyToolDispatcher } from "./tool-dispatcher.js";
import { type NodeToolRequest } from "./tool-planner.js";
import type { WorkOrderAuthorityPreflightInput, WorkOrderRuntimeEnvelope } from "./work-order.js";
import type { ToolContext } from "../tools/types.js";
export type NodeRuntimeSelfExecutionStatus = NodeResultStatus;
export interface NodeRuntimeStateTransition {
    state: NodeRuntimeState;
    at: EnterpriseTimestamp;
    reasonCode: string;
}
export interface NodeRuntimeInputValidationIssue {
    path: string;
    reasonCode: string;
    message: string;
}
export type NodeRuntimeInputValidationResult = {
    ok: true;
    issues: [];
} | {
    ok: false;
    issues: NodeRuntimeInputValidationIssue[];
};
export interface NodeRuntimeSelfExecutionContext {
    envelope: WorkOrderRuntimeEnvelope;
    profileSnapshot: NodeRuntimeProfileSnapshot;
    compiledTopologySnapshot: CompiledTopologySnapshot;
    nodeRunId: string;
}
export interface NodeRuntimeSelfExecutionResult {
    status?: NodeRuntimeSelfExecutionStatus;
    outputs?: NodeResultOutput[];
    risksOrGaps?: string[];
    partialResult?: EnterpriseMetadata;
    reasonCode?: string;
}
export type NodeRuntimeSelfExecutor = (context: NodeRuntimeSelfExecutionContext) => NodeRuntimeSelfExecutionResult | Promise<NodeRuntimeSelfExecutionResult>;
export interface RunNodeRuntimeInput {
    envelope: WorkOrderRuntimeEnvelope;
    compiledTopologySnapshot: CompiledTopologySnapshot;
    nodeRunId?: string;
    profileSnapshotId?: string;
    now?: () => number;
    authorityPreflight?: WorkOrderAuthorityPreflightInput;
    selfExecute?: NodeRuntimeSelfExecutor;
    childDelegation?: NodeRuntimeChildDelegationOptions;
    toolExecution?: NodeRuntimeToolExecutionOptions;
    aggregation?: NodeRuntimeAggregationOptions;
    recovery?: NodeRuntimeRecoveryOptions;
    component?: string;
}
export interface NodeRuntimeChildDelegationOptions {
    enabled: boolean;
    childNodeContractsById: Record<string, NodeContract>;
    targetChildNodeIds?: string[];
    maxDelegationDepth?: number;
    recursive?: boolean;
    childRunner?: ChildRuntimeRunner;
    childObjectiveByNodeId?: Record<string, string>;
    childInputByNodeId?: Record<string, EnterpriseMetadata>;
    childWorkOrderIdByNodeId?: Record<string, string>;
    authorityPreflightByNodeId?: Record<string, WorkOrderAuthorityPreflightInput>;
}
export interface NodeRuntimeToolExecutionOptions {
    enabled: boolean;
    dispatcher: TopologyToolDispatcher;
    baseToolContext: ToolContext;
    toolRequests?: NodeToolRequest[];
    defaultTimeoutMs?: number;
    dispatcherToolNameByToolId?: Record<string, string>;
    approvalDecisionsByToolId?: Record<string, "approved" | "denied">;
}
export interface NodeRuntimeAggregationOptions {
    enabled: boolean;
    strategy?: AggregationStrategy;
    expectedChildNodeIds?: string[];
    requireAllChildResults?: boolean;
    allowPartialSuccess?: boolean;
    quorum?: {
        requiredSatisfiedSourceCount: number;
    };
}
export interface NodeRuntimeRecoveryOptions extends NodeRecoveryControllerOptions {
    enabled: boolean;
}
export interface NodeRuntimeExecutionResult {
    status: NodeResultStatus;
    finalState: NodeRuntimeState;
    profileSnapshot: NodeRuntimeProfileSnapshot;
    nodeResultReport: NodeResultReport;
    legacyResultReport: ResultReport;
    traceEvents: TraceEvent[];
    stateTransitions: NodeRuntimeStateTransition[];
    permissionDecision: NodeRuntimePermissionDecision;
    authorityDecision: NodeRuntimeAuthorityDecision;
    inputValidation: NodeRuntimeInputValidationResult;
    envelope: WorkOrderRuntimeEnvelope;
    childDelegation?: ChildDispatchSummary;
    toolExecution?: NodeToolExecutionSummary;
    aggregation?: AggregationResult;
    validation?: AggregatedNodeValidationResult;
    recovery?: NodeRecoveryControllerResult;
    exhaustion?: NodeExhaustionCheckResult;
    failureReport?: FailureReport;
}
export declare function runNodeRuntime(input: RunNodeRuntimeInput): Promise<NodeRuntimeExecutionResult>;
export declare function validateNodeRuntimeInputSchema(nodeContractSnapshot: NodeContract, workOrder: WorkOrder): NodeRuntimeInputValidationResult;
//# sourceMappingURL=node-runtime.d.ts.map