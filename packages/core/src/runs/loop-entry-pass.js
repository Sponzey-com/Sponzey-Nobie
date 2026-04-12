import { applyIntakeRetryDirective, } from "./intake-retry-application.js";
const defaultModuleDependencies = {
    applyIntakeRetryDirective,
};
export async function runLoopEntryPass(params, dependencies, moduleDependencies = defaultModuleDependencies) {
    if (params.pendingLoopDirective) {
        const directive = params.pendingLoopDirective;
        if (directive.kind === "retry_intake") {
            const { usedTurns, maxTurns } = dependencies.getDelegationTurnState();
            const intakeRetryApplication = await moduleDependencies.applyIntakeRetryDirective({
                runId: params.runId,
                sessionId: params.sessionId,
                source: params.source,
                onChunk: params.onChunk,
                directive,
                usedTurns,
                maxTurns,
                recoveryBudgetUsage: params.recoveryBudgetUsage,
                finalizationDependencies: params.finalizationDependencies,
            }, dependencies);
            if (intakeRetryApplication.kind === "break") {
                return { kind: "break" };
            }
            return {
                kind: "retry",
                nextMessage: intakeRetryApplication.nextMessage,
            };
        }
        await dependencies.executeLoopDirective(directive);
        return { kind: "break" };
    }
    if (!params.intakeProcessed) {
        const cancellationDirective = await dependencies.tryHandleActiveQueueCancellation();
        if (cancellationDirective) {
            return {
                kind: "set_directive",
                directive: cancellationDirective,
                intakeProcessed: true,
            };
        }
        const intakeDirective = await dependencies.tryHandleIntakeBridge();
        if (intakeDirective) {
            return {
                kind: "set_directive",
                directive: intakeDirective,
                intakeProcessed: true,
            };
        }
        return {
            kind: "proceed",
            intakeProcessed: true,
        };
    }
    return {
        kind: "proceed",
        intakeProcessed: params.intakeProcessed,
    };
}
//# sourceMappingURL=loop-entry-pass.js.map