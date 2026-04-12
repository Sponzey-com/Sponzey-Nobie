import type { RunChunkDeliveryHandler } from "./delivery.js";
import { type ActiveQueueCancellationMode } from "./entry-semantics.js";
import type { FinalizationSource } from "./finalization.js";
import type { LoopDirective } from "./loop-directive.js";
import type { RootRun, TaskProfile } from "./types.js";
import type { WorkerRuntimeTarget } from "./worker-runtime.js";
export declare function normalizeTaskProfile(taskProfile: string | undefined): TaskProfile;
export declare function buildWorkerSessionId(params: {
    runId: string;
    isRootRequest: boolean;
    requestGroupId: string;
    taskProfile: TaskProfile;
    targetId?: string;
    workerRuntime?: WorkerRuntimeTarget;
}): string | undefined;
export declare function markAbortedRunCancelledIfActive(runId: string): void;
export declare function tryHandleActiveQueueCancellation(params: {
    runId: string;
    sessionId: string;
    message: string;
    mode: ActiveQueueCancellationMode | null;
}): Promise<LoopDirective | null>;
export declare function ensureSessionExists(sessionId: string, source: RootRun["source"], now: number): void;
export declare function rememberRunInstruction(params: {
    runId: string;
    sessionId: string;
    requestGroupId: string;
    source: FinalizationSource;
    message: string;
}): void;
export declare function rememberRunSuccess(params: {
    runId: string;
    sessionId: string;
    source: FinalizationSource;
    text: string;
    summary: string;
}): void;
export declare function rememberRunFailure(params: {
    runId: string;
    sessionId: string;
    source: FinalizationSource;
    summary: string;
    detail?: string;
    title?: string;
}): void;
export declare function runFilesystemVerificationSubtask(params: {
    parentRunId: string;
    requestGroupId: string;
    sessionId: string;
    source: FinalizationSource;
    onChunk: RunChunkDeliveryHandler | undefined;
    originalRequest: string;
    mutationPaths: string[];
    workDir: string;
}): Promise<{
    ok: boolean;
    summary: string;
    reason?: string;
    remainingItems?: string[];
}>;
//# sourceMappingURL=start-support.d.ts.map