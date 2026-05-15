export const RECOVERY_STRATEGY_CHANGE_AXES = [
    "executor",
    "tool_or_source",
    "decomposition",
    "prompt_context",
    "verification_method",
    "permission_or_user_confirmation",
];
export function createRecoveryStrategyLedger(attempts = []) {
    return { attempts: [...attempts] };
}
export function recoveryStrategyFingerprint(key) {
    return JSON.stringify({
        executor: key.executorId ?? key.targetAgentId ?? key.targetRoute,
        targetRoute: key.targetRoute,
        targetAgentId: key.targetAgentId ?? "",
        toolOrSourceIds: [...key.toolIds, ...(key.sourceIds ?? [])].sort(),
        promptContextHash: key.promptContextHash ?? key.inputShapeHash,
        decompositionHash: key.decompositionHash ?? key.normalizedTaskHash,
        workingDirectory: key.workingDirectory ?? "",
        fileTargets: [...key.fileTargets].sort(),
        permissionOrUserConfirmation: `${key.permissionProfile}:${key.userConfirmationState ?? ""}`,
        executionOrderHash: key.executionOrderHash,
        verificationMethod: key.verificationMethod,
    });
}
export function hasRecoveryStrategyAttempt(input) {
    const fingerprint = recoveryStrategyFingerprint(input.key);
    return input.ledger.attempts.some((attempt) => attempt.scopeId === input.scopeId && recoveryStrategyFingerprint(attempt.key) === fingerprint);
}
export function recordRecoveryStrategyAttempt(input) {
    if (hasRecoveryStrategyAttempt(input)) {
        return {
            accepted: false,
            ledger: input.ledger,
            rejectionReason: "same_strategy_rejected",
        };
    }
    return {
        accepted: true,
        ledger: {
            attempts: [
                ...input.ledger.attempts,
                {
                    scopeId: input.scopeId,
                    key: input.key,
                    reason: input.reason,
                    createdAt: input.now ?? Date.now(),
                },
            ],
        },
    };
}
//# sourceMappingURL=recovery-strategy-ledger.js.map