export interface RecoveryStrategyKey {
    targetRoute: string;
    targetAgentId?: string;
    executorId?: string;
    toolIds: string[];
    sourceIds?: string[];
    inputShapeHash: string;
    promptContextHash?: string;
    normalizedTaskHash: string;
    decompositionHash?: string;
    workingDirectory?: string;
    fileTargets: string[];
    permissionProfile: string;
    userConfirmationState?: string;
    executionOrderHash: string;
    verificationMethod: string;
}
export declare const RECOVERY_STRATEGY_CHANGE_AXES: readonly ["executor", "tool_or_source", "decomposition", "prompt_context", "verification_method", "permission_or_user_confirmation"];
export type RecoveryStrategyChangeAxis = typeof RECOVERY_STRATEGY_CHANGE_AXES[number];
export interface RecoveryStrategyAttempt {
    attemptId?: string;
    scopeId: string;
    key: RecoveryStrategyKey;
    reason: string;
    accepted?: boolean;
    createdAt: number;
}
export interface RecoveryStrategyLedger {
    attempts: RecoveryStrategyAttempt[];
}
export declare function createRecoveryStrategyLedger(attempts?: RecoveryStrategyAttempt[]): RecoveryStrategyLedger;
export declare function recoveryStrategyFingerprint(key: RecoveryStrategyKey): string;
export declare function hasRecoveryStrategyAttempt(input: {
    ledger: RecoveryStrategyLedger;
    scopeId: string;
    key: RecoveryStrategyKey;
}): boolean;
export declare function recordRecoveryStrategyAttempt(input: {
    ledger: RecoveryStrategyLedger;
    scopeId: string;
    key: RecoveryStrategyKey;
    reason: string;
    now?: number;
}): {
    accepted: boolean;
    ledger: RecoveryStrategyLedger;
    rejectionReason?: "same_strategy_rejected";
};
//# sourceMappingURL=recovery-strategy-ledger.d.ts.map