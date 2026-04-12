interface RecoveryQueueDependencies {
    appendRunEvent?: (runId: string, message: string) => void;
}
export declare function hasRunRecoveryQueue(runId: string): boolean;
export declare function enqueueRunRecovery<T>(params: {
    runId: string;
    task: () => Promise<T>;
}, dependencies?: RecoveryQueueDependencies): Promise<T>;
export {};
//# sourceMappingURL=recovery-queue.d.ts.map