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

export type ForbiddenTerminalFailureReason =
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

export const FORBIDDEN_TERMINAL_FAILURE_REASONS: readonly ForbiddenTerminalFailureReason[] = [
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
const forbiddenTerminalReasonSet = new Set<string>(FORBIDDEN_TERMINAL_FAILURE_REASONS)

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

export function isForbiddenTerminalFailureReason(reason: string): reason is ForbiddenTerminalFailureReason {
  return forbiddenTerminalReasonSet.has(reason)
}

export function normalizeFailureReason(input: FailureReasonNormalizationInput): FailureReasonNormalizationResult {
  const reason = input.reason.trim()
  if (isForbiddenTerminalFailureReason(reason)) {
    if (input.explicitUserLimit === true) {
      return { kind: "terminal", reason: "explicit_user_limit_reached" }
    }
    return {
      kind: "recovery_signal",
      reason: "count_signal_observed",
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
