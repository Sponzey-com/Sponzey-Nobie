import type { RunChunkDeliveryHandler } from "./delivery.js";
import type { ExecutionPostPassDecision } from "./execution-postpass.js";
import type { FinalizationDependencies, FinalizationSource } from "./finalization.js";
import { applyRecoveryRetryState, type RecoveryRetryApplicationDependencies } from "./retry-application.js";
import { applyTerminalApplication } from "./terminal-application.js";
import type { RecoveryBudgetUsage } from "./recovery-budget.js";
export type ExecutionPostPassApplicationResult = {
    kind: "continue";
} | {
    kind: "break";
} | {
    kind: "retry";
    nextMessage: string;
    clearWorkerRuntime: boolean;
    seenKey?: {
        key: string;
        kind: "command" | "generic_execution";
    };
};
interface ExecutionPostPassApplicationModuleDependencies {
    applyTerminalApplication: typeof applyTerminalApplication;
    applyRecoveryRetryState: typeof applyRecoveryRetryState;
}
export declare function applyExecutionPostPassDecision(params: {
    runId: string;
    sessionId: string;
    source: FinalizationSource;
    onChunk: RunChunkDeliveryHandler | undefined;
    preview: string;
    decision: ExecutionPostPassDecision;
    recoveryBudgetUsage: RecoveryBudgetUsage;
    finalizationDependencies: FinalizationDependencies;
}, dependencies: RecoveryRetryApplicationDependencies, moduleDependencies?: ExecutionPostPassApplicationModuleDependencies): Promise<ExecutionPostPassApplicationResult>;
export {};
//# sourceMappingURL=execution-postpass-application.d.ts.map