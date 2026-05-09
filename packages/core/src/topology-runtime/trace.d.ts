import type Database from "better-sqlite3";
import { type EnterpriseMetadata, type EnterpriseTimestamp, type NodeRuntimeState, type TraceEvent, type TracePhase, type WorkOrder } from "../contracts/enterprise-topology.js";
import { type ObservedTopologyEdgeRecord, type TopologyGapFindingRecord } from "../topology/metrics.js";
import type { NodeRuntimeExecutionResult } from "./node-runtime.js";
export interface CreateNodeRuntimeTraceEventInput {
    workOrder: WorkOrder;
    nodeRunId: string;
    state: NodeRuntimeState;
    sequence: number;
    at: EnterpriseTimestamp;
    component?: string;
    phase?: TracePhase;
    reasonCode?: string;
    payload?: EnterpriseMetadata;
}
export declare function createNodeRuntimeTraceEvent(input: CreateNodeRuntimeTraceEventInput): TraceEvent;
export declare function tracePhaseForNodeRuntimeState(state: NodeRuntimeState): TracePhase;
export interface RecordTopologyRuntimeExecutionInput {
    result: NodeRuntimeExecutionResult;
    db?: Database.Database;
    topologyId?: string;
    topologyVersion?: number;
    topologyVersionId?: string;
    rootRunId?: string;
    startedAt?: number;
    finishedAt?: number;
    metadata?: Record<string, unknown>;
    now?: () => number;
}
export interface TopologyTracePersistenceResult {
    topologyRunId: string;
    nodeRunId: string;
    workOrderId: string;
    traceEventCount: number;
    toolCallCount: number;
    observedEdgeCount: number;
}
export interface TopologyRunRecord {
    topologyRunId: string;
    topologyId: string;
    topologyVersion?: number;
    topologyVersionId?: string;
    rootRunId?: string;
    status: string;
    entryNodeId?: string;
    startedAt: number;
    finishedAt?: number;
    createdAt: number;
    updatedAt: number;
    metadata?: unknown;
}
export interface TopologyNodeRunRecord {
    nodeRunId: string;
    topologyRunId: string;
    workOrderId?: string;
    nodeId: string;
    parentNodeRunId?: string;
    status: string;
    finalState?: string;
    startedAt: number;
    finishedAt?: number;
    createdAt: number;
    updatedAt: number;
    metrics?: unknown;
}
export interface TopologyWorkOrderRecord {
    workOrderId: string;
    topologyRunId: string;
    nodeRunId?: string;
    parentWorkOrderId?: string;
    fromNodeId: string;
    toType: string;
    toId: string;
    delegationPath: string[];
    workOrder: unknown;
    createdAt: number;
}
export interface TopologyResultReportRecord {
    resultReportId: string;
    topologyRunId: string;
    nodeRunId: string;
    workOrderId: string;
    nodeId: string;
    status: string;
    report: unknown;
    createdAt: number;
}
export interface TopologyFailureReportRecord {
    failureReportId: string;
    topologyRunId: string;
    nodeRunId: string;
    workOrderId: string;
    nodeId: string;
    failurePhase: string;
    report: unknown;
    createdAt: number;
}
export interface TopologyTraceEventRecord {
    traceEventId: string;
    topologyRunId: string;
    nodeRunId: string;
    workOrderId: string;
    parentWorkOrderId?: string;
    phase: TracePhase;
    component: string;
    reasonCode: string;
    delegationPath: string[];
    payload?: unknown;
    event: unknown;
    at: number;
    sequence: number;
}
export interface TopologyToolCallRecord {
    toolCallId: string;
    topologyRunId: string;
    nodeRunId: string;
    workOrderId: string;
    toolId: string;
    dispatcherToolName: string;
    status: string;
    reasonCode: string;
    retryPossible: boolean;
    fallbackPossible: boolean;
    startedAt: number;
    completedAt?: number;
    result: unknown;
}
export interface TopologyRunTraceProjection {
    run: TopologyRunRecord;
    nodeRuns: TopologyNodeRunRecord[];
    workOrders: TopologyWorkOrderRecord[];
    resultReports: TopologyResultReportRecord[];
    failureReports: TopologyFailureReportRecord[];
    traceEvents: TopologyTraceEventRecord[];
    toolCalls: TopologyToolCallRecord[];
    observedEdges: ObservedTopologyEdgeRecord[];
    gapFindings: TopologyGapFindingRecord[];
}
export interface ListTopologyRunsOptions {
    db?: Database.Database;
    topologyId?: string;
    rootRunId?: string;
    status?: string;
    limit?: number;
}
export interface ListTopologyRunChildrenOptions {
    db?: Database.Database;
    limit?: number;
}
export declare function recordTopologyRuntimeExecution(input: RecordTopologyRuntimeExecutionInput): TopologyTracePersistenceResult;
export declare function listTopologyRuns(options?: ListTopologyRunsOptions): TopologyRunRecord[];
export declare function getTopologyRun(topologyRunId: string, options?: {
    db?: Database.Database;
}): TopologyRunRecord | null;
export declare function listTopologyNodeRuns(topologyRunId: string, options?: ListTopologyRunChildrenOptions): TopologyNodeRunRecord[];
export declare function listTopologyWorkOrders(topologyRunId: string, options?: ListTopologyRunChildrenOptions): TopologyWorkOrderRecord[];
export declare function listTopologyResultReports(topologyRunId: string, options?: ListTopologyRunChildrenOptions): TopologyResultReportRecord[];
export declare function listTopologyFailureReports(topologyRunId: string, options?: ListTopologyRunChildrenOptions): TopologyFailureReportRecord[];
export declare function listTopologyTraceEvents(topologyRunId: string, options?: ListTopologyRunChildrenOptions): TopologyTraceEventRecord[];
export declare function listTopologyToolCalls(topologyRunId: string, options?: ListTopologyRunChildrenOptions): TopologyToolCallRecord[];
export declare function getTopologyRunTraceProjection(topologyRunId: string, options?: {
    db?: Database.Database;
    limit?: number;
}): TopologyRunTraceProjection | null;
export declare function listTopologyRunsForRootRun(rootRunId: string, options?: {
    db?: Database.Database;
    limit?: number;
}): TopologyRunTraceProjection[];
//# sourceMappingURL=trace.d.ts.map