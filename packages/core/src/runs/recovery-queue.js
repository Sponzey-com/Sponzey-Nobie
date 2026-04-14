const runRecoveryQueues = new Map();
function appendRecoveryQueueEvent(dependencies, runId, message) {
    try {
        dependencies?.appendRunEvent?.(runId, message);
    }
    catch {
        // Queue tracing must never block recovery.
    }
}
export function hasRunRecoveryQueue(runId) {
    return runRecoveryQueues.has(runId);
}
export function enqueueRunRecovery(params, dependencies) {
    const previous = runRecoveryQueues.get(params.runId);
    if (previous) {
        appendRecoveryQueueEvent(dependencies, params.runId, "recovery_queue_waiting");
    }
    const next = (previous ?? Promise.resolve())
        .catch(() => undefined)
        .then(() => {
        appendRecoveryQueueEvent(dependencies, params.runId, "recovery_queue_running");
        return params.task();
    })
        .finally(() => {
        if (runRecoveryQueues.get(params.runId) === next) {
            runRecoveryQueues.delete(params.runId);
        }
        appendRecoveryQueueEvent(dependencies, params.runId, "recovery_queue_released");
    });
    runRecoveryQueues.set(params.runId, next);
    return next;
}
//# sourceMappingURL=recovery-queue.js.map