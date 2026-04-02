import type { CompletionReviewResult } from "../agent/completion-review.js"
import type { TaskExecutionSemantics } from "../agent/intake.js"
import type { DeliveryOutcome } from "./delivery.js"
import {
  canConsumeRecoveryBudget,
  getRecoveryBudgetState,
  type RecoveryBudgetUsage,
} from "./recovery-budget.js"
import { type SuccessfulToolEvidence } from "./recovery.js"
import {
  decideCompletionApplication,
  type CompletionApplicationDecision,
} from "./completion-application.js"
import {
  decideCompletionFlow,
  type CompletionFlowDecision,
} from "./completion-flow.js"

export interface CompletionPassResult {
  decision: CompletionFlowDecision
  application: CompletionApplicationDecision
  usedTurns: number
  maxTurns: number
}

export function runCompletionPass(params: {
  review: CompletionReviewResult | null
  executionSemantics: TaskExecutionSemantics
  preview: string
  deliveryOutcome: DeliveryOutcome
  successfulTools: SuccessfulToolEvidence[]
  sawRealFilesystemMutation: boolean
  requiresFilesystemMutation: boolean
  truncatedOutputRecoveryAttempted: boolean
  originalRequest: string
  recoveryBudgetUsage: RecoveryBudgetUsage
  delegationTurnCount?: number
  maxDelegationTurns?: number
  defaultMaxDelegationTurns: number
  followupAlreadySeen: boolean
}): CompletionPassResult {
  const decision = decideCompletionFlow({
    review: params.review,
    executionSemantics: params.executionSemantics,
    preview: params.preview,
    deliverySatisfied: params.deliveryOutcome.deliverySatisfied,
    successfulTools: params.successfulTools,
    sawRealFilesystemMutation: params.sawRealFilesystemMutation,
    requiresFilesystemMutation: params.requiresFilesystemMutation,
    truncatedOutputRecoveryAttempted: params.truncatedOutputRecoveryAttempted,
  })

  const usedTurns = params.delegationTurnCount ?? 0
  const maxTurns = params.maxDelegationTurns ?? params.defaultMaxDelegationTurns
  const interpretationBudget = getRecoveryBudgetState({
    usage: params.recoveryBudgetUsage,
    kind: "interpretation",
    maxDelegationTurns: maxTurns,
  })

  const application = decideCompletionApplication({
    decision,
    originalRequest: params.originalRequest,
    previousResult: params.preview,
    successfulTools: params.successfulTools,
    sawRealFilesystemMutation: params.sawRealFilesystemMutation,
    usedTurns,
    maxTurns,
    interpretationBudgetLimit: interpretationBudget.limit,
    executionBudgetLimit: getRecoveryBudgetState({
      usage: params.recoveryBudgetUsage,
      kind: "execution",
      maxDelegationTurns: maxTurns,
    }).limit,
    canRetryInterpretation: canConsumeRecoveryBudget({
      usage: params.recoveryBudgetUsage,
      kind: "interpretation",
      maxDelegationTurns: maxTurns,
    }),
    canRetryExecution: canConsumeRecoveryBudget({
      usage: params.recoveryBudgetUsage,
      kind: "execution",
      maxDelegationTurns: maxTurns,
    }),
    followupAlreadySeen: params.followupAlreadySeen,
  })

  return {
    decision,
    application,
    usedTurns,
    maxTurns,
  }
}
