import type { CompletionStageState } from "./completion-state.js";
import type { RunScope, RunStatus } from "./types.js";
export type RunCompletionOutcomeStatus = "completed_delivered" | "completed_in_chat" | "awaiting_approval" | "awaiting_user_input" | "completed_impossible" | "failed_recoverable" | "failed_final";
export type RunFlowStatusTransitionDecision = {
    allowed: true;
} | {
    allowed: false;
    reason: string;
};
export interface RunFlowIdentifiers {
    runId: string;
    sessionId: string;
    requestGroupId: string;
    lineageRootRunId: string;
    runScope: RunScope;
    parentRunId?: string;
    scheduleId?: string;
}
export interface RunCompletionOutcomeInput {
    completion?: CompletionStageState | undefined;
    approvalPending?: boolean | undefined;
    impossible?: boolean | undefined;
    finalFailure?: boolean | undefined;
}
export interface RunCompletionOutcome {
    status: RunCompletionOutcomeStatus;
    reason: string;
}
export declare const TERMINAL_RUN_STATUSES: ["completed", "failed", "cancelled", "interrupted"];
export declare function isTerminalRunStatus(status: RunStatus): boolean;
export declare function canTransitionRunStatus(currentStatus: RunStatus, nextStatus: RunStatus): RunFlowStatusTransitionDecision;
export declare function resolveRunFlowIdentifiers(params: {
    runId: string;
    sessionId: string;
    requestGroupId?: string | undefined;
    lineageRootRunId?: string | undefined;
    parentRunId?: string | undefined;
    runScope?: RunScope | undefined;
    scheduleId?: string | undefined;
}): RunFlowIdentifiers;
export declare function deriveRunCompletionOutcome(input: RunCompletionOutcomeInput): RunCompletionOutcome;
//# sourceMappingURL=flow-contract.d.ts.map