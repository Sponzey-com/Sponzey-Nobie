export const TERMINAL_FAILURE_REASONS = [
    "no_safe_alternative",
    "privacy_or_permission_boundary",
    "permission_required",
    "out_of_scope",
    "external_system_unavailable_without_alternative",
    "cancelled_by_user",
    "explicit_user_limit_reached",
    "manual_approval_required",
];
export const NON_TERMINAL_RECOVERY_REASONS = [
    "model_timeout",
    "boundary_timeout",
    "tool_failed",
    "path_not_found",
    "target_busy",
    "rate_limited",
    "queue_backpressure",
    "count_signal_observed",
    "same_strategy_rejected",
    "strategy_change_required",
    "missing_input",
    "verification_failed",
];
export const COUNT_BASED_FAILURE_SIGNAL_REASONS = [
    "retry_exhausted",
    "max_attempts_reached",
    "retry_budget_exhausted",
    "delegation_turns_exhausted",
    "too_many_failures",
];
const terminalReasonSet = new Set(TERMINAL_FAILURE_REASONS);
const nonTerminalReasonSet = new Set(NON_TERMINAL_RECOVERY_REASONS);
const countBasedFailureSignalReasonSet = new Set(COUNT_BASED_FAILURE_SIGNAL_REASONS);
const boundaryTimeoutReasonSet = new Set([
    "boundary_timeout",
    "queue_timeout",
    "external_tool_timeout",
    "approval_timeout",
    "network_timeout",
]);
export function createDefaultExecutionPolicySnapshot() {
    return {
        countLimits: {
            retryAttempts: "unbounded",
            delegationTurns: "unbounded",
        },
        operationalLimits: {
            concurrency: "queue",
            rateLimit: "wait",
            queueBackpressure: "queue",
        },
        safetyBoundaries: {
            privacy: "stop_for_confirmation",
            permission: "stop_for_confirmation",
            destructiveAction: "stop_for_confirmation",
            outOfScope: "stop",
        },
    };
}
export function isTerminalFailureReason(reason) {
    return terminalReasonSet.has(reason);
}
export function isCountBasedFailureSignalReason(reason) {
    return countBasedFailureSignalReasonSet.has(reason);
}
export function normalizeFailureReason(input) {
    const reason = input.reason.trim();
    if (isCountBasedFailureSignalReason(reason)) {
        if (input.explicitUserLimit === true) {
            return { kind: "terminal", reason: "explicit_user_limit_reached" };
        }
        return {
            kind: "recovery_signal",
            reason: "count_signal_observed",
            originalReason: reason,
        };
    }
    if (boundaryTimeoutReasonSet.has(reason)) {
        return {
            kind: "recovery_signal",
            reason: "boundary_timeout",
            originalReason: reason,
        };
    }
    if (nonTerminalReasonSet.has(reason)) {
        return {
            kind: "recovery_signal",
            reason: reason,
            originalReason: reason,
        };
    }
    if (reason === "cancelled" || reason === "user_cancelled") {
        return { kind: "terminal", reason: "cancelled_by_user" };
    }
    if (isTerminalFailureReason(reason)) {
        return { kind: "terminal", reason };
    }
    return {
        kind: "recovery_signal",
        reason: "strategy_change_required",
        originalReason: reason.length > 0 ? reason : "unknown",
    };
}
//# sourceMappingURL=execution-policy.js.map