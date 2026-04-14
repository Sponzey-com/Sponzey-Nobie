import { type RecoveryBudgetUsage } from "./recovery-budget.js";
import type { ExternalRecoveryPayload } from "./external-recovery.js";
import type { FinalizationSource } from "./finalization.js";
export type ExternalRetryKind = "ai" | "worker_runtime";
export type ExternalRecoveryAttemptResult = {
    kind: "stop";
    stop: {
        summary: string;
        reason: string;
        rawMessage?: string;
        remainingItems: string[];
    };
} | {
    kind: "retry";
    payload: ExternalRecoveryPayload;
};
export interface ExternalRecoveryAttemptDependencies {
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
export declare function applyExternalRecoveryAttempt(params: {
    kind: ExternalRetryKind;
    runId: string;
    sessionId: string;
    source: FinalizationSource;
    recoveryBudgetUsage: RecoveryBudgetUsage;
    usedTurns: number;
    maxDelegationTurns: number;
    failureTitle: string;
    payload: ExternalRecoveryPayload;
    limitRemainingItems: string[];
}, dependencies: ExternalRecoveryAttemptDependencies): ExternalRecoveryAttemptResult;
//# sourceMappingURL=external-retry-application.d.ts.map