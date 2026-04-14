interface ScheduleDeliveryQueueDependencies {
    logInfo: (message: string, payload?: Record<string, unknown>) => void;
    logWarn: (message: string) => void;
    logError: (message: string, payload?: Record<string, unknown>) => void;
}
export declare function buildScheduleDeliveryQueueId(params: {
    targetChannel: string;
    targetSessionId: string;
}): string;
export declare function hasScheduleDeliveryQueue(queueId: string): boolean;
export declare function enqueueScheduledDelivery<T>(params: {
    targetChannel: string;
    targetSessionId: string;
    scheduleId?: string;
    scheduleRunId?: string;
    task: () => Promise<T>;
}, dependencies: ScheduleDeliveryQueueDependencies): Promise<T>;
export {};
//# sourceMappingURL=delivery-queue.d.ts.map