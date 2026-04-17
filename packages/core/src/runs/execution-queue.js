import { recordQueueBackpressureEvent } from "./queue-backpressure.js";
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
        recordQueueBackpressureEvent({
            queueName: "interactive_run",
            eventKind: "queued",
            actionTaken: "wait_request_group_execution",
            runId: params.runId,
            requestGroupId: params.requestGroupId,
            pendingCount: 1,
        });
    }
    const next = (previous ?? Promise.resolve(undefined))
        .catch((error) => {
        dependencies.logWarn(`previous request-group execution queue recovered: ${error instanceof Error ? error.message : String(error)}`);
        return undefined;
    })
        .then(() => {
        appendExecutionQueueEvent(dependencies, params.runId, "execution_queue_running");
        recordQueueBackpressureEvent({
            queueName: "interactive_run",
            eventKind: "running",
            actionTaken: "run_request_group_execution",
            runId: params.runId,
            requestGroupId: params.requestGroupId,
        });
        return params.task();
    })
        .catch((error) => {
        dependencies.logError("request-group execution queue task failed", {
            runId: params.runId,
            requestGroupId: params.requestGroupId,
            error: error instanceof Error ? error.message : String(error),
        });
        recordQueueBackpressureEvent({
            queueName: "interactive_run",
            eventKind: "failed",
            actionTaken: "request_group_execution_failed",
            runId: params.runId,
            requestGroupId: params.requestGroupId,
            detail: { error: error instanceof Error ? error.message : String(error) },
        });
        return dependencies.getRootRun(params.runId);
    })
        .finally(() => {
        if (requestGroupExecutionQueues.get(params.requestGroupId) === next) {
            requestGroupExecutionQueues.delete(params.requestGroupId);
        }
        appendExecutionQueueEvent(dependencies, params.runId, "execution_queue_released");
        recordQueueBackpressureEvent({
            queueName: "interactive_run",
            eventKind: "completed",
            actionTaken: "release_request_group_execution",
            runId: params.runId,
            requestGroupId: params.requestGroupId,
        });
    });
    requestGroupExecutionQueues.set(params.requestGroupId, next);
    return next;
}
//# sourceMappingURL=execution-queue.js.map