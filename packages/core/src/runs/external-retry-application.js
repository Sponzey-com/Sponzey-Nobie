import { canConsumeRecoveryBudget, consumeRecoveryBudget, formatRecoveryBudgetProgress, getRecoveryBudgetState, } from "./recovery-budget.js";
export function applyExternalRecoveryAttempt(params, dependencies) {
    dependencies.rememberRunFailure({
        runId: params.runId,
        sessionId: params.sessionId,
        source: params.source,
        summary: params.payload.summary,
        detail: `${params.payload.reason}\n${params.payload.message}`,
        title: params.failureTitle,
    });
    const externalBudget = getRecoveryBudgetState({
        usage: params.recoveryBudgetUsage,
        kind: "external",
        maxDelegationTurns: params.maxDelegationTurns,
    });
    if ((params.maxDelegationTurns > 0 && params.usedTurns >= params.maxDelegationTurns) || !canConsumeRecoveryBudget({
        usage: params.recoveryBudgetUsage,
        kind: "external",
        maxDelegationTurns: params.maxDelegationTurns,
    })) {
        dependencies.appendRunEvent(params.runId, `${params.kind === "ai" ? "AI" : "작업 세션"} 복구 한도 도달 ${formatRecoveryBudgetProgress(externalBudget)}`);
        return {
            kind: "stop",
            stop: {
                summary: `${params.kind === "ai" ? "AI" : "작업 세션"} 복구 재시도 한도(${externalBudget.limit > 0 ? externalBudget.limit : params.maxDelegationTurns}회)에 도달했습니다.`,
                reason: params.payload.reason,
                ...(params.payload.message.trim() ? { rawMessage: params.payload.message } : {}),
                remainingItems: params.limitRemainingItems,
            },
        };
    }
    dependencies.incrementDelegationTurnCount(params.runId, params.payload.summary);
    const externalBudgetAfterUse = consumeRecoveryBudget({
        usage: params.recoveryBudgetUsage,
        kind: "external",
        maxDelegationTurns: params.maxDelegationTurns,
    });
    dependencies.appendRunEvent(params.runId, `${params.kind === "ai" ? "AI 오류" : "작업 세션"} 복구 재시도 ${formatRecoveryBudgetProgress(externalBudgetAfterUse)}`);
    dependencies.setRunStepStatus(params.runId, "executing", "running", params.payload.summary);
    dependencies.updateRunStatus(params.runId, "running", params.payload.summary, true);
    return {
        kind: "retry",
        payload: params.payload,
    };
}
//# sourceMappingURL=external-retry-application.js.map