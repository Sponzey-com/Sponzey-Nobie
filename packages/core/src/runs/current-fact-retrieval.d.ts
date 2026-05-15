import type { SourceEvidence, SourceFreshnessPolicy, SourceKind, SourceReliability } from "./web-retrieval-policy.js";
import type { RetrievalSourceMethod, RetrievalTargetContract } from "./web-retrieval-session.js";
import type { RetrievalVerificationVerdict } from "./web-retrieval-verification.js";
import type { FinalValidationInput } from "./finalization.js";
export type CurrentFactSourceRole = "search_candidate" | "verification_source";
export type CurrentFactSourceState = "live" | "delayed" | "market_closed" | "dynamic_blocked" | "unavailable" | "unknown";
export type CurrentFactVerificationStatus = "candidate_only" | "verified" | "no_value" | "fetch_failed" | "dynamic_blocked" | "market_closed_or_delayed" | "conflict" | "blocked";
export type CurrentFactVerificationDecisionKind = "continue_verification" | "ready_to_answer" | "explain_conflict" | "explain_market_state" | "unable_after_exhausting_sources";
export type FinancialInformationBoundary = "market_fact" | "general_financial_information" | "investment_advice";
export interface CurrentFactSourceCandidate {
    sourceId: string;
    role: CurrentFactSourceRole;
    method: RetrievalSourceMethod;
    sourceUrl?: string | null;
    sourceDomain?: string | null;
    sourceLabel?: string | null;
    sourceKind: SourceKind;
    reliability: SourceReliability;
}
export interface RetrievalVerificationPlan {
    planId: string;
    target: RetrievalTargetContract;
    freshnessPolicy: SourceFreshnessPolicy;
    sources: CurrentFactSourceCandidate[];
    searchIsDiscoveryOnly: true;
    requiredVerifiedSourceCount: number;
    createdAt: string;
}
export interface CurrentFactVerificationResult {
    sourceId: string;
    status: CurrentFactVerificationStatus;
    verdict?: RetrievalVerificationVerdict | null;
    evidence?: SourceEvidence | null;
    sourceState?: CurrentFactSourceState;
    attemptedAt?: string;
    failureReason?: string | null;
    notes?: string[];
}
export interface CurrentFactVerificationDecision {
    kind: CurrentFactVerificationDecisionKind;
    nextSource?: CurrentFactSourceCandidate;
    confirmedResults: CurrentFactVerificationResult[];
    unverifiedResults: CurrentFactVerificationResult[];
    conflictResults: CurrentFactVerificationResult[];
    exhausted: boolean;
    reasonCodes: string[];
}
export interface CurrentFactAnswerSummary {
    status: CurrentFactVerificationDecisionKind;
    text: string;
    confirmed: string[];
    unverified: string[];
    sources: string[];
    issues: string[];
}
export interface FinancialInformationBoundaryNotice {
    boundary: FinancialInformationBoundary;
    checkedAt?: string;
    mustIncludeRiskNotice: boolean;
    notice: string;
}
export declare function sourceCandidateFromEvidence(evidence: SourceEvidence, role?: CurrentFactSourceRole): CurrentFactSourceCandidate;
export declare function buildRetrievalVerificationPlan(input: {
    target: RetrievalTargetContract;
    freshnessPolicy: SourceFreshnessPolicy;
    sources: Array<Omit<CurrentFactSourceCandidate, "sourceId"> & {
        sourceId?: string;
    }>;
    requiredVerifiedSourceCount?: number;
    now?: Date;
}): RetrievalVerificationPlan;
export declare function chooseNextRetrievalVerificationSource(plan: RetrievalVerificationPlan, results: CurrentFactVerificationResult[]): CurrentFactSourceCandidate | null;
export declare function evaluateRetrievalVerificationPlan(input: {
    plan: RetrievalVerificationPlan;
    results: CurrentFactVerificationResult[];
}): CurrentFactVerificationDecision;
export declare function formatCurrentFactVerificationAnswer(input: {
    plan: RetrievalVerificationPlan;
    decision: CurrentFactVerificationDecision;
}): CurrentFactAnswerSummary;
export declare function buildCurrentFactFinalValidationInput(input: {
    plan: RetrievalVerificationPlan;
    decision: CurrentFactVerificationDecision;
}): FinalValidationInput;
export declare function buildFinancialInformationBoundaryNotice(input: {
    boundary: FinancialInformationBoundary;
    checkedAt?: string | null;
}): FinancialInformationBoundaryNotice;
//# sourceMappingURL=current-fact-retrieval.d.ts.map