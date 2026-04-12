import { deliverChunk, type RunChunkDeliveryHandler } from "./delivery.js";
import { applyFatalFailure } from "./failure-application.js";
import type { FinalizationSource } from "./finalization.js";
interface RootRunDriverFailureDependencies {
    appendRunEvent: (runId: string, message: string) => void;
    setRunStepStatus: (runId: string, step: string, status: "pending" | "running" | "completed" | "failed" | "cancelled", summary: string) => void;
    updateRunStatus: (runId: string, status: "queued" | "running" | "awaiting_approval" | "awaiting_user" | "completed" | "failed" | "cancelled" | "interrupted", summary: string, active: boolean) => void;
    rememberRunFailure: (params: {
        runId: string;
        sessionId: string;
        source: FinalizationSource;
        summary: string;
        detail?: string;
        title?: string;
    }) => void;
    markAbortedRunCancelledIfActive: (runId: string) => void;
    onDeliveryError?: (message: string) => void;
}
interface RootRunDriverFailureModuleDependencies {
    applyFatalFailure: typeof applyFatalFailure;
    deliverChunk: typeof deliverChunk;
}
export declare function applyRootRunDriverFailure(params: {
    runId: string;
    sessionId: string;
    source: FinalizationSource;
    onChunk: RunChunkDeliveryHandler | undefined;
    aborted: boolean;
    message: string;
}, dependencies: RootRunDriverFailureDependencies, moduleDependencies?: RootRunDriverFailureModuleDependencies): Promise<void>;
export {};
//# sourceMappingURL=root-run-driver-failure.d.ts.map