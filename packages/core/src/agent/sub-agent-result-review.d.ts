import type { ExpectedOutputContract, FeedbackRequest, ResultReport } from "../contracts/sub-agent-orchestration.js";
export type SubAgentResultReviewIssueCode = "result_report_not_completed" | "result_report_failed" | "required_output_missing" | "required_output_not_satisfied" | "required_evidence_missing" | "evidence_source_missing" | "artifact_missing" | "artifact_path_missing" | "artifact_not_found" | "reported_risk_or_gap" | "impossible_reason_reported";
export type SubAgentRetryClass = "default" | "format_only" | "risk_or_external" | "expensive";
export type SubAgentResultReviewVerdict = "accept" | "needs_revision" | "reject" | "limited_success" | "insufficient_evidence";
export type SubAgentResultParentIntegrationStatus = "ready_for_parent_integration" | "requires_revision" | "blocked_rejected" | "limited_parent_integration" | "blocked_insufficient_evidence";
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
    verdict: SubAgentResultReviewVerdict;
    parentIntegrationStatus: SubAgentResultParentIntegrationStatus;
    issues: SubAgentResultReviewIssue[];
    normalizedFailureKey?: string;
    missingItems: string[];
    requiredChanges: string[];
    risksOrGaps: string[];
    impossibleReason?: ResultReport["impossibleReason"];
    retryBudgetLimit: number;
    repeatedFailure: boolean;
    canRetry: boolean;
    feedbackRequest?: FeedbackRequest;
    manualActionReason?: string;
}
export interface SubSessionCompletionIntegrationDecision {
    finalDeliveryAllowed: boolean;
    blockedSubSessionIds: string[];
    limitedSubSessionIds: string[];
    reviewStatuses: Array<{
        subSessionId: string;
        verdict?: SubAgentResultReviewVerdict;
        parentIntegrationStatus?: SubAgentResultParentIntegrationStatus;
    }>;
    reasonCodes: string[];
    parentAggregationRequired?: boolean;
    parentAggregationNextAction?: ParentAggregationNextAction;
}
export type ParentAggregationNextAction = "ready_for_finalization" | "augment_same_child" | "redelegate_direct_child" | "self_solve" | "ask_user" | "return_to_parent" | "fail_with_reason";
export type ParentFacingChildResultStatus = "completed" | "partial" | "failed";
export interface ParentFacingChildResult {
    subSessionId: string;
    resultReportId?: string;
    status: ParentFacingChildResultStatus;
    confirmedFacts: string[];
    unverifiedItems: string[];
    attemptedMethods: string[];
    remainingAlternatives: string[];
    artifacts: ResultReport["artifacts"];
    riskNotes: string[];
    handoffSummary: string;
    reviewVerdict?: SubAgentResultReviewVerdict;
    parentIntegrationStatus?: SubAgentResultParentIntegrationStatus;
}
export interface ParentAggregationChildInput {
    subSessionId: string;
    resultReport?: ResultReport;
    review: Pick<SubAgentResultReview, "accepted" | "status" | "missingItems" | "risksOrGaps" | "canRetry"> & Partial<Pick<SubAgentResultReview, "verdict" | "parentIntegrationStatus" | "normalizedFailureKey" | "manualActionReason" | "impossibleReason">>;
    attemptedMethods?: string[];
    remainingAlternatives?: string[];
    canUseSameChild?: boolean;
    canUseOtherDirectChild?: boolean;
    canSelfSolve?: boolean;
    needsUserDecision?: boolean;
    returnToParentAllowed?: boolean;
}
export interface ParentAggregationInput {
    parentRunId?: string;
    parentAgentId?: string;
    requestingAgentId?: string;
    originalRequest?: string;
    successCriteria?: string[];
    childResults: ParentAggregationChildInput[];
    canSelfSolve?: boolean;
    needsUserDecision?: boolean;
    returnToParentAllowed?: boolean;
}
export interface ParentAggregationTrace {
    kind: "parent_child_result_aggregation";
    parentRunId?: string;
    parentAgentId?: string;
    requestingAgentId?: string;
    originalRequest?: string;
    successCriteria: string[];
    childResults: ParentFacingChildResult[];
    nextAction: ParentAggregationNextAction;
    finalDeliveryAllowed: boolean;
    reasonCodes: string[];
    blockedSubSessionIds: string[];
    limitedSubSessionIds: string[];
    unverifiedSubSessionIds: string[];
    createdAt: number;
}
export interface ParentAggregationRuntimeEventInput {
    eventKind: "parent_child_result_aggregated";
    parentRunId?: string;
    parentAgentId?: string;
    requestingAgentId?: string;
    summary: string;
    payload: ParentAggregationTrace;
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
    reasonCode: string;
    now?: () => number;
    idProvider?: () => string;
}): FeedbackRequest;
export declare function summarizeChildResultForParent(input: ParentAggregationChildInput): ParentFacingChildResult;
export declare function aggregateSubSessionResultsForParent(input: ParentAggregationInput): ParentAggregationTrace;
export declare function buildParentAggregationRuntimeEvent(trace: ParentAggregationTrace): ParentAggregationRuntimeEventInput;
export declare function decideSubSessionCompletionIntegration(reviews: Array<{
    subSessionId: string;
    review: Pick<SubAgentResultReview, "accepted" | "normalizedFailureKey"> & Partial<Pick<SubAgentResultReview, "verdict" | "parentIntegrationStatus">>;
}>): SubSessionCompletionIntegrationDecision;
//# sourceMappingURL=sub-agent-result-review.d.ts.map
