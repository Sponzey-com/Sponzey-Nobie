import type { EnterpriseMetadata, EnterpriseTool, NodeContract, WorkOrder } from "../contracts/enterprise-topology.js";
import type { CompiledTool, CompiledTopologySnapshot } from "../topology/compiler.js";
export type NodeToolPlanStatus = "planned" | "partial" | "blocked" | "skipped";
export type NodeToolType = EnterpriseTool["toolType"];
export type NodeToolApprovalStatus = "not_required" | "approved" | "denied" | "missing";
export type NodeToolPlanIssueCode = "tool_not_found" | "enterprise_system_not_executable_tool" | "tool_permission_denied" | "backing_system_permission_denied" | "tool_approval_required" | "tool_approval_denied";
export interface NodeToolRequest {
    toolId: string;
    input?: EnterpriseMetadata;
    timeoutMs?: number;
}
export interface NodeToolPlanIssue {
    code: NodeToolPlanIssueCode;
    reasonCode: NodeToolPlanIssueCode;
    message: string;
    toolId: string;
    systemId?: string;
}
export interface PlannedNodeToolCall {
    toolId: string;
    dispatcherToolName: string;
    tool: CompiledTool;
    toolType: NodeToolType;
    systemId?: string;
    input: EnterpriseMetadata;
    timeoutMs?: number;
    approvalRequired: boolean;
    approvalStatus: NodeToolApprovalStatus;
    fallbackNodeIds: string[];
    reasonCodes: string[];
}
export interface NodeAllowedToolResolution {
    nodeId: string;
    allowedToolIds: string[];
    allowedSystemIds: string[];
    declaredToolIds: string[];
    declaredSystemIds: string[];
    effectiveToolIds: string[];
    effectiveSystemIds: string[];
    removedToolIds: string[];
    removedSystemIds: string[];
    reasonCodes: string[];
}
export interface NodeToolExecutionPlan {
    ok: boolean;
    status: NodeToolPlanStatus;
    nodeId: string;
    workOrderId: string;
    allowed: NodeAllowedToolResolution;
    toolCalls: PlannedNodeToolCall[];
    blocked: NodeToolPlanIssue[];
    reasonCodes: string[];
}
export interface PlanNodeToolExecutionInput {
    compiledTopologySnapshot: CompiledTopologySnapshot;
    nodeContractSnapshot: NodeContract;
    workOrder: WorkOrder;
    toolRequests?: NodeToolRequest[];
    defaultTimeoutMs?: number;
    dispatcherToolNameByToolId?: Record<string, string>;
    approvalDecisionsByToolId?: Record<string, "approved" | "denied">;
}
export declare function resolveAllowedNodeTools(input: {
    compiledTopologySnapshot: CompiledTopologySnapshot;
    nodeContractSnapshot: NodeContract;
    workOrder: WorkOrder;
}): NodeAllowedToolResolution;
export declare function planNodeToolExecution(input: PlanNodeToolExecutionInput): NodeToolExecutionPlan;
export declare function isApprovalRequiredToolType(toolType: NodeToolType): boolean;
//# sourceMappingURL=tool-planner.d.ts.map
