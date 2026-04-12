interface IntakeQueueLoggingDependencies {
    logInfo: (message: string, payload?: Record<string, unknown>) => void;
    logWarn: (message: string) => void;
    logError: (message: string, payload?: Record<string, unknown>) => void;
    appendRunEvent?: (runId: string, message: string) => void;
}
export declare function hasSessionIntakeQueue(sessionId: string): boolean;
export declare function enqueueSessionIntake<T>(params: {
    sessionId: string;
    runId: string;
    requestGroupId: string;
    task: () => Promise<T>;
}, dependencies: IntakeQueueLoggingDependencies): Promise<T>;
export {};
//# sourceMappingURL=intake-queue.d.ts.map