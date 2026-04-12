import type { RootRun } from "./types.js";
interface ExecutionQueueLoggingDependencies {
    logInfo: (message: string, payload?: Record<string, unknown>) => void;
    logWarn: (message: string) => void;
    logError: (message: string, payload?: Record<string, unknown>) => void;
    appendRunEvent?: (runId: string, message: string) => void;
}
interface RequestGroupExecutionQueueDependencies extends ExecutionQueueLoggingDependencies {
    getRootRun: (runId: string) => RootRun | undefined;
}
export declare function hasRequestGroupExecutionQueue(requestGroupId: string): boolean;
export declare function enqueueRequestGroupExecution(params: {
    requestGroupId: string;
    runId: string;
    task: () => Promise<RootRun | undefined>;
}, dependencies: RequestGroupExecutionQueueDependencies): Promise<RootRun | undefined>;
export {};
//# sourceMappingURL=execution-queue.d.ts.map