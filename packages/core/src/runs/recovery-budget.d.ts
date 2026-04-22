export type RecoveryBudgetKind = "interpretation" | "execution" | "delivery" | "external";
export type SubSessionRevisionBudgetClass = "default" | "format_only" | "risk_or_external" | "expensive";
export interface RecoveryBudgetState {
    kind: RecoveryBudgetKind;
    used: number;
    limit: number;
    remaining: number;
}
export type RecoveryBudgetUsage = Record<RecoveryBudgetKind, number>;
export declare function createRecoveryBudgetUsage(): RecoveryBudgetUsage;
export declare function getRecoveryBudgetLimit(kind: RecoveryBudgetKind, maxDelegationTurns: number): number;
export declare function getRecoveryBudgetState(params: {
    usage: RecoveryBudgetUsage;
    kind: RecoveryBudgetKind;
    maxDelegationTurns: number;
}): RecoveryBudgetState;
export declare function canConsumeRecoveryBudget(params: {
    usage: RecoveryBudgetUsage;
    kind: RecoveryBudgetKind;
    maxDelegationTurns: number;
}): boolean;
export declare function consumeRecoveryBudget(params: {
    usage: RecoveryBudgetUsage;
    kind: RecoveryBudgetKind;
    maxDelegationTurns: number;
}): RecoveryBudgetState;
export declare function formatRecoveryBudgetProgress(state: RecoveryBudgetState): string;
export declare function getSubSessionRevisionBudgetLimit(budgetClass?: SubSessionRevisionBudgetClass): number;
export declare function canRetrySubSessionRevision(params: {
    retryBudgetRemaining: number;
    budgetClass?: SubSessionRevisionBudgetClass;
    repeatedFailure?: boolean;
}): boolean;
//# sourceMappingURL=recovery-budget.d.ts.map