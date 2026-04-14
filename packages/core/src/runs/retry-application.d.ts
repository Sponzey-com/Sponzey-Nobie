import { type AppliedRunningContinuation, type RunningContinuationDependencies } from "./running-application.js";
import { type RecoveryBudgetKind, type RecoveryBudgetUsage } from "./recovery-budget.js";
import { type RecoveryAlternative } from "./recovery.js";
import type { FinalizationSource } from "./finalization.js";
export interface RecoveryRetryApplicationState {
    summary: string;
    budgetKind: RecoveryBudgetKind;
    maxDelegationTurns: number;
    eventLabel: string;
    nextMessage: string;
    reviewStepStatus: "running" | "completed";
    executingStepSummary: string;
    updateRunStatusSummary?: string;
    updateRunSummary?: string;
    clearWorkerRuntime?: boolean;
    clearProvider?: boolean;
    alternatives?: RecoveryAlternative[];
    failureTitle?: string;
    failureDetail?: string;
}
export interface RecoveryRetryApplicationDependencies extends RunningContinuationDependencies {
    rememberRunFailure: (params: {
        runId: string;
        sessionId: string;
        source: FinalizationSource;
        summary: string;
        detail?: string;
        title?: string;
    }) => void;
    incrementDelegationTurnCount: (runId: string, summary: string) => void;
}
export declare function applyRecoveryRetryState(params: {
    runId: string;
    sessionId: string;
    source: FinalizationSource;
    recoveryBudgetUsage: RecoveryBudgetUsage;
    state: RecoveryRetryApplicationState;
}, dependencies: RecoveryRetryApplicationDependencies): AppliedRunningContinuation;
//# sourceMappingURL=retry-application.d.ts.map