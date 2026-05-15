import type { EnterpriseRelation, EnterpriseTopology, NodeContract } from "../contracts/enterprise-topology.js";
import { type CreateEnterpriseTopologyRegistryOptions, type EnterpriseTopologyRegistryRecord, type EnterpriseTopologyRegistryStore, type TopologyExportEnvelope } from "./registry.js";
export type LegacyEnterpriseRelation = EnterpriseRelation;
export type LegacyEnterpriseTopology = EnterpriseTopology;
export type LegacyNodeContract = NodeContract;
export type LegacyEnterpriseTopologyRegistryRecord = EnterpriseTopologyRegistryRecord;
export type LegacyEnterpriseTopologyRegistryStore = EnterpriseTopologyRegistryStore;
export type LegacyTopologyExportEnvelope = TopologyExportEnvelope;
export type LegacyRelation = LegacyEnterpriseRelation;
export type LegacyTopology = LegacyEnterpriseTopology;
export type LegacyNode = LegacyNodeContract;
export type LegacyTopologyRegistryRecord = LegacyEnterpriseTopologyRegistryRecord;
export type LegacyTopologyRegistryStore = LegacyEnterpriseTopologyRegistryStore;
export type LegacyTopologyEnvelope = LegacyTopologyExportEnvelope;
export type LegacyTopologyAdapterIssueSeverity = "info" | "warning" | "invalid";
export interface LegacyTopologyAdapterIssue {
    code: string;
    severity: LegacyTopologyAdapterIssueSeverity;
    message: string;
    topologyId?: string;
    topologyVersion?: number;
    relationId?: string;
    edgeId?: string;
    agentId?: string;
    parentAgentId?: string;
    childAgentId?: string;
}
export interface LegacyTopologyAdapterResult {
    envelope: LegacyTopologyExportEnvelope;
    issues: LegacyTopologyAdapterIssue[];
}
export declare function createLegacyEnterpriseTopologyRegistry(options?: CreateEnterpriseTopologyRegistryOptions): LegacyEnterpriseTopologyRegistryStore;
export declare function createLegacyTopologyRegistry(options?: CreateEnterpriseTopologyRegistryOptions): LegacyTopologyRegistryStore;
export declare function collectLegacyTopologyCompatibilityIssues(envelope: LegacyTopologyExportEnvelope): LegacyTopologyAdapterIssue[];
export declare function legacyTopologyEnvelopeToExecutorCompatibilityEnvelope(envelope: LegacyTopologyExportEnvelope): LegacyTopologyAdapterResult;
//# sourceMappingURL=legacy-enterprise-topology-adapter.d.ts.map