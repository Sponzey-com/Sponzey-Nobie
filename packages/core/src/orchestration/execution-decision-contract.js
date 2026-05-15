export const AGENT_EXECUTION_DECISION_CONTRACT_VERSION = "agent-execution-decision:v1";
export const AGENT_EXECUTION_DECISION_V2_CONTRACT_VERSION = "agent-execution-decision:v2";
export const AGENT_EXECUTION_DECISION_V2_ACTIONS = [
    "delegate",
    "self_solve",
    "ask_user",
    "return_to_parent",
    "fail_with_reason",
];
export const AgentExecutionFallbackReason = {
    SelfSolve: "self_solve",
    DirectCurrentAgent: "direct_current_agent",
    DelegateToChild: "delegate_to_child",
    // Direct requester or parent executor, not root Nobie unless that executor requested the work.
    ReturnToParent: "return_to_parent",
    RootNobieDirect: "root_nobie_direct",
    ExplicitProvider: "explicit_provider",
    ExplicitProviderTarget: "explicit_provider_target",
    BoundaryFailure: "boundary_failure",
    // Legacy alias accepted for stored phase022 decisions. New decisions should
    // use root_nobie_direct when the current executor is root Nobie.
    NobieDirect: "nobie_direct",
    AskParent: "ask_parent",
    AskUser: "ask_user",
};
export const AGENT_EXECUTION_FALLBACK_REASONS = Object.freeze(Object.values(AgentExecutionFallbackReason));
export const AGENT_EXECUTION_ROUTES = [
    "self_solve",
    "direct_current_agent",
    "delegate_to_child",
    "return_to_parent",
    "root_nobie_direct",
    "explicit_provider",
    "explicit_provider_target",
    "boundary_failure",
    "nobie_direct",
    "ask_parent",
    "ask_user",
    "sub_agent",
    "yeonjang",
];
export const AGENT_EXECUTION_BEHAVIOR_PATTERNS = [
    "answer",
    "plan",
    "split",
    "delegate",
    "execute",
    "review",
    "aggregate",
    "clarify",
    "recover",
];
export const AGENT_EXECUTION_RISK_BOUNDARY_KINDS = [
    "privacy",
    "permission",
    "delete",
    "payment",
    "external_transfer",
    "local_system_control",
];
function isRecord(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
function isStringArray(value) {
    return Array.isArray(value) && value.every((item) => typeof item === "string");
}
function hasString(value) {
    return typeof value === "string" && value.trim().length > 0;
}
export function isAgentExecutionFallbackReason(value) {
    return typeof value === "string" && AGENT_EXECUTION_FALLBACK_REASONS.includes(value);
}
export function isAgentExecutionRoute(value) {
    return typeof value === "string" && AGENT_EXECUTION_ROUTES.includes(value);
}
export function normalizeAgentExecutionConfidence(value) {
    if (typeof value !== "number" || !Number.isFinite(value))
        return 0;
    if (value < 0)
        return 0;
    if (value > 1)
        return 1;
    return value;
}
export function validateAgentExecutionDecisionShape(decision) {
    const issues = [];
    if (!isRecord(decision)) {
        return { ok: false, issues: ["decision must be an object"] };
    }
    if (decision.contract_version !== AGENT_EXECUTION_DECISION_CONTRACT_VERSION) {
        issues.push("contract_version must match agent execution decision contract");
    }
    if (!hasString(decision.current_executor_id)) {
        issues.push("current_executor_id must be a non-empty string");
    }
    if (!hasString(decision.domain)) {
        issues.push("domain must be a non-empty string");
    }
    if (typeof decision.behavior_pattern !== "string" ||
        !AGENT_EXECUTION_BEHAVIOR_PATTERNS.includes(decision.behavior_pattern)) {
        issues.push("behavior_pattern must be a known behavior pattern");
    }
    if (!isAgentExecutionRoute(decision.execution_route)) {
        issues.push("execution_route must be a known execution route");
    }
    if (!isStringArray(decision.selected_connection_path)) {
        issues.push("selected_connection_path must be an array of executor ids");
    }
    if (!Array.isArray(decision.required_outputs)) {
        issues.push("required_outputs must be an array");
    }
    if (!isRecord(decision.task_profile)) {
        issues.push("task_profile must be an object");
    }
    if (!isRecord(decision.risk_boundary)) {
        issues.push("risk_boundary must be an object");
    }
    else {
        if (typeof decision.risk_boundary.requires_user_approval !== "boolean") {
            issues.push("risk_boundary.requires_user_approval must be boolean");
        }
        if (!hasString(decision.risk_boundary.reason)) {
            issues.push("risk_boundary.reason must be a non-empty string");
        }
        if (decision.risk_boundary.boundary_kind !== undefined &&
            (typeof decision.risk_boundary.boundary_kind !== "string" ||
                !AGENT_EXECUTION_RISK_BOUNDARY_KINDS.includes(decision.risk_boundary.boundary_kind))) {
            issues.push("risk_boundary.boundary_kind must be a known policy boundary");
        }
    }
    if (typeof decision.confidence !== "number" || !Number.isFinite(decision.confidence)) {
        issues.push("confidence must be a finite number");
    }
    else if (decision.confidence < 0 || decision.confidence > 1) {
        issues.push("confidence must be between 0 and 1");
    }
    if (!isAgentExecutionFallbackReason(decision.fallback_if_unavailable)) {
        issues.push("fallback_if_unavailable must be a known fallback reason");
    }
    if (!hasString(decision.reason)) {
        issues.push("reason must be a non-empty string");
    }
    return { ok: issues.length === 0, issues };
}
export function isAgentExecutionDecisionV2Action(value) {
    return typeof value === "string" && AGENT_EXECUTION_DECISION_V2_ACTIONS.includes(value);
}
export function isAgentExecutionDecisionV2(value) {
    return isRecord(value) && value.contract_version === AGENT_EXECUTION_DECISION_V2_CONTRACT_VERSION;
}
export function validateAgentExecutionDecisionV2AgainstContext(input) {
    const issues = [];
    const decision = input.decision;
    if (!isRecord(decision)) {
        return {
            ok: false,
            issues: [{
                    code: "invalid_contract_version",
                    message: "AgentExecutionDecisionV2 must be an object.",
                }],
        };
    }
    const directChildIds = new Set(input.context.execution_graph?.available_executor_ids ??
        input.context.accessible_executors.map((executor) => executor.executor_id));
    const allContextExecutorIds = new Set([
        input.context.current_executor.executor_id,
        input.context.parent_executor?.executor_id,
        ...(input.context.execution_graph?.all_active_executor_ids ?? []),
        ...(input.context.execution_graph?.all_registered_executor_ids ?? []),
        ...input.context.accessible_executors.map((executor) => executor.executor_id),
        ...(input.context.diagnostic_executors ?? []).map((executor) => executor.executor_id),
    ].filter((value) => Boolean(value?.trim())));
    if (decision.contract_version !== AGENT_EXECUTION_DECISION_V2_CONTRACT_VERSION) {
        issues.push({
            code: "invalid_contract_version",
            message: "contract_version must be agent-execution-decision:v2.",
        });
    }
    if (decision.current_executor_id !== input.context.current_executor.executor_id) {
        issues.push({
            code: "invalid_current_executor",
            message: "current_executor_id must match the current executor context.",
            ...(typeof decision.current_executor_id === "string" ? { executor_id: decision.current_executor_id } : {}),
        });
    }
    if (!isAgentExecutionDecisionV2Action(decision.action)) {
        issues.push({
            code: "invalid_action",
            message: "action must be delegate, self_solve, ask_user, return_to_parent, or fail_with_reason.",
        });
    }
    if (!isStringArray(decision.selected_executor_ids)) {
        issues.push({
            code: "missing_selected_executor",
            message: "selected_executor_ids must be an array.",
        });
    }
    else {
        if (decision.action === "delegate" && decision.selected_executor_ids.length === 0) {
            issues.push({
                code: "missing_selected_executor",
                message: "delegate action requires at least one selected executor.",
            });
        }
        for (const executorId of decision.selected_executor_ids) {
            if (!allContextExecutorIds.has(executorId)) {
                issues.push({
                    code: "selected_executor_not_in_context",
                    message: "selected_executor_ids may only reference executors in the provided graph context.",
                    executor_id: executorId,
                });
                continue;
            }
            if (!directChildIds.has(executorId)) {
                issues.push({
                    code: "selected_executor_not_direct_child",
                    message: "selected_executor_ids may only reference direct child executors.",
                    executor_id: executorId,
                });
            }
        }
    }
    if (!isStringArray(decision.selected_connection_path)) {
        issues.push({
            code: "invalid_selected_connection_path",
            message: "selected_connection_path must be an array of executor ids.",
        });
    }
    else if (decision.action === "delegate" && decision.selected_connection_path.length === 0) {
        issues.push({
            code: "invalid_selected_connection_path",
            message: "delegate action requires a non-empty selected_connection_path.",
        });
    }
    if (!isRecord(decision.task_profile)) {
        issues.push({
            code: "invalid_task_profile",
            message: "task_profile must be an object.",
        });
    }
    if (!Array.isArray(decision.required_outputs)) {
        issues.push({
            code: "invalid_required_outputs",
            message: "required_outputs must be an array.",
        });
    }
    if (!isRecord(decision.risk_boundary)) {
        issues.push({
            code: "invalid_risk_boundary",
            message: "risk_boundary must be an object.",
        });
    }
    else {
        if (typeof decision.risk_boundary.requires_user_approval !== "boolean" || !hasString(decision.risk_boundary.reason)) {
            issues.push({
                code: "invalid_risk_boundary",
                message: "risk_boundary must include requires_user_approval and a reason.",
            });
        }
    }
    if (typeof decision.confidence !== "number" || !Number.isFinite(decision.confidence) || decision.confidence < 0 || decision.confidence > 1) {
        issues.push({
            code: "invalid_confidence",
            message: "confidence must be a finite number from 0 through 1.",
        });
    }
    if (!hasString(decision.reason)) {
        issues.push({
            code: "invalid_reason",
            message: "reason must be a non-empty string.",
        });
    }
    if (decision.task_split !== undefined) {
        if (!Array.isArray(decision.task_split)) {
            issues.push({
                code: "invalid_task_split_objective",
                message: "task_split must be an array when present.",
            });
        }
        else {
            for (const unit of decision.task_split) {
                if (!isRecord(unit)) {
                    issues.push({
                        code: "invalid_task_split_objective",
                        message: "Each task_split item must be an object.",
                    });
                    continue;
                }
                const executorId = unit.executor_id;
                if (!hasString(executorId) || !directChildIds.has(executorId)) {
                    issues.push({
                        code: "invalid_task_split_executor",
                        message: "task_split executor_id must reference a direct child executor.",
                        ...(hasString(executorId) ? { executor_id: executorId } : {}),
                    });
                }
                if (!hasString(unit.objective)) {
                    issues.push({
                        code: "invalid_task_split_objective",
                        message: "Each task_split item must include a non-empty objective.",
                        ...(hasString(executorId) ? { executor_id: executorId } : {}),
                    });
                }
                if (!hasString(unit.expected_return)) {
                    issues.push({
                        code: "invalid_task_split_expected_return",
                        message: "Each task_split item must include a non-empty expected_return.",
                        ...(hasString(executorId) ? { executor_id: executorId } : {}),
                    });
                }
            }
        }
    }
    return { ok: issues.length === 0, issues };
}
export function convertAgentExecutionDecisionV2ToV1(decision) {
    const firstSelectedExecutorId = decision.selected_executor_ids[0];
    const fallback = fallbackForV2Action(decision.action);
    const unresolvedReason = decision.unresolved_reason ??
        (decision.action === "self_solve" ? decision.reason : undefined);
    return {
        contract_version: AGENT_EXECUTION_DECISION_CONTRACT_VERSION,
        current_executor_id: decision.current_executor_id,
        ...(decision.parent_executor_id ? { parent_executor_id: decision.parent_executor_id } : {}),
        domain: decision.domain,
        behavior_pattern: decision.behavior_pattern,
        execution_route: routeForV2Action(decision.action),
        ...(firstSelectedExecutorId ? { selected_executor_id: firstSelectedExecutorId } : {}),
        selected_connection_path: [...decision.selected_connection_path],
        task_profile: {
            ...decision.task_profile,
            task_units: decision.task_split?.map((unit, index) => ({
                id: `task_split:${index + 1}`,
                title: unit.objective,
                goal: unit.objective,
                preferred_executor_id: unit.executor_id,
                required_outputs: [{
                        id: `task_split:${index + 1}:return`,
                        label: unit.expected_return,
                    }],
                ...(unit.depends_on_executor_ids ? { depends_on_unit_ids: unit.depends_on_executor_ids } : {}),
            })) ?? decision.task_profile.task_units,
        },
        required_outputs: [...decision.required_outputs],
        risk_boundary: { ...decision.risk_boundary },
        confidence: decision.confidence,
        fallback_if_unavailable: fallback,
        ...(unresolvedReason ? { unresolved_reason: unresolvedReason } : {}),
        reason: decision.reason,
    };
}
function routeForV2Action(action) {
    if (action === "delegate")
        return "delegate_to_child";
    if (action === "fail_with_reason")
        return "boundary_failure";
    if (action === "ask_user")
        return "ask_user";
    if (action === "return_to_parent")
        return "return_to_parent";
    return "self_solve";
}
function fallbackForV2Action(action) {
    if (action === "delegate")
        return AgentExecutionFallbackReason.SelfSolve;
    if (action === "fail_with_reason")
        return AgentExecutionFallbackReason.BoundaryFailure;
    if (action === "ask_user")
        return AgentExecutionFallbackReason.AskUser;
    if (action === "return_to_parent")
        return AgentExecutionFallbackReason.ReturnToParent;
    return AgentExecutionFallbackReason.SelfSolve;
}
//# sourceMappingURL=execution-decision-contract.js.map