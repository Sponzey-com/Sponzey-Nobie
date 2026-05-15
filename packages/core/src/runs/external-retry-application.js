import { consumeRecoveryBudget, formatRecoveryBudgetProgress, } from "./recovery-budget.js";
export function applyExternalRecoveryAttempt(params, dependencies) {
    dependencies.rememberRunFailure({
        runId: params.runId,
        sessionId: params.sessionId,
        source: params.source,
        summary: params.payload.summary,
        detail: `${params.payload.reason}\n${params.payload.message}`,
        title: params.failureTitle,
    });
    dependencies.incrementDelegationTurnCount(params.runId, params.payload.summary);
    const externalBudgetAfterUse = consumeRecoveryBudget({
        usage: params.recoveryBudgetUsage,
        kind: "external",
        maxDelegationTurns: params.maxDelegationTurns,
    });
    dependencies.appendRunEvent(params.runId, `${params.kind === "ai" ? "AI 오류" : "작업 세션"} 복구 ${formatRecoveryBudgetProgress(externalBudgetAfterUse)}`);
    dependencies.setRunStepStatus(params.runId, "executing", "running", params.payload.summary);
    dependencies.updateRunStatus(params.runId, "running", params.payload.summary, true);
    return {
        kind: "retry",
        payload: params.payload,
    };
}
//# sourceMappingURL=external-retry-application.js.map