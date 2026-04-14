const intakeSessionQueues = new Map();
function appendIntakeQueueEvent(dependencies, runId, message) {
    try {
        dependencies.appendRunEvent?.(runId, message);
    }
    catch {
        // Queue tracing must never block intake execution.
    }
}
export function hasSessionIntakeQueue(sessionId) {
    return intakeSessionQueues.has(sessionId);
}
export function enqueueSessionIntake(params, dependencies) {
    const previous = intakeSessionQueues.get(params.sessionId);
    if (previous) {
        dependencies.logInfo("session intake queued behind active intake task", {
            sessionId: params.sessionId,
            runId: params.runId,
            requestGroupId: params.requestGroupId,
        });
        appendIntakeQueueEvent(dependencies, params.runId, "intake_queue_waiting");
    }
    const next = (previous ?? Promise.resolve())
        .catch((error) => {
        dependencies.logWarn(`previous session intake queue recovered: ${error instanceof Error ? error.message : String(error)}`);
    })
        .then(() => {
        appendIntakeQueueEvent(dependencies, params.runId, "intake_queue_running");
        return params.task();
    })
        .catch((error) => {
        dependencies.logError("session intake queue task failed", {
            sessionId: params.sessionId,
            runId: params.runId,
            requestGroupId: params.requestGroupId,
            error: error instanceof Error ? error.message : String(error),
        });
        throw error;
    })
        .finally(() => {
        if (intakeSessionQueues.get(params.sessionId) === next) {
            intakeSessionQueues.delete(params.sessionId);
        }
        appendIntakeQueueEvent(dependencies, params.runId, "intake_queue_released");
    });
    intakeSessionQueues.set(params.sessionId, next);
    return next;
}
//# sourceMappingURL=intake-queue.js.map