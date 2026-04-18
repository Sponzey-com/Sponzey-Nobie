import type { SourceEvidence, SourceKind, SourceReliability } from "../web-retrieval-policy.js";
import { type RetrievalTargetContract } from "../web-retrieval-session.js";
import { type CandidateExtractionHints, type RetrievalExtractionInputKind, type RetrievedValueCandidate } from "../web-retrieval-verification.js";
import { type WebSourceAdapterMetadata } from "./types.js";
export type FinanceIndexKey = "kospi" | "kosdaq" | "nasdaq_composite" | "nasdaq_100";
export interface FinanceIndexDefinition {
    key: FinanceIndexKey;
    canonicalName: string;
    symbols: string[];
    market: string;
    aliases: string[];
    disambiguationPolicy: string;
}
export interface FinanceTargetResolution {
    key: FinanceIndexKey;
    definition: FinanceIndexDefinition;
    targetContract: RetrievalTargetContract;
    caveats: string[];
}
export interface FinanceKnownSource {
    method: "direct_fetch" | "browser_search" | "known_source_adapter";
    url: string;
    sourceDomain: string;
    sourceKind: SourceKind;
    reliability: SourceReliability;
    sourceLabel: string;
    expectedTargetBinding: string;
}
export interface FinanceQuoteParseInput {
    targetKey: FinanceIndexKey;
    content: string;
    sourceUrl?: string | null;
    sourceTimestamp?: string | null;
    fetchTimestamp?: string;
    inputKind?: RetrievalExtractionInputKind;
    hints?: CandidateExtractionHints;
}
export interface FinanceQuoteParseResult {
    adapterId: string;
    adapterVersion: string;
    parserVersion: string;
    targetDefinition: FinanceIndexDefinition;
    targetContract: RetrievalTargetContract;
    sourceEvidenceId: string;
    sourceEvidence: SourceEvidence;
    candidates: RetrievedValueCandidate[];
}
export declare const FINANCE_ADAPTER_ID = "finance-index-known-source";
export declare const FINANCE_ADAPTER_VERSION = "2026.04.17";
export declare const FINANCE_PARSER_VERSION = "finance-parser-1";
export declare const FINANCE_INDEX_DEFINITIONS: Record<FinanceIndexKey, FinanceIndexDefinition>;
export declare const FINANCE_ADAPTER_METADATA: WebSourceAdapterMetadata;
export declare function createFinanceIndexTargetContract(key: FinanceIndexKey, rawQuery?: string | null): RetrievalTargetContract;
export declare function resolveFinanceIndexTarget(query: string): FinanceTargetResolution | null;
export declare function buildFinanceKnownSources(key: FinanceIndexKey): FinanceKnownSource[];
export declare function buildFinanceSourceEvidence(input: {
    targetKey: FinanceIndexKey;
    url?: string | null;
    sourceTimestamp?: string | null;
    fetchTimestamp?: string;
}): SourceEvidence;
export declare function parseFinanceQuoteCandidates(input: FinanceQuoteParseInput): FinanceQuoteParseResult;
//# sourceMappingURL=finance.d.ts.map