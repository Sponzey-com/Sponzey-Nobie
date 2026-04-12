import { applyRecoveryRetryState, } from "./retry-application.js";
import { applyTerminalApplication } from "./terminal-application.js";
const defaultModuleDependencies = {
    applyTerminalApplication,
    applyRecoveryRetryState,
};
export async function applyExecutionPostPassDecision(params, dependencies, moduleDependencies = defaultModuleDependencies) {
    if (params.decision.kind === "none") {
        return { kind: "continue" };
    }
    if (params.decision.kind === "stop") {
        await moduleDependencies.applyTerminalApplication({
            runId: params.runId,
            sessionId: params.sessionId,
            source: params.source,
            onChunk: params.onChunk,
            application: {
                kind: "stop",
                preview: params.preview,
                summary: params.decision.summary,
                reason: params.decision.reason,
                remainingItems: params.decision.remainingItems,
            },
            dependencies: params.finalizationDependencies,
        });
        return { kind: "break" };
    }
    const continuation = moduleDependencies.applyRecoveryRetryState({
        runId: params.runId,
        sessionId: params.sessionId,
        source: params.source,
        recoveryBudgetUsage: params.recoveryBudgetUsage,
        state: params.decision.state,
    }, dependencies);
    return {
        kind: "retry",
        nextMessage: continuation.nextMessage,
        clearWorkerRuntime: continuation.clearWorkerRuntime,
        seenKey: {
            key: params.decision.seenKey,
            kind: params.decision.seenKeyKind,
        },
    };
}
//# sourceMappingURL=execution-postpass-application.js.map