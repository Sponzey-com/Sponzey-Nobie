import type { RunChunkDeliveryHandler } from "./delivery.js";
import type { FilesystemPostPassDecision } from "./filesystem-postpass.js";
import type { FinalizationDependencies, FinalizationSource } from "./finalization.js";
import { applyRecoveryRetryState, type RecoveryRetryApplicationDependencies } from "./retry-application.js";
import { applyTerminalApplication } from "./terminal-application.js";
export type FilesystemPostPassApplicationResult = {
    kind: "continue";
    preview?: string;
} | {
    kind: "break";
} | {
    kind: "retry";
    nextMessage: string;
    clearWorkerRuntime: boolean;
    markMutationRecoveryAttempted?: true;
};
interface FilesystemPostPassApplicationModuleDependencies {
    applyTerminalApplication: typeof applyTerminalApplication;
    applyRecoveryRetryState: typeof applyRecoveryRetryState;
}
export declare function applyFilesystemPostPassDecision(params: {
    runId: string;
    sessionId: string;
    source: FinalizationSource;
    onChunk: RunChunkDeliveryHandler | undefined;
    preview: string;
    decision: FilesystemPostPassDecision;
    recoveryBudgetUsage: {
        interpretation: number;
        execution: number;
        delivery: number;
        external: number;
    };
    finalizationDependencies: FinalizationDependencies;
}, dependencies: RecoveryRetryApplicationDependencies, moduleDependencies?: FilesystemPostPassApplicationModuleDependencies): Promise<FilesystemPostPassApplicationResult>;
export {};
//# sourceMappingURL=filesystem-postpass-application.d.ts.map