import type { AgentChunk } from "../agent/index.js";
export type WorkerRuntimeKind = string;
export interface WorkerRuntimeTarget {
    kind: WorkerRuntimeKind;
    targetId: string;
    label: string;
    command?: string;
}
export interface WorkerAvailabilityOverrides {
    [kind: string]: boolean | undefined;
}
export declare function resolveWorkerRuntimeTarget(kind: WorkerRuntimeKind): WorkerRuntimeTarget;
export declare function isWorkerRuntimeAvailable(_kind: WorkerRuntimeKind, _overrides?: WorkerAvailabilityOverrides): boolean;
export declare function runWorkerRuntime(_params: {
    runtime: WorkerRuntimeTarget;
    prompt: string;
    sessionId: string;
    runId: string;
    signal: AbortSignal;
}): AsyncGenerator<AgentChunk>;
//# sourceMappingURL=worker-runtime.d.ts.map