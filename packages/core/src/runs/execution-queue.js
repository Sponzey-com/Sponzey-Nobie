const requestGroupExecutionQueues = new Map();
function appendExecutionQueueEvent(dependencies, runId, message) {
    try {
        dependencies.appendRunEvent?.(runId, message);
    }
    catch {
        // Queue tracing must never block execution.
    }
}
export function hasRequestGroupExecutionQueue(requestGroupId) {
    return requestGroupExecutionQueues.has(requestGroupId);
}
export function enqueueRequestGroupExecution(params, dependencies) {
    const previous = requestGroupExecutionQueues.get(params.requestGroupId);
    if (previous) {
        dependencies.logInfo("request-group execution queued behind active execution task", {
            runId: params.runId,
            requestGroupId: params.requestGroupId,
        });
        appendExecutionQueueEvent(dependencies, params.runId, "execution_queue_waiting");
    }
    const next = (previous ?? Promise.resolve(undefined))
        .catch((error) => {
        dependencies.logWarn(`previous request-group execution queue recovered: ${error instanceof Error ? error.message : String(error)}`);
        return undefined;
    })
        .then(() => {
        appendExecutionQueueEvent(dependencies, params.runId, "execution_queue_running");
        return params.task();
    })
        .catch((error) => {
        dependencies.logError("request-group execution queue task failed", {
            runId: params.runId,
            requestGroupId: params.requestGroupId,
            error: error instanceof Error ? error.message : String(error),
        });
        return dependencies.getRootRun(params.runId);
    })
        .finally(() => {
        if (requestGroupExecutionQueues.get(params.requestGroupId) === next) {
            requestGroupExecutionQueues.delete(params.requestGroupId);
        }
        appendExecutionQueueEvent(dependencies, params.runId, "execution_queue_released");
    });
    requestGroupExecutionQueues.set(params.requestGroupId, next);
    return next;
}
//# sourceMappingURL=execution-queue.js.map