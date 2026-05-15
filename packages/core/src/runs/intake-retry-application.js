import { consumeRecoveryBudget, formatRecoveryBudgetProgress, } from "./recovery-budget.js";
import { applyTerminalApplication } from "./terminal-application.js";
const defaultModuleDependencies = {
    applyTerminalApplication,
};
export async function applyIntakeRetryDirective(params, dependencies, moduleDependencies = defaultModuleDependencies) {
    if (params.directive.eventLabel) {
        dependencies.appendRunEvent(params.runId, params.directive.eventLabel);
    }
    dependencies.rememberRunFailure({
        runId: params.runId,
        sessionId: params.sessionId,
        source: params.source,
        summary: params.directive.summary,
        detail: params.directive.reason,
        title: "intake_recovery",
    });
    dependencies.incrementDelegationTurnCount(params.runId, params.directive.summary);
    const interpretationBudgetAfterUse = consumeRecoveryBudget({
        usage: params.recoveryBudgetUsage,
        kind: "interpretation",
        maxDelegationTurns: params.maxTurns,
    });
    dependencies.appendRunEvent(params.runId, `일정 해석 복구 ${formatRecoveryBudgetProgress(interpretationBudgetAfterUse)}`);
    dependencies.setRunStepStatus(params.runId, "executing", "running", params.directive.summary);
    dependencies.updateRunStatus(params.runId, "running", params.directive.summary, true);
    return {
        kind: "retry",
        nextMessage: params.directive.message,
    };
}
//# sourceMappingURL=intake-retry-application.js.map