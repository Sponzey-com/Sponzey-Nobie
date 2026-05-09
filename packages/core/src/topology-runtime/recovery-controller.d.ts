import type { AttemptKind, AttemptRecord, AttemptStatus, NodeContract, NodeResultStatus, NodeRuntimeState, WorkOrder } from "../contracts/enterprise-topology.js";
import type { AggregationResult } from "./aggregation.js";
import type { ChildDispatchSummary } from "./child-dispatcher.js";
import type { NodeToolExecutionSummary } from "./tool-dispatcher.js";
import type { AggregatedNodeValidationResult } from "./validation.js";
export type RecoveryOptionReviewCode = "self_execution_attempted" | "self_execution_untried" | "child_delegation_attempted" | "child_delegation_untried" | "child_delegation_not_available" | "tool_execution_attempted" | "tool_execution_untried" | "tool_execution_not_available" | "retry_attempted" | "retry_untried" | "retry_not_available" | "fallback_attempted" | "fallback_untried" | "fallback_not_available" | "partial_success_checked" | "partial_success_unchecked" | "partial_success_not_available" | "parent_recovery_checked" | "parent_recovery_unchecked";
export interface NodeRecoveryControllerOptions {
    selfExecutionAttempted?: boolean;
    childDelegationAttempted?: boolean;
    toolExecutionAttempted?: boolean;
    retryAttempted?: boolean;
    fallbackAttempted?: boolean;
    partialSuccessChecked?: boolean;
    parentRecoveryPossibleChecked?: boolean;
    requireChildDelegationReview?: boolean;
    requireToolExecutionReview?: boolean;
    requireRetryReview?: boolean;
    requireFallbackReview?: boolean;
    requirePartialSuccessReview?: boolean;
    requireParentRecoveryReview?: boolean;
    recommendedAction?: string;
}
export interface BuildNodeRecoveryReviewInput {
    workOrder: WorkOrder;
    nodeContractSnapshot: NodeContract;
    candidateStatus: NodeResultStatus;
    stateTransitions: ReadonlyArray<{
        state: NodeRuntimeState;
    }>;
    childDelegation?: ChildDispatchSummary;
    toolExecution?: NodeToolExecutionSummary;
    aggregation?: AggregationResult;
    validation?: AggregatedNodeValidationResult;
    options?: NodeRecoveryControllerOptions;
    now?: () => number;
}
export interface NodeRecoveryReviewSignal {
    kind: AttemptKind;
    possible: boolean;
    reviewed: boolean;
    blockingIfUnreviewed: boolean;
    status: AttemptStatus;
    reasonCode: RecoveryOptionReviewCode;
    summary: string;
}
export interface NodeRecoveryControllerResult {
    attempts: AttemptRecord[];
    signals: NodeRecoveryReviewSignal[];
    untriedOptions: string[];
    blockingUntriedOptions: string[];
    reasonCodes: RecoveryOptionReviewCode[];
    attempted: Record<AttemptKind, boolean>;
}
export declare class RecoveryController {
    private readonly input;
    constructor(input: BuildNodeRecoveryReviewInput);
    reviewSelfExecution(): NodeRecoveryReviewSignal;
    reviewRetry(): NodeRecoveryReviewSignal;
    reviewPartialSuccess(): NodeRecoveryReviewSignal;
    reviewParentRecovery(): NodeRecoveryReviewSignal;
    private hasState;
}
export declare class RedelegationController {
    private readonly input;
    constructor(input: BuildNodeRecoveryReviewInput);
    reviewChildDelegation(): NodeRecoveryReviewSignal;
    private statusForChildDelegation;
}
export declare class FallbackController {
    private readonly input;
    constructor(input: BuildNodeRecoveryReviewInput);
    reviewFallback(): NodeRecoveryReviewSignal;
}
export declare class ToolRecoveryController {
    private readonly input;
    constructor(input: BuildNodeRecoveryReviewInput);
    reviewToolExecution(): NodeRecoveryReviewSignal;
    private statusForToolExecution;
}
export declare function buildNodeRecoveryReview(input: BuildNodeRecoveryReviewInput): NodeRecoveryControllerResult;
//# sourceMappingURL=recovery-controller.d.ts.map