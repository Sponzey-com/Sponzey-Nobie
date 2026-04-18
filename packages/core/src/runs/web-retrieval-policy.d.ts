export declare const WEB_RETRIEVAL_POLICY_VERSION = "2026.04.18-task009";
export type WebRetrievalMethod = "official_api" | "direct_fetch" | "fast_text_search" | "browser_search";
export type SourceKind = "official" | "first_party" | "search_index" | "third_party" | "browser_evidence" | "unknown";
export type SourceReliability = "high" | "medium" | "low" | "unknown";
export type SourceFreshnessPolicy = "normal" | "latest_approximate" | "strict_timestamp";
export type SourceCompletionStatus = "ready" | "approximate_latest" | "limited_success" | "insufficient_source";
export interface WebRetrievalPolicyInput {
    toolName: string;
    params: Record<string, unknown>;
    userMessage?: string;
    now?: Date;
    locale?: string;
}
export interface WebRetrievalPolicyDecision {
    applies: boolean;
    method: WebRetrievalMethod;
    dedupeKey: string;
    canonicalParams: Record<string, unknown>;
    freshnessPolicy: SourceFreshnessPolicy;
    sourceKind: SourceKind;
    reliability: SourceReliability;
    fetchTimestamp: string;
    answerDirective: string;
}
export interface SourceEvidence {
    method: WebRetrievalMethod;
    sourceKind: SourceKind;
    reliability: SourceReliability;
    sourceUrl?: string | null;
    sourceDomain?: string | null;
    sourceLabel?: string | null;
    sourceTimestamp?: string | null;
    fetchTimestamp: string;
    freshnessPolicy?: SourceFreshnessPolicy;
    adapterId?: string | null;
    adapterVersion?: string | null;
    parserVersion?: string | null;
    adapterStatus?: "active" | "degraded" | null;
}
export interface SourceReliabilityGuardResult {
    status: SourceCompletionStatus;
    userMessage: string;
    mustAvoidGuessing: boolean;
    evidence: SourceEvidence;
}
export interface BrowserSearchEvidenceInput {
    query: string;
    url?: string | null;
    extractedText?: string | null;
    screenshotBase64?: string | null;
    timeoutReason?: string | null;
    error?: unknown;
    runId?: string | null;
    requestGroupId?: string | null;
    method?: WebRetrievalMethod;
    createdAt?: number;
}
export interface BrowserSearchEvidenceArtifact {
    artifactPath: string;
    artifactId: string | null;
    diagnosticEventId: string | null;
    userMessage: string;
}
export declare function buildWebRetrievalPolicyDecision(input: WebRetrievalPolicyInput): WebRetrievalPolicyDecision | null;
export declare function buildAnswerDirective(freshnessPolicy: SourceFreshnessPolicy, sourceKind: SourceKind, sourceDomain: string | null, fetchTimestamp: string): string;
export declare function evaluateSourceReliabilityGuard(input: SourceEvidence): SourceReliabilityGuardResult;
export declare function extractSourceTimestampFromHtml(html: string): string | null;
export declare function recordBrowserSearchEvidence(input: BrowserSearchEvidenceInput): BrowserSearchEvidenceArtifact;
//# sourceMappingURL=web-retrieval-policy.d.ts.map