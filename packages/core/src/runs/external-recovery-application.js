import { applyTerminalApplication } from "./terminal-application.js";
const defaultModuleDependencies = {
    applyTerminalApplication,
};
export async function applyExternalRecoveryPlan(params, dependencies, moduleDependencies = defaultModuleDependencies) {
    if (params.plan.duplicateStop) {
        await moduleDependencies.applyTerminalApplication({
            runId: params.runId,
            sessionId: params.sessionId,
            source: params.source,
            onChunk: params.onChunk,
            application: {
                kind: "stop",
                preview: params.preview,
                summary: params.plan.duplicateStop.summary,
                ...(params.plan.duplicateStop.reason ? { reason: params.plan.duplicateStop.reason } : {}),
                ...(params.plan.duplicateStop.rawMessage ? { rawMessage: params.plan.duplicateStop.rawMessage } : {}),
                remainingItems: params.plan.duplicateStop.remainingItems,
            },
            dependencies: params.finalizationDependencies,
        });
        return { kind: "stop" };
    }
    params.seenKeys.add(params.plan.recoveryKey);
    dependencies.appendRunEvent(params.runId, params.plan.eventLabel);
    if (params.plan.routeEventLabel) {
        dependencies.appendRunEvent(params.runId, params.plan.routeEventLabel);
    }
    return {
        kind: "retry",
        nextState: params.plan.nextState,
        nextMessage: params.plan.nextMessage,
    };
}
//# sourceMappingURL=external-recovery-application.js.map