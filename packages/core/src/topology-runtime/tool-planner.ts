import type {
  EnterpriseMetadata,
  EnterpriseTool,
  NodeContract,
  WorkOrder,
} from "../contracts/enterprise-topology.js"
import type {
  CompiledTool,
  CompiledTopologySnapshot,
} from "../topology/compiler.js"

export type NodeToolPlanStatus = "planned" | "partial" | "blocked" | "skipped"
export type NodeToolType = EnterpriseTool["toolType"]
export type NodeToolApprovalStatus = "not_required" | "approved" | "denied" | "missing"
export type NodeToolPlanIssueCode =
  | "tool_not_found"
  | "enterprise_system_not_executable_tool"
  | "tool_permission_denied"
  | "backing_system_permission_denied"
  | "tool_approval_required"
  | "tool_approval_denied"

export interface NodeToolRequest {
  toolId: string
  input?: EnterpriseMetadata
  timeoutMs?: number
}

export interface NodeToolPlanIssue {
  code: NodeToolPlanIssueCode
  reasonCode: NodeToolPlanIssueCode
  message: string
  toolId: string
  systemId?: string
}

export interface PlannedNodeToolCall {
  toolId: string
  dispatcherToolName: string
  tool: CompiledTool
  toolType: NodeToolType
  systemId?: string
  input: EnterpriseMetadata
  timeoutMs?: number
  approvalRequired: boolean
  approvalStatus: NodeToolApprovalStatus
  fallbackNodeIds: string[]
  reasonCodes: string[]
}

export interface NodeAllowedToolResolution {
  nodeId: string
  allowedToolIds: string[]
  allowedSystemIds: string[]
  declaredToolIds: string[]
  declaredSystemIds: string[]
  effectiveToolIds: string[]
  effectiveSystemIds: string[]
  removedToolIds: string[]
  removedSystemIds: string[]
  reasonCodes: string[]
}

export interface NodeToolExecutionPlan {
  ok: boolean
  status: NodeToolPlanStatus
  nodeId: string
  workOrderId: string
  allowed: NodeAllowedToolResolution
  toolCalls: PlannedNodeToolCall[]
  blocked: NodeToolPlanIssue[]
  reasonCodes: string[]
}

export interface PlanNodeToolExecutionInput {
  compiledTopologySnapshot: CompiledTopologySnapshot
  nodeContractSnapshot: NodeContract
  workOrder: WorkOrder
  toolRequests?: NodeToolRequest[]
  defaultTimeoutMs?: number
  dispatcherToolNameByToolId?: Record<string, string>
  approvalDecisionsByToolId?: Record<string, "approved" | "denied">
}

export function resolveAllowedNodeTools(input: {
  compiledTopologySnapshot: CompiledTopologySnapshot
  nodeContractSnapshot: NodeContract
  workOrder: WorkOrder
}): NodeAllowedToolResolution {
  const nodeId = input.nodeContractSnapshot.id
  const toolScope = input.compiledTopologySnapshot.toolScopeIndex[nodeId]
  const declaredToolIds = toolScope?.declaredToolIds ?? input.nodeContractSnapshot.allowedToolIds
  const declaredSystemIds = toolScope?.declaredSystemIds ?? input.nodeContractSnapshot.allowedSystemIds
  const effectiveToolIds = toolScope?.effectiveToolIds ?? input.nodeContractSnapshot.allowedToolIds
  const effectiveSystemIds = toolScope?.effectiveSystemIds ?? input.nodeContractSnapshot.allowedSystemIds
  const allowedToolIds = intersectStable(input.workOrder.permissionScope.allowedToolIds, effectiveToolIds)
  const allowedSystemIds = intersectStable(input.workOrder.permissionScope.allowedSystemIds, effectiveSystemIds)

  return {
    nodeId,
    allowedToolIds,
    allowedSystemIds,
    declaredToolIds,
    declaredSystemIds,
    effectiveToolIds,
    effectiveSystemIds,
    removedToolIds: input.workOrder.permissionScope.allowedToolIds.filter((toolId) => !allowedToolIds.includes(toolId)),
    removedSystemIds: input.workOrder.permissionScope.allowedSystemIds.filter((systemId) => !allowedSystemIds.includes(systemId)),
    reasonCodes: [
      "compiled_tool_scope_resolved",
      "work_order_permission_scope_intersected",
      ...(toolScope !== undefined ? ["compiled_tool_scope_index_used"] : []),
    ],
  }
}

export function planNodeToolExecution(input: PlanNodeToolExecutionInput): NodeToolExecutionPlan {
  const allowed = resolveAllowedNodeTools(input)
  const requested: NodeToolRequest[] = input.toolRequests ?? allowed.allowedToolIds.map((toolId) => ({ toolId }))
  const blocked: NodeToolPlanIssue[] = []
  const toolCalls: PlannedNodeToolCall[] = []

  for (const request of requested) {
    const tool = input.compiledTopologySnapshot.toolIndex[request.toolId]
    const system = input.compiledTopologySnapshot.systemIndex[request.toolId]

    if (tool === undefined) {
      blocked.push({
        code: system !== undefined ? "enterprise_system_not_executable_tool" : "tool_not_found",
        reasonCode: system !== undefined ? "enterprise_system_not_executable_tool" : "tool_not_found",
        message: system !== undefined
          ? "EnterpriseSystem is not executable as a Tool."
          : "Requested tool is not present in compiled topology snapshot.",
        toolId: request.toolId,
      })
      continue
    }

    if (!allowed.allowedToolIds.includes(request.toolId)) {
      blocked.push({
        code: "tool_permission_denied",
        reasonCode: "tool_permission_denied",
        message: "Requested tool is outside compiled node scope or WorkOrder permission scope.",
        toolId: request.toolId,
        ...(tool.systemId !== undefined ? { systemId: tool.systemId } : {}),
      })
      continue
    }

    if (tool.systemId !== undefined && !allowed.allowedSystemIds.includes(tool.systemId)) {
      blocked.push({
        code: "backing_system_permission_denied",
        reasonCode: "backing_system_permission_denied",
        message: "Requested tool's backing EnterpriseSystem is outside WorkOrder permission scope.",
        toolId: request.toolId,
        systemId: tool.systemId,
      })
      continue
    }

    const approvalRequired = isApprovalRequiredToolType(tool.toolType)
    const approvalStatus = approvalStatusForTool(input.approvalDecisionsByToolId?.[request.toolId], approvalRequired)
    if (approvalStatus === "denied" || approvalStatus === "missing") {
      blocked.push({
        code: approvalStatus === "denied" ? "tool_approval_denied" : "tool_approval_required",
        reasonCode: approvalStatus === "denied" ? "tool_approval_denied" : "tool_approval_required",
        message: approvalStatus === "denied"
          ? "Requested tool execution approval was denied."
          : "Requested write or external tool requires explicit approval.",
        toolId: request.toolId,
        ...(tool.systemId !== undefined ? { systemId: tool.systemId } : {}),
      })
      continue
    }

    const timeoutMs = request.timeoutMs ?? input.defaultTimeoutMs
    toolCalls.push({
      toolId: request.toolId,
      dispatcherToolName: input.dispatcherToolNameByToolId?.[request.toolId] ?? request.toolId,
      tool,
      toolType: tool.toolType,
      ...(tool.systemId !== undefined ? { systemId: tool.systemId } : {}),
      input: structuredClone(request.input ?? input.workOrder.input),
      ...(timeoutMs !== undefined ? { timeoutMs } : {}),
      approvalRequired,
      approvalStatus,
      fallbackNodeIds: [...(input.nodeContractSnapshot.failurePolicy?.fallbackNodeIds ?? [])],
      reasonCodes: [
        "node_tool_call_planned",
        `tool_type:${tool.toolType}`,
        approvalRequired ? "tool_approval_policy_required" : "tool_approval_policy_not_required",
        "node_retry_policy_unbounded",
      ],
    })
  }

  const status: NodeToolPlanStatus =
    toolCalls.length > 0 && blocked.length > 0
      ? "partial"
      : toolCalls.length > 0
        ? "planned"
        : blocked.length > 0
          ? "blocked"
          : "skipped"

  return {
    ok: toolCalls.length > 0 || status === "skipped",
    status,
    nodeId: input.nodeContractSnapshot.id,
    workOrderId: input.workOrder.workOrderId,
    allowed,
    toolCalls,
    blocked,
    reasonCodes: [
      ...allowed.reasonCodes,
      ...(toolCalls.length > 0 ? ["node_tool_execution_planned"] : []),
      ...blocked.map((issue) => issue.reasonCode),
    ],
  }
}

export function isApprovalRequiredToolType(toolType: NodeToolType): boolean {
  return toolType === "write" || toolType === "external_action" || toolType === "unknown"
}

function approvalStatusForTool(
  decision: "approved" | "denied" | undefined,
  approvalRequired: boolean,
): NodeToolApprovalStatus {
  if (!approvalRequired) return "not_required"
  if (decision === "approved") return "approved"
  if (decision === "denied") return "denied"
  return "missing"
}

function intersectStable(left: string[], right: string[]): string[] {
  return left.filter((item, index) => left.indexOf(item) === index && right.includes(item))
}
