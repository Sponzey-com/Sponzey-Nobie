import type Database from "better-sqlite3";
import type { EnterpriseMetadata, EnterpriseTimestamp, EnterpriseTopology } from "../contracts/enterprise-topology.js";
import { type CompiledTopologySnapshot } from "./compiler.js";
import { type TopologyValidationResult } from "./validator.js";
import { type TopologyRegistryHistoryEventType } from "./versioning.js";
export type EnterpriseTopologyRegistryStatus = "draft" | "active" | "inactive" | "archived";
export interface EnterpriseTopologyRegistryRecord {
    topologyId: string;
    name: string;
    status: EnterpriseTopologyRegistryStatus;
    activeVersion?: number;
    activeVersionId?: string;
    metadata?: EnterpriseMetadata;
    createdAt: EnterpriseTimestamp;
    updatedAt: EnterpriseTimestamp;
    archivedAt?: EnterpriseTimestamp;
}
export interface EnterpriseTopologyVersionRecord {
    versionId: string;
    topologyId: string;
    version: number;
    topology: EnterpriseTopology;
    sourceHash: string;
    validationSnapshotId: string;
    compiledSnapshotId?: string;
    createdBy?: string;
    importSource?: string;
    createdAt: EnterpriseTimestamp;
}
export interface TopologyValidationSnapshotRecord {
    snapshotId: string;
    topologyId: string;
    versionId: string;
    version: number;
    executable: boolean;
    validation: TopologyValidationResult;
    createdAt: EnterpriseTimestamp;
}
export interface CompiledTopologySnapshotRecord {
    snapshotId: string;
    topologyId: string;
    versionId: string;
    version: number;
    sourceTopologyVersion: string;
    sourceTopologyHash: string;
    compilerVersion: string;
    snapshot: CompiledTopologySnapshot;
    createdAt: EnterpriseTimestamp;
}
export interface EnterpriseTopologyHistoryRecord {
    historyId: string;
    topologyId: string;
    versionId?: string;
    eventType: TopologyRegistryHistoryEventType;
    fromVersion?: number;
    toVersion?: number;
    validationSnapshotId?: string;
    compiledSnapshotId?: string;
    summary: string;
    detail: EnterpriseMetadata;
    createdAt: EnterpriseTimestamp;
}
export interface AppendTopologyVersionInput {
    topology: EnterpriseTopology;
    createdBy?: string;
    importSource?: string;
}
export interface AppendTopologyVersionResult {
    topologyRecord: EnterpriseTopologyRegistryRecord;
    version: EnterpriseTopologyVersionRecord;
    validationSnapshot: TopologyValidationSnapshotRecord;
    compiledSnapshot?: CompiledTopologySnapshotRecord;
    history: EnterpriseTopologyHistoryRecord;
}
export interface TopologyActivationSuccess {
    ok: true;
    topologyRecord: EnterpriseTopologyRegistryRecord;
    version: EnterpriseTopologyVersionRecord;
    validationSnapshot: TopologyValidationSnapshotRecord;
    compiledSnapshot: CompiledTopologySnapshotRecord;
    history: EnterpriseTopologyHistoryRecord;
}
export interface TopologyActivationBlocked {
    ok: false;
    reasonCode: "topology_version_not_found" | "topology_validation_snapshot_missing" | "topology_validation_blocked" | "compiled_snapshot_missing" | "compiled_snapshot_source_mismatch";
    topologyId: string;
    version: number;
    issues: string[];
    history?: EnterpriseTopologyHistoryRecord;
}
export type TopologyActivationResult = TopologyActivationSuccess | TopologyActivationBlocked;
export interface TopologyExportEnvelope {
    topologyRecord: EnterpriseTopologyRegistryRecord;
    version: EnterpriseTopologyVersionRecord;
    validationSnapshot: TopologyValidationSnapshotRecord;
    compiledSnapshot?: CompiledTopologySnapshotRecord;
}
export interface EnterpriseTopologyRegistryStore {
    appendTopologyVersion(input: AppendTopologyVersionInput): AppendTopologyVersionResult;
    activateTopologyVersion(topologyId: string, version: number): TopologyActivationResult;
    rollbackTopologyVersion(topologyId: string, targetVersion: number): TopologyActivationResult;
    archiveTopology(topologyId: string): EnterpriseTopologyHistoryRecord | null;
    listTopologies(): EnterpriseTopologyRegistryRecord[];
    getTopology(topologyId: string): EnterpriseTopologyRegistryRecord | null;
    listVersions(topologyId: string): EnterpriseTopologyVersionRecord[];
    getVersion(topologyId: string, version: number): EnterpriseTopologyVersionRecord | null;
    exportTopology(topologyId: string, version?: number): TopologyExportEnvelope | null;
    listHistory(topologyId: string): EnterpriseTopologyHistoryRecord[];
}
export interface CreateEnterpriseTopologyRegistryOptions {
    db?: Database.Database;
    now?: () => number;
}
export declare function createEnterpriseTopologyRegistry(options?: CreateEnterpriseTopologyRegistryOptions): EnterpriseTopologyRegistryStore;
//# sourceMappingURL=registry.d.ts.map