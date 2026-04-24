import type { SubAgentResultReview } from "../agent/sub-agent-result-review.js";
import type { DataExchangePackage, ExpectedOutputContract, FeedbackRequest, FeedbackTargetAgentPolicy, ResultReport, SubSessionContract } from "../contracts/sub-agent-orchestration.js";
import { persistDataExchangePackage } from "../memory/isolation.js";
import { type SubSessionFeedbackCycleDirective } from "../runs/review-cycle-pass.js";
import type { RunSubSessionInput } from "./sub-session-runner.js";
export type FeedbackLoopContinuationAction = "feedback_request" | "limited_success_finalized" | "blocked_repeated_failure" | "blocked_retry_budget_exhausted" | "blocked_review_not_retryable";
export interface FeedbackLoopContinuationDecision {
    action: FeedbackLoopContinuationAction;
    reasonCode: string;
    normalizedFailureKey?: string;
}
export interface RedelegationTargetValidationInput {
    policy: FeedbackTargetAgentPolicy;
    parentAgentId?: string;
    currentAgentId: string;
    targetAgentId?: string;
    directChildAgentIds?: string[];
    permissionAllowed?: boolean;
    capabilityAllowed?: boolean;
    modelAvailable?: boolean;
    resourceLocksAvailable?: boolean;
}
export interface RedelegationTargetValidationResult {
    ok: boolean;
    reasonCodes: string[];
}
export interface BuildFeedbackLoopPackageInput {
    resultReports: ResultReport[];
    review: SubAgentResultReview;
    expectedOutputs: ExpectedOutputContract[];
    targetAgentPolicy: FeedbackTargetAgentPolicy;
    targetAgentId?: string;
    targetAgentNicknameSnapshot?: string;
    requestingAgentId?: string;
    requestingAgentNicknameSnapshot?: string;
    parentRunId?: string;
    parentSessionId?: string;
    parentRequestId?: string;
    previousSubSessionIds?: string[];
    conflictItems?: string[];
    additionalConstraints?: string[];
    additionalContextRefs?: string[];
    retryBudgetRemaining?: number;
    idProvider?: () => string;
    now?: () => number;
    persistSynthesizedContext?: boolean;
    persistDataExchange?: typeof persistDataExchangePackage;
}
export interface FeedbackLoopPackage {
    feedbackRequest: FeedbackRequest;
    synthesizedContext: DataExchangePackage;
    directive: SubSessionFeedbackCycleDirective;
}
export interface BuildRedelegatedSubSessionInput {
    sourceSubSession: SubSessionContract;
    feedbackRequest: FeedbackRequest;
    targetAgentId: string;
    targetAgentDisplayName?: string;
    targetAgentNickname?: string;
    subSessionId?: string;
    commandRequestId?: string;
    idProvider?: () => string;
}
export declare function decideFeedbackLoopContinuation(input: {
    review: SubAgentResultReview;
    retryBudgetRemaining: number;
    previousFailureKeys?: string[];
}): FeedbackLoopContinuationDecision;
export declare function validateRedelegationTarget(input: RedelegationTargetValidationInput): RedelegationTargetValidationResult;
export declare function buildFeedbackLoopPackage(input: BuildFeedbackLoopPackageInput): FeedbackLoopPackage;
export declare function buildRedelegatedSubSessionInput(input: BuildRedelegatedSubSessionInput): RunSubSessionInput;
//# sourceMappingURL=feedback-loop.d.ts.map