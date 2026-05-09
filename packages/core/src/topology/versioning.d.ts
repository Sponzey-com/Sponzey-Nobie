import type { EnterpriseTopology } from "../contracts/enterprise-topology.js";
import type { CompiledTopologySnapshot } from "./compiler.js";
export type TopologyRegistryHistoryEventType = "imported" | "version_appended" | "activated" | "archived" | "rolled_back" | "activation_blocked" | "rollback_blocked";
export declare function computeTopologyRegistrySourceHash(topology: EnterpriseTopology): string;
export declare function buildTopologyVersionId(topologyId: string, version: number): string;
export declare function buildTopologyValidationSnapshotId(topologyId: string, version: number, sourceHash: string): string;
export declare function buildTopologyHistoryId(eventType: TopologyRegistryHistoryEventType, topologyId: string, version: number | null): string;
export declare function compiledSnapshotMatchesTopologyVersion(input: {
    compiledSnapshot: CompiledTopologySnapshot;
    topologyId: string;
    version: number;
    sourceHash: string;
}): boolean;
export declare function describeCompiledSnapshotMismatch(input: {
    compiledSnapshot: CompiledTopologySnapshot;
    topologyId: string;
    version: number;
    sourceHash: string;
}): string[];
//# sourceMappingURL=versioning.d.ts.map