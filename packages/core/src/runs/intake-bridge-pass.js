import { buildScheduleRegistrationCancelledEvent, buildScheduleRegistrationCreatedEvent, } from "../scheduler/lifecycle.js";
import { detectAvailableProvider, getDefaultModel, getProvider, } from "../ai/index.js";
import { analyzeTaskIntake, } from "../agent/intake.js";
import { resolveRunRoute } from "./routing.js";
import { normalizeDirectArtifactDeliverySemantics } from "./execution-profile.js";
import { buildFollowupPrompt, createDefaultScheduleActionDependencies, executeScheduleActions, inferDelegatedTaskProfile, } from "./action-execution.js";
import { buildAgentExecutionContextFromGraphSnapshot, } from "../orchestration/execution-context-builder.js";
import { buildExecutionGraphSnapshot, EXECUTION_GRAPH_ROOT_AGENT_ID, } from "../orchestration/execution-graph-snapshot.js";
import { formatAgentExecutionDecisionTraceRunEvent, runAgentExecutionHarness, } from "../orchestration/execution-harness.js";
const defaultModuleDependencies = {
    analyzeTaskIntake,
    resolveRunRoute,
    executeScheduleActions,
    createDefaultScheduleActionDependencies,
    inferDelegatedTaskProfile,
    buildFollowupPrompt,
    buildExecutionGraphSnapshot,
    runAgentExecutionHarness,
};
function normalizedExplicitTarget(value) {
    const trimmed = value?.trim();
    if (!trimmed || trimmed === "auto" || trimmed === "embedded" || trimmed === "local_reasoner")
        return undefined;
    return trimmed;
}
function isExplicitDirectExecutionTarget(value) {
    const normalized = normalizedExplicitTarget(value)?.toLowerCase();
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
function buildExecutionDecisionModelCaller(input) {
    const providerId = input.providerId?.trim() || detectAvailableProvider();
    let provider = input.provider;
    if (!provider && providerId) {
        try {
            provider = getProvider(providerId);
        }
        catch {
            provider = undefined;
        }
    }
    if (!provider)
        return undefined;
    const model = input.model?.trim() || getDefaultModel() || provider.supportedModels[0];
    if (!model)
        return undefined;
    return async (params) => {
        let output = "";
        for await (const chunk of provider.chat({
            model,
            system: "You are Nobie's execution-decision harness. Return only the requested JSON decision object.",
            messages: [{ role: "user", content: params.prompt }],
            maxTokens: 4000,
            signal: params.signal,
        })) {
            if (chunk.type === "text_delta")
                output += chunk.delta;
        }
        return output.trim();
    };
}
function executorLabel(graph, executorId) {
    return graph.agentsById[executorId]?.displayName?.trim() || executorId;
}
function isDelegationDecision(decision) {
    return decision.execution_route === "delegate_to_child" && Boolean(decision.selected_executor_id?.trim());
}
function decisionFallbackKind(decision) {
    if (decision.execution_route === "ask_user")
        return "ask_user";
    if (decision.execution_route === "ask_parent" || decision.execution_route === "return_to_parent") {
        return "return_to_parent";
    }
    return "self_solve";
}
function resolveExplicitProviderRoute(input) {
    if (!isExplicitDirectExecutionTarget(input.preferredTarget))
        return undefined;
    return input.moduleDependencies.resolveRunRoute({
        preferredTarget: input.preferredTarget,
        taskProfile: input.delegatedTaskProfile,
        fallbackModel: input.fallbackModel,
    });
}
function recordExecutionDecisionTraceForRun(dependencies, runId, decisionRoute) {
    dependencies.recordExecutionDecisionTrace?.({
        runId,
        agentExecutionDecision: decisionRoute.agentExecutionDecision,
        executionDecisionTrace: decisionRoute.decisionResult.decisionTrace,
    });
}
async function resolveDelegatedDecisionRoute(input) {
    if (isExplicitDirectExecutionTarget(input.preferredTarget))
        return undefined;
    const buildGraph = input.moduleDependencies.buildExecutionGraphSnapshot ?? buildExecutionGraphSnapshot;
    const executionGraph = buildGraph({
        mode: "active_deployment",
        currentExecutorId: EXECUTION_GRAPH_ROOT_AGENT_ID,
    });
    const explicitTarget = normalizedExplicitTarget(input.preferredTarget);
    const context = buildAgentExecutionContextFromGraphSnapshot({
        graph: executionGraph,
        request: {
            kind: "user_message",
            latest_user_message: input.originalRequest,
            structured_goal: input.delegatedTitle.trim() || input.originalRequest,
            required_outputs: [{
                    id: "answer",
                    label: "사용자에게 전달할 최종 결과",
                    acceptance_criteria: ["요청의 핵심 결과와 남은 이슈를 분명히 전달한다."],
                }],
            channel_id: input.params.sessionId,
        },
        requester: {
            requester_id: input.params.sessionId,
            requester_type: "channel",
            display_name: input.params.source,
        },
        directExecutionRequested: false,
        ...(explicitTarget ? { explicitTargetExecutorId: explicitTarget } : {}),
    });
    const runDecisionHarness = input.moduleDependencies.runAgentExecutionHarness ?? runAgentExecutionHarness;
    const callModel = buildExecutionDecisionModelCaller({
        providerId: input.params.providerId,
        provider: input.params.provider,
        model: input.params.model,
    });
    const decisionResult = await runDecisionHarness({
        context,
        ...(callModel ? { callModel } : {}),
    });
    const decision = decisionResult.decision;
    if (!isDelegationDecision(decision)) {
        return {
            kind: decisionFallbackKind(decision),
            agentExecutionDecision: decision,
            decisionResult,
            executionGraph,
        };
    }
    const selectedExecutorId = decision.selected_executor_id;
    if (!selectedExecutorId) {
        return {
            kind: "self_solve",
            agentExecutionDecision: decision,
            decisionResult,
            executionGraph,
        };
    }
    return {
        kind: "delegate",
        route: {
            targetId: selectedExecutorId,
            targetLabel: executorLabel(executionGraph, selectedExecutorId),
            reason: `execution_decision:${decision.execution_route}`,
        },
        agentExecutionDecision: decision,
        decisionResult,
        executionGraph,
    };
}
export async function runIntakeBridgePass(params, dependencies, moduleDependencies = defaultModuleDependencies) {
    const intakeSessionId = params.requestGroupId !== params.runId || params.reuseConversationContext
        ? params.sessionId
        : undefined;
    const intake = await moduleDependencies.analyzeTaskIntake({
        userMessage: params.message,
        ...(intakeSessionId ? { sessionId: intakeSessionId } : {}),
        requestGroupId: params.requestGroupId,
        ...(params.model ? { model: params.model } : {}),
        workDir: params.workDir,
        source: params.source,
    }).catch(() => null);
    if (!intake)
        return null;
    dependencies.logInfo("intake bridge result", {
        runId: params.runId,
        sessionId: params.sessionId,
        category: intake.intent.category,
        actions: intake.action_items.map((item) => item.type),
        scheduling: intake.scheduling,
    });
    dependencies.appendRunEvent(params.runId, `Intake: ${intake.intent.category}`);
    if (intake.intent.summary.trim()) {
        dependencies.updateRunSummary(params.runId, intake.intent.summary.trim());
    }
    const replyAction = intake.action_items.find((item) => item.type === "reply");
    if (replyAction) {
        const content = getString(replyAction.payload.content);
        if (content) {
            return {
                kind: "complete",
                text: content,
                eventLabel: "intake 즉시 응답 완료",
            };
        }
    }
    const scheduleActions = intake.action_items.filter((item) => item.type === "create_schedule" || item.type === "cancel_schedule");
    const delegatedActions = intake.action_items.filter((item) => item.type === "run_task" || item.type === "delegate_agent");
    if (scheduleActions.length > 0 || delegatedActions.length > 0 || intake.intent.category === "schedule_request") {
        const responseParts = [];
        let delegatedFollowupCount = 0;
        if (scheduleActions.length > 0 || intake.intent.category === "schedule_request") {
            const scheduleResult = moduleDependencies.executeScheduleActions(scheduleActions, intake, params, moduleDependencies.createDefaultScheduleActionDependencies({
                scheduleDelayedRun: dependencies.scheduleDelayedRun,
            }));
            dependencies.logInfo("schedule action handled", {
                runId: params.runId,
                sessionId: params.sessionId,
                count: scheduleActions.length,
                ok: scheduleResult.ok,
                message: scheduleResult.message,
            });
            const shouldRetryScheduleIntake = !scheduleResult.ok
                && scheduleResult.successCount === 0
                && delegatedActions.length === 0;
            if (shouldRetryScheduleIntake) {
                return {
                    kind: "retry_intake",
                    summary: "일정 요청을 다시 분석하고 가능한 일정 방안으로 재시도합니다.",
                    reason: scheduleResult.detail || scheduleResult.message,
                    message: buildScheduleIntakeRecoveryPrompt({
                        originalRequest: params.originalRequest,
                        previousReceipt: scheduleResult.message,
                        reason: scheduleResult.detail || scheduleResult.message,
                    }),
                    remainingItems: [
                        "유효한 run_at 또는 cron 일정으로 다시 해석",
                        "필요한 경우에만 최소한의 확인 질문 생성",
                    ],
                    eventLabel: "일정 해석 실패로 재분석",
                };
            }
            if (scheduleResult.message.trim()) {
                responseParts.push(scheduleResult.message.trim());
            }
            for (const receipt of scheduleResult.receipts) {
                if (receipt.kind === "schedule_create_one_time") {
                    dependencies.emitScheduleCreated(buildScheduleRegistrationCreatedEvent({
                        runId: params.runId,
                        requestGroupId: params.requestGroupId,
                        registrationKind: "one_time",
                        title: receipt.title,
                        task: receipt.task,
                        source: receipt.source,
                        scheduleText: receipt.scheduleText,
                        runAtMs: receipt.runAtMs,
                    }));
                    continue;
                }
                if (receipt.kind === "schedule_create_recurring") {
                    dependencies.emitScheduleCreated(buildScheduleRegistrationCreatedEvent({
                        runId: receipt.originRunId,
                        requestGroupId: receipt.originRequestGroupId,
                        registrationKind: "recurring",
                        title: receipt.title,
                        task: receipt.task,
                        source: receipt.source,
                        scheduleText: receipt.scheduleText,
                        scheduleId: receipt.scheduleId,
                        cron: receipt.cron,
                        ...(receipt.targetSessionId ? { targetSessionId: receipt.targetSessionId } : {}),
                        driver: receipt.driver,
                    }));
                    continue;
                }
                dependencies.emitScheduleCancelled(buildScheduleRegistrationCancelledEvent({
                    runId: params.runId,
                    requestGroupId: params.requestGroupId,
                    cancelledScheduleIds: receipt.cancelledScheduleIds,
                    cancelledNames: receipt.cancelledNames,
                }));
            }
        }
        for (const delegatedAction of delegatedActions) {
            const delegatedExecutionSemantics = normalizeDirectArtifactDeliverySemantics({
                message: params.originalRequest,
                originalRequest: params.originalRequest,
                executionSemantics: intake.intent_envelope.execution_semantics,
                structuredRequest: intake.structured_request,
                intentEnvelope: intake.intent_envelope,
            });
            const delegatedIntentEnvelope = {
                ...intake.intent_envelope,
                execution_semantics: delegatedExecutionSemantics,
                delivery_mode: delegatedExecutionSemantics.artifactDelivery,
                requires_approval: delegatedExecutionSemantics.approvalRequired,
                approval_tool: delegatedExecutionSemantics.approvalTool,
            };
            const delegatedIntake = {
                ...intake,
                execution: {
                    ...intake.execution,
                    execution_semantics: delegatedExecutionSemantics,
                },
                intent_envelope: delegatedIntentEnvelope,
            };
            const delegatedTaskProfile = moduleDependencies.inferDelegatedTaskProfile({
                intake: delegatedIntake,
                action: delegatedAction,
            });
            const preferredTarget = getString(delegatedAction.payload.preferred_target)
                || getString(delegatedAction.payload.preferredTarget)
                || intake.intent_envelope.preferred_target;
            const explicitProviderRoute = resolveExplicitProviderRoute({
                moduleDependencies,
                preferredTarget,
                delegatedTaskProfile,
                fallbackModel: params.model,
            });
            const decisionRoute = explicitProviderRoute ? undefined : await resolveDelegatedDecisionRoute({
                params,
                moduleDependencies,
                preferredTarget,
                delegatedTitle: delegatedAction.title,
                delegatedTaskProfile,
                originalRequest: params.originalRequest,
                executionSemantics: delegatedExecutionSemantics,
            });
            if (!explicitProviderRoute && (!decisionRoute || decisionRoute.kind === "self_solve")) {
                if (decisionRoute) {
                    recordExecutionDecisionTraceForRun(dependencies, params.runId, decisionRoute);
                    dependencies.appendRunEvent(params.runId, formatAgentExecutionDecisionTraceRunEvent(decisionRoute.decisionResult.decisionTrace));
                }
                dependencies.appendRunEvent(params.runId, "execution_decision_fallback:self_solve; provider_direct_blocked_without_explicit_target");
                dependencies.logInfo("delegated follow-up self-solve fallback", {
                    runId: params.runId,
                    sessionId: params.sessionId,
                    delegatedType: delegatedAction.type,
                    delegatedTitle: delegatedAction.title,
                    delegatedTaskProfile,
                    preferredTarget: preferredTarget ?? null,
                    reason: "provider_direct_blocked_without_explicit_target",
                });
                continue;
            }
            if (decisionRoute?.kind === "ask_user") {
                recordExecutionDecisionTraceForRun(dependencies, params.runId, decisionRoute);
                dependencies.appendRunEvent(params.runId, formatAgentExecutionDecisionTraceRunEvent(decisionRoute.decisionResult.decisionTrace));
                return {
                    kind: "awaiting_user",
                    preview: decisionRoute.agentExecutionDecision.unresolved_reason
                        ?? decisionRoute.agentExecutionDecision.reason,
                    summary: "실행 전에 사용자 확인이 필요합니다.",
                    reason: decisionRoute.agentExecutionDecision.reason,
                    userMessage: decisionRoute.agentExecutionDecision.unresolved_reason
                        ?? "요청을 계속 진행하려면 필요한 조건을 확인해 주세요.",
                    eventLabel: "execution decision 사용자 확인 대기",
                };
            }
            if (decisionRoute?.kind === "return_to_parent") {
                recordExecutionDecisionTraceForRun(dependencies, params.runId, decisionRoute);
                dependencies.appendRunEvent(params.runId, formatAgentExecutionDecisionTraceRunEvent(decisionRoute.decisionResult.decisionTrace));
                return {
                    kind: "awaiting_user",
                    preview: decisionRoute.agentExecutionDecision.unresolved_reason
                        ?? decisionRoute.agentExecutionDecision.reason,
                    summary: "현재 채널 요청에는 반환할 상위 실행자가 없어 사용자 확인으로 전환합니다.",
                    reason: decisionRoute.agentExecutionDecision.reason,
                    userMessage: decisionRoute.agentExecutionDecision.unresolved_reason
                        ?? "상위 실행자에게 반환할 수 없는 요청입니다. 계속 진행할 방법을 확인해 주세요.",
                    eventLabel: "execution decision 상위 반환 불가",
                };
            }
            const route = explicitProviderRoute ?? (decisionRoute?.kind === "delegate" ? decisionRoute.route : undefined);
            if (!route)
                continue;
            const followupPrompt = moduleDependencies.buildFollowupPrompt({
                originalMessage: params.originalRequest,
                intake: delegatedIntake,
                action: delegatedAction,
                taskProfile: delegatedTaskProfile,
                ...(route.targetId ? { selectedExecutorId: route.targetId } : {}),
                ...(route.targetLabel ? { selectedExecutorLabel: route.targetLabel } : {}),
                ...(decisionRoute?.kind === "delegate"
                    ? { selectedExecutorReason: decisionRoute.agentExecutionDecision.reason }
                    : {}),
            });
            if (decisionRoute?.kind === "delegate") {
                recordExecutionDecisionTraceForRun(dependencies, params.runId, decisionRoute);
                dependencies.appendRunEvent(params.runId, formatAgentExecutionDecisionTraceRunEvent(decisionRoute.decisionResult.decisionTrace));
            }
            if (explicitProviderRoute) {
                dependencies.appendRunEvent(params.runId, `execution_decision_fallback:explicit_provider; provider_direct_allowed_with_explicit_target; target=${explicitProviderRoute.targetId ?? preferredTarget ?? "unknown"}`);
            }
            dependencies.appendRunEvent(params.runId, route.targetLabel
                ? `후속 실행 생성: ${delegatedAction.title} -> ${route.targetLabel} (${delegatedTaskProfile})`
                : `후속 실행 생성: ${delegatedAction.title} (${delegatedTaskProfile})`);
            dependencies.logInfo("delegated follow-up run created", {
                runId: params.runId,
                sessionId: params.sessionId,
                delegatedType: delegatedAction.type,
                delegatedTitle: delegatedAction.title,
                delegatedTaskProfile,
                targetId: route.targetId ?? null,
                targetLabel: route.targetLabel ?? null,
                model: route.model ?? params.model ?? null,
                providerId: route.providerId ?? null,
                workerRuntime: route.workerRuntime?.kind ?? null,
                executionGraph: decisionRoute
                    ? {
                        graphId: decisionRoute.executionGraph.graphId,
                        graphSource: decisionRoute.executionGraph.graphSource,
                        topologyId: decisionRoute.executionGraph.topologyId ?? null,
                        currentExecutorId: decisionRoute.executionGraph.currentExecutorId,
                        availableExecutorIds: decisionRoute.executionGraph.availableExecutorIds,
                    }
                    : null,
                executionDecisionSource: decisionRoute ? "nobie_harness" : null,
            });
            dependencies.incrementDelegationTurnCount(params.runId, `${delegatedAction.title} 후속 작업을 시작합니다.`);
            dependencies.startDelegatedRun({
                message: followupPrompt,
                sessionId: params.sessionId,
                taskProfile: dependencies.normalizeTaskProfile(delegatedTaskProfile),
                requestGroupId: params.requestGroupId,
                parentRunId: params.runId,
                runScope: "child",
                handoffSummary: delegatedAction.title,
                originalRequest: params.message,
                executionSemantics: delegatedExecutionSemantics,
                structuredRequest: delegatedIntake.structured_request,
                intentEnvelope: delegatedIntentEnvelope,
                model: route.model ?? params.model,
                ...(route.providerId ? { providerId: route.providerId } : {}),
                ...(route.provider ? { provider: route.provider } : {}),
                ...(route.providerTrace ? { providerTrace: route.providerTrace } : {}),
                ...(route.workerRuntime ? { workerRuntime: route.workerRuntime } : {}),
                ...(route.targetId ? { targetId: route.targetId } : {}),
                ...(route.targetLabel ? { targetLabel: route.targetLabel } : {}),
                ...(decisionRoute?.kind === "delegate" ? { agentExecutionDecision: decisionRoute.agentExecutionDecision } : {}),
                ...(decisionRoute?.kind === "delegate"
                    ? { agentExecutionDecisionTrace: decisionRoute.decisionResult.decisionTrace }
                    : {}),
                workDir: params.workDir,
                source: params.source,
                skipIntake: true,
                contextMode: "handoff",
                onChunk: params.onChunk,
            });
            delegatedFollowupCount += 1;
        }
        if (responseParts.length > 0) {
            return {
                kind: "complete",
                text: responseParts.join("\n\n"),
                eventLabel: "intake 처리 결과 전달",
            };
        }
        if (delegatedFollowupCount > 0) {
            return {
                kind: "complete_silent",
                summary: "후속 실행으로 전달되었습니다.",
                eventLabel: "intake 후속 실행 생성 완료",
            };
        }
        return null;
    }
    if (intake.user_message.mode === "clarification_receipt" || intake.user_message.mode === "failed_receipt") {
        const text = intake.user_message.text.trim();
        if (text) {
            return {
                kind: "complete",
                text,
                eventLabel: "intake 확인 응답 완료",
            };
        }
    }
    return null;
}
function buildScheduleIntakeRecoveryPrompt(params) {
    return [
        "[Schedule Intake Recovery]",
        "The previous schedule-analysis pass did not create a valid schedule action.",
        `Original user request: ${params.originalRequest}`,
        `Previous schedule receipt: ${params.previousReceipt}`,
        `Failure reason: ${params.reason}`,
        "Re-analyze this as a scheduling request.",
        "Produce a concrete create_schedule or cancel_schedule action with a valid run_at or cron value.",
        "Only ask a clarification question if a required time expression or delivery target is truly missing.",
        "Do not return a success receipt unless a schedule action can actually be executed.",
    ].join("\n\n");
}
function getString(value) {
    return typeof value === "string" && value.trim() ? value.trim() : undefined;
}
//# sourceMappingURL=intake-bridge-pass.js.map
