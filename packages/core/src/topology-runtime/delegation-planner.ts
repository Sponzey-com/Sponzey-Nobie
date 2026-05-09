import {
  type EnterpriseMetadata,
  type EnterpriseTimestamp,
  type NodeResultStatus,
  type PermissionScope,
  type WorkOrder,
} from "../contracts/enterprise-topology.js"
import {
  getCompiledChildCandidates,
  type CompiledNode,
  type CompiledTopologySnapshot,
} from "../topology/compiler.js"
import {
  buildWorkOrder,
} from "./work-order.js"

export const DEFAULT_TOPOLOGY_RUNTIME_MAX_DELEGATION_DEPTH = 5

export type DelegationPlanStatus = "planned" | "partial" | "blocked" | "skipped"
export type DelegationPlanIssueCode =
  | "parent_node_missing"
  | "child_node_missing"
  | "no_direct_child_candidates"
  | "grandchild_direct_delegation_forbidden"
  | "not_direct_child"
  | "max_delegation_depth_exceeded"

export interface DelegationPlanIssue {
  code: DelegationPlanIssueCode
  reasonCode: DelegationPlanIssueCode
  message: string
  parentNodeId: string
  childNodeId?: string
}

export interface ChildDelegationCandidate {
  parentNodeId: string
  childNode: CompiledNode
  delegationDepth: number
  reasonCodes: string[]
}

export interface PlannedChildWorkOrder {
  parentNodeId: string
  childNodeId: string
  childNode: CompiledNode
  workOrder: WorkOrder
  delegationDepth: number
  reasonCodes: string[]
}

export interface DelegationPlan {
  ok: boolean
  status: DelegationPlanStatus
  parentNodeId: string
  parentWorkOrderId: string
  parentDelegationDepth: number
  childDelegationDepth: number
  maxDelegationDepth: number
  directChildCandidates: ChildDelegationCandidate[]
  childWorkOrders: PlannedChildWorkOrder[]
  skipped: DelegationPlanIssue[]
  reasonCodes: string[]
}

export interface PlanChildDelegationInput {
  compiledTopologySnapshot: CompiledTopologySnapshot
  parentWorkOrder: WorkOrder
  parentNodeId?: string
  targetChildNodeIds?: string[]
  maxDelegationDepth?: number
  childObjectiveByNodeId?: Record<string, string>
  childInputByNodeId?: Record<string, EnterpriseMetadata>
  childWorkOrderIdByNodeId?: Record<string, string>
  now?: () => number
}

export interface TopologyNestedDelegationCompatibilityBoundary {
  topologyRuntimeBoundary: "compiled_topology_direct_child_work_order"
  existingOrchestrationBoundary: "orchestration_nested_delegation_command_request"
  sharedRules: string[]
  separatedResponsibilities: string[]
}

export function listDirectChildDelegationCandidates(input: {
  compiledTopologySnapshot: CompiledTopologySnapshot
  parentNodeId: string
  parentWorkOrder: WorkOrder
}): ChildDelegationCandidate[] {
  const childDepth = calculateWorkOrderDelegationDepth(input.parentWorkOrder) + 1
  return getCompiledChildCandidates(input.compiledTopologySnapshot, input.parentNodeId).map((childNode) => ({
    parentNodeId: input.parentNodeId,
    childNode,
    delegationDepth: childDepth,
    reasonCodes: [
      "compiled_direct_child_candidate",
      `parent_node:${input.parentNodeId}`,
      `child_node:${childNode.id}`,
    ],
  }))
}

export function planChildDelegation(input: PlanChildDelegationInput): DelegationPlan {
  const parentNodeId = input.parentNodeId ?? input.parentWorkOrder.to.id
  const parentDepth = calculateWorkOrderDelegationDepth(input.parentWorkOrder)
  const childDepth = parentDepth + 1
  const maxDelegationDepth = normalizedMaxDelegationDepth(input.maxDelegationDepth)
  const parentNode = input.compiledTopologySnapshot.nodeIndex[parentNodeId]
  const skipped: DelegationPlanIssue[] = []

  if (parentNode === undefined) {
    skipped.push({
      code: "parent_node_missing",
      reasonCode: "parent_node_missing",
      message: "Parent node is not present in compiled topology snapshot.",
      parentNodeId,
    })
    return finalizePlan({
      statusWhenNoChild: "blocked",
      parentNodeId,
      parentWorkOrder: input.parentWorkOrder,
      parentDepth,
      childDepth,
      maxDelegationDepth,
      directChildCandidates: [],
      childWorkOrders: [],
      skipped,
      reasonCodes: ["parent_node_missing"],
    })
  }

  const directChildCandidates = listDirectChildDelegationCandidates({
    compiledTopologySnapshot: input.compiledTopologySnapshot,
    parentNodeId,
    parentWorkOrder: input.parentWorkOrder,
  })
  const directChildIds = new Set(directChildCandidates.map((candidate) => candidate.childNode.id))
  const requestedChildNodeIds = input.targetChildNodeIds ?? directChildCandidates.map((candidate) => candidate.childNode.id)

  if (requestedChildNodeIds.length === 0) {
    skipped.push({
      code: "no_direct_child_candidates",
      reasonCode: "no_direct_child_candidates",
      message: "Parent node has no direct child candidates to delegate.",
      parentNodeId,
    })
    return finalizePlan({
      statusWhenNoChild: "skipped",
      parentNodeId,
      parentWorkOrder: input.parentWorkOrder,
      parentDepth,
      childDepth,
      maxDelegationDepth,
      directChildCandidates,
      childWorkOrders: [],
      skipped,
      reasonCodes: ["no_direct_child_candidates"],
    })
  }

  const childWorkOrders: PlannedChildWorkOrder[] = []
  for (const childNodeId of requestedChildNodeIds) {
    const childNode = input.compiledTopologySnapshot.nodeIndex[childNodeId]
    if (childNode === undefined) {
      skipped.push({
        code: "child_node_missing",
        reasonCode: "child_node_missing",
        message: "Requested child node is not present in compiled topology snapshot.",
        parentNodeId,
        childNodeId,
      })
      continue
    }

    if (!directChildIds.has(childNodeId)) {
      const code = isDescendantButNotDirect(input.compiledTopologySnapshot, parentNodeId, childNodeId)
        ? "grandchild_direct_delegation_forbidden"
        : "not_direct_child"
      skipped.push({
        code,
        reasonCode: code,
        message: "Topology runtime can delegate only to compiled direct child nodes.",
        parentNodeId,
        childNodeId,
      })
      continue
    }

    if (childDepth > maxDelegationDepth) {
      skipped.push({
        code: "max_delegation_depth_exceeded",
        reasonCode: "max_delegation_depth_exceeded",
        message: "Delegation depth exceeds the topology runtime depth guard.",
        parentNodeId,
        childNodeId,
      })
      continue
    }

    const childWorkOrder = buildChildWorkOrder({
      parentWorkOrder: input.parentWorkOrder,
      parentNodeId,
      childNode,
      delegationDepth: childDepth,
      ...(input.childObjectiveByNodeId?.[childNodeId] !== undefined
        ? { objective: input.childObjectiveByNodeId[childNodeId] }
        : {}),
      ...(input.childInputByNodeId?.[childNodeId] !== undefined
        ? { input: input.childInputByNodeId[childNodeId] }
        : {}),
      ...(input.childWorkOrderIdByNodeId?.[childNodeId] !== undefined
        ? { workOrderId: input.childWorkOrderIdByNodeId[childNodeId] }
        : {}),
      createdAt: input.now?.() ?? Date.now(),
    })
    childWorkOrders.push({
      parentNodeId,
      childNodeId,
      childNode,
      workOrder: childWorkOrder,
      delegationDepth: childDepth,
      reasonCodes: [
        "child_work_order_planned",
        `parent_work_order:${input.parentWorkOrder.workOrderId}`,
        `child_work_order:${childWorkOrder.workOrderId}`,
      ],
    })
  }

  return finalizePlan({
    statusWhenNoChild: "blocked",
    parentNodeId,
    parentWorkOrder: input.parentWorkOrder,
    parentDepth,
    childDepth,
    maxDelegationDepth,
    directChildCandidates,
    childWorkOrders,
    skipped,
    reasonCodes: [
      "compiled_direct_child_delegation_checked",
      ...(childWorkOrders.length > 0 ? ["child_work_orders_planned"] : []),
      ...skipped.map((issue) => issue.reasonCode),
    ],
  })
}

export function buildChildWorkOrder(input: {
  parentWorkOrder: WorkOrder
  parentNodeId: string
  childNode: CompiledNode
  delegationDepth: number
  objective?: string
  input?: EnterpriseMetadata
  workOrderId?: string
  createdAt: EnterpriseTimestamp
}): WorkOrder {
  return buildWorkOrder({
    workOrderId: input.workOrderId ?? buildChildWorkOrderId(input.parentWorkOrder, input.childNode.id),
    topologyRunId: input.parentWorkOrder.topologyRunId,
    parentWorkOrderId: input.parentWorkOrder.workOrderId,
    fromNodeId: input.parentNodeId,
    to: { type: "node", id: input.childNode.id },
    objective: input.objective ?? input.parentWorkOrder.objective,
    scope: {
      included: [...input.parentWorkOrder.scope.included],
      excluded: [...input.parentWorkOrder.scope.excluded],
    },
    input: structuredClone(input.input ?? input.parentWorkOrder.input),
    expectedOutputSchema: structuredClone(input.parentWorkOrder.expectedOutputSchema),
    successCriteria: input.parentWorkOrder.successCriteria.map((criterion) => ({
      ...criterion,
      ...(criterion.metadata !== undefined ? { metadata: structuredClone(criterion.metadata) } : {}),
    })),
    permissionScope: narrowPermissionScopeToChild(input.parentWorkOrder.permissionScope, input.childNode),
    authorityScope: {
      requiredAuthorityRuleIds: [...input.parentWorkOrder.authorityScope.requiredAuthorityRuleIds],
      approvalRequired: input.parentWorkOrder.authorityScope.approvalRequired,
      ...(input.parentWorkOrder.authorityScope.approvedBy !== undefined
        ? { approvedBy: input.parentWorkOrder.authorityScope.approvedBy.map((reference) => ({ ...reference })) }
        : {}),
    },
    failureReportRequired: input.parentWorkOrder.failureReportRequired,
    delegationPath: appendDelegationPath(input.parentWorkOrder.delegationPath, input.childNode.id),
    createdAt: input.createdAt,
  })
}

export function calculateWorkOrderDelegationDepth(workOrder: WorkOrder): number {
  const nodePath = workOrder.delegationPath.filter((item) => item.startsWith("node:"))
  const targetIndex = nodePath.lastIndexOf(workOrder.to.id)
  if (targetIndex < 0) return Math.max(0, nodePath.length - 1)
  const originOffset = nodePath.length > 1 && nodePath[0] !== workOrder.to.id ? 1 : 0
  return Math.max(0, targetIndex - originOffset)
}

export function isTopologyChildFailureStatus(status: NodeResultStatus): boolean {
  return status === "failed" || status === "failed_candidate" || status === "permission_limited"
}

export function describeTopologyNestedDelegationCompatibilityBoundary(): TopologyNestedDelegationCompatibilityBoundary {
  return {
    topologyRuntimeBoundary: "compiled_topology_direct_child_work_order",
    existingOrchestrationBoundary: "orchestration_nested_delegation_command_request",
    sharedRules: [
      "max_depth_guard",
      "parent_child_linkage_required",
      "budget_or_candidate_shrink_can_block_dispatch",
    ],
    separatedResponsibilities: [
      "topology_runtime_uses_node_contract_and_work_order_as_source_of_truth",
      "orchestration_nested_delegation_uses_agent_registry_and_command_request",
      "topology_runtime_does_not_expose_grandchild_as_parent_candidate",
    ],
  }
}

function buildChildWorkOrderId(parentWorkOrder: WorkOrder, childNodeId: string): string {
  return `${parentWorkOrder.workOrderId}:child:${childNodeId.replace(/[^A-Za-z0-9:_-]/g, "_")}`
}

function narrowPermissionScopeToChild(parentPermissionScope: PermissionScope, childNode: CompiledNode): PermissionScope {
  return {
    allowedToolIds: parentPermissionScope.allowedToolIds.filter((toolId) => childNode.allowedToolIds.includes(toolId)),
    allowedSystemIds: parentPermissionScope.allowedSystemIds.filter((systemId) => childNode.allowedSystemIds.includes(systemId)),
    dataDomainIds: [...parentPermissionScope.dataDomainIds],
    ...(parentPermissionScope.riskLevel !== undefined ? { riskLevel: parentPermissionScope.riskLevel } : {}),
  }
}

function appendDelegationPath(path: string[], childNodeId: string): string[] {
  if (path[path.length - 1] === childNodeId) return [...path]
  return [...path, childNodeId]
}

function isDescendantButNotDirect(snapshot: CompiledTopologySnapshot, parentNodeId: string, childNodeId: string): boolean {
  const scope = snapshot.delegationScopeMap[parentNodeId]
  if (scope === undefined) return false
  return scope.descendantNodeIds.includes(childNodeId) && !scope.directChildNodeIds.includes(childNodeId)
}

function normalizedMaxDelegationDepth(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value) || value < 0) {
    return DEFAULT_TOPOLOGY_RUNTIME_MAX_DELEGATION_DEPTH
  }
  return Math.floor(value)
}

function finalizePlan(input: {
  statusWhenNoChild: DelegationPlanStatus
  parentNodeId: string
  parentWorkOrder: WorkOrder
  parentDepth: number
  childDepth: number
  maxDelegationDepth: number
  directChildCandidates: ChildDelegationCandidate[]
  childWorkOrders: PlannedChildWorkOrder[]
  skipped: DelegationPlanIssue[]
  reasonCodes: string[]
}): DelegationPlan {
  const status: DelegationPlanStatus =
    input.childWorkOrders.length > 0 && input.skipped.length > 0
      ? "partial"
      : input.childWorkOrders.length > 0
        ? "planned"
        : input.statusWhenNoChild

  return {
    ok: input.childWorkOrders.length > 0 || status === "skipped",
    status,
    parentNodeId: input.parentNodeId,
    parentWorkOrderId: input.parentWorkOrder.workOrderId,
    parentDelegationDepth: input.parentDepth,
    childDelegationDepth: input.childDepth,
    maxDelegationDepth: input.maxDelegationDepth,
    directChildCandidates: input.directChildCandidates,
    childWorkOrders: input.childWorkOrders,
    skipped: input.skipped,
    reasonCodes: [...new Set(input.reasonCodes)],
  }
}
