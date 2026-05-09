import type Database from "better-sqlite3";
import type { EnterpriseTimestamp, EnterpriseTopology } from "../contracts/enterprise-topology.js";
export interface TopologyMetricsDailyRecord {
    metricDate: string;
    topologyId: string;
    topologyVersion: number;
    topologyRunCount: number;
    nodeRunCount: number;
    completedCount: number;
    failedCount: number;
    partialSuccessCount: number;
    toolCallCount: number;
    failureCount: number;
    updatedAt: number;
}
export interface ObservedTopologyEdgeRecord {
    edgeId: string;
    topologyId: string;
    topologyRunId: string;
    fromNodeId: string;
    toNodeId: string;
    edgeKind: string;
    source: string;
    confidence: number;
    firstSeenAt: number;
    lastSeenAt: number;
    evidence: unknown;
}
export interface TopologyGapFindingRecord {
    findingId: string;
    topologyId: string;
    topologyRunId?: string;
    findingKind: string;
    severity: string;
    status: string;
    summary: string;
    detail: unknown;
    createdAt: number;
    updatedAt: number;
}
export interface EnterpriseOrgWorkloadMetric {
    topologyId: string;
    orgUnitId: string;
    orgUnitName: string;
    positionCount: number;
    personCount: number;
    activeMembershipCount: number;
    allocatedPercent: number;
    ownedNodeCount: number;
    responsibilityCount: number;
    approvalTargetCount: number;
    processCount: number;
    criticalSystemCount: number;
    workloadScore: number;
    capacityScore: number;
    bottleneckScore: number;
    bottleneckReasons: string[];
}
export interface ProjectTopologyMetricsDailyOptions {
    db?: Database.Database;
    metricDate?: string;
    topologyId?: string;
    topologyVersion?: number;
    now?: number;
}
export interface ListTopologyMetricsDailyOptions {
    db?: Database.Database;
    metricDate?: string;
    topologyId?: string;
    limit?: number;
}
export interface ListTopologyObservabilityOptions {
    db?: Database.Database;
    topologyId?: string;
    topologyRunId?: string;
    limit?: number;
}
export interface ProjectEnterpriseOrgWorkloadMetricsOptions {
    asOf?: EnterpriseTimestamp;
    bottleneckThreshold?: number;
}
export declare function projectEnterpriseOrgWorkloadMetrics(topology: EnterpriseTopology, options?: ProjectEnterpriseOrgWorkloadMetricsOptions): EnterpriseOrgWorkloadMetric[];
export declare function refreshTopologyMetricsDaily(db: Database.Database, input: {
    metricDate: string;
    topologyId: string;
    topologyVersion?: number | null;
    now?: number;
}): TopologyMetricsDailyRecord;
export declare function projectTopologyMetricsDaily(options?: ProjectTopologyMetricsDailyOptions): TopologyMetricsDailyRecord[];
export declare function projectTopologyRunMetricsDaily(db: Database.Database, input: {
    topologyId: string;
    topologyVersion?: number | null;
    startedAt: number;
    now?: number;
}): TopologyMetricsDailyRecord;
export declare function listTopologyMetricsDaily(options?: ListTopologyMetricsDailyOptions): TopologyMetricsDailyRecord[];
export declare function listObservedTopologyEdges(options?: ListTopologyObservabilityOptions): ObservedTopologyEdgeRecord[];
export declare function listTopologyGapFindings(options?: ListTopologyObservabilityOptions): TopologyGapFindingRecord[];
//# sourceMappingURL=metrics.d.ts.map