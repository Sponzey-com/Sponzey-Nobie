import type { LoopDirective } from "./loop-directive.js";
import type { WorkerRuntimeTarget } from "./worker-runtime.js";
interface LoopBootstrapDependencies {
    appendRunEvent: (runId: string, message: string) => void;
    updateRunSummary: (runId: string, summary: string) => void;
    setRunStepStatus: (runId: string, stepKey: string, status: "running" | "completed" | "cancelled" | "pending" | "failed", summary: string) => void;
    updateRunStatus: (runId: string, status: "queued" | "running" | "awaiting_approval" | "awaiting_user" | "completed" | "failed" | "cancelled" | "interrupted", summary: string, canCancel: boolean) => void;
    logInfo: (message: string, payload: Record<string, unknown>) => void;
}
export declare function buildReconnectClarificationDirective(params: {
    reconnectTarget?: {
        title: string;
    } | undefined;
    reconnectSelection?: {
        candidates?: Array<{
            title: string;
        }>;
    } | undefined;
}): LoopDirective;
export declare function bootstrapLoopState(params: {
    runId: string;
    sessionId: string;
    skipIntake?: boolean | undefined;
    immediateCompletionText?: string | undefined;
    reconnectNeedsClarification: boolean;
    reconnectTarget?: {
        title: string;
    } | undefined;
    reconnectSelection?: {
        candidates?: Array<{
            title: string;
        }>;
    } | undefined;
    queuedBehindRequestGroupRun: boolean;
    aborted: boolean;
    activeWorkerRuntime?: WorkerRuntimeTarget | undefined;
    requiresFilesystemMutation: boolean;
    requiresPrivilegedToolExecution: boolean;
}, dependencies: LoopBootstrapDependencies): {
    intakeProcessed: boolean;
    pendingLoopDirective: LoopDirective | null;
    activeWorkerRuntime?: WorkerRuntimeTarget | undefined;
};
export {};
//# sourceMappingURL=loop-bootstrap.d.ts.map