import { canConsumeRecoveryBudget, consumeRecoveryBudget, formatRecoveryBudgetProgress, getRecoveryBudgetState, } from "./recovery-budget.js";
export function applyExecutionRecoveryAttempt(params, dependencies) {
    dependencies.rememberRunFailure({
        runId: params.runId,
        sessionId: params.sessionId,
        source: params.source,
        summary: params.payload.summary,
        detail: params.payload.reason,
        title: `execution_recovery: ${params.payload.toolNames.join(", ") || "tool"}`,
    });
    const executionBudget = getRecoveryBudgetState({
        usage: params.recoveryBudgetUsage,
        kind: "execution",
        maxDelegationTurns: params.maxDelegationTurns,
    });
    if ((params.maxDelegationTurns > 0 && params.usedTurns >= params.maxDelegationTurns) || !canConsumeRecoveryBudget({
        usage: params.recoveryBudgetUsage,
        kind: "execution",
        maxDelegationTurns: params.maxDelegationTurns,
    })) {
        dependencies.appendRunEvent(params.runId, `실행 복구 한도 도달 ${formatRecoveryBudgetProgress(executionBudget)}`);
        return {
            kind: "stop",
            stop: {
                summary: `실행 복구 재시도 한도(${executionBudget.limit > 0 ? executionBudget.limit : params.maxDelegationTurns}회)에 도달했습니다.`,
                reason: params.payload.reason,
                remainingItems: [
                    `${params.payload.toolNames.join(", ")} 실행 실패에 대한 추가 대안 탐색이 필요하지만 자동 한도에 도달했습니다.`,
                ],
            },
        };
    }
    incrementExecutionRecoveryRetry({
        runId: params.runId,
        summary: params.payload.summary,
        recoveryBudgetUsage: params.recoveryBudgetUsage,
        maxDelegationTurns: params.maxDelegationTurns,
    }, dependencies);
    return {
        kind: "retry",
        payload: params.payload,
    };
}
function incrementExecutionRecoveryRetry(params, dependencies) {
    dependencies.incrementDelegationTurnCount(params.runId, params.summary);
    const executionBudgetAfterUse = consumeRecoveryBudget({
        usage: params.recoveryBudgetUsage,
        kind: "execution",
        maxDelegationTurns: params.maxDelegationTurns,
    });
    dependencies.appendRunEvent(params.runId, `실행 복구 재시도 ${formatRecoveryBudgetProgress(executionBudgetAfterUse)}`);
    dependencies.setRunStepStatus(params.runId, "executing", "running", params.summary);
    dependencies.updateRunStatus(params.runId, "running", params.summary, true);
}
//# sourceMappingURL=execution-retry-application.js.map