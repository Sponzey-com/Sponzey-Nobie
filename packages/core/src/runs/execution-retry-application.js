import { consumeRecoveryBudget, formatRecoveryBudgetProgress, } from "./recovery-budget.js";
export function applyExecutionRecoveryAttempt(params, dependencies) {
    dependencies.rememberRunFailure({
        runId: params.runId,
        sessionId: params.sessionId,
        source: params.source,
        summary: params.payload.summary,
        detail: params.payload.reason,
        title: `execution_recovery: ${params.payload.toolNames.join(", ") || "tool"}`,
    });
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
    dependencies.appendRunEvent(params.runId, `실행 복구 ${formatRecoveryBudgetProgress(executionBudgetAfterUse)}`);
    dependencies.setRunStepStatus(params.runId, "executing", "running", params.summary);
    dependencies.updateRunStatus(params.runId, "running", params.summary, true);
}
//# sourceMappingURL=execution-retry-application.js.map