import type { EnterpriseRelationType, EnterpriseTimestamp, EnterpriseTopology, NodeType } from "../contracts/enterprise-topology.js";
import { type EnterpriseTopologyGuiOperation } from "./gui-operations.js";
import { type ExecutorProfile } from "./executor-profile.js";
export declare const EXECUTOR_GRAPH_SCHEMA_VERSION: 1;
export declare const EXECUTOR_GRAPH_METADATA_KEY: "executorGraph";
export type ExecutorGraphSchemaVersion = typeof EXECUTOR_GRAPH_SCHEMA_VERSION;
export type ExecutorGraphMode = "simple" | "advanced";
export type ExecutorRuntimeMode = "auto" | "human_check" | "approval" | "tool_execution" | "external" | "unknown";
export type ExecutorConnectionRelation = "handoff" | "approval_request" | "report" | "collaboration" | "exception" | "reference";
export interface ExecutorGraphSourceOfTruth {
    editableProjection: "executor_graph";
    runtimeSourceOfTruth: "executor_topology_v2";
    nodeContractBoundary: "compatibility_projection";
    workOrderBoundary: "runtime_adapter";
    agentConfigRole: "compatibility_import";
    projectionOnly: true;
}
export interface ExecutorAdvancedMapping {
    nodeType: NodeType;
    executorKind: "nobie" | "agent" | "team" | "tool" | "manual_approval" | "external";
    executorId?: string;
    allowedToolIds?: string[];
    allowedSystemIds?: string[];
}
export interface ExecutorInferenceEvidence {
    schemaVersion: 1;
    evidenceId: string;
    executorId: string;
    sourceNodeId?: string;
    userDescription: {
        name: string;
        description: string;
    };
    normalizedUnderstanding: {
        runtimeMode: ExecutorRuntimeMode;
        capabilities: string[];
        tools: string[];
        outputs: string[];
        successCriteria: string[];
    };
    confidence: number;
    inferenceRuleIds: string[];
    understandingState: "draft" | "confirmed";
    understandingVersionBeforeConfirmation: string;
    confirmedUnderstandingVersion?: string;
    generatedAt?: EnterpriseTimestamp;
}
export interface ExecutorDraft {
    id: string;
    name: string;
    description: string;
    definitionQuickChips?: string[];
    position?: {
        x: number;
        y: number;
    };
    inferredRuntimeMode: ExecutorRuntimeMode;
    inferredCapabilities: string[];
    inferredTools: string[];
    inferredOutputs: string[];
    inferredSuccessCriteria: string[];
    executorProfile?: ExecutorProfile;
    confidence: number;
    userConfirmed?: boolean;
    confirmedUnderstandingVersion?: string;
    sourceNodeId?: string;
    advancedMapping?: ExecutorAdvancedMapping;
    inferenceEvidence?: ExecutorInferenceEvidence;
}
export interface ExecutorConnectionDraft {
    id: string;
    fromExecutorId: string;
    toExecutorId: string;
    inferredRelation: ExecutorConnectionRelation;
    label: "넘김" | "승인 요청" | "보고" | "협업" | "예외 처리" | "참고 요청";
    confidence: number;
    userConfirmed: boolean;
    sourceRelationId?: string;
    advancedRelationType?: EnterpriseRelationType;
}
export interface ExecutorSectionDraft {
    id: string;
    name: string;
    description: string;
    executorIds: string[];
    sourceTeamId?: string;
    collapsed?: boolean;
}
export interface ExecutorGraphInferenceSummary {
    source: "enterprise_topology_projection" | "executor_graph_compile";
    confidence: number;
    executorCount: number;
    connectionCount: number;
    issueCount: number;
    generatedAt?: EnterpriseTimestamp;
}
export interface ExecutorGraphIssue {
    severity: "error" | "warning";
    code: "duplicate_executor_id" | "blank_executor_name" | "missing_connection_endpoint" | "self_loop_connection" | "duplicate_connection_id";
    message: string;
    targetId?: string;
}
export interface ExecutorGraphWorkspace {
    schemaVersion: ExecutorGraphSchemaVersion;
    graphId: string;
    topologyId: string;
    name: string;
    mode: ExecutorGraphMode;
    executors: ExecutorDraft[];
    sections: ExecutorSectionDraft[];
    connections: ExecutorConnectionDraft[];
    selectedId: string | null;
    inference: ExecutorGraphInferenceSummary;
    compiledPreview: EnterpriseTopology | null;
    latestRun: unknown | null;
    issues: ExecutorGraphIssue[];
    sourceOfTruth: ExecutorGraphSourceOfTruth;
}
export interface ExecutorGraphTopologyMetadata {
    schemaVersion: ExecutorGraphSchemaVersion;
    graphId: string;
    topologyId: string;
    mode: ExecutorGraphMode;
    source: "executor_graph";
    sourceOfTruth: "executor_topology_v2";
    projectionOnly: true;
    executorIds: string[];
    connectionIds: string[];
    sectionIds: string[];
    confirmedExecutorIds: string[];
    confidence: number;
    updatedAt: EnterpriseTimestamp;
    workspace: {
        executors: Array<Pick<ExecutorDraft, "id" | "name" | "description" | "definitionQuickChips" | "position" | "inferredRuntimeMode" | "inferredCapabilities" | "inferredTools" | "inferredOutputs" | "inferredSuccessCriteria" | "executorProfile" | "confidence" | "userConfirmed" | "confirmedUnderstandingVersion" | "sourceNodeId" | "inferenceEvidence">>;
        connections: Array<Pick<ExecutorConnectionDraft, "id" | "fromExecutorId" | "toExecutorId" | "inferredRelation" | "label" | "confidence" | "userConfirmed" | "sourceRelationId" | "advancedRelationType">>;
        sections: ExecutorSectionDraft[];
    };
}
export interface ExecutorGraphRollbackEvidence {
    kind: "nobie.executor_graph.rollback_projection";
    status: "passed" | "failed";
    topologyId: string;
    expectedTopologyId?: string;
    expectedTopologyVersion?: number;
    expectedTopologyVersionId?: string;
    actualTopologyVersion?: number;
    actualTopologyVersionId?: string;
    metadataProjectionRestored: boolean;
    executorIdsMatch: boolean;
    connectionIdsMatch: boolean;
    confirmedUnderstandingRestored: boolean;
    sourceOfTruthPreserved: boolean;
    blockingFailures: string[];
}
export type ExecutorGraphCompileResult = {
    ok: true;
    topology: EnterpriseTopology;
    operations: EnterpriseTopologyGuiOperation[];
    metadata: ExecutorGraphTopologyMetadata;
    issues: [];
} | {
    ok: false;
    topology: EnterpriseTopology;
    operations: [];
    metadata: null;
    issues: ExecutorGraphIssue[];
};
export interface CompileExecutorGraphOptions {
    baseTopology?: EnterpriseTopology | null;
    now?: EnterpriseTimestamp;
}
export declare const EXECUTOR_GRAPH_SOURCE_OF_TRUTH: ExecutorGraphSourceOfTruth;
export declare function buildExecutorGraphFromEnterpriseTopology(topology: EnterpriseTopology, options?: {
    mode?: ExecutorGraphMode;
    now?: EnterpriseTimestamp;
}): ExecutorGraphWorkspace;
export declare function buildExecutorGraphGuiOperations(graph: ExecutorGraphWorkspace, baseTopology?: EnterpriseTopology | null, options?: {
    now?: EnterpriseTimestamp;
}): EnterpriseTopologyGuiOperation[];
export declare function buildExecutorGraphTopologyMetadata(graph: ExecutorGraphWorkspace, options?: {
    now?: EnterpriseTimestamp;
}): ExecutorGraphTopologyMetadata;
export declare function attachExecutorGraphMetadata(topology: EnterpriseTopology, graph: ExecutorGraphWorkspace, options?: {
    now?: EnterpriseTimestamp;
}): EnterpriseTopology;
export declare function readExecutorGraphMetadata(topology: EnterpriseTopology): ExecutorGraphTopologyMetadata | null;
export declare function compileExecutorGraphToEnterpriseTopology(graph: ExecutorGraphWorkspace, options?: CompileExecutorGraphOptions): ExecutorGraphCompileResult;
export declare function buildExecutorGraphRollbackEvidence(input: {
    restoredTopology: EnterpriseTopology;
    expectedTopologyId?: string;
    expectedTopologyVersion?: number;
    expectedTopologyVersionId?: string;
    actualTopologyVersion?: number;
    actualTopologyVersionId?: string;
}): ExecutorGraphRollbackEvidence;
//# sourceMappingURL=executor-graph.d.ts.map