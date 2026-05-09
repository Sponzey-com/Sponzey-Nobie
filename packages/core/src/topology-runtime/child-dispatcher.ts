import type {
  NodeContract,
  NodeResultReport,
  NodeResultStatus,
  NodeRuntimeState,
  TraceEvent,
} from "../contracts/enterprise-topology.js"
import type { CompiledTopologySnapshot } from "../topology/compiler.js"
import type {
  DelegationPlan,
  PlannedChildWorkOrder,
} from "./delegation-planner.js"
import {
  isTopologyChildFailureStatus,
} from "./delegation-planner.js"
import {
  createWorkOrderRuntimeEnvelope,
  type WorkOrderAuthorityPreflightInput,
  type WorkOrderRuntimeBridgeIssue,
  type WorkOrderRuntimeEnvelope,
} from "./work-order.js"

export type ChildDispatchStatus = "completed" | "partial_success" | "failed_candidate" | "permission_limited"

export interface ChildRuntimeRunnerInput {
  planItem: PlannedChildWorkOrder
  childNodeContractSnapshot: NodeContract
  childEnvelope: WorkOrderRuntimeEnvelope
  compiledTopologySnapshot: CompiledTopologySnapshot
}

export interface ChildRuntimeRunnerResult {
  status: NodeResultStatus
  finalState?: NodeRuntimeState
  nodeResultReport?: NodeResultReport
  traceEvents?: TraceEvent[]
  risksOrGaps?: string[]
}

export type ChildRuntimeRunner =
  (input: ChildRuntimeRunnerInput) => ChildRuntimeRunnerResult | Promise<ChildRuntimeRunnerResult>

export interface ChildDispatchResult {
  childNodeId: string
  childWorkOrderId: string
  workOrder: PlannedChildWorkOrder["workOrder"]
  status: ChildDispatchStatus
  failureCandidate: boolean
  reasonCodes: string[]
  envelope?: WorkOrderRuntimeEnvelope
  nodeResultReport?: NodeResultReport
  traceEvents: TraceEvent[]
  bridgeIssues: WorkOrderRuntimeBridgeIssue[]
  risksOrGaps: string[]
}

export interface ChildDispatchSummary {
  status: "dispatched" | "partial" | "blocked" | "skipped"
  plan: DelegationPlan
  results: ChildDispatchResult[]
  failureCandidateResults: ChildDispatchResult[]
  traceEvents: TraceEvent[]
  reasonCodes: string[]
}

export interface DispatchChildWorkOrdersInput {
  plan: DelegationPlan
  compiledTopologySnapshot: CompiledTopologySnapshot
  childNodeContractsById: Record<string, NodeContract>
  childRunner: ChildRuntimeRunner
  now?: () => number
  authorityPreflightByNodeId?: Record<string, WorkOrderAuthorityPreflightInput>
}

export async function dispatchChildWorkOrders(
  input: DispatchChildWorkOrdersInput,
): Promise<ChildDispatchSummary> {
  if (input.plan.childWorkOrders.length === 0) {
    return {
      status: input.plan.status === "skipped" ? "skipped" : "blocked",
      plan: input.plan,
      results: [],
      failureCandidateResults: [],
      traceEvents: [],
      reasonCodes: [...input.plan.reasonCodes],
    }
  }

  const results: ChildDispatchResult[] = []
  for (const planItem of input.plan.childWorkOrders) {
    const childNodeContractSnapshot = input.childNodeContractsById[planItem.childNodeId]
    if (childNodeContractSnapshot === undefined) {
      results.push({
        childNodeId: planItem.childNodeId,
        childWorkOrderId: planItem.workOrder.workOrderId,
        workOrder: planItem.workOrder,
        status: "failed_candidate",
        failureCandidate: true,
        reasonCodes: ["child_node_contract_missing"],
        traceEvents: [],
        bridgeIssues: [],
        risksOrGaps: [`child_node_contract_missing:${planItem.childNodeId}`],
      })
      continue
    }

    const envelopeResult = createWorkOrderRuntimeEnvelope({
      workOrder: planItem.workOrder,
      nodeContractSnapshot: childNodeContractSnapshot,
      compiledTopologySnapshot: input.compiledTopologySnapshot,
      commandRequestId: `command:${planItem.workOrder.workOrderId}`,
      subSessionId: `sub-session:${planItem.workOrder.workOrderId}`,
      ...(input.authorityPreflightByNodeId?.[planItem.childNodeId] !== undefined
        ? { authorityPreflight: input.authorityPreflightByNodeId[planItem.childNodeId] }
        : {}),
      ...(input.now !== undefined ? { now: input.now } : {}),
    })

    if (!envelopeResult.ok) {
      results.push({
        childNodeId: planItem.childNodeId,
        childWorkOrderId: planItem.workOrder.workOrderId,
        workOrder: planItem.workOrder,
        status: "failed_candidate",
        failureCandidate: true,
        reasonCodes: envelopeResult.issues.map((issue) => issue.reasonCode ?? issue.code),
        traceEvents: [],
        bridgeIssues: envelopeResult.issues,
        risksOrGaps: envelopeResult.issues.map((issue) => `${issue.code}:${issue.reasonCode ?? "unknown"}`),
      })
      continue
    }

    const childResult = await input.childRunner({
      planItem,
      childNodeContractSnapshot,
      childEnvelope: envelopeResult.envelope,
      compiledTopologySnapshot: input.compiledTopologySnapshot,
    })
    const failureCandidate = isTopologyChildFailureStatus(childResult.status)
    results.push({
      childNodeId: planItem.childNodeId,
      childWorkOrderId: planItem.workOrder.workOrderId,
      workOrder: planItem.workOrder,
      status: normalizeChildDispatchStatus(childResult.status),
      failureCandidate,
      reasonCodes: [
        ...planItem.reasonCodes,
        failureCandidate ? "child_result_failure_candidate" : "child_result_completed",
      ],
      envelope: envelopeResult.envelope,
      ...(childResult.nodeResultReport !== undefined ? { nodeResultReport: childResult.nodeResultReport } : {}),
      traceEvents: childResult.traceEvents ?? [],
      bridgeIssues: [],
      risksOrGaps: childResult.risksOrGaps ?? childResult.nodeResultReport?.risksOrGaps ?? [],
    })
  }

  const failureCandidateResults = results.filter((result) => result.failureCandidate)
  const status =
    results.length === 0
      ? "blocked"
      : failureCandidateResults.length > 0
        ? "partial"
        : "dispatched"

  return {
    status,
    plan: input.plan,
    results,
    failureCandidateResults,
    traceEvents: results.flatMap((result) => result.traceEvents),
    reasonCodes: [
      ...input.plan.reasonCodes,
      status === "dispatched" ? "child_dispatch_completed" : status === "partial" ? "child_dispatch_partial" : "child_dispatch_blocked",
    ],
  }
}

function normalizeChildDispatchStatus(status: NodeResultStatus): ChildDispatchStatus {
  if (status === "completed") return "completed"
  if (status === "partial_success") return "partial_success"
  if (status === "permission_limited") return "permission_limited"
  return "failed_candidate"
}
