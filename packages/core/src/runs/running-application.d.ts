export interface RunningContinuationState {
    eventLabels?: string[];
    reviewStepStatus: "running" | "completed";
    reviewSummary: string;
    executingSummary: string;
    updateRunStatusSummary?: string;
    updateRunSummary?: string;
    nextMessage: string;
    clearWorkerRuntime?: boolean;
    clearProvider?: boolean;
}
export interface RunningContinuationDependencies {
    appendRunEvent: (runId: string, label: string) => void;
    updateRunSummary: (runId: string, summary: string) => void;
    setRunStepStatus: (runId: string, stepKey: string, status: "running" | "completed" | "cancelled" | "pending" | "failed", summary: string) => void;
    updateRunStatus: (runId: string, status: "queued" | "running" | "awaiting_approval" | "awaiting_user" | "completed" | "failed" | "cancelled" | "interrupted", summary: string, canCancel: boolean) => void;
}
export interface AppliedRunningContinuation {
    nextMessage: string;
    clearWorkerRuntime: boolean;
    clearProvider: boolean;
}
export declare function applyRunningContinuationState(params: {
    runId: string;
    state: RunningContinuationState;
}, dependencies: RunningContinuationDependencies): AppliedRunningContinuation;
//# sourceMappingURL=running-application.d.ts.map