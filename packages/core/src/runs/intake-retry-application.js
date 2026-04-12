import { canConsumeRecoveryBudget, consumeRecoveryBudget, formatRecoveryBudgetProgress, getRecoveryBudgetState, } from "./recovery-budget.js";
import { applyTerminalApplication } from "./terminal-application.js";
const defaultModuleDependencies = {
    applyTerminalApplication,
};
export async function applyIntakeRetryDirective(params, dependencies, moduleDependencies = defaultModuleDependencies) {
    const interpretationBudget = getRecoveryBudgetState({
        usage: params.recoveryBudgetUsage,
        kind: "interpretation",
        maxDelegationTurns: params.maxTurns,
    });
    if (params.directive.eventLabel) {
        dependencies.appendRunEvent(params.runId, params.directive.eventLabel);
    }
    dependencies.rememberRunFailure({
        runId: params.runId,
        sessionId: params.sessionId,
        source: params.source,
        summary: params.directive.summary,
        detail: params.directive.reason,
        title: "schedule_intake_recovery",
    });
    if ((params.maxTurns > 0 && params.usedTurns >= params.maxTurns) || !canConsumeRecoveryBudget({
        usage: params.recoveryBudgetUsage,
        kind: "interpretation",
        maxDelegationTurns: params.maxTurns,
    })) {
        await moduleDependencies.applyTerminalApplication({
            runId: params.runId,
            sessionId: params.sessionId,
            source: params.source,
            onChunk: params.onChunk,
            application: {
                kind: "stop",
                preview: "",
                summary: `일정 해석 복구 재시도 한도(${interpretationBudget.limit > 0 ? interpretationBudget.limit : params.maxTurns}회)에 도달했습니다.`,
                reason: params.directive.reason,
                remainingItems: params.directive.remainingItems ?? ["일정 요청을 다시 해석해야 하지만 자동 재시도 한도에 도달했습니다."],
            },
            dependencies: params.finalizationDependencies,
        });
        return { kind: "break" };
    }
    dependencies.incrementDelegationTurnCount(params.runId, params.directive.summary);
    const interpretationBudgetAfterUse = consumeRecoveryBudget({
        usage: params.recoveryBudgetUsage,
        kind: "interpretation",
        maxDelegationTurns: params.maxTurns,
    });
    dependencies.appendRunEvent(params.runId, `일정 해석 복구 재시도 ${formatRecoveryBudgetProgress(interpretationBudgetAfterUse)}`);
    dependencies.setRunStepStatus(params.runId, "executing", "running", params.directive.summary);
    dependencies.updateRunStatus(params.runId, "running", params.directive.summary, true);
    return {
        kind: "retry",
        nextMessage: params.directive.message,
    };
}
//# sourceMappingURL=intake-retry-application.js.map