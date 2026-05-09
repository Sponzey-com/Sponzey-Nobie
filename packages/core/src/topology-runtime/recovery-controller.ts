import type {
  AttemptKind,
  AttemptRecord,
  AttemptStatus,
  EnterpriseTimestamp,
  NodeContract,
  NodeResultStatus,
  NodeRuntimeState,
  WorkOrder,
} from "../contracts/enterprise-topology.js"
import type { AggregationResult } from "./aggregation.js"
import type { ChildDispatchSummary } from "./child-dispatcher.js"
import type { NodeToolExecutionSummary } from "./tool-dispatcher.js"
import type { AggregatedNodeValidationResult } from "./validation.js"

export type RecoveryOptionReviewCode =
  | "self_execution_attempted"
  | "self_execution_untried"
  | "child_delegation_attempted"
  | "child_delegation_untried"
  | "child_delegation_not_available"
  | "tool_execution_attempted"
  | "tool_execution_untried"
  | "tool_execution_not_available"
  | "retry_attempted"
  | "retry_untried"
  | "retry_not_available"
  | "fallback_attempted"
  | "fallback_untried"
  | "fallback_not_available"
  | "partial_success_checked"
  | "partial_success_unchecked"
  | "partial_success_not_available"
  | "parent_recovery_checked"
  | "parent_recovery_unchecked"

export interface NodeRecoveryControllerOptions {
  selfExecutionAttempted?: boolean
  childDelegationAttempted?: boolean
  toolExecutionAttempted?: boolean
  retryAttempted?: boolean
  fallbackAttempted?: boolean
  partialSuccessChecked?: boolean
  parentRecoveryPossibleChecked?: boolean
  requireChildDelegationReview?: boolean
  requireToolExecutionReview?: boolean
  requireRetryReview?: boolean
  requireFallbackReview?: boolean
  requirePartialSuccessReview?: boolean
  requireParentRecoveryReview?: boolean
  recommendedAction?: string
}

export interface BuildNodeRecoveryReviewInput {
  workOrder: WorkOrder
  nodeContractSnapshot: NodeContract
  candidateStatus: NodeResultStatus
  stateTransitions: ReadonlyArray<{ state: NodeRuntimeState }>
  childDelegation?: ChildDispatchSummary
  toolExecution?: NodeToolExecutionSummary
  aggregation?: AggregationResult
  validation?: AggregatedNodeValidationResult
  options?: NodeRecoveryControllerOptions
  now?: () => number
}

export interface NodeRecoveryReviewSignal {
  kind: AttemptKind
  possible: boolean
  reviewed: boolean
  blockingIfUnreviewed: boolean
  status: AttemptStatus
  reasonCode: RecoveryOptionReviewCode
  summary: string
}

export interface NodeRecoveryControllerResult {
  attempts: AttemptRecord[]
  signals: NodeRecoveryReviewSignal[]
  untriedOptions: string[]
  blockingUntriedOptions: string[]
  reasonCodes: RecoveryOptionReviewCode[]
  attempted: Record<AttemptKind, boolean>
}

export class RecoveryController {
  constructor(private readonly input: BuildNodeRecoveryReviewInput) {}

  reviewSelfExecution(): NodeRecoveryReviewSignal {
    const reviewed = this.input.options?.selfExecutionAttempted
      ?? this.hasState("self_executing")
    return buildSignal({
      kind: "self_execution",
      possible: true,
      reviewed,
      blockingIfUnreviewed: true,
      attemptedStatus: this.input.candidateStatus === "completed" || this.input.candidateStatus === "partial_success"
        ? "succeeded"
        : "failed",
      attemptedReasonCode: "self_execution_attempted",
      unreviewedReasonCode: "self_execution_untried",
      notAvailableReasonCode: "self_execution_untried",
      summary: reviewed
        ? "Self execution was attempted before final failure review."
        : "Self execution has not been attempted.",
    })
  }

  reviewRetry(): NodeRecoveryReviewSignal {
    const possible = this.input.options?.requireRetryReview
      ?? this.input.nodeContractSnapshot.recoveryPolicy?.retryAllowed === true
    const reviewed = this.input.options?.retryAttempted === true
    return buildSignal({
      kind: "retry",
      possible,
      reviewed,
      blockingIfUnreviewed: possible,
      attemptedStatus: "attempted",
      attemptedReasonCode: "retry_attempted",
      unreviewedReasonCode: "retry_untried",
      notAvailableReasonCode: "retry_not_available",
      summary: reviewed
        ? "Retry path was reviewed or attempted."
        : possible
          ? "Retry path remains unreviewed."
          : "Retry is unavailable by node recovery policy.",
    })
  }

  reviewPartialSuccess(): NodeRecoveryReviewSignal {
    const policyAllowsPartial = this.input.nodeContractSnapshot.recoveryPolicy?.partialSuccessAllowed === true
      || this.input.nodeContractSnapshot.failurePolicy?.allowPartialSuccess === true
    const possible = this.input.options?.requirePartialSuccessReview ?? policyAllowsPartial
    const reviewed = this.input.options?.partialSuccessChecked
      ?? (this.input.validation !== undefined || this.input.candidateStatus === "partial_success")
    return buildSignal({
      kind: "partial_success_review",
      possible,
      reviewed,
      blockingIfUnreviewed: possible,
      attemptedStatus: "attempted",
      attemptedReasonCode: "partial_success_checked",
      unreviewedReasonCode: "partial_success_unchecked",
      notAvailableReasonCode: "partial_success_not_available",
      summary: reviewed
        ? "Partial success was evaluated."
        : possible
          ? "Partial success has not been evaluated."
          : "Partial success is unavailable by node policy.",
    })
  }

  reviewParentRecovery(): NodeRecoveryReviewSignal {
    const possible = this.input.options?.requireParentRecoveryReview ?? true
    const reviewed = this.input.options?.parentRecoveryPossibleChecked === true
    return buildSignal({
      kind: "parent_recovery",
      possible,
      reviewed,
      blockingIfUnreviewed: possible,
      attemptedStatus: "attempted",
      attemptedReasonCode: "parent_recovery_checked",
      unreviewedReasonCode: "parent_recovery_unchecked",
      notAvailableReasonCode: "parent_recovery_unchecked",
      summary: reviewed
        ? "Parent recovery propagation was reviewed."
        : "Parent recovery propagation has not been reviewed.",
    })
  }

  private hasState(state: NodeRuntimeState): boolean {
    return this.input.stateTransitions.some((transition) => transition.state === state)
  }
}

export class RedelegationController {
  constructor(private readonly input: BuildNodeRecoveryReviewInput) {}

  reviewChildDelegation(): NodeRecoveryReviewSignal {
    const policyAllowsRedelegation = this.input.nodeContractSnapshot.recoveryPolicy?.redelegationAllowed === true
    const hasChildCandidates = this.input.nodeContractSnapshot.children.length > 0
    const possible = this.input.options?.requireChildDelegationReview
      ?? (policyAllowsRedelegation || hasChildCandidates)
    const reviewed = this.input.options?.childDelegationAttempted
      ?? (this.input.childDelegation !== undefined)
    return buildSignal({
      kind: "child_delegation",
      possible,
      reviewed,
      blockingIfUnreviewed: possible,
      attemptedStatus: this.statusForChildDelegation(),
      attemptedReasonCode: "child_delegation_attempted",
      unreviewedReasonCode: "child_delegation_untried",
      notAvailableReasonCode: "child_delegation_not_available",
      summary: reviewed
        ? "Child delegation or redelegation was reviewed."
        : possible
          ? "Child delegation or redelegation remains unreviewed."
          : "Child delegation is unavailable for this node.",
    })
  }

  private statusForChildDelegation(): AttemptStatus {
    const summary = this.input.childDelegation
    if (summary === undefined) return "attempted"
    if (summary.status === "dispatched") return "succeeded"
    if (summary.status === "blocked") return "blocked"
    if (summary.status === "partial") return "failed"
    return "skipped"
  }
}

export class FallbackController {
  constructor(private readonly input: BuildNodeRecoveryReviewInput) {}

  reviewFallback(): NodeRecoveryReviewSignal {
    const fallbackNodeIds = this.input.nodeContractSnapshot.failurePolicy?.fallbackNodeIds ?? []
    const possible = this.input.options?.requireFallbackReview
      ?? (
        this.input.nodeContractSnapshot.recoveryPolicy?.fallbackAllowed === true
        && fallbackNodeIds.length > 0
      )
    const reviewed = this.input.options?.fallbackAttempted === true
    return buildSignal({
      kind: "fallback",
      possible,
      reviewed,
      blockingIfUnreviewed: possible,
      attemptedStatus: "attempted",
      attemptedReasonCode: "fallback_attempted",
      unreviewedReasonCode: "fallback_untried",
      notAvailableReasonCode: "fallback_not_available",
      summary: reviewed
        ? "Fallback path was reviewed or attempted."
        : possible
          ? "Fallback path remains unreviewed."
          : "Fallback is unavailable by node policy.",
    })
  }
}

export class ToolRecoveryController {
  constructor(private readonly input: BuildNodeRecoveryReviewInput) {}

  reviewToolExecution(): NodeRecoveryReviewSignal {
    const allowedToolIds = new Set([
      ...this.input.nodeContractSnapshot.allowedToolIds,
      ...this.input.workOrder.permissionScope.allowedToolIds,
    ])
    const possible = this.input.options?.requireToolExecutionReview
      ?? allowedToolIds.size > 0
    const reviewed = this.input.options?.toolExecutionAttempted
      ?? (this.input.toolExecution !== undefined)
    return buildSignal({
      kind: "tool_execution",
      possible,
      reviewed,
      blockingIfUnreviewed: possible,
      attemptedStatus: this.statusForToolExecution(),
      attemptedReasonCode: "tool_execution_attempted",
      unreviewedReasonCode: "tool_execution_untried",
      notAvailableReasonCode: "tool_execution_not_available",
      summary: reviewed
        ? "Tool execution possibilities were reviewed."
        : possible
          ? "Tool execution possibilities remain unreviewed."
          : "No executable tool is available for this work order.",
    })
  }

  private statusForToolExecution(): AttemptStatus {
    const summary = this.input.toolExecution
    if (summary === undefined) return "attempted"
    if (summary.status === "completed") return "succeeded"
    if (summary.status === "failed_candidate") return "failed"
    if (summary.status === "partial") return "failed"
    return "skipped"
  }
}

export function buildNodeRecoveryReview(input: BuildNodeRecoveryReviewInput): NodeRecoveryControllerResult {
  const recoveryController = new RecoveryController(input)
  const redelegationController = new RedelegationController(input)
  const fallbackController = new FallbackController(input)
  const toolController = new ToolRecoveryController(input)
  const signals = [
    recoveryController.reviewSelfExecution(),
    redelegationController.reviewChildDelegation(),
    toolController.reviewToolExecution(),
    recoveryController.reviewRetry(),
    fallbackController.reviewFallback(),
    recoveryController.reviewPartialSuccess(),
    recoveryController.reviewParentRecovery(),
  ]
  const now = input.now ?? Date.now
  const attempts = signals.map((signal, index) => signalToAttemptRecord(signal, input.workOrder, now(), index))
  const untriedOptions = signals
    .filter((signal) => !signal.reviewed)
    .map((signal) => `${signal.kind}:${signal.reasonCode}`)
  const blockingUntriedOptions = signals
    .filter((signal) => signal.possible && signal.blockingIfUnreviewed && !signal.reviewed)
    .map((signal) => `${signal.kind}:${signal.reasonCode}`)
  return {
    attempts,
    signals,
    untriedOptions,
    blockingUntriedOptions,
    reasonCodes: signals.map((signal) => signal.reasonCode),
    attempted: {
      self_execution: signalAttempted(signals, "self_execution"),
      child_delegation: signalAttempted(signals, "child_delegation"),
      tool_execution: signalAttempted(signals, "tool_execution"),
      retry: signalAttempted(signals, "retry"),
      fallback: signalAttempted(signals, "fallback"),
      partial_success_review: signalAttempted(signals, "partial_success_review"),
      parent_recovery: signalAttempted(signals, "parent_recovery"),
    },
  }
}

function buildSignal(input: {
  kind: AttemptKind
  possible: boolean
  reviewed: boolean
  blockingIfUnreviewed: boolean
  attemptedStatus: AttemptStatus
  attemptedReasonCode: RecoveryOptionReviewCode
  unreviewedReasonCode: RecoveryOptionReviewCode
  notAvailableReasonCode: RecoveryOptionReviewCode
  summary: string
}): NodeRecoveryReviewSignal {
  if (!input.possible) {
    return {
      kind: input.kind,
      possible: false,
      reviewed: input.reviewed,
      blockingIfUnreviewed: false,
      status: input.reviewed ? input.attemptedStatus : "skipped",
      reasonCode: input.reviewed ? input.attemptedReasonCode : input.notAvailableReasonCode,
      summary: input.summary,
    }
  }

  return {
    kind: input.kind,
    possible: true,
    reviewed: input.reviewed,
    blockingIfUnreviewed: input.blockingIfUnreviewed,
    status: input.reviewed ? input.attemptedStatus : "skipped",
    reasonCode: input.reviewed ? input.attemptedReasonCode : input.unreviewedReasonCode,
    summary: input.summary,
  }
}

function signalToAttemptRecord(
  signal: NodeRecoveryReviewSignal,
  workOrder: WorkOrder,
  at: EnterpriseTimestamp,
  index: number,
): AttemptRecord {
  return {
    attemptId: `attempt:${workOrder.workOrderId}:${index + 1}:${signal.kind}`,
    kind: signal.kind,
    status: signal.status,
    at,
    reasonCode: signal.reasonCode,
    summary: signal.summary,
    target: workOrder.to,
  }
}

function signalAttempted(signals: NodeRecoveryReviewSignal[], kind: AttemptKind): boolean {
  return signals.find((signal) => signal.kind === kind)?.reviewed === true
}
