import type { RetrievalTargetKind } from "../web-retrieval-session.js";
export type WebSourceAdapterStatus = "active" | "degraded";
export interface WebSourceAdapterMetadata {
    adapterId: string;
    adapterVersion: string;
    parserVersion: string;
    sourceDomains: string[];
    supportedTargetKinds: RetrievalTargetKind[];
    checksum: string;
    status: WebSourceAdapterStatus;
    degradedReason?: string | null;
}
export interface WebSourceAdapterFixtureVersionCheck {
    ok: boolean;
    adapterId: string;
    expectedParserVersion: string;
    actualParserVersion: string;
    message: string;
}
export declare function stableAdapterChecksum(input: Omit<WebSourceAdapterMetadata, "checksum" | "status" | "degradedReason">): string;
export declare function withAdapterChecksum(input: Omit<WebSourceAdapterMetadata, "checksum" | "status"> & {
    status?: WebSourceAdapterStatus;
}): WebSourceAdapterMetadata;
export declare function compareAdapterFixtureParserVersion(input: {
    metadata: WebSourceAdapterMetadata;
    expectedParserVersion: string;
}): WebSourceAdapterFixtureVersionCheck;
//# sourceMappingURL=types.d.ts.map