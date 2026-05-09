import type { EnterpriseMetadata, EnterpriseMetadataValue, TraceEvent, WorkOrder } from "../contracts/enterprise-topology.js";
import type { ToolDispatcher } from "../tools/dispatcher.js";
import type { ToolContext } from "../tools/types.js";
import type { NodeToolExecutionPlan } from "./tool-planner.js";
export type TopologyToolDispatcher = Pick<ToolDispatcher, "dispatch">;
export type NodeToolExecutionStatus = "succeeded" | "denied" | "timeout" | "execution_error" | "skipped";
export interface NormalizedNodeToolResult {
    toolId: string;
    dispatcherToolName: string;
    status: NodeToolExecutionStatus;
    reasonCode: string;
    output?: EnterpriseMetadataValue;
    error?: string;
    retryPossible: boolean;
    fallbackPossible: boolean;
    failureCandidate: boolean;
    startedAt: number;
    completedAt: number;
    traceEvents: TraceEvent[];
    failureCandidateInfo?: EnterpriseMetadata;
}
export interface NodeToolExecutionSummary {
    status: "completed" | "partial" | "failed_candidate" | "skipped";
    plan: NodeToolExecutionPlan;
    results: NormalizedNodeToolResult[];
    failureCandidateResults: NormalizedNodeToolResult[];
    traceEvents: TraceEvent[];
    reasonCodes: string[];
}
export interface DispatchPlannedNodeToolsInput {
    plan: NodeToolExecutionPlan;
    dispatcher: TopologyToolDispatcher;
    workOrder: WorkOrder;
    nodeRunId: string;
    baseToolContext: ToolContext;
    now?: () => number;
    traceSequenceStart?: number;
}
export declare function dispatchPlannedNodeTools(input: DispatchPlannedNodeToolsInput): Promise<NodeToolExecutionSummary>;
//# sourceMappingURL=tool-dispatcher.d.ts.map