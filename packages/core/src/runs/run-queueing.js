import { resolveRunRoute } from "./routing.js";
const MAX_DELAY_TIMER_MS = 2_147_483_647;
const delayedRunTimers = new Map();
const delayedSessionQueues = new Map();
function enqueueDelayedSessionRun(params, dependencies) {
    const previous = delayedSessionQueues.get(params.sessionId);
    if (previous) {
        dependencies.logInfo("delayed run queued behind active session task", {
            jobId: params.jobId,
            sessionId: params.sessionId,
        });
    }
    const next = (previous ?? Promise.resolve())
        .catch((error) => {
        dependencies.logWarn(`previous delayed run queue recovered: ${error instanceof Error ? error.message : String(error)}`);
    })
        .then(params.task)
        .catch((error) => {
        dependencies.logError("delayed run queue task failed", {
            jobId: params.jobId,
            sessionId: params.sessionId,
            error: error instanceof Error ? error.message : String(error),
        });
    })
        .finally(() => {
        if (delayedSessionQueues.get(params.sessionId) === next) {
            delayedSessionQueues.delete(params.sessionId);
        }
    });
    delayedSessionQueues.set(params.sessionId, next);
}
export function scheduleDelayedRootRun(params, dependencies) {
    const jobId = crypto.randomUUID();
    const now = dependencies.now ?? Date.now;
    const resolveRouteImpl = dependencies.resolveRoute ?? resolveRunRoute;
    const setTimer = dependencies.setTimer ?? setTimeout;
    dependencies.logInfo("delayed run armed", {
        jobId,
        sessionId: params.sessionId,
        originRunId: params.originRunId ?? null,
        source: params.source,
        runAtMs: params.runAtMs,
        originRequestGroupId: params.originRequestGroupId ?? null,
        directDelivery: params.immediateCompletionText != null,
        preferredTarget: params.preferredTarget ?? null,
        taskProfile: params.taskProfile ?? null,
        toolsEnabled: params.toolsEnabled ?? true,
        contextMode: params.contextMode ?? "full",
    });
    const fire = () => {
        delayedRunTimers.delete(jobId);
        enqueueDelayedSessionRun({
            sessionId: params.sessionId,
            jobId,
            task: async () => {
                const route = resolveRouteImpl({
                    preferredTarget: params.preferredTarget,
                    taskProfile: params.taskProfile,
                    fallbackModel: params.model,
                });
                dependencies.logInfo("delayed run firing", {
                    jobId,
                    sessionId: params.sessionId,
                    originRunId: params.originRunId ?? null,
                    originRequestGroupId: params.originRequestGroupId ?? null,
                    targetId: route.targetId ?? null,
                    targetLabel: route.targetLabel ?? null,
                    model: route.model ?? params.model ?? null,
                    providerId: route.providerId ?? null,
                    workerRuntime: route.workerRuntime?.kind ?? null,
                    toolsEnabled: params.toolsEnabled ?? true,
                    contextMode: params.contextMode ?? "full",
                });
                const started = dependencies.startRootRun({
                    message: params.message,
                    sessionId: params.sessionId,
                    ...(params.originRunId ? { originRunId: params.originRunId } : {}),
                    ...(params.originRequestGroupId ? { originRequestGroupId: params.originRequestGroupId } : {}),
                    ...(params.taskProfile ? { taskProfile: params.taskProfile } : {}),
                    ...(params.originalRequest ? { originalRequest: params.originalRequest } : {}),
                    ...(params.executionSemantics ? { executionSemantics: params.executionSemantics } : {}),
                    ...(params.structuredRequest ? { structuredRequest: params.structuredRequest } : {}),
                    ...(params.intentEnvelope ? { intentEnvelope: params.intentEnvelope } : {}),
                    ...(params.immediateCompletionText ? { immediateCompletionText: params.immediateCompletionText } : {}),
                    model: route.model ?? params.model,
                    ...(route.providerId ? { providerId: route.providerId } : {}),
                    ...(route.provider ? { provider: route.provider } : {}),
                    ...(route.providerTrace ? { providerTrace: route.providerTrace } : {}),
                    ...(route.workerRuntime ? { workerRuntime: route.workerRuntime } : {}),
                    ...(route.targetId ? { targetId: route.targetId } : {}),
                    ...(route.targetLabel ? { targetLabel: route.targetLabel } : {}),
                    ...(params.workDir ? { workDir: params.workDir } : {}),
                    source: params.source,
                    skipIntake: true,
                    ...(params.toolsEnabled === false ? { toolsEnabled: false } : {}),
                    ...(params.contextMode ? { contextMode: params.contextMode } : {}),
                    onChunk: params.onChunk,
                });
                await started.finished;
            },
        }, dependencies);
    };
    const arm = () => {
        const remaining = params.runAtMs - now();
        if (remaining <= 0) {
            fire();
            return;
        }
        const handle = setTimer(arm, Math.min(remaining, MAX_DELAY_TIMER_MS));
        delayedRunTimers.set(jobId, handle);
    };
    arm();
}
//# sourceMappingURL=run-queueing.js.map