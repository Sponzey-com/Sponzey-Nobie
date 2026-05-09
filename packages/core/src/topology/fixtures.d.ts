import { type EnterpriseTopology, type EnterpriseTopologyValidationCode, type EnterpriseTopologyValidationIssue } from "../contracts/enterprise-topology.js";
import { type TopologyDocumentEnvelope } from "./draft-store.js";
export type TopologyFixtureFormat = "json" | "json5" | "yaml";
export type TopologyFixtureIssueCode = EnterpriseTopologyValidationCode | "topology_fixture_parse_failed" | "unsupported_topology_fixture_format" | "topology_fixture_file_not_found";
export interface TopologyFixtureIssue extends Omit<EnterpriseTopologyValidationIssue, "code" | "reasonCode"> {
    code: TopologyFixtureIssueCode;
    reasonCode: TopologyFixtureIssueCode;
}
export type TopologyFixtureParseResult = {
    ok: true;
    topology: EnterpriseTopology;
    issues: [];
    format: TopologyFixtureFormat;
} | {
    ok: false;
    issues: TopologyFixtureIssue[];
    format?: TopologyFixtureFormat;
};
export interface TopologyFixtureRecord {
    fixtureId: string;
    sourceRef: string;
    envelope: TopologyDocumentEnvelope;
}
export interface TopologyFixtureStore {
    list(): TopologyFixtureRecord[];
    get(fixtureId: string): TopologyFixtureRecord | undefined;
    require(fixtureId: string): TopologyFixtureRecord;
}
export type TopologyFixtureDirectoryLoadResult = {
    ok: true;
    store: TopologyFixtureStore;
    issues: [];
} | {
    ok: false;
    issues: TopologyFixtureIssue[];
};
export declare function inferTopologyFixtureFormat(sourceRef: string): TopologyFixtureFormat | undefined;
export declare function parseTopologyDocumentText(text: string, options?: {
    sourceRef?: string;
    format?: TopologyFixtureFormat;
}): TopologyFixtureParseResult;
export declare function loadTopologyFixtureFile(filePath: string): TopologyFixtureParseResult;
export declare function createTopologyFixtureStore(records: TopologyFixtureRecord[]): TopologyFixtureStore;
export declare function loadTopologyFixtureDirectory(directoryPath: string): TopologyFixtureDirectoryLoadResult;
//# sourceMappingURL=fixtures.d.ts.map