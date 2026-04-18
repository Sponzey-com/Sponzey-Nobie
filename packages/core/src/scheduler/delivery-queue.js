import { recordLatencyMetric } from "../observability/latency.js";
const scheduleDeliveryQueues = new Map();
export function buildScheduleDeliveryQueueId(params) {
    return `${params.targetChannel}:${params.targetSessionId}`;
}
export function hasScheduleDeliveryQueue(queueId) {
    return scheduleDeliveryQueues.has(queueId);
}
export function enqueueScheduledDelivery(params, dependencies) {
    const queueId = buildScheduleDeliveryQueueId({
        targetChannel: params.targetChannel,
        targetSessionId: params.targetSessionId,
    });
    const previous = scheduleDeliveryQueues.get(queueId);
    if (previous) {
        dependencies.logInfo("scheduled delivery queued behind active target", {
            queueId,
            targetChannel: params.targetChannel,
            targetSessionId: params.targetSessionId,
            scheduleId: params.scheduleId ?? null,
            scheduleRunId: params.scheduleRunId ?? null,
        });
    }
    const next = (previous ?? Promise.resolve())
        .catch((error) => {
        dependencies.logWarn(`previous scheduled delivery queue recovered: ${error instanceof Error ? error.message : String(error)}`);
    })
        .then(async () => {
        const startedAt = Date.now();
        try {
            return await params.task();
        }
        finally {
            recordLatencyMetric({
                name: "delivery_latency_ms",
                durationMs: Date.now() - startedAt,
                ...(params.scheduleRunId ? { runId: params.scheduleRunId } : {}),
                ...(params.scheduleId ? { requestGroupId: params.scheduleId } : {}),
                source: "scheduler",
                detail: {
                    queueId,
                    targetChannel: params.targetChannel,
                    targetSessionId: params.targetSessionId,
                    scheduleId: params.scheduleId ?? null,
                    scheduleRunId: params.scheduleRunId ?? null,
                },
            });
        }
    })
        .catch((error) => {
        dependencies.logError("scheduled delivery queue task failed", {
            queueId,
            targetChannel: params.targetChannel,
            targetSessionId: params.targetSessionId,
            scheduleId: params.scheduleId ?? null,
            scheduleRunId: params.scheduleRunId ?? null,
            error: error instanceof Error ? error.message : String(error),
        });
        throw error;
    })
        .finally(() => {
        if (scheduleDeliveryQueues.get(queueId) === next) {
            scheduleDeliveryQueues.delete(queueId);
        }
    });
    scheduleDeliveryQueues.set(queueId, next);
    return next;
}
//# sourceMappingURL=delivery-queue.js.map