import type Database from "better-sqlite3";
import type { EnterpriseEntityRef, EnterpriseMetadata, EnterpriseRelationType, EnterpriseTopology, FailureReport, TraceEvent, WorkOrder } from "../contracts/enterprise-topology.js";
export type ObservedTopologyRuntimeRelationType = EnterpriseRelationType | "runtime_failure" | "fallback_route";
export type ObservedTopologyEdgeKind = "delegation_path" | "tool_call" | "failed_node" | "fallback_route" | "observed_owner";
export interface ObservedTopologyEdge {
    edgeId: string;
    topologyId: string;
    topologyRunId?: string;
    relationType: ObservedTopologyRuntimeRelationType;
    edgeKind: ObservedTopologyEdgeKind;
    from: EnterpriseEntityRef;
    to: EnterpriseEntityRef;
    source: "trace_store" | "trace_event" | "work_order" | "tool_call" | "failure_report" | "manual";
    confidence: number;
    firstSeenAt: number;
    lastSeenAt: number;
    evidence: EnterpriseMetadata;
}
export interface ExtractObservedTopologyEdgesOptions {
    db?: Database.Database;
    topology?: EnterpriseTopology;
    topologyId?: string;
    topologyRunId?: string;
    edges?: ObservedTopologyEdge[];
    workOrders?: WorkOrder[];
    traceEvents?: TraceEvent[];
    failureReports?: FailureReport[];
    now?: number;
}
export declare function extractObservedTopologyEdges(options?: ExtractObservedTopologyEdgesOptions): ObservedTopologyEdge[];
//# sourceMappingURL=observed.d.ts.map