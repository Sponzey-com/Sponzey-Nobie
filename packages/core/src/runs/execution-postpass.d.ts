import { type RecoveryBudgetUsage } from "./recovery-budget.js";
import { type FailedCommandTool } from "./recovery.js";
import type { RecoveryRetryApplicationState } from "./retry-application.js";
export interface ExecutionRecoveryPayload {
    summary: string;
    reason: string;
    toolNames: string[];
}
export type ExecutionPostPassDecision = {
    kind: "none";
} | {
    kind: "stop";
    summary: string;
    reason: string;
    remainingItems: string[];
} | {
    kind: "retry";
    seenKey: string;
    seenKeyKind: "command" | "generic_execution";
    state: RecoveryRetryApplicationState;
};
export declare function decideExecutionPostPassRecovery(params: {
    originalRequest: string;
    preview: string;
    directArtifactDeliverySatisfied: boolean;
    failedCommandTools: FailedCommandTool[];
    commandFailureSeen: boolean;
    commandRecoveredWithinSamePass: boolean;
    executionRecovery: ExecutionRecoveryPayload | null;
    seenCommandFailureRecoveryKeys: Set<string>;
    seenExecutionRecoveryKeys: Set<string>;
    recoveryBudgetUsage: RecoveryBudgetUsage;
    usedTurns: number;
    maxDelegationTurns: number;
}): ExecutionPostPassDecision;
//# sourceMappingURL=execution-postpass.d.ts.map