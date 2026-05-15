export type TerminalFailureReason = "no_safe_alternative" | "privacy_or_permission_boundary" | "permission_required" | "out_of_scope" | "external_system_unavailable_without_alternative" | "cancelled_by_user" | "explicit_user_limit_reached" | "manual_approval_required";
export type NonTerminalRecoveryReason = "model_timeout" | "boundary_timeout" | "tool_failed" | "path_not_found" | "target_busy" | "rate_limited" | "queue_backpressure" | "count_signal_observed" | "same_strategy_rejected" | "strategy_change_required" | "missing_input" | "verification_failed";
export type CountBasedFailureSignalReason = "retry_exhausted" | "max_attempts_reached" | "retry_budget_exhausted" | "delegation_turns_exhausted" | "too_many_failures";
export declare const TERMINAL_FAILURE_REASONS: readonly TerminalFailureReason[];
export declare const NON_TERMINAL_RECOVERY_REASONS: readonly NonTerminalRecoveryReason[];
export declare const COUNT_BASED_FAILURE_SIGNAL_REASONS: readonly CountBasedFailureSignalReason[];
export interface ExplicitLimit {
    explicitLimit: number;
    source: "user" | "admin";
}
export interface ExecutionPolicySnapshot {
    countLimits: {
        retryAttempts: "unbounded" | ExplicitLimit;
        delegationTurns: "unbounded" | ExplicitLimit;
    };
    operationalLimits: {
        concurrency: "queue" | "wait" | "fallback";
        rateLimit: "wait" | "fallback" | "requires_user_confirmation";
        queueBackpressure: "queue" | "fallback" | "requires_user_confirmation";
    };
    safetyBoundaries: {
        privacy: "stop_for_confirmation";
        permission: "stop_for_confirmation";
        destructiveAction: "stop_for_confirmation";
        outOfScope: "stop";
    };
}
export interface FailureReasonNormalizationInput {
    reason: string;
    explicitUserLimit?: boolean;
}
export type FailureReasonNormalizationResult = {
    kind: "terminal";
    reason: TerminalFailureReason;
} | {
    kind: "recovery_signal";
    reason: NonTerminalRecoveryReason;
    originalReason: string;
};
export declare function createDefaultExecutionPolicySnapshot(): ExecutionPolicySnapshot;
export declare function isTerminalFailureReason(reason: string): reason is TerminalFailureReason;
export declare function isCountBasedFailureSignalReason(reason: string): reason is CountBasedFailureSignalReason;
export declare function normalizeFailureReason(input: FailureReasonNormalizationInput): FailureReasonNormalizationResult;
//# sourceMappingURL=execution-policy.d.ts.map