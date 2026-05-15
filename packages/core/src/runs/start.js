import { getConfig } from "../config/index.js";
import { intentContractFromTaskIntentEnvelope } from "../contracts/intake-adapter.js";
import { insertDiagnosticEvent } from "../db/index.js";
import { formatProviderAuditTrace, resolveProviderResolutionSnapshot } from "../ai/index.js";
import { attachCapabilityProfileToTrace, getProviderCapabilityMatrix } from "../ai/capabilities.js";
import { createLogger } from "../logger/index.js";
import { buildLatencyEventLabel, recordLatencyMetric } from "../observability/latency.js";
import { emitStandaloneAssistantMessage } from "./finalization.js";
import { executeRootRunDriver, } from "./root-run-driver.js";
import { prepareStartLaunch, } from "./start-launch.js";
import { appendRunEvent, clearActiveRunController, getRootRun, setRunStepStatus, updateRunSummary, updateRunStatus, } from "./store.js";
import { enqueueRequestGroupExecution, hasRequestGroupExecutionQueue, } from "./execution-queue.js";
import { buildStartRootRunDriverDependencies, } from "./start-driver-dependencies.js";
import { rememberRunFailure } from "./start-support.js";
import { resolveStartContextPlan } from "./preflight.js";
import { dispatchDelegatedSubAgentTasks } from "./orchestration-dispatch.js";
import { recordTopologyDispatchFollowupTrace, resolveTopologyDispatchFollowupDecision, } from "./topology-dispatch-fallback.js";
const log = createLogger("runs:start");
const syntheticApprovalScopes = new Set();
async function failStartPreflight(params) {
    appendRunEvent(params.runId, params.failure.eventLabel);
    setRunStepStatus(params.runId, "executing", "failed", params.failure.userMessage);
    updateRunStatus(params.runId, "failed", params.failure.summary, false);
    rememberRunFailure({
        runId: params.runId,
        sessionId: params.sessionId,
        source: params.source,
        summary: params.failure.summary,
        detail: params.failure.userMessage,
        title: params.failure.code,
    });
    await emitStandaloneAssistantMessage({
        runId: params.runId,
        sessionId: params.sessionId,
        text: params.failure.userMessage,
        source: params.source,
        onChunk: params.onChunk,
        dependencies: {
            appendRunEvent,
            onDeliveryError: (message) => params.logWarn(message),
        },
    });
    clearActiveRunController(params.runId);
    return getRootRun(params.runId);
}
export function startRootRun(params) {
    const sessionId = params.sessionId ?? crypto.randomUUID();
    const runId = params.runId ?? crypto.randomUUID();
    const controller = new AbortController();
    const targetId = params.targetId?.trim() ? params.targetId : undefined;
    const now = Date.now();
    const workDir = params.workDir ?? process.cwd();
    const incomingIntentContract = params.intentEnvelope
        ? intentContractFromTaskIntentEnvelope(params.intentEnvelope)
        : undefined;
    const finished = (async () => {
        const maxDelegationTurns = getConfig().orchestration.maxDelegationTurns;
        const startLaunch = await prepareStartLaunch({
            message: params.message,
            sessionId,
            runId,
            ...(params.targetRunId ? { targetRunId: params.targetRunId } : {}),
            source: params.source,
            ...(incomingIntentContract ? { incomingIntentContract } : {}),
            controller,
            now,
            maxDelegationTurns,
            ...(params.requestGroupId ? { requestGroupId: params.requestGroupId } : {}),
            ...(params.lineageRootRunId ? { lineageRootRunId: params.lineageRootRunId } : {}),
            ...(params.parentRunId ? { parentRunId: params.parentRunId } : {}),
            ...(params.originRunId ? { originRunId: params.originRunId } : {}),
            ...(params.originRequestGroupId ? { originRequestGroupId: params.originRequestGroupId } : {}),
            ...(params.forceRequestGroupReuse ? { forceRequestGroupReuse: params.forceRequestGroupReuse } : {}),
            ...(params.contextMode ? { contextMode: params.contextMode } : {}),
            ...(params.taskProfile ? { taskProfile: params.taskProfile } : {}),
            ...(params.runScope ? { runScope: params.runScope } : {}),
            ...(params.handoffSummary ? { handoffSummary: params.handoffSummary } : {}),
            ...(targetId ? { targetId } : {}),
            ...(params.targetLabel?.trim() ? { targetLabel: params.targetLabel.trim() } : {}),
            ...(params.model ? { model: params.model } : {}),
            ...(params.workerRuntime ? { workerRuntime: params.workerRuntime } : {}),
            ...(params.orchestrationPlannerIntent
                ? { orchestrationPlannerIntent: params.orchestrationPlannerIntent }
                : {}),
            ...(params.agentExecutionDecision ? { agentExecutionDecision: params.agentExecutionDecision } : {}),
            ...(params.agentExecutionDecisionTrace
                ? { agentExecutionDecisionTrace: params.agentExecutionDecisionTrace }
                : {}),
            ...(params.inboundMessage ? { inboundMessage: params.inboundMessage } : {}),
            hasRequestGroupExecutionQueue,
        });
        appendRunEvent(runId, `preflight_ms=${Date.now() - now}`);
        const providerTrace = params.providerTrace ?? (() => {
            try {
                const cfg = getConfig();
                const snapshot = resolveProviderResolutionSnapshot(params.providerId);
                const matrix = getProviderCapabilityMatrix({ connection: cfg.ai.connection, memory: cfg.memory });
                return attachCapabilityProfileToTrace(snapshot.auditTrace, matrix);
            }
            catch {
                return undefined;
            }
        })();
        if (providerTrace)
            appendRunEvent(runId, formatProviderAuditTrace(providerTrace));
        const { startPlan } = startLaunch;
        appendRunEvent(runId, `orchestration_mode: ${startPlan.orchestrationMode} (${startPlan.orchestrationRegistrySnapshot.reasonCode})`);
        if (startPlan.orchestrationRegistrySnapshot.status === "degraded") {
            try {
                insertDiagnosticEvent({
                    kind: "orchestration.registry.degraded",
                    summary: startPlan.orchestrationRegistrySnapshot.reason,
                    runId,
                    sessionId,
                    requestGroupId: startPlan.requestGroupId,
                    recoveryKey: startPlan.orchestrationRegistrySnapshot.reasonCode,
                    detail: {
                        mode: startPlan.orchestrationRegistrySnapshot.mode,
                        reasonCode: startPlan.orchestrationRegistrySnapshot.reasonCode,
                        activeSubAgentCount: startPlan.orchestrationRegistrySnapshot.activeSubAgentCount,
                    },
                });
            }
            catch (error) {
                log.warn("failed to record orchestration degraded diagnostic", {
                    runId,
                    error: error instanceof Error ? error.message : String(error),
                });
            }
        }
        for (const latencyEvent of startPlan.latencyEvents)
            appendRunEvent(runId, latencyEvent);
        const { entrySemantics, reconnectTarget, reconnectNeedsClarification, requestGroupId, isRootRequest, effectiveTaskProfile, effectiveContextMode, workerSessionId, topologyRouting, } = startPlan;
        const suppressFinalDelivery = params.runScope === "child" || Boolean(params.parentRunId);
        const effectiveOnChunk = suppressFinalDelivery ? undefined : params.onChunk;
        const queuedBehindRequestGroupRun = startLaunch.queuedBehindRequestGroupRun;
        const { syntheticApprovalRuntimeDependencies, driverDependencies } = buildStartRootRunDriverDependencies({
            runId,
            sessionId,
            requestGroupId,
            source: params.source,
            onChunk: effectiveOnChunk,
            message: params.message,
            model: params.model,
            ...(params.providerId ? { providerId: params.providerId } : {}),
            ...(params.provider ? { provider: params.provider } : {}),
            workDir,
            reuseConversationContext: entrySemantics.reuse_conversation_context,
            ...(suppressFinalDelivery ? { suppressFinalDelivery: true } : {}),
            activeQueueCancellationMode: entrySemantics.active_queue_cancellation_mode,
            startNestedRootRun: startRootRun,
            syntheticApprovalScopes,
            logInfo: (message, payload) => log.info(message, payload),
            logWarn: (message) => log.warn(message),
            logError: (message, payload) => log.error(message, payload),
        });
        const contextPlan = resolveStartContextPlan({
            source: params.source,
            message: params.message,
            ...(params.model ? { model: params.model } : {}),
            ...(params.providerId ? { providerId: params.providerId } : {}),
            ...(params.provider ? { provider: params.provider } : {}),
            ...(effectiveOnChunk ? { onChunk: effectiveOnChunk } : {}),
            ...(params.immediateCompletionText ? { immediateCompletionText: params.immediateCompletionText } : {}),
            ...(topologyRouting.mode === "route" && !params.immediateCompletionText
                ? { immediateCompletionText: "topology-runtime" }
                : {}),
            ...(params.toolsEnabled === false ? { toolsEnabled: params.toolsEnabled } : {}),
            ...(params.executionSemantics ? { executionSemantics: params.executionSemantics } : {}),
            ...(targetId ? { targetId } : {}),
            ...(params.workerRuntime ? { workerRuntime: params.workerRuntime } : {}),
            ...(params.contextMode ? { contextMode: params.contextMode } : {}),
            ...(params.runScope ? { runScope: params.runScope } : {}),
            ...(params.skipIntake ? { skipIntake: params.skipIntake } : {}),
        });
        appendRunEvent(runId, `context_plan: memory=${contextPlan.memoryScopes.join(",")}; tools=${contextPlan.toolPolicy.toolsEnabled ? "enabled" : "disabled"}; yeonjang=${contextPlan.toolPolicy.requiresYeonjang ? "required" : "not_required"}`);
        const preflightFailure = contextPlan.preflightFailure;
        if (preflightFailure) {
            return await failStartPreflight({
                failure: preflightFailure,
                runId,
                sessionId,
                source: params.source,
                onChunk: effectiveOnChunk,
                logWarn: (message) => log.warn(message),
            });
        }
        return enqueueRequestGroupExecution({
            requestGroupId,
            runId,
            task: async () => {
                const executionStartedAt = Date.now();
                let executionMessage = params.message;
                let topologyDelegatedDispatchAttempted = false;
                let topologyDispatchFollowupDecision;
                const topologyAgentIds = new Set(startPlan.orchestrationRegistrySnapshot.activeSubAgents
                    .filter((agent) => agent.source === "topology")
                    .map((agent) => agent.agentId));
                const hasTopologyDelegatedTasks = startPlan.orchestrationPlanSnapshot.delegatedTasks.some((task) => task.assignedAgentId !== undefined && topologyAgentIds.has(task.assignedAgentId));
                try {
                    if (isRootRequest &&
                        !params.parentRunId &&
                        params.runScope !== "child" &&
                        !params.skipIntake &&
                        startPlan.orchestrationMode === "orchestration" &&
                        startPlan.orchestrationPlanSnapshot.delegatedTasks.length > 0) {
                        try {
                            setRunStepStatus(runId, "executing", "running", "서브 에이전트에게 작업을 위임했고 결과를 기다리고 있습니다.");
                            updateRunStatus(runId, "running", "서브 에이전트에게 작업을 위임했고 결과를 기다리고 있습니다.", false);
                            appendRunEvent(runId, "parent_run_awaiting_child_result:sub_agent_dispatch");
                            const dispatchResult = await dispatchDelegatedSubAgentTasks({
                                plan: startPlan.orchestrationPlanSnapshot,
                                parentRunId: runId,
                                parentSessionId: sessionId,
                                parentRequestGroupId: requestGroupId,
                                source: params.source,
                                message: params.message,
                                ...(params.originalRequest ? { originalRequest: params.originalRequest } : {}),
                                workDir,
                                controller,
                            }, {
                                startSubAgentRun: startRootRun,
                                appendParentEvent: appendRunEvent,
                                updateParentSummary: updateRunSummary,
                            });
                            appendRunEvent(runId, `sub_agent_dispatch_summary:attempted=${dispatchResult.attempted};completed=${dispatchResult.completed};failed=${dispatchResult.failed};skipped=${dispatchResult.skipped}`);
                            if (hasTopologyDelegatedTasks && dispatchResult.attempted > 0) {
                                topologyDelegatedDispatchAttempted = true;
                                topologyDispatchFollowupDecision = resolveTopologyDispatchFollowupDecision({
                                    dispatchResult,
                                    plan: startPlan.orchestrationPlanSnapshot,
                                    currentExecutorId: "agent:nobie",
                                    availableDirectChildExecutorIds: topologyRouting.mode === "route"
                                        ? topologyRouting.availableDirectChildExecutorIds
                                        : [],
                                });
                                if (topologyDispatchFollowupDecision && topologyRouting.mode === "route") {
                                    const traceResult = recordTopologyDispatchFollowupTrace({
                                        decision: topologyDispatchFollowupDecision,
                                        dispatchResult,
                                        plan: startPlan.orchestrationPlanSnapshot,
                                        runId,
                                        requestGroupId,
                                        sessionId,
                                        source: params.source,
                                        topologyId: topologyRouting.topologyId,
                                        entryNodeId: topologyRouting.selectedExecutorId ?? topologyRouting.entryNodeId,
                                    });
                                    appendRunEvent(runId, `topology_dispatch_followup_trace:${traceResult.topologyRunId};decision_trace=${traceResult.decisionTraceId};events=${traceResult.traceEventCount}`);
                                }
                            }
                            const subAgentContext = dispatchResult.outcomes
                                .filter((outcome) => outcome.status !== "skipped")
                                .map((outcome) => [
                                `- task=${outcome.taskId}`,
                                outcome.agentDisplayName ? `executor=${outcome.agentDisplayName}` : undefined,
                                outcome.agentSource ? `source=${outcome.agentSource}` : undefined,
                                outcome.agentId ? `agent=${outcome.agentId}` : undefined,
                                outcome.topologyId ? `topology=${outcome.topologyId}` : undefined,
                                outcome.topologyExecutorId ? `topologyExecutor=${outcome.topologyExecutorId}` : undefined,
                                outcome.subSessionId ? `subSession=${outcome.subSessionId}` : undefined,
                                outcome.childRunId ? `childRun=${outcome.childRunId}` : undefined,
                                `status=${outcome.status}`,
                                outcome.reasonCode ? `reason=${outcome.reasonCode}` : undefined,
                                outcome.summary ? `summary=${outcome.summary}` : undefined,
                            ].filter(Boolean).join("; "))
                                .join("\n");
                            if (subAgentContext.trim()) {
                                executionMessage = `${params.message}\n\n# Sub-agent execution results\n${subAgentContext}`;
                            }
                        }
                        catch (error) {
                            appendRunEvent(runId, `sub_agent_dispatch_failed:${error instanceof Error ? error.message : String(error)}`);
                            log.warn("sub-agent dispatch failed", {
                                runId,
                                error: error instanceof Error ? error.message : String(error),
                            });
                        }
                    }
                    if (topologyDelegatedDispatchAttempted && topologyRouting.mode === "route") {
                        appendRunEvent(runId, `topology_runtime_deferred_to_sub_agent_dispatch:${topologyRouting.topologyId}:selected=${topologyRouting.selectedExecutorId ?? "unselected"}`);
                    }
                    if (topologyDispatchFollowupDecision) {
                        appendRunEvent(runId, `topology_dispatch_followup_decision:${topologyDispatchFollowupDecision.action};reason=${topologyDispatchFollowupDecision.reasonCode};failed=${topologyDispatchFollowupDecision.failedExecutorIds.join(",") || "none"}`);
                        if (topologyDispatchFollowupDecision.action === "self_solve") {
                            appendRunEvent(runId, "delegated_executor_runtime_failure_direct_current_agent:self_solve_after_delegation_failure");
                        }
                        else {
                            const summary = topologyDispatchFollowupDecision.summary;
                            updateRunSummary(runId, summary);
                            setRunStepStatus(runId, "executing", topologyDispatchFollowupDecision.action === "fail_with_reason" ? "failed" : "pending", summary);
                            updateRunStatus(runId, topologyDispatchFollowupDecision.action === "fail_with_reason" ? "failed" : "awaiting_user", summary, false);
                            appendRunEvent(runId, `topology_dispatch_followup_blocked_root_loop:${topologyDispatchFollowupDecision.action};reason=${topologyDispatchFollowupDecision.reasonCode}`);
                            return getRootRun(runId);
                        }
                    }
                    const skipIntakeForTopologyDispatch = params.skipIntake === true || topologyDelegatedDispatchAttempted;
                    const driverTopologyRouting = topologyDelegatedDispatchAttempted ? undefined : topologyRouting;
                    await executeRootRunDriver({
                        runId,
                        sessionId,
                        requestGroupId,
                        source: params.source,
                        onChunk: effectiveOnChunk,
                        controller,
                        message: executionMessage,
                        ...(params.originalRequest || executionMessage !== params.message
                            ? { originalRequest: params.originalRequest ?? params.message }
                            : {}),
                        ...(params.executionSemantics ? { executionSemantics: params.executionSemantics } : {}),
                        ...(params.structuredRequest ? { structuredRequest: params.structuredRequest } : {}),
                        ...(params.intentEnvelope ? { intentEnvelope: params.intentEnvelope } : {}),
                        currentModel: params.model,
                        currentProviderId: params.providerId,
                        currentProvider: params.provider,
                        currentTargetId: targetId,
                        currentTargetLabel: params.targetLabel,
                        workDir,
                        ...(skipIntakeForTopologyDispatch ? { skipIntake: true } : {}),
                        ...(params.immediateCompletionText ? { immediateCompletionText: params.immediateCompletionText } : {}),
                        reconnectNeedsClarification,
                        ...(reconnectTarget ? { reconnectTargetTitle: reconnectTarget.title } : {}),
                        queuedBehindRequestGroupRun,
                        activeWorkerRuntime: params.workerRuntime,
                        ...(workerSessionId ? { workerSessionId } : {}),
                        ...(params.toolsEnabled === false ? { toolsEnabled: false } : {}),
                        isRootRequest,
                        ...(suppressFinalDelivery ? { suppressFinalDelivery: true } : {}),
                        contextMode: effectiveContextMode,
                        taskProfile: effectiveTaskProfile,
                        ...(driverTopologyRouting ? { topologyRouting: driverTopologyRouting } : {}),
                        syntheticApprovalRuntimeDependencies,
                        defaultMaxDelegationTurns: getConfig().orchestration.maxDelegationTurns,
                    }, driverDependencies);
                }
                finally {
                    appendRunEvent(runId, buildLatencyEventLabel(recordLatencyMetric({
                        name: "execution_latency_ms",
                        durationMs: Date.now() - executionStartedAt,
                        runId,
                        sessionId,
                        requestGroupId,
                        source: params.source,
                    })));
                }
                return getRootRun(runId);
            },
        }, {
            getRootRun,
            appendRunEvent,
            logInfo: (message, payload) => log.info(message, payload),
            logWarn: (message) => log.warn(message),
            logError: (message, payload) => log.error(message, payload),
        });
    })().catch((error) => {
        log.error("start root run failed", {
            runId,
            sessionId,
            error: error instanceof Error ? error.message : String(error),
        });
        return undefined;
    });
    return {
        runId,
        sessionId,
        status: "started",
        finished,
    };
}
//# sourceMappingURL=start.js.map