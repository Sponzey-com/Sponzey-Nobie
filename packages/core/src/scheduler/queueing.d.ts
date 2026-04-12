interface ScheduleQueueLoggingDependencies {
    logInfo: (message: string, payload?: Record<string, unknown>) => void;
    logWarn: (message: string) => void;
    logError: (message: string, payload?: Record<string, unknown>) => void;
}
export declare function hasScheduleExecutionQueue(scheduleId: string): boolean;
export declare function listScheduleExecutionQueueIds(): string[];
export declare function enqueueScheduleExecution<T>(params: {
    scheduleId: string;
    scheduleName?: string;
    trigger?: string;
    task: () => Promise<T>;
}, dependencies: ScheduleQueueLoggingDependencies): Promise<T>;
export {};
//# sourceMappingURL=queueing.d.ts.map