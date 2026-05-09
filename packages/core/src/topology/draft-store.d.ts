import { ENTERPRISE_TOPOLOGY_SCHEMA_VERSION, type EnterpriseTimestamp, type EnterpriseTopology, type EnterpriseTopologyValidationIssue } from "../contracts/enterprise-topology.js";
export type TopologyDraftSource = "memory" | "fixture" | "import";
export interface TopologyDocumentEnvelope {
    schemaVersion: typeof ENTERPRISE_TOPOLOGY_SCHEMA_VERSION;
    envelopeId: string;
    draftId: string;
    topologyId: string;
    name: string;
    lifecycle: "draft";
    source: TopologyDraftSource;
    sourceRef?: string;
    document: EnterpriseTopology;
    validation: {
        valid: true;
        issueCount: 0;
    };
    createdAt: EnterpriseTimestamp;
    updatedAt: EnterpriseTimestamp;
}
export interface SaveTopologyDraftInput {
    document: EnterpriseTopology;
    draftId?: string;
    envelopeId?: string;
    source?: TopologyDraftSource;
    sourceRef?: string;
    now?: EnterpriseTimestamp;
}
export type TopologyDraftStoreResult = {
    ok: true;
    envelope: TopologyDocumentEnvelope;
    issues: [];
} | {
    ok: false;
    issues: EnterpriseTopologyValidationIssue[];
};
export interface TopologyDraftStore {
    saveDraft(input: SaveTopologyDraftInput): TopologyDraftStoreResult;
    getDraft(draftId: string): TopologyDocumentEnvelope | undefined;
    listDrafts(): TopologyDocumentEnvelope[];
    deleteDraft(draftId: string): boolean;
    clear(): void;
}
export declare function createTopologyDocumentEnvelope(input: SaveTopologyDraftInput): TopologyDraftStoreResult;
export declare function createInMemoryTopologyDraftStore(initialDrafts?: TopologyDocumentEnvelope[]): TopologyDraftStore;
//# sourceMappingURL=draft-store.d.ts.map