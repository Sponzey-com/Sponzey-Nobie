import { type EnterpriseTopology, type EnterpriseTopologyValidationIssue } from "../contracts/enterprise-topology.js";
export type TopologyImportExportFormat = "json" | "yaml";
export type TopologyDocumentParseResult = {
    ok: true;
    topology: EnterpriseTopology;
    format: TopologyImportExportFormat;
} | {
    ok: false;
    issues: EnterpriseTopologyValidationIssue[];
    format?: TopologyImportExportFormat;
};
export declare function normalizeTopologyDocumentFormat(value: unknown): TopologyImportExportFormat;
export declare function inferTopologyDocumentFormat(sourceRef: string | undefined): TopologyImportExportFormat;
export declare function parseTopologyImportDocument(input: {
    content?: unknown;
    topology?: unknown;
    format?: unknown;
    sourceRef?: unknown;
}): TopologyDocumentParseResult;
export declare function stringifyTopologyDocument(value: unknown, format: TopologyImportExportFormat): string;
//# sourceMappingURL=import-export.d.ts.map