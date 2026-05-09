export function resolveAllowedNodeTools(input) {
    const nodeId = input.nodeContractSnapshot.id;
    const toolScope = input.compiledTopologySnapshot.toolScopeIndex[nodeId];
    const declaredToolIds = toolScope?.declaredToolIds ?? input.nodeContractSnapshot.allowedToolIds;
    const declaredSystemIds = toolScope?.declaredSystemIds ?? input.nodeContractSnapshot.allowedSystemIds;
    const effectiveToolIds = toolScope?.effectiveToolIds ?? input.nodeContractSnapshot.allowedToolIds;
    const effectiveSystemIds = toolScope?.effectiveSystemIds ?? input.nodeContractSnapshot.allowedSystemIds;
    const allowedToolIds = intersectStable(input.workOrder.permissionScope.allowedToolIds, effectiveToolIds);
    const allowedSystemIds = intersectStable(input.workOrder.permissionScope.allowedSystemIds, effectiveSystemIds);
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
    };
}
export function planNodeToolExecution(input) {
    const allowed = resolveAllowedNodeTools(input);
    const requested = input.toolRequests ?? allowed.allowedToolIds.map((toolId) => ({ toolId }));
    const blocked = [];
    const toolCalls = [];
    for (const request of requested) {
        const tool = input.compiledTopologySnapshot.toolIndex[request.toolId];
        const system = input.compiledTopologySnapshot.systemIndex[request.toolId];
        if (tool === undefined) {
            blocked.push({
                code: system !== undefined ? "enterprise_system_not_executable_tool" : "tool_not_found",
                reasonCode: system !== undefined ? "enterprise_system_not_executable_tool" : "tool_not_found",
                message: system !== undefined
                    ? "EnterpriseSystem is not executable as a Tool."
                    : "Requested tool is not present in compiled topology snapshot.",
                toolId: request.toolId,
            });
            continue;
        }
        if (!allowed.allowedToolIds.includes(request.toolId)) {
            blocked.push({
                code: "tool_permission_denied",
                reasonCode: "tool_permission_denied",
                message: "Requested tool is outside compiled node scope or WorkOrder permission scope.",
                toolId: request.toolId,
                ...(tool.systemId !== undefined ? { systemId: tool.systemId } : {}),
            });
            continue;
        }
        if (tool.systemId !== undefined && !allowed.allowedSystemIds.includes(tool.systemId)) {
            blocked.push({
                code: "backing_system_permission_denied",
                reasonCode: "backing_system_permission_denied",
                message: "Requested tool's backing EnterpriseSystem is outside WorkOrder permission scope.",
                toolId: request.toolId,
                systemId: tool.systemId,
            });
            continue;
        }
        const approvalRequired = isApprovalRequiredToolType(tool.toolType);
        const approvalStatus = approvalStatusForTool(input.approvalDecisionsByToolId?.[request.toolId], approvalRequired);
        if (approvalStatus === "denied" || approvalStatus === "missing") {
            blocked.push({
                code: approvalStatus === "denied" ? "tool_approval_denied" : "tool_approval_required",
                reasonCode: approvalStatus === "denied" ? "tool_approval_denied" : "tool_approval_required",
                message: approvalStatus === "denied"
                    ? "Requested tool execution approval was denied."
                    : "Requested write or external tool requires explicit approval.",
                toolId: request.toolId,
                ...(tool.systemId !== undefined ? { systemId: tool.systemId } : {}),
            });
            continue;
        }
        const timeoutMs = request.timeoutMs ?? input.defaultTimeoutMs;
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
        });
    }
    const status = toolCalls.length > 0 && blocked.length > 0
        ? "partial"
        : toolCalls.length > 0
            ? "planned"
            : blocked.length > 0
                ? "blocked"
                : "skipped";
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
    };
}
export function isApprovalRequiredToolType(toolType) {
    return toolType === "write" || toolType === "external_action" || toolType === "unknown";
}
function approvalStatusForTool(decision, approvalRequired) {
    if (!approvalRequired)
        return "not_required";
    if (decision === "approved")
        return "approved";
    if (decision === "denied")
        return "denied";
    return "missing";
}
function intersectStable(left, right) {
    return left.filter((item, index) => left.indexOf(item) === index && right.includes(item));
}
//# sourceMappingURL=tool-planner.js.map
