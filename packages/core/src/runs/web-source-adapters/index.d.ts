import type { RetrievalTargetKind } from "../web-retrieval-session.js";
import { type WebSourceAdapterFixtureVersionCheck, type WebSourceAdapterMetadata } from "./types.js";
export * from "./types.js";
export * from "./finance.js";
export * from "./weather.js";
export * from "../web-location-contract.js";
export interface WebSourceAdapterRegistrySnapshot {
    adapters: WebSourceAdapterMetadata[];
    activeCount: number;
    degradedCount: number;
    degradedReasons: Record<string, string>;
}
export interface WebSourceAdapterFailureSample {
    adapterId: string;
    failureKind: "parser_failed" | "parser_version_mismatch" | "source_unreachable" | "unknown";
    occurredAt?: string | number | Date;
    reason?: string | null;
}
export interface WebSourceAdapterDegradationPolicy {
    parserFailureThreshold: number;
    parserVersionMismatchThreshold: number;
}
export declare const DEFAULT_ADAPTER_DEGRADATION_POLICY: WebSourceAdapterDegradationPolicy;
export interface WebSourceAdapterDegradationState {
    degradedAdapterIds: string[];
    degradedReasons: Record<string, string>;
    countsByAdapter: Record<string, {
        parserFailed: number;
        parserVersionMismatch: number;
        sourceUnreachable: number;
        unknown: number;
    }>;
}
export declare function listWebSourceAdapters(input?: {
    degradedAdapterIds?: string[];
    degradedReasons?: Record<string, string>;
}): WebSourceAdapterMetadata[];
export declare function buildWebSourceAdapterRegistrySnapshot(input?: {
    degradedAdapterIds?: string[];
    degradedReasons?: Record<string, string>;
}): WebSourceAdapterRegistrySnapshot;
export declare function buildWebSourceAdapterDegradationState(input: {
    failureSamples: WebSourceAdapterFailureSample[];
    policy?: Partial<WebSourceAdapterDegradationPolicy>;
}): WebSourceAdapterDegradationState;
export declare function rankWebSourceAdaptersForTarget(targetKind: RetrievalTargetKind, input?: {
    degradedAdapterIds?: string[];
}): WebSourceAdapterMetadata[];
export declare function checkAdapterFixtureParserVersions(input: Array<{
    metadata: WebSourceAdapterMetadata;
    expectedParserVersion: string;
}>): WebSourceAdapterFixtureVersionCheck[];
//# sourceMappingURL=index.d.ts.map