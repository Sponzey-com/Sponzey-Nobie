import type { RunChunkDeliveryHandler } from "./delivery.js";
import type { FinalizationDependencies, FinalizationSource } from "./finalization.js";
import { applyIntakeRetryDirective, type IntakeRetryApplicationDependencies } from "./intake-retry-application.js";
import type { RecoveryBudgetUsage } from "./recovery-budget.js";
import type { LoopDirective } from "./loop-directive.js";
export type LoopEntryPassResult = {
    kind: "break";
} | {
    kind: "retry";
    nextMessage: string;
} | {
    kind: "set_directive";
    directive: LoopDirective;
    intakeProcessed: boolean;
} | {
    kind: "proceed";
    intakeProcessed: boolean;
};
interface LoopEntryPassDependencies extends IntakeRetryApplicationDependencies {
    getDelegationTurnState: () => {
        usedTurns: number;
        maxTurns: number;
    };
    executeLoopDirective: (directive: LoopDirective) => Promise<"break">;
    tryHandleActiveQueueCancellation: () => Promise<LoopDirective | null>;
    tryHandleIntakeBridge: () => Promise<LoopDirective | null>;
}
interface LoopEntryPassModuleDependencies {
    applyIntakeRetryDirective: typeof applyIntakeRetryDirective;
}
export declare function runLoopEntryPass(params: {
    runId: string;
    sessionId: string;
    source: FinalizationSource;
    onChunk: RunChunkDeliveryHandler | undefined;
    pendingLoopDirective: LoopDirective | null;
    intakeProcessed: boolean;
    recoveryBudgetUsage: RecoveryBudgetUsage;
    finalizationDependencies: FinalizationDependencies;
}, dependencies: LoopEntryPassDependencies, moduleDependencies?: LoopEntryPassModuleDependencies): Promise<LoopEntryPassResult>;
export {};
//# sourceMappingURL=loop-entry-pass.d.ts.map