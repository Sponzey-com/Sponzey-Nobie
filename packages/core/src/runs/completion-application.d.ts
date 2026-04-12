import type { SuccessfulToolEvidence } from "./recovery.js";
import type { CompletionFlowDecision } from "./completion-flow.js";
export type CompletionApplicationDecision = {
    kind: "complete";
    summary: string;
    persistedText: string;
    statusText: string;
} | {
    kind: "stop";
    summary: string;
    reason: string;
    remainingItems?: string[];
} | {
    kind: "retry";
    budgetKind: "execution" | "interpretation";
    summary: string;
    detail?: string;
    title?: string;
    eventLabel: string;
    nextMessage: string;
    reviewStepStatus: "running" | "completed";
    executingStepSummary: string;
    updateRunStatusSummary?: string;
    normalizedFollowupPrompt?: string;
    markTruncatedOutputRecoveryAttempted?: boolean;
    clearWorkerRuntime?: boolean;
} | {
    kind: "awaiting_user";
    summary: string;
    reason?: string;
    remainingItems?: string[];
    userMessage?: string;
};
export declare function decideCompletionApplication(params: {
    decision: CompletionFlowDecision;
    originalRequest: string;
    previousResult: string;
    successfulTools: SuccessfulToolEvidence[];
    sawRealFilesystemMutation: boolean;
    usedTurns: number;
    maxTurns: number;
    interpretationBudgetLimit: number;
    executionBudgetLimit: number;
    canRetryInterpretation: boolean;
    canRetryExecution: boolean;
    followupAlreadySeen: boolean;
}): CompletionApplicationDecision;
//# sourceMappingURL=completion-application.d.ts.map