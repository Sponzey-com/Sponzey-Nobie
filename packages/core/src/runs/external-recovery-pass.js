import { applyExternalRecoveryPlan, } from "./external-recovery-application.js";
import { planExternalRecovery, } from "./external-recovery.js";
const defaultModuleDependencies = {
    planExternalRecovery,
    applyExternalRecoveryPlan,
};
export async function runExternalRecoveryPass(params, dependencies, moduleDependencies = defaultModuleDependencies) {
    if (!params.payload || params.aborted) {
        return { kind: "none" };
    }
    const recoveryPlan = moduleDependencies.planExternalRecovery({
        kind: params.kind,
        taskProfile: params.taskProfile,
        current: params.current,
        payload: params.payload,
        seenKeys: params.seenKeys,
        originalRequest: params.originalRequest,
        previousResult: params.previousResult,
    });
    const appliedRecovery = await moduleDependencies.applyExternalRecoveryPlan({
        runId: params.runId,
        sessionId: params.sessionId,
        source: params.source,
        onChunk: params.onChunk,
        preview: params.preview,
        plan: recoveryPlan,
        seenKeys: params.seenKeys,
        finalizationDependencies: params.finalizationDependencies,
    }, {
        appendRunEvent: dependencies.appendRunEvent,
    });
    if (appliedRecovery.kind === "stop") {
        return { kind: "stop" };
    }
    return {
        kind: "retry",
        nextState: appliedRecovery.nextState,
        nextMessage: appliedRecovery.nextMessage,
    };
}
//# sourceMappingURL=external-recovery-pass.js.map