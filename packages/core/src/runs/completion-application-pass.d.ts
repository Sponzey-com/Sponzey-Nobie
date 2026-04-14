import type { RunChunkDeliveryHandler } from "./delivery.js";
import type { CompletionStageState } from "./completion-state.js";
import { markRunCompleted, type FinalizationDependencies, type FinalizationSource } from "./finalization.js";
import { applyRecoveryRetryState, type RecoveryRetryApplicationDependencies } from "./retry-application.js";
import { type RecoveryBudgetUsage } from "./recovery-budget.js";
import { applyTerminalApplication } from "./terminal-application.js";
import type { CompletionApplicationDecision } from "./completion-application.js";
import { decideCompletionTerminalOutcome } from "./terminal-outcome-policy.js";
export type CompletionApplicationPassResult = {
    kind: "break";
} | {
    kind: "retry";
    nextMessage: string;
    clearWorkerRuntime: boolean;
    normalizedFollowupPrompt?: string;
    markTruncatedOutputRecoveryAttempted?: boolean;
};
interface CompletionApplicationPassModuleDependencies {
    decideCompletionTerminalOutcome: typeof decideCompletionTerminalOutcome;
    markRunCompleted: typeof markRunCompleted;
    applyTerminalApplication: typeof applyTerminalApplication;
    applyRecoveryRetryState: typeof applyRecoveryRetryState;
}
export declare function applyCompletionApplicationPass(params: {
    runId: string;
    sessionId: string;
    source: FinalizationSource;
    onChunk: RunChunkDeliveryHandler | undefined;
    preview: string;
    state: CompletionStageState;
    application: CompletionApplicationDecision;
    maxTurns: number;
    recoveryBudgetUsage: RecoveryBudgetUsage;
    finalizationDependencies: FinalizationDependencies;
}, dependencies: RecoveryRetryApplicationDependencies, moduleDependencies?: CompletionApplicationPassModuleDependencies): Promise<CompletionApplicationPassResult>;
export {};
//# sourceMappingURL=completion-application-pass.d.ts.map