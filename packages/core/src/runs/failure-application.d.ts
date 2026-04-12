import type { FinalizationSource } from "./finalization.js";
interface FatalFailureApplicationDependencies {
    appendRunEvent: (runId: string, event: string) => void;
    setRunStepStatus: (runId: string, step: "executing", status: "failed", summary: string) => void;
    updateRunStatus: (runId: string, status: "failed", summary: string, active: boolean) => void;
    rememberRunFailure: (params: {
        runId: string;
        sessionId: string;
        source: FinalizationSource;
        summary: string;
        detail?: string;
        title?: string;
    }) => void;
    markAbortedRunCancelledIfActive: (runId: string) => void;
}
export interface FatalFailureApplicationParams {
    runId: string;
    sessionId: string;
    source: FinalizationSource;
    message: string;
    aborted: boolean;
    summary: string;
    title: string;
    extraEvents?: string[];
    appendMessageEventOnAbort?: boolean;
    appendExtraEventsOnAbort?: boolean;
}
export declare function applyFatalFailure(params: FatalFailureApplicationParams, dependencies: FatalFailureApplicationDependencies): "failed" | "cancelled";
export {};
//# sourceMappingURL=failure-application.d.ts.map