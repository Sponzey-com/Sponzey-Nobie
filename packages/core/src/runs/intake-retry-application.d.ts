import { type RecoveryBudgetUsage } from "./recovery-budget.js";
import type { FinalizationDependencies, FinalizationSource } from "./finalization.js";
import { applyTerminalApplication } from "./terminal-application.js";
import type { RunChunkDeliveryHandler } from "./delivery.js";
export interface IntakeRetryDirective {
    summary: string;
    reason: string;
    message: string;
    remainingItems?: string[];
    eventLabel?: string;
}
export type IntakeRetryApplicationResult = {
    kind: "break";
} | {
    kind: "retry";
    nextMessage: string;
};
export interface IntakeRetryApplicationDependencies {
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
    setRunStepStatus: (runId: string, stepKey: string, status: "running" | "completed" | "cancelled" | "pending" | "failed", summary: string) => void;
    updateRunStatus: (runId: string, status: "queued" | "running" | "awaiting_approval" | "awaiting_user" | "completed" | "failed" | "cancelled" | "interrupted", summary: string, canCancel: boolean) => void;
}
interface IntakeRetryApplicationModuleDependencies {
    applyTerminalApplication: typeof applyTerminalApplication;
}
export declare function applyIntakeRetryDirective(params: {
    runId: string;
    sessionId: string;
    source: FinalizationSource;
    onChunk: RunChunkDeliveryHandler | undefined;
    directive: IntakeRetryDirective;
    usedTurns: number;
    maxTurns: number;
    recoveryBudgetUsage: RecoveryBudgetUsage;
    finalizationDependencies: FinalizationDependencies;
}, dependencies: IntakeRetryApplicationDependencies, moduleDependencies?: IntakeRetryApplicationModuleDependencies): Promise<IntakeRetryApplicationResult>;
export {};
//# sourceMappingURL=intake-retry-application.d.ts.map