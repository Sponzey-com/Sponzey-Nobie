import { type NonTerminalRecoveryReason, type TerminalFailureReason } from "./execution-policy.js";
import { type RecoveryStrategyKey, type RecoveryStrategyLedger } from "./recovery-strategy-ledger.js";
import type { NodeTaskAnalysis, RecoveryAlternative } from "../topology/executor-task-analysis.js";
export type RecoveryControllerDecision = {
    status: "cancelled";
    reasonCode: "user_cancelled";
} | {
    status: "waiting_for_user";
    terminalReason: Extract<TerminalFailureReason, "privacy_or_permission_boundary" | "permission_required" | "manual_approval_required">;
} | {
    status: "strategy_selected";
    recoveryReason: NonTerminalRecoveryReason;
    alternative: RecoveryAlternative;
    strategyKey: RecoveryStrategyKey;
} | {
    status: "no_safe_alternative";
    terminalReason: Extract<TerminalFailureReason, "no_safe_alternative" | "out_of_scope" | "external_system_unavailable_without_alternative">;
    recoveryReason?: NonTerminalRecoveryReason;
};
export interface RecoveryControllerResult {
    decision: RecoveryControllerDecision;
    ledger: RecoveryStrategyLedger;
}
export declare function chooseRecoveryAlternative(input: {
    taskAnalysis: Pick<NodeTaskAnalysis, "safeAlternatives" | "needsUserConfirmation">;
    ledger: RecoveryStrategyLedger;
    scopeId: string;
    failureReason: string;
    baseStrategyKey: RecoveryStrategyKey;
    explicitUserLimit?: boolean;
    cancelled?: boolean;
    now?: number;
}): RecoveryControllerResult;
//# sourceMappingURL=recovery-controller.d.ts.map