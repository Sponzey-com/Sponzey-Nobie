import { buildAgentExecutionContextFromGraphSnapshot, } from "./execution-context-builder.js";
import { buildExecutionGraphSnapshot, EXECUTION_GRAPH_ROOT_AGENT_ID, } from "./execution-graph-snapshot.js";
import { runAgentExecutionHarness, } from "./execution-harness.js";
export const DECIDE_EXECUTION_ROUTE_KINDS = [
    "delegate_to_child",
    "self_solve",
    "ask_user",
    "boundary_failure",
    "explicit_provider_target",
];
export function normalizeExplicitExecutionTarget(value) {
    const trimmed = value?.trim();
    if (!trimmed || trimmed === "auto" || trimmed === "embedded" || trimmed === "local_reasoner") {
        return undefined;
    }
    return trimmed;
}
export function isExplicitProviderExecutionTarget(value) {
    const normalized = normalizeExplicitExecutionTarget(value)?.toLowerCase();
    if (!normalized)
        return false;
    return normalized.startsWith("provider:")
        || normalized.startsWith("worker:")
        || normalized.startsWith("model:")
        || normalized === "openai"
        || normalized === "anthropic"
        || normalized === "gemini"
        || normalized === "ollama"
        || normalized === "llama"
        || normalized === "llama_cpp";
}
export async function decideExecutionRoute(input) {
    if (isExplicitProviderExecutionTarget(input.preferredTarget)) {
        const explicitRoute = input.resolveExplicitProviderTarget?.({
            preferredTarget: input.preferredTarget,
            taskProfile: input.delegatedTaskProfile,
            fallbackModel: input.fallbackModel,
        });
        if (explicitRoute && hasExplicitProviderResolution(explicitRoute)) {
            return {
                kind: "explicit_provider_target",
                route: explicitRoute,
            };
        }
    }
    const buildGraph = input.buildExecutionGraphSnapshot ?? buildExecutionGraphSnapshot;
    const executionGraph = buildGraph({
        mode: "active_deployment",
        currentExecutorId: input.currentExecutorId ?? EXECUTION_GRAPH_ROOT_AGENT_ID,
    });
    const buildContext = input.buildExecutionContext ?? buildAgentExecutionContextFromGraphSnapshot;
    const explicitTarget = normalizeExplicitExecutionTarget(input.preferredTarget);
    const explicitProviderTarget = isExplicitProviderExecutionTarget(input.preferredTarget)
        ? explicitTarget
        : undefined;
    const executionContext = buildContext({
        graph: executionGraph,
        request: buildDecisionRequest(input),
        requester: buildDecisionRequester(input),
        directExecutionRequested: false,
        ...(explicitTarget ? { explicitTargetExecutorId: explicitTarget } : {}),
        ...(explicitProviderTarget ? { explicitProviderTargetId: explicitProviderTarget } : {}),
    });
    const runHarness = input.runAgentExecutionHarness ?? runAgentExecutionHarness;
    const decisionResult = await runHarness({
        context: executionContext,
        ...(input.callModel ? { callModel: input.callModel } : {}),
    });
    const decision = decisionResult.decision;
    if (isDelegateToChildDecision(decision)) {
        const selectedExecutorId = decision.selected_executor_id;
        return {
            kind: "delegate_to_child",
            route: {
                targetId: selectedExecutorId,
                targetLabel: executorLabel(executionGraph, selectedExecutorId),
                reason: `execution_decision:${decision.execution_route}`,
            },
            agentExecutionDecision: decision,
            decisionResult,
            executionGraph,
            executionContext,
        };
    }
    return {
        kind: fallbackRouteKind(decision),
        agentExecutionDecision: decision,
        decisionResult,
        executionGraph,
        executionContext,
    };
}
export function executionDecisionTraceForResult(result) {
    return "decisionResult" in result ? result.decisionResult.decisionTrace : undefined;
}
function hasExplicitProviderResolution(route) {
    return Boolean(route.targetId?.trim() ||
        route.providerId?.trim() ||
        route.workerRuntime ||
        route.model?.trim());
}
function buildDecisionRequest(input) {
    return {
        kind: "user_message",
        latest_user_message: input.originalRequest,
        structured_goal: input.delegatedTitle.trim() || input.originalRequest,
        required_outputs: [{
                id: "answer",
                label: "사용자에게 전달할 최종 결과",
                acceptance_criteria: ["요청의 핵심 결과와 남은 이슈를 분명히 전달한다."],
            }],
        channel_id: input.sessionId,
    };
}
function buildDecisionRequester(input) {
    return {
        requester_id: input.sessionId,
        requester_type: "channel",
        display_name: input.source,
    };
}
function isDelegateToChildDecision(decision) {
    return decision.execution_route === "delegate_to_child" && Boolean(decision.selected_executor_id?.trim());
}
function fallbackRouteKind(decision) {
    if (decision.execution_route === "boundary_failure")
        return "boundary_failure";
    if (decision.execution_route === "ask_user" ||
        decision.execution_route === "ask_parent" ||
        decision.execution_route === "return_to_parent") {
        return "ask_user";
    }
    return "self_solve";
}
function executorLabel(graph, executorId) {
    return graph.agentsById[executorId]?.displayName?.trim() || executorId;
}
//# sourceMappingURL=decide-execution-route.js.map