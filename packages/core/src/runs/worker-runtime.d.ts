import type { AgentChunk } from "../agent/index.js";
export type WorkerRuntimeKind = "claude_code" | "codex_cli";
export interface WorkerRuntimeTarget {
    kind: WorkerRuntimeKind;
    targetId: string;
    label: string;
    command: string;
}
export interface WorkerAvailabilityOverrides {
    claude_code?: boolean;
    codex_cli?: boolean;
}
export declare function resolveWorkerRuntimeTarget(kind: WorkerRuntimeKind): WorkerRuntimeTarget;
export declare function isWorkerRuntimeAvailable(kind: WorkerRuntimeKind, overrides?: WorkerAvailabilityOverrides): boolean;
export declare function runWorkerRuntime(params: {
    runtime: WorkerRuntimeTarget;
    prompt: string;
    sessionId: string;
    runId: string;
    signal: AbortSignal;
}): AsyncGenerator<AgentChunk>;
//# sourceMappingURL=worker-runtime.d.ts.map