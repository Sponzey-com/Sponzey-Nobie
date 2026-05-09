import { AGENT_EXECUTION_DECISION_CONTRACT_VERSION, AGENT_EXECUTION_DECISION_V2_ACTIONS, AGENT_EXECUTION_DECISION_V2_CONTRACT_VERSION, AgentExecutionFallbackReason, convertAgentExecutionDecisionV2ToV1, isAgentExecutionDecisionV2, normalizeAgentExecutionConfidence, validateAgentExecutionDecisionShape, validateAgentExecutionDecisionV2AgainstContext, } from "./execution-decision-contract.js";
const DEFAULT_EXECUTION_HARNESS_TIMEOUT_MS = 30_000;
export async function createAgentExecutionDecision(input) {
    const result = await runAgentExecutionHarness(input);
    return result.decision;
}
export async function runAgentExecutionHarness(input) {
    const trace = [];
    const prompt = buildAgentExecutionDecisionPrompt(input.context);
    trace.push({ phase: "prompt_built", status: "ok", reasonCode: "accepted" });
    if (!input.callModel) {
        return buildFallbackResult({
            context: input.context,
            trace,
            reasonCode: "model_unavailable",
            detail: "No execution decision model caller was provided.",
            idProvider: input.idProvider,
        });
    }
    let rawModelOutput;
    try {
        rawModelOutput = await callModelWithTimeout({
            callModel: input.callModel,
            prompt,
            context: input.context,
            timeoutMs: input.timeoutMs ?? DEFAULT_EXECUTION_HARNESS_TIMEOUT_MS,
        });
        trace.push({ phase: "model_call", status: "ok", reasonCode: "accepted" });
    }
    catch (error) {
        const isTimeout = error instanceof AgentExecutionHarnessTimeoutError;
        return buildFallbackResult({
            context: input.context,
            trace: [
                ...trace,
                {
                    phase: "model_call",
                    status: "failed",
                    reasonCode: isTimeout ? "model_timeout" : "model_call_failed",
                    detail: error instanceof Error ? error.message : "Model call failed.",
                },
            ],
            reasonCode: isTimeout ? "model_timeout" : "model_call_failed",
            idProvider: input.idProvider,
        });
    }
    const parsed = parseAgentExecutionDecisionModelOutput(rawModelOutput);
    if (!parsed.ok) {
        return buildFallbackResult({
            context: input.context,
            trace: [
                ...trace,
                {
                    phase: "json_parse",
                    status: "failed",
                    reasonCode: "non_json_output",
                    detail: parsed.issue,
                },
            ],
            reasonCode: "non_json_output",
            rawModelOutput,
            idProvider: input.idProvider,
        });
    }
    trace.push({ phase: "json_parse", status: "ok", reasonCode: "accepted" });
    const normalized = normalizeAgentExecutionDecisionModelValue({
        context: input.context,
        value: parsed.value,
    });
    if (!normalized.ok) {
        return buildFallbackResult({
            context: input.context,
            trace: [
                ...trace,
                {
                    phase: "schema_validation",
                    status: "failed",
                    reasonCode: "schema_invalid",
                    detail: normalized.issues.join("; "),
                },
            ],
            reasonCode: "schema_invalid",
            rawModelOutput,
            idProvider: input.idProvider,
        });
    }
    const shape = validateAgentExecutionDecisionShape(normalized.decision);
    if (!shape.ok) {
        return buildFallbackResult({
            context: input.context,
            trace: [
                ...trace,
                {
                    phase: "schema_validation",
                    status: "failed",
                    reasonCode: "schema_invalid",
                    detail: shape.issues.join("; "),
                },
            ],
            reasonCode: "schema_invalid",
            rawModelOutput,
            idProvider: input.idProvider,
        });
    }
    trace.push({ phase: "schema_validation", status: "ok", reasonCode: "accepted" });
    const decision = normalized.decision;
    const delegation = validateAgentExecutionDecisionAgainstContext({
        context: input.context,
        decision,
        allowExplicitTarget: input.allowExplicitTarget ?? false,
    });
    const validation = { shape, delegation };
    if (!delegation.ok) {
        return buildFallbackResult({
            context: input.context,
            trace: [
                ...trace,
                {
                    phase: "context_validation",
                    status: "failed",
                    reasonCode: delegation.status,
                    detail: delegation.issues.map((issue) => issue.message).join("; "),
                },
            ],
            reasonCode: delegation.status,
            rawModelOutput,
            validation,
            preferredFallback: delegation.fallback_if_invalid,
            proposedDecision: decision,
            idProvider: input.idProvider,
        });
    }
    const acceptedDecision = {
        ...decision,
        confidence: normalizeAgentExecutionConfidence(decision.confidence),
    };
    return {
        ok: true,
        decision: acceptedDecision,
        decisionTrace: buildAgentExecutionDecisionTraceSnapshot({
            context: input.context,
            decision: acceptedDecision,
            validation: delegation,
            decisionSource: "nobie_harness",
        }),
        validation,
        trace: [
            ...trace,
            { phase: "context_validation", status: "ok", reasonCode: "accepted" },
        ],
        rawModelOutput,
    };
}
export function buildAgentExecutionDecisionPrompt(context) {
    return [
        "Return only one JSON object matching AgentExecutionDecisionV2.",
        "Use the provided structured context. Do not use local language-specific string rules.",
        "accessible_executors contains only direct children selectable by the current executor.",
        "For a root request, root direct children are the only delegation candidates.",
        "For a child executor request, only that executor's outgoing edge targets are delegation candidates.",
        "diagnostic_executors and all_active_executor_ids are reference-only. They must never be selected as execution candidates.",
        `Use action only from: ${AGENT_EXECUTION_DECISION_V2_ACTIONS.join(", ")}.`,
        "If action is delegate, selected_executor_ids and every task_split executor_id must be direct children from accessible_executors.",
        "If accessible_executors contains available direct children and the user did not explicitly request direct handling by the current executor, evaluate those child profiles first and delegate any meaningful unit they can own.",
        "Do not choose self_solve merely because the current executor could answer. Choose self_solve only when no available direct child profile can own a meaningful part of the work, or direct_execution_requested is true.",
        "When choosing self_solve while available direct children exist, unresolved_reason is required and must state why delegation is not suitable from the provided executor profile context.",
        "If no direct child can take the work, choose self_solve, ask_user, return_to_parent, or fail_with_reason. Do not invent provider, legacy single-agent, full-agent-list, or default workflow fallback targets.",
        "Low confidence is not a stop condition. It is a reason to choose a better path or self-solve inside the current executor's ability and allowed tools.",
        JSON.stringify({
            contract_version: AGENT_EXECUTION_DECISION_V2_CONTRACT_VERSION,
            context,
            required_decision_fields: [
                "current_executor_id",
                "parent_executor_id",
                "domain",
                "behavior_pattern",
                "action",
                "selected_executor_ids",
                "selected_connection_path",
                "task_profile",
                "task_split",
                "required_outputs",
                "risk_boundary",
                "confidence",
                "unresolved_reason",
                "reason",
            ],
            allowed_actions: AGENT_EXECUTION_DECISION_V2_ACTIONS,
        }),
    ].join("\n");
}
function normalizeAgentExecutionDecisionModelValue(input) {
    if (!isAgentExecutionDecisionV2(input.value)) {
        return {
            ok: true,
            decision: input.value,
            source: "v1",
        };
    }
    const validation = validateAgentExecutionDecisionV2AgainstContext({
        context: input.context,
        decision: input.value,
    });
    if (!validation.ok) {
        return {
            ok: false,
            issues: validation.issues.map((issue) => `${issue.code}: ${issue.message}`),
            v2Validation: validation,
        };
    }
    return {
        ok: true,
        decision: convertAgentExecutionDecisionV2ToV1(input.value),
        source: "v2",
    };
}
export function parseAgentExecutionDecisionModelOutput(output) {
    const trimmed = output.trim();
    const jsonText = extractSingleJsonObject(trimmed);
    if (!jsonText) {
        return { ok: false, issue: "Model output must be a single JSON object." };
    }
    try {
        return { ok: true, value: JSON.parse(jsonText) };
    }
    catch (error) {
        return {
            ok: false,
            issue: error instanceof Error ? error.message : "Model output is not valid JSON.",
        };
    }
}
function extractSingleJsonObject(value) {
    if (value.startsWith("{") && value.endsWith("}"))
        return value;
    const fenced = value.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
    const candidate = fenced?.[1]?.trim() ?? value;
    const start = candidate.indexOf("{");
    if (start < 0)
        return undefined;
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let index = start; index < candidate.length; index += 1) {
        const char = candidate[index];
        if (escaped) {
            escaped = false;
            continue;
        }
        if (char === "\\") {
            escaped = true;
            continue;
        }
        if (char === "\"") {
            inString = !inString;
            continue;
        }
        if (inString)
            continue;
        if (char === "{")
            depth += 1;
        if (char === "}") {
            depth -= 1;
            if (depth === 0)
                return candidate.slice(start, index + 1);
        }
    }
    return undefined;
}
export function validateAgentExecutionDecisionAgainstContext(input) {
    const issues = [];
    const currentId = input.context.current_executor.executor_id;
    const route = input.decision.execution_route;
    const selectedId = input.decision.selected_executor_id;
    const graphContext = input.context.execution_graph;
    const directChildIds = directChildExecutorIds(input.context);
    const allGraphExecutorIds = allKnownGraphExecutorIds(input.context);
    const selectedProfile = selectedId ? executorProfileById(input.context, selectedId) : undefined;
    const selectedIsSelf = selectedId === currentId;
    const selectedIsParent = selectedId === input.context.parent_executor?.executor_id;
    const selectedIsRequester = input.context.requester?.requester_type === "executor" &&
        selectedId === input.context.requester.requester_id;
    const explicitAllowed = Boolean(input.allowExplicitTarget) &&
        Boolean(selectedId) &&
        input.context.explicit_target_executor_id === selectedId;
    if (input.decision.current_executor_id !== currentId) {
        issues.push({
            code: "missing_executor",
            message: "Decision current_executor_id does not match the current executor context.",
            executor_id: input.decision.current_executor_id,
        });
    }
    if (requiresSelectedExecutor(route) && !selectedId) {
        issues.push({
            code: "missing_executor",
            message: "Selected executor is required for this execution route.",
        });
    }
    if (selectedId) {
        const selectedInGraph = allGraphExecutorIds.has(selectedId);
        const selectedIsStructuralEscape = selectedIsSelf || selectedIsParent || selectedIsRequester || explicitAllowed;
        if (graphContext && !selectedInGraph && !selectedIsStructuralEscape) {
            issues.push({
                code: "selected_executor_not_in_graph",
                message: "Selected executor does not exist in the execution graph snapshot.",
                executor_id: selectedId,
            });
        }
        else if (!graphContext && !selectedProfile && !selectedIsStructuralEscape) {
            issues.push({
                code: "missing_executor",
                message: "Selected executor is not visible from the current executor context.",
                executor_id: selectedId,
            });
        }
        if (graphContext &&
            !directChildIds.has(selectedId) &&
            !selectedIsStructuralEscape &&
            input.decision.selected_connection_path.length === 0) {
            issues.push({
                code: "selected_executor_not_direct_child",
                message: "Selected executor is not a direct child and no valid connection path was provided.",
                executor_id: selectedId,
                connection_path: [],
            });
        }
        if (selectedProfile && !selectedProfile.available) {
            issues.push({
                code: "executor_unavailable",
                message: "Selected executor is currently unavailable.",
                executor_id: selectedId,
            });
        }
        if (selectedIsSelf && !input.context.current_executor.available) {
            issues.push({
                code: "executor_unavailable",
                message: "Current executor is currently unavailable for self solve.",
                executor_id: selectedId,
            });
        }
    }
    if ((requiresSelectedPath(route) || input.decision.selected_connection_path.length > 0) && !explicitAllowed) {
        issues.push(...validateSelectedConnectionPath({
            context: input.context,
            selectedExecutorId: selectedId,
            route,
            rawPath: input.decision.selected_connection_path,
            issueCode: graphContext ? "selected_connection_path_invalid" : "inaccessible_connection_path",
        }));
    }
    if (route === "self_solve" &&
        input.context.current_executor.can_delegate &&
        input.context.direct_execution_requested !== true &&
        input.context.accessible_executors.some((executor) => executor.available) &&
        !input.decision.unresolved_reason?.trim()) {
        issues.push({
            code: "fallback_not_allowed",
            message: "Self-solve with available direct child executors must include unresolved_reason explaining why delegation is not suitable.",
            executor_id: currentId,
        });
    }
    issues.push(...fallbackRouteIssues(input.context, input.decision));
    if (riskBoundaryNeedsFallback(input.context, input.decision)) {
        issues.push({
            code: "risk_boundary_requires_approval",
            message: "Decision crosses a configured risk boundary without an approval route.",
        });
    }
    const uniqueIssues = dedupeDelegationIssues(issues);
    const status = firstValidationStatus(uniqueIssues);
    return {
        contract_version: AGENT_EXECUTION_DECISION_CONTRACT_VERSION,
        ok: uniqueIssues.length === 0,
        status,
        issues: uniqueIssues,
        fallback_if_invalid: fallbackReasonForValidationStatus(input.context, status),
    };
}
export function buildAgentExecutionDecisionTraceSnapshot(input) {
    const graph = input.context.execution_graph;
    const normalizedPath = normalizeSelectedConnectionPath({
        context: input.context,
        selectedExecutorId: input.decision.selected_executor_id,
        rawPath: input.decision.selected_connection_path,
    });
    return {
        contract_version: AGENT_EXECUTION_DECISION_CONTRACT_VERSION,
        decision_source: input.decisionSource ?? "nobie_harness",
        ...(graph?.graph_id ? { graph_id: graph.graph_id } : {}),
        ...(graph?.graph_source ? { graph_source: graph.graph_source } : {}),
        ...(graph?.root_executor_id ? { root_executor_id: graph.root_executor_id } : {}),
        current_executor_id: input.context.current_executor.executor_id,
        available_executor_ids: [...directChildExecutorIds(input.context)],
        diagnostic_executor_ids: graph?.diagnostic_executor_ids
            ? [...graph.diagnostic_executor_ids]
            : (input.context.diagnostic_executors ?? []).map((executor) => executor.executor_id),
        all_active_executor_ids: graph?.all_active_executor_ids
            ? [...graph.all_active_executor_ids]
            : [...allKnownGraphExecutorIds(input.context)],
        ...(graph?.all_registered_executor_ids
            ? { all_registered_executor_ids: [...graph.all_registered_executor_ids] }
            : {}),
        ...(input.decision.selected_executor_id
            ? { selected_executor_id: input.decision.selected_executor_id }
            : {}),
        selected_connection_path: [...input.decision.selected_connection_path],
        ...(normalizedPath.ok ? { normalized_connection_path: normalizedPath.fullPath } : {}),
        execution_route: input.decision.execution_route,
        fallback_if_unavailable: input.decision.fallback_if_unavailable,
        ...(input.fallbackReason ? { fallback_reason: input.fallbackReason } : {}),
        ...(input.validation
            ? {
                validation_ok: input.validation.ok,
                validation_status: input.validation.status,
                validation_issues: input.validation.issues,
            }
            : {}),
        ...(input.resolvedDecision
            ? {
                resolved_execution_route: input.resolvedDecision.execution_route,
                ...(input.resolvedDecision.selected_executor_id
                    ? { resolved_selected_executor_id: input.resolvedDecision.selected_executor_id }
                    : {}),
            }
            : {}),
    };
}
export function formatAgentExecutionDecisionTraceRunEvent(trace) {
    return [
        `execution_decision_source:${trace.decision_source}`,
        `graph_id=${trace.graph_id ?? "none"}`,
        `graph_source=${trace.graph_source ?? "none"}`,
        `current_executor=${trace.current_executor_id}`,
        `available_executors=${trace.available_executor_ids.join(",") || "none"}`,
        `selected_executor=${trace.selected_executor_id ?? "none"}`,
        `resolved_selected_executor=${trace.resolved_selected_executor_id ?? "none"}`,
        `resolved_route=${trace.resolved_execution_route ?? trace.execution_route}`,
        `fallback_reason=${trace.fallback_reason ?? trace.fallback_if_unavailable}`,
        `validation_status=${trace.validation_status ?? "unknown"}`,
    ].join("; ");
}
function directChildExecutorIds(context) {
    return new Set(context.execution_graph?.available_executor_ids ??
        context.accessible_executors.map((executor) => executor.executor_id));
}
function allKnownGraphExecutorIds(context) {
    const values = [
        context.execution_graph?.root_executor_id,
        context.execution_graph?.current_executor_id,
        ...(context.execution_graph?.all_active_executor_ids ?? []),
        ...(context.execution_graph?.all_registered_executor_ids ?? []),
        context.current_executor.executor_id,
        context.parent_executor?.executor_id,
        ...(context.requester?.requester_type === "executor" ? [context.requester.requester_id] : []),
        ...context.accessible_executors.map((executor) => executor.executor_id),
        ...(context.diagnostic_executors ?? []).map((executor) => executor.executor_id),
    ];
    return new Set(values.filter((value) => Boolean(value?.trim())));
}
function executorProfileById(context, executorId) {
    if (context.current_executor.executor_id === executorId)
        return context.current_executor;
    if (context.parent_executor?.executor_id === executorId)
        return context.parent_executor;
    return [
        ...context.accessible_executors,
        ...(context.diagnostic_executors ?? []),
    ].find((executor) => executor.executor_id === executorId);
}
function normalizeSelectedConnectionPath(input) {
    const currentId = input.context.current_executor.executor_id;
    const directChildIds = directChildExecutorIds(input.context);
    if (input.rawPath.length === 0) {
        if (input.selectedExecutorId && directChildIds.has(input.selectedExecutorId)) {
            return {
                ok: true,
                pathFromCurrentExcluded: [input.selectedExecutorId],
                fullPath: [currentId, input.selectedExecutorId],
            };
        }
        return { ok: false };
    }
    const first = input.rawPath[0];
    if (first === currentId) {
        return {
            ok: true,
            pathFromCurrentExcluded: input.rawPath.slice(1),
            fullPath: [...input.rawPath],
        };
    }
    return {
        ok: true,
        pathFromCurrentExcluded: [...input.rawPath],
        fullPath: [currentId, ...input.rawPath],
    };
}
function validateSelectedConnectionPath(input) {
    const issues = [];
    const selectedId = input.selectedExecutorId;
    const directChildIds = directChildExecutorIds(input.context);
    const normalized = normalizeSelectedConnectionPath({
        context: input.context,
        selectedExecutorId: selectedId,
        rawPath: input.rawPath,
    });
    if (!normalized.ok) {
        if (requiresSelectedPath(input.route)) {
            issues.push({
                code: selectedId ? "selected_executor_not_direct_child" : "empty_selected_path",
                message: selectedId
                    ? "Selected executor is not a direct child and no connection path was provided."
                    : "Selected connection path is required for this execution route.",
                ...(selectedId ? { executor_id: selectedId } : {}),
                connection_path: [],
            });
        }
        return issues;
    }
    const firstHop = normalized.pathFromCurrentExcluded[0];
    if (input.context.execution_graph && (!firstHop || !directChildIds.has(firstHop))) {
        issues.push({
            code: input.issueCode,
            message: "Selected connection path must first enter a direct child of the current executor.",
            connection_path: normalized.fullPath,
        });
    }
    const lastHop = normalized.pathFromCurrentExcluded.at(-1);
    if (selectedId && lastHop !== selectedId) {
        issues.push({
            code: input.issueCode,
            message: "Selected connection path must end at the selected executor.",
            executor_id: selectedId,
            connection_path: normalized.fullPath,
        });
    }
    const allowedConnections = input.context.execution_graph?.allowed_connections ??
        input.context.accessible_connections;
    for (const [fromExecutorId, toExecutorId] of pairPath(normalized.fullPath)) {
        if (!hasConnection(allowedConnections, fromExecutorId, toExecutorId)) {
            issues.push({
                code: input.issueCode,
                message: "Selected connection path uses an unavailable graph edge.",
                connection_path: [fromExecutorId, toExecutorId],
            });
        }
    }
    return issues;
}
class AgentExecutionHarnessTimeoutError extends Error {
    name = "AgentExecutionHarnessTimeoutError";
}
async function callModelWithTimeout(input) {
    const controller = new AbortController();
    let timeout;
    try {
        return await Promise.race([
            input.callModel({
                prompt: input.prompt,
                context: input.context,
                signal: controller.signal,
            }),
            new Promise((_resolve, reject) => {
                timeout = setTimeout(() => {
                    controller.abort();
                    reject(new AgentExecutionHarnessTimeoutError("Execution decision model timed out."));
                }, Math.max(1, input.timeoutMs));
            }),
        ]);
    }
    finally {
        if (timeout)
            clearTimeout(timeout);
    }
}
function buildFallbackResult(input) {
    const fallbackRoute = selectFallbackRoute({
        context: input.context,
        preferredFallback: input.preferredFallback,
        reasonCode: input.reasonCode,
    });
    const decision = buildFallbackDecision({
        context: input.context,
        route: fallbackRoute,
        reasonCode: input.reasonCode,
        detail: input.detail,
    });
    const selfSolveAttempt = fallbackRoute === AgentExecutionFallbackReason.SelfSolve ||
        fallbackRoute === AgentExecutionFallbackReason.DirectCurrentAgent ||
        fallbackRoute === AgentExecutionFallbackReason.RootNobieDirect ||
        fallbackRoute === AgentExecutionFallbackReason.NobieDirect
        ? buildSelfSolveAttempt({
            context: input.context,
            decision,
            reasonCode: input.reasonCode,
            idProvider: input.idProvider,
        })
        : undefined;
    return {
        ok: false,
        decision,
        decisionTrace: buildAgentExecutionDecisionTraceSnapshot({
            context: input.context,
            decision: input.proposedDecision ?? decision,
            validation: input.validation?.delegation,
            decisionSource: "nobie_harness",
            fallbackReason: fallbackRoute,
            resolvedDecision: decision,
        }),
        ...(input.validation ? { validation: input.validation } : {}),
        fallbackReason: input.reasonCode,
        ...(selfSolveAttempt ? { selfSolveAttempt } : {}),
        trace: [
            ...input.trace,
            {
                phase: "fallback",
                status: "fallback",
                reasonCode: input.reasonCode,
                detail: input.detail ?? `Fallback route: ${fallbackRoute}`,
            },
        ],
        ...(input.rawModelOutput !== undefined ? { rawModelOutput: input.rawModelOutput } : {}),
    };
}
function buildFallbackDecision(input) {
    const selected = selectedExecutorForFallback(input.context, input.route);
    return {
        contract_version: AGENT_EXECUTION_DECISION_CONTRACT_VERSION,
        current_executor_id: input.context.current_executor.executor_id,
        ...(input.context.parent_executor
            ? { parent_executor_id: input.context.parent_executor.executor_id }
            : {}),
        domain: "unresolved",
        behavior_pattern: input.route === "delegate_to_child" ? "delegate" : "recover",
        execution_route: fallbackRouteToExecutionRoute(input.route),
        ...(selected ? { selected_executor_id: selected } : {}),
        selected_connection_path: selectedPathForFallback(input.context, selected),
        task_profile: {
            title: "Fallback execution decision",
            summary: input.detail ?? input.reasonCode,
            goals: ["Recover from an unavailable or structurally invalid execution decision"],
            task_units: [],
            success_criteria: ["A safe next action is selected"],
        },
        required_outputs: fallbackRequiredOutputs(input.context),
        risk_boundary: {
            requires_user_approval: input.route === "ask_user" || input.route === "ask_parent",
            reason: input.reasonCode,
        },
        confidence: 0,
        fallback_if_unavailable: input.route,
        unresolved_reason: input.detail ?? input.reasonCode,
        reason: input.detail ?? input.reasonCode,
    };
}
function buildSelfSolveAttempt(input) {
    const suffix = input.idProvider?.() ?? `${input.context.current_executor.executor_id}:self-solve`;
    return {
        contract_version: AGENT_EXECUTION_DECISION_CONTRACT_VERSION,
        executor_id: input.context.current_executor.executor_id,
        task_profile: input.decision.task_profile,
        selected_tool_ids: input.context.permission_policy.allowed_tool_ids,
        status: "planned",
        unresolved_reason: input.reasonCode,
        reason: `Self-solve planned after ${input.reasonCode}. ${suffix}`,
    };
}
function selectFallbackRoute(input) {
    const hasAvailableDirectChild = Boolean(firstDelegableExecutor(input.context));
    const unsafeDirectFallback = hasAvailableDirectChild &&
        input.context.direct_execution_requested !== true &&
        isExecutionDecisionRecoveryReason(input.reasonCode);
    if (input.reasonCode === "risk_boundary_requires_approval") {
        return input.context.parent_executor
            ? AgentExecutionFallbackReason.AskParent
            : AgentExecutionFallbackReason.AskUser;
    }
    if (input.preferredFallback &&
        isFallbackRouteAllowed(input.context, input.preferredFallback) &&
        !(unsafeDirectFallback &&
            isCurrentExecutorDirectFallback(input.preferredFallback))) {
        return input.preferredFallback;
    }
    if (unsafeDirectFallback) {
        return input.context.parent_executor
            ? AgentExecutionFallbackReason.AskParent
            : AgentExecutionFallbackReason.AskUser;
    }
    if (input.context.current_executor.available) {
        return AgentExecutionFallbackReason.SelfSolve;
    }
    if (firstDelegableExecutor(input.context)) {
        return AgentExecutionFallbackReason.DelegateToChild;
    }
    if (input.context.parent_executor) {
        return AgentExecutionFallbackReason.ReturnToParent;
    }
    if (isRootCurrentExecutor(input.context)) {
        return AgentExecutionFallbackReason.RootNobieDirect;
    }
    return input.context.requester?.requester_type === "executor"
        ? AgentExecutionFallbackReason.AskParent
        : AgentExecutionFallbackReason.AskUser;
}
function isExecutionDecisionRecoveryReason(reasonCode) {
    return reasonCode !== "accepted" && reasonCode !== "risk_boundary_requires_approval";
}
function isCurrentExecutorDirectFallback(route) {
    return route === AgentExecutionFallbackReason.SelfSolve ||
        route === AgentExecutionFallbackReason.DirectCurrentAgent ||
        route === AgentExecutionFallbackReason.RootNobieDirect ||
        route === AgentExecutionFallbackReason.NobieDirect;
}
function selectedExecutorForFallback(context, route) {
    switch (route) {
        case "self_solve":
        case "direct_current_agent":
        case "root_nobie_direct":
        case "nobie_direct":
            return context.current_executor.executor_id;
        case "delegate_to_child":
            return firstDelegableExecutor(context)?.executor_id;
        case "return_to_parent":
        case "ask_parent":
            return context.parent_executor?.executor_id ??
                (context.requester?.requester_type === "executor" ? context.requester.requester_id : undefined);
        case "ask_user":
        case "explicit_provider":
            return undefined;
    }
}
function selectedPathForFallback(context, selectedExecutorId) {
    const currentId = context.current_executor.executor_id;
    if (!selectedExecutorId || selectedExecutorId === currentId)
        return [];
    return [currentId, selectedExecutorId];
}
function fallbackRequiredOutputs(context) {
    return context.request.required_outputs?.length
        ? context.request.required_outputs
        : [
            {
                id: "fallback:next-action",
                label: "Safe next action",
                acceptance_criteria: ["Fallback reason and next executor are explicit"],
            },
        ];
}
function fallbackRouteToExecutionRoute(route) {
    return route;
}
function firstDelegableExecutor(context) {
    return context.accessible_executors.find((executor) => executor.available);
}
function isRootCurrentExecutor(context) {
    return !context.parent_executor;
}
function requiresSelectedExecutor(route) {
    return route === "delegate_to_child" || route === "sub_agent" || route === "yeonjang";
}
function requiresSelectedPath(route) {
    return route === "delegate_to_child" || route === "sub_agent";
}
function fallbackRouteIssues(context, decision) {
    const issues = [];
    const routes = [
        decision.execution_route,
        decision.fallback_if_unavailable,
    ];
    for (const route of routes) {
        if ((route === "root_nobie_direct" || route === "nobie_direct") && !isRootCurrentExecutor(context)) {
            issues.push({
                code: "fallback_not_allowed",
                message: "Root Nobie direct fallback is only valid when the current executor is root Nobie.",
                executor_id: context.current_executor.executor_id,
            });
        }
        if (route === "explicit_provider" && !context.explicit_provider_target_id?.trim()) {
            issues.push({
                code: "provider_target_missing",
                message: "explicit_provider fallback requires an explicit provider target.",
            });
        }
        if ((route === "return_to_parent" || route === "ask_parent") &&
            !context.parent_executor &&
            context.requester?.requester_type !== "executor") {
            issues.push({
                code: "parent_executor_missing",
                message: "Parent fallback requires a parent executor or executor requester.",
            });
        }
    }
    return dedupeDelegationIssues(issues);
}
function dedupeDelegationIssues(issues) {
    const seen = new Set();
    const result = [];
    for (const issue of issues) {
        const key = `${issue.code}:${issue.executor_id ?? ""}:${issue.connection_path?.join(">") ?? ""}:${issue.message}`;
        if (seen.has(key))
            continue;
        seen.add(key);
        result.push(issue);
    }
    return result;
}
function isFallbackRouteAllowed(context, route) {
    return fallbackRouteIssues(context, {
        contract_version: AGENT_EXECUTION_DECISION_CONTRACT_VERSION,
        current_executor_id: context.current_executor.executor_id,
        domain: "fallback_validation",
        behavior_pattern: "recover",
        execution_route: fallbackRouteToExecutionRoute(route),
        selected_connection_path: [],
        task_profile: {
            title: "Fallback route validation",
            summary: "Validate fallback route availability.",
            goals: [],
            task_units: [],
            success_criteria: [],
        },
        required_outputs: [],
        risk_boundary: {
            requires_user_approval: false,
            reason: "fallback route validation",
        },
        confidence: 0,
        fallback_if_unavailable: route,
        reason: "fallback route validation",
    }).length === 0;
}
function hasConnection(connections, fromExecutorId, toExecutorId) {
    return connections.some((connection) => connection.from_executor_id === fromExecutorId &&
        connection.to_executor_id === toExecutorId);
}
function pairPath(path) {
    const pairs = [];
    for (let index = 0; index < path.length - 1; index += 1) {
        const fromExecutorId = path[index];
        const toExecutorId = path[index + 1];
        if (fromExecutorId === undefined || toExecutorId === undefined)
            continue;
        pairs.push([fromExecutorId, toExecutorId]);
    }
    return pairs;
}
function riskBoundaryNeedsFallback(context, decision) {
    const boundaryKind = decision.risk_boundary.boundary_kind;
    const approvalRoute = decision.execution_route === "ask_user" ||
        decision.execution_route === "ask_parent" ||
        decision.execution_route === "return_to_parent";
    if (decision.risk_boundary.requires_user_approval && !approvalRoute)
        return true;
    if (!boundaryKind)
        return false;
    const approvalRequired = context.risk_policy.approval_required_for.includes(boundaryKind);
    const blocked = context.risk_policy.blocked_without_approval?.includes(boundaryKind) ?? false;
    return (approvalRequired || blocked) && !approvalRoute;
}
function firstValidationStatus(issues) {
    if (issues.length === 0)
        return "valid";
    return issues[0]?.code ?? "permission_denied";
}
function fallbackReasonForValidationStatus(context, status) {
    if (status === "risk_boundary_requires_approval") {
        return context.parent_executor
            ? AgentExecutionFallbackReason.AskParent
            : AgentExecutionFallbackReason.AskUser;
    }
    if (status === "parent_executor_missing") {
        return context.requester?.requester_type === "executor"
            ? AgentExecutionFallbackReason.AskParent
            : AgentExecutionFallbackReason.AskUser;
    }
    if (status === "provider_target_missing") {
        return AgentExecutionFallbackReason.AskUser;
    }
    if (status === "executor_unavailable" && firstDelegableExecutor(context)) {
        return AgentExecutionFallbackReason.DelegateToChild;
    }
    if (context.current_executor.available)
        return AgentExecutionFallbackReason.SelfSolve;
    if (context.parent_executor)
        return AgentExecutionFallbackReason.ReturnToParent;
    if (isRootCurrentExecutor(context))
        return AgentExecutionFallbackReason.RootNobieDirect;
    return context.requester?.requester_type === "executor"
        ? AgentExecutionFallbackReason.AskParent
        : AgentExecutionFallbackReason.AskUser;
}
//# sourceMappingURL=execution-harness.js.map
