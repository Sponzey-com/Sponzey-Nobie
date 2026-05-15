import type { EnterpriseTopology } from "../contracts/enterprise-topology.js";
import type { EnterpriseTopologyRegistryStore, TopologyExportEnvelope } from "./registry.js";
export declare const EXECUTOR_TOPOLOGY_V2_SCHEMA_VERSION: 2;
export declare const NOBIE_ROOT_AGENT_ID: "agent:nobie";
export type ExecutorTopologyV2SchemaVersion = typeof EXECUTOR_TOPOLOGY_V2_SCHEMA_VERSION;
export type ExecutorTopologyV2Status = "draft" | "active" | "archived";
export type ExecutorNodeV2Status = "active" | "archived";
export type ExecutorEdgeV2Status = "active" | "archived";
export type ExecutorTopologyV2Timestamp = number | string;
export type ExecutorTopologyV2MetadataValue = string | number | boolean | null | ExecutorTopologyV2MetadataValue[] | {
    [key: string]: ExecutorTopologyV2MetadataValue | undefined;
};
export type ExecutorTopologyV2Metadata = {
    [key: string]: ExecutorTopologyV2MetadataValue | undefined;
};
export interface ExecutorNodeV2 {
    id: string;
    name: string;
    roleName?: string;
    description: string;
    definitionQuickChips?: string[];
    instruction?: string;
    position: {
        x: number;
        y: number;
    };
    status: ExecutorNodeV2Status;
    profile?: ExecutorTopologyV2Metadata;
    metadata?: ExecutorTopologyV2Metadata;
}
export interface ExecutorEdgeV2 {
    id: string;
    sourceNodeId: string;
    targetNodeId: string;
    type: "delegates_to";
    label?: string;
    status: ExecutorEdgeV2Status;
}
export interface ExecutorTopologyV2 {
    schemaVersion: ExecutorTopologyV2SchemaVersion;
    id: string;
    name: string;
    status: ExecutorTopologyV2Status;
    activeVersion?: number;
    nodes: ExecutorNodeV2[];
    edges: ExecutorEdgeV2[];
    metadata?: ExecutorTopologyV2Metadata;
    createdAt: ExecutorTopologyV2Timestamp;
    updatedAt: ExecutorTopologyV2Timestamp;
}
export interface ExecutorRuntimeGraphSnapshotV2 {
    topologyId: string;
    schemaVersion: ExecutorTopologyV2SchemaVersion;
    rootAgentId: typeof NOBIE_ROOT_AGENT_ID;
    nodes: ExecutorNodeV2[];
    edges: ExecutorEdgeV2[];
    rootDirectChildIds: string[];
    directChildrenByNodeId: Record<string, string[]>;
}
export type ExecutorTopologyV2SourceField = "node.id" | "node.name" | "node.roleName" | "node.description" | "node.definitionQuickChips" | "node.instruction" | "node.position" | "node.status" | "edge.id" | "edge.sourceNodeId" | "edge.targetNodeId" | "edge.type" | "edge.label" | "edge.status";
export type ExecutorTopologyV2ProjectionField = "node.profile" | "node.metadata" | "topology.metadata";
export declare const EXECUTOR_TOPOLOGY_V2_SOURCE_FIELDS: readonly ExecutorTopologyV2SourceField[];
export declare const EXECUTOR_TOPOLOGY_V2_PROJECTION_FIELDS: readonly ExecutorTopologyV2ProjectionField[];
export type ExecutorTopologyV2MigrationIssueSeverity = "info" | "warning" | "invalid";
export interface ExecutorTopologyV2MigrationIssue {
    code: string;
    severity: ExecutorTopologyV2MigrationIssueSeverity;
    message: string;
    topologyId: string;
    nodeId?: string;
    edgeId?: string;
    relationId?: string;
}
export interface ExecutorTopologyV2MigrationResult {
    topology: ExecutorTopologyV2;
    issues: ExecutorTopologyV2MigrationIssue[];
}
export interface ExecutorTopologyV2PersistenceRepairResult {
    topology: ExecutorTopologyV2;
    issues: ExecutorTopologyV2MigrationIssue[];
}
export interface ExecutorTopologyV2RegistryReadModelResult {
    ok: boolean;
    topology?: ExecutorTopologyV2;
    envelope?: TopologyExportEnvelope;
    issues: ExecutorTopologyV2MigrationIssue[];
    reasonCode?: "topology_not_found" | "active_topology_not_found" | "multiple_active_topologies_without_selection_policy" | "topology_export_failed";
}
export interface ExecutorTopologyV2RegistryMigrationPreview {
    ok: boolean;
    dryRun: true;
    reasonCode?: ExecutorTopologyV2RegistryReadModelResult["reasonCode"] | "v2_validation_failed";
    topologyId?: string;
    sourceVersion?: number;
    sourceVersionId?: string;
    sourceImportSource?: string;
    runtimeReadModel?: ExecutorTopologyV2;
    materializedTopology?: EnterpriseTopology;
    issues: ExecutorTopologyV2MigrationIssue[];
    validation: ExecutorTopologyV2ValidationResult;
    staleIssueCount: number;
    invalidIssueCount: number;
    historyPreserved: boolean;
    report?: ExecutorTopologyV2MigrationDryRunReport;
}
export type ExecutorTopologyV2MigrationDryRunChangeKind = "removed" | "transformed" | "preserved";
export type ExecutorTopologyV2MigrationDryRunFieldCategory = "topology_field" | "node_field" | "relation_field" | "metadata" | "history" | "runtime_trace" | "validation";
export interface ExecutorTopologyV2MigrationDryRunChange {
    kind: ExecutorTopologyV2MigrationDryRunChangeKind;
    category: ExecutorTopologyV2MigrationDryRunFieldCategory;
    path: string;
    sourceField?: string;
    targetPath?: string;
    targetField?: string;
    sourceValueSummary?: string;
    targetValueSummary?: string;
    reason: string;
    destructive: boolean;
    approvalRequiredForPhysicalDelete: boolean;
}
export interface ExecutorTopologyV2MigrationDryRunReport {
    reportVersion: 1;
    dryRun: true;
    writePlanned: false;
    destructiveChangesPlanned: false;
    backupRequired: true;
    rollbackSupported: true;
    approvalRequiredForDestructiveChanges: true;
    topologyId?: string;
    sourceVersion?: number;
    sourceVersionId?: string;
    removedFields: ExecutorTopologyV2MigrationDryRunChange[];
    transformedFields: ExecutorTopologyV2MigrationDryRunChange[];
    preservedFields: ExecutorTopologyV2MigrationDryRunChange[];
    warnings: string[];
    rollbackProcedure: string[];
    summary: {
        sourceNodeCount: number;
        sourceDelegateEdgeCount: number;
        runtimeNodeCount: number;
        runtimeEdgeCount: number;
        removedFieldCount: number;
        transformedFieldCount: number;
        preservedFieldCount: number;
        staleIssueCount: number;
        invalidIssueCount: number;
    };
}
export interface ExecutorTopologyV2RegistryMaterializationResult {
    ok: boolean;
    preview: ExecutorTopologyV2RegistryMigrationPreview;
    appendResult?: ReturnType<EnterpriseTopologyRegistryStore["appendTopologyVersion"]>;
    activationResult?: ReturnType<EnterpriseTopologyRegistryStore["activateTopologyVersion"]>;
}
export type ExecutorTopologyV2ValidationSeverity = "error" | "warning";
export interface ExecutorTopologyV2ValidationIssue {
    code: string;
    severity: ExecutorTopologyV2ValidationSeverity;
    path: string;
    message: string;
    nodeId?: string;
    edgeId?: string;
}
export interface ExecutorTopologyV2ValidationResult {
    ok: boolean;
    issues: ExecutorTopologyV2ValidationIssue[];
}
export declare function migrateEnterpriseTopologyToExecutorTopologyV2(topology: EnterpriseTopology): ExecutorTopologyV2MigrationResult;
export declare function repairExecutorTopologyV2ForPersistence(topology: ExecutorTopologyV2): ExecutorTopologyV2PersistenceRepairResult;
export declare function buildExecutorTopologyV2RuntimeReadModelFromEnterpriseTopology(topology: EnterpriseTopology): ExecutorTopologyV2MigrationResult;
export declare function enterpriseTopologyFromExecutorTopologyV2(topology: ExecutorTopologyV2, options?: {
    migrationSource?: string;
    sourceTopologyVersion?: number;
    sourceVersionId?: string;
    materializedAt?: ExecutorTopologyV2Timestamp;
}): EnterpriseTopology;
export declare function loadExecutorTopologyV2ReadModelFromRegistry(input: {
    registry: EnterpriseTopologyRegistryStore;
    topologyId?: string;
    version?: number;
}): ExecutorTopologyV2RegistryReadModelResult;
export declare function buildExecutorTopologyV2MigrationDryRunReport(input: {
    sourceTopology?: EnterpriseTopology;
    runtimeReadModel?: ExecutorTopologyV2;
    materializedTopology?: EnterpriseTopology;
    topologyId?: string;
    sourceVersion?: number;
    sourceVersionId?: string;
    issues?: ExecutorTopologyV2MigrationIssue[];
    validation?: ExecutorTopologyV2ValidationResult;
}): ExecutorTopologyV2MigrationDryRunReport;
export declare function previewExecutorTopologyV2RegistryMigration(input: {
    registry: EnterpriseTopologyRegistryStore;
    topologyId?: string;
    version?: number;
    migrationSource?: string;
    materializedAt?: ExecutorTopologyV2Timestamp;
}): ExecutorTopologyV2RegistryMigrationPreview;
export declare function materializeExecutorTopologyV2ReadModelInRegistry(input: {
    registry: EnterpriseTopologyRegistryStore;
    topologyId?: string;
    version?: number;
    createdBy?: string;
    importSource?: string;
    migrationSource?: string;
    materializedAt?: ExecutorTopologyV2Timestamp;
}): ExecutorTopologyV2RegistryMaterializationResult;
export declare function validateExecutorTopologyV2(input: unknown): ExecutorTopologyV2ValidationResult;
export declare function isExecutorTopologyV2(input: unknown): input is ExecutorTopologyV2;
export declare function buildExecutorRuntimeGraphSnapshotV2(topology: ExecutorTopologyV2): ExecutorRuntimeGraphSnapshotV2;
//# sourceMappingURL=executor-topology-v2.d.ts.map