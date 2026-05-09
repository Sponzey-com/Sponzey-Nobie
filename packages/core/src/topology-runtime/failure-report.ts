import {
  ENTERPRISE_TOPOLOGY_SCHEMA_VERSION,
  type EnterpriseMetadata,
  type EnterpriseTimestamp,
  type FailureReport,
  type FailureIssueKind,
  type FailureNextActionKind,
  type FailureRecoveryActionKind,
  type NodeContract,
  type NodeResultOutput,
  type WorkOrder,
} from "../contracts/enterprise-topology.js"
import type { NodeExhaustionCheckResult } from "./exhaustion-checker.js"
import type { NodeRecoveryControllerResult } from "./recovery-controller.js"

export interface GenerateFailureReportInput {
  workOrder: WorkOrder
  nodeContractSnapshot: NodeContract
  nodeRunId: string
  outputs: NodeResultOutput[]
  risksOrGaps: string[]
  recoveryReview: NodeRecoveryControllerResult
  exhaustion: NodeExhaustionCheckResult
  partialResult?: EnterpriseMetadata
  recommendedAction?: string
  failureReportId?: string
  createdAt?: EnterpriseTimestamp
}

export function generateFailureReport(input: GenerateFailureReportInput): FailureReport {
  return {
    schemaVersion: ENTERPRISE_TOPOLOGY_SCHEMA_VERSION,
    failureReportId: input.failureReportId ?? `failure:${input.workOrder.workOrderId}`,
    topologyRunId: input.workOrder.topologyRunId,
    nodeRunId: input.nodeRunId,
    workOrderId: input.workOrder.workOrderId,
    nodeId: input.nodeContractSnapshot.id,
    exhaustionSummary: input.exhaustion.exhaustionSummary,
    attempts: input.recoveryReview.attempts.map((attempt) => ({ ...attempt })),
    untriedOptions: [...input.exhaustion.untriedOptions],
    ...(input.partialResult !== undefined ? { partialResult: structuredClone(input.partialResult) } : {}),
    issueKind: failureIssueKind(input),
    recoveryActionKind: failureRecoveryActionKind(input.recoveryReview),
    nextActionKind: failureNextActionKind(input.recoveryReview),
    recommendedAction: input.recommendedAction ?? recommendedActionForFailure(input),
    createdAt: input.createdAt ?? Date.now(),
  }
}

function failureIssueKind(input: GenerateFailureReportInput): FailureIssueKind {
  if (input.exhaustion.unmetSuccessCriteriaIds.length > 0) return "success_criteria_unmet"
  if (input.risksOrGaps.length > 0) return "runtime_risk"
  if (input.recoveryReview.attempted.tool_execution && !input.recoveryReview.attempted.fallback) {
    return "permission_or_tool_blocked"
  }
  return "execution_incomplete"
}

function failureRecoveryActionKind(
  recoveryReview: NodeRecoveryControllerResult,
): FailureRecoveryActionKind {
  const unreviewed = recoveryReview.signals.find((signal) => signal.possible && !signal.reviewed)
  switch (unreviewed?.kind) {
    case "retry":
      return "retry"
    case "child_delegation":
      return "delegate_to_next_executor"
    case "tool_execution":
      return "add_tool_permission"
    case "fallback":
      return "add_fallback_path"
    case "partial_success_review":
      return "pass_partial_result"
    case "parent_recovery":
      return "return_to_parent"
    case "self_execution":
      return "review_trace"
    default:
      return "review_trace"
  }
}

function failureNextActionKind(
  recoveryReview: NodeRecoveryControllerResult,
): FailureNextActionKind {
  switch (failureRecoveryActionKind(recoveryReview)) {
    case "add_tool_permission":
      return "add_permission"
    case "add_fallback_path":
      return "add_fallback"
    case "pass_partial_result":
      return "pass_partial"
    case "retry":
    case "delegate_to_next_executor":
    case "return_to_parent":
    case "review_trace":
    case "none":
      return "review_trace"
  }
}

function recommendedActionForFailure(input: GenerateFailureReportInput): string {
  if (input.exhaustion.blockingUntriedOptions.length > 0) {
    return `Review untried recovery options before declaring final failure: ${input.exhaustion.blockingUntriedOptions.join(", ")}.`
  }
  if (input.exhaustion.unmetSuccessCriteriaIds.length > 0) {
    return `Escalate with unmet success criteria: ${input.exhaustion.unmetSuccessCriteriaIds.join(", ")}.`
  }
  if (input.risksOrGaps.length > 0) {
    return `Review unresolved runtime risks: ${input.risksOrGaps.slice(0, 3).join(", ")}.`
  }
  return "Escalate to the accountable owner with the failure report and runtime trace."
}
