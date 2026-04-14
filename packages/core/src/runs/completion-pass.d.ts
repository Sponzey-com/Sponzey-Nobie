import type { CompletionReviewResult } from "../agent/completion-review.js";
import type { TaskExecutionSemantics } from "../agent/intake.js";
import type { DeliveryOutcome } from "./delivery.js";
import { type CompletionStageState } from "./completion-state.js";
import { type RecoveryBudgetUsage } from "./recovery-budget.js";
import { type SuccessfulToolEvidence } from "./recovery.js";
import { type CompletionApplicationDecision } from "./completion-application.js";
import { type CompletionFlowDecision } from "./completion-flow.js";
export interface CompletionPassResult {
    state: CompletionStageState;
    decision: CompletionFlowDecision;
    application: CompletionApplicationDecision;
    usedTurns: number;
    maxTurns: number;
}
export declare function runCompletionPass(params: {
    review: CompletionReviewResult | null;
    executionSemantics: TaskExecutionSemantics;
    preview: string;
    deliveryOutcome: DeliveryOutcome;
    successfulTools: SuccessfulToolEvidence[];
    sawRealFilesystemMutation: boolean;
    requiresFilesystemMutation: boolean;
    truncatedOutputRecoveryAttempted: boolean;
    originalRequest: string;
    recoveryBudgetUsage: RecoveryBudgetUsage;
    delegationTurnCount?: number;
    maxDelegationTurns?: number;
    defaultMaxDelegationTurns: number;
    followupAlreadySeen: boolean;
}): CompletionPassResult;
//# sourceMappingURL=completion-pass.d.ts.map