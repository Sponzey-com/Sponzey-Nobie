import type {
  ExhaustionSummary,
  NodeResultOutput,
  WorkOrder,
} from "../contracts/enterprise-topology.js"
import type { NodeRecoveryControllerResult } from "./recovery-controller.js"

export interface CheckFinalFailureExhaustionInput {
  workOrder: WorkOrder
  outputs: NodeResultOutput[]
  recoveryReview: NodeRecoveryControllerResult
}

export interface NodeExhaustionCheckResult {
  exhaustionSummary: ExhaustionSummary
  complete: boolean
  canFinalizeFailure: boolean
  successCriteriaStillNotMet: boolean
  unmetSuccessCriteriaIds: string[]
  untriedOptions: string[]
  blockingUntriedOptions: string[]
  reasonCodes: string[]
}

export function checkFinalFailureExhaustion(
  input: CheckFinalFailureExhaustionInput,
): NodeExhaustionCheckResult {
  const unmetSuccessCriteriaIds = unmetSuccessCriteriaIdsForOutputs(input.workOrder, input.outputs)
  const successCriteriaStillNotMet = unmetSuccessCriteriaIds.length > 0
  const complete = input.recoveryReview.blockingUntriedOptions.length === 0
  const canFinalizeFailure = complete && successCriteriaStillNotMet
  return {
    exhaustionSummary: {
      selfExecutionAttempted: input.recoveryReview.attempted.self_execution,
      childDelegationAttempted: input.recoveryReview.attempted.child_delegation,
      toolExecutionAttempted: input.recoveryReview.attempted.tool_execution,
      retryAttempted: input.recoveryReview.attempted.retry,
      fallbackAttempted: input.recoveryReview.attempted.fallback,
      partialSuccessChecked: input.recoveryReview.attempted.partial_success_review,
      parentRecoveryPossibleChecked: input.recoveryReview.attempted.parent_recovery,
      successCriteriaStillNotMet,
      complete,
    },
    complete,
    canFinalizeFailure,
    successCriteriaStillNotMet,
    unmetSuccessCriteriaIds,
    untriedOptions: [...input.recoveryReview.untriedOptions],
    blockingUntriedOptions: [...input.recoveryReview.blockingUntriedOptions],
    reasonCodes: [
      canFinalizeFailure ? "final_failure_guard_passed" : "final_failure_guard_blocked",
      complete ? "exhaustion_complete" : "exhaustion_incomplete",
      successCriteriaStillNotMet ? "success_criteria_not_met" : "success_criteria_met",
      ...input.recoveryReview.reasonCodes,
    ],
  }
}

function unmetSuccessCriteriaIdsForOutputs(workOrder: WorkOrder, outputs: NodeResultOutput[]): string[] {
  const outputsById = new Map(outputs.map((output) => [output.outputId, output]))
  return workOrder.successCriteria
    .filter((criterion) => criterion.required)
    .filter((criterion) => outputsById.get(criterion.criterionId)?.status !== "satisfied")
    .map((criterion) => criterion.criterionId)
}
