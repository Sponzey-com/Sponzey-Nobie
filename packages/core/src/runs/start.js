import { getConfig } from "../config/index.js";
import { intentContractFromTaskIntentEnvelope } from "../contracts/intake-adapter.js";
import { detectAvailableProvider, formatProviderAuditTrace, resolveProviderResolutionSnapshot } from "../ai/index.js";
import { createLogger } from "../logger/index.js";
import { buildLatencyEventLabel, recordLatencyMetric } from "../observability/latency.js";
import { emitStandaloneAssistantMessage } from "./finalization.js";
import { executeRootRunDriver, } from "./root-run-driver.js";
import { prepareStartLaunch, } from "./start-launch.js";
import { appendRunEvent, clearActiveRunController, getRootRun, setRunStepStatus, updateRunStatus, } from "./store.js";
import { enqueueRequestGroupExecution, hasRequestGroupExecutionQueue, } from "./execution-queue.js";
import { buildStartRootRunDriverDependencies, } from "./start-driver-dependencies.js";
import { rememberRunFailure } from "./start-support.js";
import { resolveStartContextPlan } from "./preflight.js";
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
    const targetId = params.targetId ?? (params.model ? detectAvailableProvider() : undefined);
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
            hasRequestGroupExecutionQueue,
        });
        appendRunEvent(runId, `preflight_ms=${Date.now() - now}`);
        const providerTrace = params.providerTrace ?? (() => {
            try {
                return resolveProviderResolutionSnapshot(params.providerId).auditTrace;
            }
            catch {
                return undefined;
            }
        })();
        if (providerTrace)
            appendRunEvent(runId, formatProviderAuditTrace(providerTrace));
        const { startPlan } = startLaunch;
        for (const latencyEvent of startPlan.latencyEvents)
            appendRunEvent(runId, latencyEvent);
        const { entrySemantics, reconnectTarget, reconnectNeedsClarification, requestGroupId, isRootRequest, effectiveTaskProfile, effectiveContextMode, workerSessionId, } = startPlan;
        const queuedBehindRequestGroupRun = startLaunch.queuedBehindRequestGroupRun;
        const { syntheticApprovalRuntimeDependencies, driverDependencies } = buildStartRootRunDriverDependencies({
            runId,
            sessionId,
            requestGroupId,
            source: params.source,
            onChunk: params.onChunk,
            message: params.message,
            model: params.model,
            workDir,
            reuseConversationContext: entrySemantics.reuse_conversation_context,
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
            ...(params.onChunk ? { onChunk: params.onChunk } : {}),
            ...(params.immediateCompletionText ? { immediateCompletionText: params.immediateCompletionText } : {}),
            ...(params.toolsEnabled === false ? { toolsEnabled: params.toolsEnabled } : {}),
            ...(params.executionSemantics ? { executionSemantics: params.executionSemantics } : {}),
            ...(params.targetId ? { targetId: params.targetId } : {}),
            ...(params.workerRuntime ? { workerRuntime: params.workerRuntime } : {}),
        });
        appendRunEvent(runId, `context_plan: memory=${contextPlan.memoryScopes.join(",")}; tools=${contextPlan.toolPolicy.toolsEnabled ? "enabled" : "disabled"}; yeonjang=${contextPlan.toolPolicy.requiresYeonjang ? "required" : "not_required"}`);
        const preflightFailure = contextPlan.preflightFailure;
        if (preflightFailure) {
            return await failStartPreflight({
                failure: preflightFailure,
                runId,
                sessionId,
                source: params.source,
                onChunk: params.onChunk,
                logWarn: (message) => log.warn(message),
            });
        }
        return enqueueRequestGroupExecution({
            requestGroupId,
            runId,
            task: async () => {
                const executionStartedAt = Date.now();
                try {
                    await executeRootRunDriver({
                        runId,
                        sessionId,
                        requestGroupId,
                        source: params.source,
                        onChunk: params.onChunk,
                        controller,
                        message: params.message,
                        ...(params.originalRequest ? { originalRequest: params.originalRequest } : {}),
                        ...(params.executionSemantics ? { executionSemantics: params.executionSemantics } : {}),
                        ...(params.structuredRequest ? { structuredRequest: params.structuredRequest } : {}),
                        ...(params.intentEnvelope ? { intentEnvelope: params.intentEnvelope } : {}),
                        currentModel: params.model,
                        currentProviderId: params.providerId,
                        currentProvider: params.provider,
                        currentTargetId: params.targetId,
                        currentTargetLabel: params.targetLabel,
                        workDir,
                        ...(params.skipIntake ? { skipIntake: params.skipIntake } : {}),
                        ...(params.immediateCompletionText ? { immediateCompletionText: params.immediateCompletionText } : {}),
                        reconnectNeedsClarification,
                        ...(reconnectTarget ? { reconnectTargetTitle: reconnectTarget.title } : {}),
                        queuedBehindRequestGroupRun,
                        activeWorkerRuntime: params.workerRuntime,
                        ...(workerSessionId ? { workerSessionId } : {}),
                        ...(params.toolsEnabled === false ? { toolsEnabled: false } : {}),
                        isRootRequest,
                        contextMode: effectiveContextMode,
                        taskProfile: effectiveTaskProfile,
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