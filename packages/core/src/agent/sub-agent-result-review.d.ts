import type { ExpectedOutputContract, FeedbackRequest, ResultReport } from "../contracts/sub-agent-orchestration.js";
export type SubAgentResultReviewIssueCode = "result_report_not_completed" | "result_report_failed" | "required_output_missing" | "required_output_not_satisfied" | "required_evidence_missing" | "evidence_source_missing" | "artifact_missing" | "artifact_path_missing" | "artifact_not_found" | "reported_risk_or_gap";
export type SubAgentRetryClass = "default" | "format_only" | "risk_or_external" | "expensive";
export interface SubAgentResultReviewIssue {
    code: SubAgentResultReviewIssueCode;
    outputId?: string;
    evidenceKind?: string;
    artifactId?: string;
    detail: string;
}
export interface SubAgentResultReviewInput {
    resultReport: ResultReport;
    expectedOutputs: ExpectedOutputContract[];
    retryBudgetRemaining: number;
    previousFailureKeys?: string[];
    retryClass?: SubAgentRetryClass;
    additionalContextRefs?: string[];
    artifactExists?: (artifact: ResultReport["artifacts"][number]) => boolean;
    now?: () => number;
    idProvider?: () => string;
}
export interface SubAgentResultReview {
    accepted: boolean;
    status: "completed" | "needs_revision" | "failed";
    issues: SubAgentResultReviewIssue[];
    normalizedFailureKey?: string;
    missingItems: string[];
    requiredChanges: string[];
    retryBudgetLimit: number;
    retryBudgetRemaining: number;
    repeatedFailure: boolean;
    canRetry: boolean;
    feedbackRequest?: FeedbackRequest;
    manualActionReason?: string;
}
export interface SubSessionCompletionIntegrationDecision {
    finalDeliveryAllowed: boolean;
    blockedSubSessionIds: string[];
    reasonCodes: string[];
}
export declare function reviewSubAgentResult(input: SubAgentResultReviewInput): SubAgentResultReview;
export declare function collectResultReviewIssues(input: Pick<SubAgentResultReviewInput, "resultReport" | "expectedOutputs" | "artifactExists">): SubAgentResultReviewIssue[];
export declare function normalizeResultReviewFailureKey(issues: SubAgentResultReviewIssue[]): string;
export declare function getSubAgentResultRetryBudgetLimit(retryClass: SubAgentRetryClass): number;
export declare function buildFeedbackRequest(input: {
    resultReport: ResultReport;
    expectedOutputs: ExpectedOutputContract[];
    missingItems: string[];
    requiredChanges: string[];
    additionalContextRefs: string[];
    retryBudgetRemaining: number;
    reasonCode: string;
    now?: () => number;
    idProvider?: () => string;
}): FeedbackRequest;
export declare function decideSubSessionCompletionIntegration(reviews: Array<{
    subSessionId: string;
    review: Pick<SubAgentResultReview, "accepted" | "normalizedFailureKey">;
}>): SubSessionCompletionIntegrationDecision;
//# sourceMappingURL=sub-agent-result-review.d.ts.map