import {
  normalizeFailureReason,
  type NonTerminalRecoveryReason,
  type TerminalFailureReason,
} from "./execution-policy.js"
import {
  recordRecoveryStrategyAttempt,
  type RecoveryStrategyKey,
  type RecoveryStrategyLedger,
} from "./recovery-strategy-ledger.js"
import type { NodeTaskAnalysis, RecoveryAlternative } from "../topology/executor-task-analysis.js"

export type RecoveryControllerDecision =
  | {
      status: "cancelled"
      reasonCode: "user_cancelled"
    }
  | {
      status: "waiting_for_user"
      terminalReason: Extract<TerminalFailureReason, "privacy_or_permission_boundary" | "permission_required" | "manual_approval_required">
    }
  | {
      status: "strategy_selected"
      recoveryReason: NonTerminalRecoveryReason
      alternative: RecoveryAlternative
      strategyKey: RecoveryStrategyKey
    }
  | {
      status: "no_safe_alternative"
      terminalReason: Extract<TerminalFailureReason, "no_safe_alternative" | "out_of_scope" | "external_system_unavailable_without_alternative">
      recoveryReason?: NonTerminalRecoveryReason
    }

export interface RecoveryControllerResult {
  decision: RecoveryControllerDecision
  ledger: RecoveryStrategyLedger
}

export function chooseRecoveryAlternative(input: {
  taskAnalysis: Pick<NodeTaskAnalysis, "safeAlternatives" | "needsUserConfirmation">
  ledger: RecoveryStrategyLedger
  scopeId: string
  failureReason: string
  baseStrategyKey: RecoveryStrategyKey
  explicitUserLimit?: boolean
  cancelled?: boolean
  now?: number
}): RecoveryControllerResult {
  if (input.cancelled) {
    return {
      decision: { status: "cancelled", reasonCode: "user_cancelled" },
      ledger: input.ledger,
    }
  }

  const normalized = normalizeFailureReason({
    reason: input.failureReason,
    ...(input.explicitUserLimit !== undefined ? { explicitUserLimit: input.explicitUserLimit } : {}),
  })
  if (normalized.kind === "terminal") {
    if (
      normalized.reason === "privacy_or_permission_boundary" ||
      normalized.reason === "permission_required" ||
      normalized.reason === "manual_approval_required"
    ) {
      return {
        decision: { status: "waiting_for_user", terminalReason: normalized.reason },
        ledger: input.ledger,
      }
    }
    const terminalReason =
      normalized.reason === "out_of_scope" ||
      normalized.reason === "external_system_unavailable_without_alternative" ||
      normalized.reason === "no_safe_alternative"
        ? normalized.reason
        : "no_safe_alternative"
    return {
      decision: {
        status: "no_safe_alternative",
        terminalReason,
      },
      ledger: input.ledger,
    }
  }

  let ledger = input.ledger
  for (const alternative of input.taskAnalysis.safeAlternatives) {
    const strategyKey = strategyKeyForAlternative(input.baseStrategyKey, alternative)
    const recorded = recordRecoveryStrategyAttempt({
      ledger,
      scopeId: input.scopeId,
      key: strategyKey,
      reason: normalized.reason,
      ...(input.now !== undefined ? { now: input.now } : {}),
    })
    ledger = recorded.ledger
    if (!recorded.accepted) continue
    return {
      decision: {
        status: "strategy_selected",
        recoveryReason: normalized.reason,
        alternative,
        strategyKey,
      },
      ledger,
    }
  }

  return {
    decision: {
      status: "no_safe_alternative",
      terminalReason: "no_safe_alternative",
      recoveryReason: normalized.reason,
    },
    ledger,
  }
}

function strategyKeyForAlternative(
  base: RecoveryStrategyKey,
  alternative: RecoveryAlternative,
): RecoveryStrategyKey {
  const suffix = alternative.alternativeId
  switch (alternative.changedDimension) {
    case "target":
    case "fallback_route":
    case "path":
      return {
        ...base,
        targetRoute: `${base.targetRoute}:${alternative.changedDimension}:${suffix}`,
        executorId: `${base.executorId ?? base.targetAgentId ?? base.targetRoute}:${suffix}`,
      }
    case "tool":
      return { ...base, toolIds: [...base.toolIds, suffix], sourceIds: [...(base.sourceIds ?? []), suffix] }
    case "input_shape":
      return {
        ...base,
        inputShapeHash: `${base.inputShapeHash}:${suffix}`,
        promptContextHash: `${base.promptContextHash ?? base.inputShapeHash}:${suffix}`,
      }
    case "permission":
      return {
        ...base,
        permissionProfile: `${base.permissionProfile}:${suffix}`,
        userConfirmationState: `${base.userConfirmationState ?? "none"}:${suffix}`,
      }
    case "execution_order":
      return { ...base, executionOrderHash: `${base.executionOrderHash}:${suffix}` }
    case "task_split":
      return {
        ...base,
        normalizedTaskHash: `${base.normalizedTaskHash}:${suffix}`,
        decompositionHash: `${base.decompositionHash ?? base.normalizedTaskHash}:${suffix}`,
      }
    case "verification":
      return { ...base, verificationMethod: `${base.verificationMethod}:${suffix}` }
  }
}
