import { recordQueueBackpressureEvent } from "./queue-backpressure.js";
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
        recordQueueBackpressureEvent({
            queueName: "diagnostic",
            eventKind: "queued",
            actionTaken: "wait_recovery",
            runId: params.runId,
            recoveryKey: `run:${params.runId}:recovery`,
            pendingCount: 1,
        });
    }
    const next = (previous ?? Promise.resolve())
        .catch(() => undefined)
        .then(() => {
        appendRecoveryQueueEvent(dependencies, params.runId, "recovery_queue_running");
        recordQueueBackpressureEvent({
            queueName: "diagnostic",
            eventKind: "running",
            actionTaken: "run_recovery",
            runId: params.runId,
            recoveryKey: `run:${params.runId}:recovery`,
        });
        return params.task();
    })
        .finally(() => {
        if (runRecoveryQueues.get(params.runId) === next) {
            runRecoveryQueues.delete(params.runId);
        }
        appendRecoveryQueueEvent(dependencies, params.runId, "recovery_queue_released");
        recordQueueBackpressureEvent({
            queueName: "diagnostic",
            eventKind: "completed",
            actionTaken: "release_recovery",
            runId: params.runId,
            recoveryKey: `run:${params.runId}:recovery`,
        });
    });
    runRecoveryQueues.set(params.runId, next);
    return next;
}
//# sourceMappingURL=recovery-queue.js.map