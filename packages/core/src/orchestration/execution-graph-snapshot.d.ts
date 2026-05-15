import { type NobieConfig } from "../config/index.js";
import { type LegacyTopologyRegistryStore } from "../topology/legacy-enterprise-topology-adapter.js";
import { type ExecutorProfile, type OrchestrationRegistrySnapshot, type RegistryServiceDependencies } from "./registry.js";
export declare const EXECUTION_GRAPH_ROOT_AGENT_ID: "agent:nobie";
export declare const WORKSPACE_DRAFT_TOPOLOGY_ID: "workspace:draft";
export type ExecutionGraphBuildMode = "workspace" | "active_deployment" | "db_config";
export type ExecutionGraphSource = "workspace_draft" | "active_topology" | "db_config";
export type ExecutionGraphIssueSeverity = "info" | "warning" | "invalid";
export type ExecutionGraphEdgeSource = "topology_relation" | "agent_relationship" | "unparented_root";
export interface ExecutionGraphValidationIssue {
    code: string;
    severity: ExecutionGraphIssueSeverity;
    message: string;
    topologyId?: string;
    topologyVersion?: number;
    relationId?: string;
    edgeId?: string;
    agentId?: string;
    parentAgentId?: string;
    childAgentId?: string;
}
export interface ExecutorRuntimeProjection {
    agentId: string;
    displayName: string;
    source: "topology" | "db" | "config";
    status: string;
    delegationEnabled: boolean;
    executionCandidate: boolean;
    role: string;
    specialtyTags: string[];
    topologyId?: string;
    topologyVersion?: number;
    executorId?: string;
    executorProfile?: ExecutorProfile;
    reasonCodes: string[];
}
export interface ExecutionGraphEdgeProjection {
    edgeId: string;
    parentAgentId: string;
    childAgentId: string;
    source: ExecutionGraphEdgeSource;
    executionCandidate: boolean;
    reasonCodes: string[];
    relationId?: string;
    relationshipStatus?: string;
    topologyId?: string;
    topologyVersion?: number;
}
export interface ExecutionGraphTraceFields {
    execution_graph_id: string;
    graph_source: ExecutionGraphSource;
    current_executor_id: string;
    available_executor_ids: string[];
}
export interface ExecutionGraphSnapshot {
    graphId: string;
    graphSource: ExecutionGraphSource;
    generatedAt: number;
    rootAgentId: string;
    currentExecutorId: string;
    topologyId?: string;
    topologyVersion?: number;
    agentsById: Record<string, ExecutorRuntimeProjection>;
    directChildAgentIdsByParent: Record<string, string[]>;
    edgeIndex: Record<string, Record<string, ExecutionGraphEdgeProjection>>;
    edges: ExecutionGraphEdgeProjection[];
    rootDirectChildAgentIds: string[];
    allRegisteredExecutorIds: string[];
    allActiveExecutorIds: string[];
    availableExecutorIds: string[];
    validationIssues: ExecutionGraphValidationIssue[];
    trace: ExecutionGraphTraceFields;
}
export interface BuildExecutionGraphSnapshotInput {
    mode?: ExecutionGraphBuildMode;
    currentExecutorId?: string;
    rootAgentId?: string;
    now?: () => number;
    topologyRegistry?: LegacyTopologyRegistryStore;
    registrySnapshot?: OrchestrationRegistrySnapshot;
    loadRegistrySnapshot?: () => OrchestrationRegistrySnapshot;
    registryDependencies?: RegistryServiceDependencies;
    getConfig?: () => Pick<NobieConfig, "orchestration"> & Partial<Pick<NobieConfig, "ai">>;
}
export declare function buildExecutionGraphSnapshot(input?: BuildExecutionGraphSnapshotInput): ExecutionGraphSnapshot;
//# sourceMappingURL=execution-graph-snapshot.d.ts.map