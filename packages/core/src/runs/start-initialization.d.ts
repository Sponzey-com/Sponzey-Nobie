import type { FinalizationSource } from "./finalization.js";
interface StartInitializationDependencies {
    rememberRunInstruction: (params: {
        runId: string;
        sessionId: string;
        requestGroupId: string;
        source: FinalizationSource;
        message: string;
    }) => void;
    bindActiveRunController: (runId: string, controller: AbortController) => void;
    interruptOrphanWorkerSessionRuns: (params: {
        requestGroupId: string;
        workerSessionId: string;
        keepRunId: string;
        summary?: string;
    }) => Array<unknown>;
    appendRunEvent: (runId: string, message: string) => void;
    updateRunSummary: (runId: string, summary: string) => void;
    setRunStepStatus: (runId: string, stepKey: string, status: "running" | "completed" | "cancelled" | "pending" | "failed", summary: string) => void;
    updateRunStatus: (runId: string, status: "queued" | "running" | "awaiting_approval" | "awaiting_user" | "completed" | "failed" | "cancelled" | "interrupted", summary: string, canCancel: boolean) => void;
}
export declare function applyStartInitialization(params: {
    runId: string;
    sessionId: string;
    requestGroupId: string;
    originRunId?: string | undefined;
    originRequestGroupId?: string | undefined;
    source: FinalizationSource;
    message: string;
    controller: AbortController;
    requestGroupExecutionQueueActive: boolean;
    targetLabel?: string | undefined;
    model?: string | undefined;
    reconnectTargetTitle?: string | undefined;
    shouldReconnectGroup: boolean;
    reconnectCandidateCount: number;
    requestedClosedRequestGroup: boolean;
    workerSessionId?: string | undefined;
    reusableWorkerSessionRun?: boolean | undefined;
}, dependencies: StartInitializationDependencies): {
    queuedBehindRequestGroupRun: boolean;
    interruptedWorkerRunCount: number;
};
export {};
//# sourceMappingURL=start-initialization.d.ts.map