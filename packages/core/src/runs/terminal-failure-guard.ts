import {
  type FailureReasonNormalizationResult,
  type TerminalFailureReason,
  normalizeFailureReason,
} from "./execution-policy.js"

export type TerminalFailureGuardDecision =
  | {
      ok: true
      terminalReason: TerminalFailureReason
    }
  | {
      ok: false
      recoverySignal: Extract<FailureReasonNormalizationResult, { kind: "recovery_signal" }>
    }

export function guardTerminalFailure(input: {
  reason: string
  explicitUserLimit?: boolean
}): TerminalFailureGuardDecision {
  const normalized = normalizeFailureReason(input)
  if (normalized.kind === "terminal") {
    return {
      ok: true,
      terminalReason: normalized.reason,
    }
  }
  return {
    ok: false,
    recoverySignal: normalized,
  }
}

export function assertTerminalFailureAllowed(input: {
  reason: string
  explicitUserLimit?: boolean
}): TerminalFailureReason {
  const decision = guardTerminalFailure(input)
  if (decision.ok) return decision.terminalReason
  throw new Error(
    `terminal failure rejected: ${decision.recoverySignal.originalReason} -> ${decision.recoverySignal.reason}`,
  )
}
