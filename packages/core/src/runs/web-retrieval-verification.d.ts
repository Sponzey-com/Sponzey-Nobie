import type { SourceEvidence, SourceFreshnessPolicy, SourceKind } from "./web-retrieval-policy.js";
import type { RetrievalTargetContract } from "./web-retrieval-session.js";
export type RetrievalExtractionInputKind = "search_snippet" | "html_text" | "json" | "table" | "browser_text" | "plain_text";
export type RetrievalExtractionMethod = RetrievalExtractionInputKind | "ai_extractor";
export type RetrievalBindingSignalKind = "symbol" | "canonical_name" | "page_title" | "url_path" | "quote_card" | "table_row" | "location" | "unit" | "timestamp";
export type RetrievalBindingStrength = "strong" | "acceptable" | "weak" | "none";
export type RetrievalVerificationPolicy = SourceFreshnessPolicy | "official_required";
export type RetrievalEvidenceSufficiency = "sufficient_exact" | "sufficient_approximate" | "partial_but_answerable" | "insufficient_candidate_missing" | "insufficient_binding_weak" | "insufficient_conflict" | "blocked";
export interface RetrievalBindingSignal {
    kind: RetrievalBindingSignalKind;
    value: string;
    weight: number;
    evidenceField: string;
}
export interface RetrievedValueCandidate {
    id: string;
    sourceEvidenceId: string;
    targetId: string;
    rawValue: string;
    normalizedValue: string;
    unit: string | null;
    labelNearValue: string;
    targetLabelNearValue: string | null;
    bindingSignals: RetrievalBindingSignal[];
    extractionMethod: RetrievalExtractionMethod;
    confidence: number;
}
export interface CandidateExtractionHints {
    pageTitle?: string | null;
    quoteCardLabel?: string | null;
    tableRowLabel?: string | null;
    locationLabel?: string | null;
    sourceTimestamp?: string | null;
}
export interface CandidateExtractionInput {
    sourceEvidenceId: string;
    sourceEvidence: SourceEvidence;
    target: RetrievalTargetContract;
    content: unknown;
    inputKind: RetrievalExtractionInputKind;
    hints?: CandidateExtractionHints;
}
export interface CandidateExtractionFailureEvent {
    eventType: "web_retrieval.candidate_extraction_failed";
    sourceEvidenceId: string;
    targetId: string;
    reason: string;
    inputKind: RetrievalExtractionInputKind;
}
export interface RetrievalVerificationVerdict {
    candidateId: string | null;
    canAnswer: boolean;
    bindingStrength: RetrievalBindingStrength;
    evidenceSufficiency: RetrievalEvidenceSufficiency;
    rejectionReason: string | null;
    policy: RetrievalVerificationPolicy;
    sourceEvidenceId: string | null;
    targetId: string;
    acceptedValue: string | null;
    acceptedUnit: string | null;
    bindingSignals: RetrievalBindingSignal[];
    conflicts: string[];
    caveats: string[];
}
export interface VerifyRetrievedValueCandidateInput {
    candidate?: RetrievedValueCandidate | null;
    target: RetrievalTargetContract;
    sourceEvidence?: SourceEvidence | null;
    policy: RetrievalVerificationPolicy;
}
export declare function extractRetrievedValueCandidates(input: CandidateExtractionInput): RetrievedValueCandidate[];
export declare function buildCandidateExtractionFailureEvent(input: {
    sourceEvidenceId: string;
    targetId: string;
    reason: string;
    inputKind: RetrievalExtractionInputKind;
}): CandidateExtractionFailureEvent;
export declare function verifyRetrievedValueCandidate(input: VerifyRetrievedValueCandidateInput): RetrievalVerificationVerdict;
export declare function verifyRetrievedValueCandidates(input: {
    candidates: RetrievedValueCandidate[];
    target: RetrievalTargetContract;
    sourceEvidenceById: Record<string, SourceEvidence>;
    policy: RetrievalVerificationPolicy;
}): RetrievalVerificationVerdict;
export declare function sourceKindSatisfiesOfficialRequired(kind: SourceKind): boolean;
//# sourceMappingURL=web-retrieval-verification.d.ts.map