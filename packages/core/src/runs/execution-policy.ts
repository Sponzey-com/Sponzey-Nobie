export type TerminalFailureReason =
  | "no_safe_alternative"
  | "privacy_or_permission_boundary"
  | "permission_required"
  | "out_of_scope"
  | "external_system_unavailable_without_alternative"
  | "cancelled_by_user"
  | "explicit_user_limit_reached"
  | "manual_approval_required"

export type NonTerminalRecoveryReason =
  | "model_timeout"
  | "boundary_timeout"
  | "tool_failed"
  | "path_not_found"
  | "target_busy"
  | "rate_limited"
  | "queue_backpressure"
  | "count_signal_observed"
  | "same_strategy_rejected"
  | "strategy_change_required"
  | "missing_input"
  | "verification_failed"

export type CountBasedFailureSignalReason =
  | "retry_exhausted"
  | "max_attempts_reached"
  | "retry_budget_exhausted"
  | "delegation_turns_exhausted"
  | "too_many_failures"

export const TERMINAL_FAILURE_REASONS: readonly TerminalFailureReason[] = [
  "no_safe_alternative",
  "privacy_or_permission_boundary",
  "permission_required",
  "out_of_scope",
  "external_system_unavailable_without_alternative",
  "cancelled_by_user",
  "explicit_user_limit_reached",
  "manual_approval_required",
] as const

export const NON_TERMINAL_RECOVERY_REASONS: readonly NonTerminalRecoveryReason[] = [
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
] as const

export const COUNT_BASED_FAILURE_SIGNAL_REASONS: readonly CountBasedFailureSignalReason[] = [
  "retry_exhausted",
  "max_attempts_reached",
  "retry_budget_exhausted",
  "delegation_turns_exhausted",
  "too_many_failures",
] as const

export interface ExplicitLimit {
  explicitLimit: number
  source: "user" | "admin"
}

export interface ExecutionPolicySnapshot {
  countLimits: {
    retryAttempts: "unbounded" | ExplicitLimit
    delegationTurns: "unbounded" | ExplicitLimit
  }
  operationalLimits: {
    concurrency: "queue" | "wait" | "fallback"
    rateLimit: "wait" | "fallback" | "requires_user_confirmation"
    queueBackpressure: "queue" | "fallback" | "requires_user_confirmation"
  }
  safetyBoundaries: {
    privacy: "stop_for_confirmation"
    permission: "stop_for_confirmation"
    destructiveAction: "stop_for_confirmation"
    outOfScope: "stop"
  }
}

export interface FailureReasonNormalizationInput {
  reason: string
  explicitUserLimit?: boolean
}

export type FailureReasonNormalizationResult =
  | {
      kind: "terminal"
      reason: TerminalFailureReason
    }
  | {
      kind: "recovery_signal"
      reason: NonTerminalRecoveryReason
      originalReason: string
    }

const terminalReasonSet = new Set<string>(TERMINAL_FAILURE_REASONS)
const nonTerminalReasonSet = new Set<string>(NON_TERMINAL_RECOVERY_REASONS)
const countBasedFailureSignalReasonSet = new Set<string>(COUNT_BASED_FAILURE_SIGNAL_REASONS)
const boundaryTimeoutReasonSet = new Set<string>([
  "boundary_timeout",
  "queue_timeout",
  "external_tool_timeout",
  "approval_timeout",
  "network_timeout",
])

export function createDefaultExecutionPolicySnapshot(): ExecutionPolicySnapshot {
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
  }
}

export function isTerminalFailureReason(reason: string): reason is TerminalFailureReason {
  return terminalReasonSet.has(reason)
}

export function isCountBasedFailureSignalReason(
  reason: string,
): reason is CountBasedFailureSignalReason {
  return countBasedFailureSignalReasonSet.has(reason)
}

export function normalizeFailureReason(input: FailureReasonNormalizationInput): FailureReasonNormalizationResult {
  const reason = input.reason.trim()
  if (isCountBasedFailureSignalReason(reason)) {
    if (input.explicitUserLimit === true) {
      return { kind: "terminal", reason: "explicit_user_limit_reached" }
    }
    return {
      kind: "recovery_signal",
      reason: "count_signal_observed",
      originalReason: reason,
    }
  }
  if (boundaryTimeoutReasonSet.has(reason)) {
    return {
      kind: "recovery_signal",
      reason: "boundary_timeout",
      originalReason: reason,
    }
  }
  if (nonTerminalReasonSet.has(reason)) {
    return {
      kind: "recovery_signal",
      reason: reason as NonTerminalRecoveryReason,
      originalReason: reason,
    }
  }
  if (reason === "cancelled" || reason === "user_cancelled") {
    return { kind: "terminal", reason: "cancelled_by_user" }
  }
  if (isTerminalFailureReason(reason)) {
    return { kind: "terminal", reason }
  }
  return {
    kind: "recovery_signal",
    reason: "strategy_change_required",
    originalReason: reason.length > 0 ? reason : "unknown",
  }
}
