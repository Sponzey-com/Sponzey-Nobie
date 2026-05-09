import type { EnterpriseEntityRef, EnterpriseMetadata, EnterpriseRelationType, EnterpriseTopology } from "../contracts/enterprise-topology.js";
import { type ExtractObservedTopologyEdgesOptions, type ObservedTopologyEdge, type ObservedTopologyRuntimeRelationType } from "./observed.js";
export type TopologyRelationDiffKind = "matched" | "observed_only" | "declared_only" | "mismatched_relation";
export type TopologyGapFindingKind = "observed_only_relation" | "declared_only_relation" | "mismatched_relation" | "single_point_of_failure" | "approval_bottleneck" | "unclear_owner" | "duplicate_owner" | "orphan_process" | "overloaded_node" | "missing_backup" | "raci_incomplete" | "process_sla_missing" | "critical_system_access_gap" | "org_workload_bottleneck";
export type TopologyGapSeverity = "info" | "low" | "medium" | "high" | "critical";
export type TopologyGapFindingStatus = "open" | "acknowledged" | "resolved";
export interface DeclaredTopologyEdge {
    edgeId: string;
    topologyId: string;
    relationType: EnterpriseRelationType;
    from: EnterpriseEntityRef;
    to: EnterpriseEntityRef;
    source: "relation" | "node_children" | "node_owner" | "responsibility";
    relationId?: string;
    nodeId?: string;
    evidence: EnterpriseMetadata;
}
export interface TopologyRelationDiff {
    diffId: string;
    kind: TopologyRelationDiffKind;
    relationType: ObservedTopologyRuntimeRelationType;
    from: EnterpriseEntityRef;
    to: EnterpriseEntityRef;
    declaredEdge?: DeclaredTopologyEdge;
    observedEdge?: ObservedTopologyEdge;
    reasonCode: string;
}
export interface TopologyGapFinding {
    findingId: string;
    topologyId: string;
    topologyRunId?: string;
    findingKind: TopologyGapFindingKind;
    severity: TopologyGapSeverity;
    status: TopologyGapFindingStatus;
    summary: string;
    recommendation: string;
    relatedEntities: EnterpriseEntityRef[];
    relatedRelations: string[];
    relatedRuns: string[];
    detail: EnterpriseMetadata;
    createdAt: number;
    updatedAt: number;
}
export interface TopologyGapAnalysisSummary {
    declaredEdgeCount: number;
    observedEdgeCount: number;
    matchedCount: number;
    observedOnlyCount: number;
    declaredOnlyCount: number;
    mismatchedCount: number;
    findingCount: number;
    highOrCriticalFindingCount: number;
}
export interface TopologyGapAnalysisResult {
    topologyId: string;
    topologyRunId?: string;
    generatedAt: number;
    declaredEdges: DeclaredTopologyEdge[];
    observedEdges: ObservedTopologyEdge[];
    diffs: TopologyRelationDiff[];
    findings: TopologyGapFinding[];
    summary: TopologyGapAnalysisSummary;
}
export interface AnalyzeTopologyGapsOptions extends Omit<ExtractObservedTopologyEdgesOptions, "topology"> {
    topology: EnterpriseTopology;
    observedEdges?: ObservedTopologyEdge[];
    persist?: boolean;
    overloadedNodeThreshold?: number;
    orgWorkloadBottleneckThreshold?: number;
    now?: number;
}
export declare function analyzeTopologyGaps(options: AnalyzeTopologyGapsOptions): TopologyGapAnalysisResult;
export declare function listDeclaredTopologyEdges(topology: EnterpriseTopology): DeclaredTopologyEdge[];
//# sourceMappingURL=gap-analysis.d.ts.map