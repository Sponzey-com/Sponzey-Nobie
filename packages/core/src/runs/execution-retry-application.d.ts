import { type RecoveryBudgetUsage } from "./recovery-budget.js";
import type { FinalizationSource } from "./finalization.js";
export interface ExecutionRecoveryPayload {
    summary: string;
    reason: string;
    toolNames: string[];
}
export type ExecutionRecoveryAttemptResult = {
    kind: "stop";
    stop: {
        summary: string;
        reason: string;
        remainingItems: string[];
    };
} | {
    kind: "retry";
    payload: ExecutionRecoveryPayload;
};
export interface ExecutionRecoveryAttemptDependencies {
    rememberRunFailure: (params: {
        runId: string;
        sessionId: string;
        source: FinalizationSource;
        summary: string;
        detail?: string;
        title?: string;
    }) => void;
    incrementDelegationTurnCount: (runId: string, summary: string) => void;
    appendRunEvent: (runId: string, message: string) => void;
    setRunStepStatus: (runId: string, step: string, status: "pending" | "running" | "completed" | "failed" | "cancelled", summary: string) => void;
    updateRunStatus: (runId: string, status: "queued" | "running" | "awaiting_approval" | "awaiting_user" | "completed" | "failed" | "cancelled" | "interrupted", summary: string, active: boolean) => void;
}
export declare function applyExecutionRecoveryAttempt(params: {
    runId: string;
    sessionId: string;
    source: FinalizationSource;
    recoveryBudgetUsage: RecoveryBudgetUsage;
    usedTurns: number;
    maxDelegationTurns: number;
    payload: ExecutionRecoveryPayload;
}, dependencies: ExecutionRecoveryAttemptDependencies): ExecutionRecoveryAttemptResult;
//# sourceMappingURL=execution-retry-application.d.ts.map