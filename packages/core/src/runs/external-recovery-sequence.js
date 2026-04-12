import { runExternalRecoveryPass, } from "./external-recovery-pass.js";
const defaultModuleDependencies = {
    runExternalRecoveryPass,
};
export async function runExternalRecoverySequence(params, dependencies, moduleDependencies = defaultModuleDependencies) {
    for (const recoveryInput of params.recoveries) {
        const result = await moduleDependencies.runExternalRecoveryPass({
            kind: recoveryInput.kind,
            ...(recoveryInput.payload !== undefined ? { payload: recoveryInput.payload } : {}),
            aborted: params.aborted,
            taskProfile: params.taskProfile,
            current: params.current,
            seenKeys: params.seenKeys,
            originalRequest: params.originalRequest,
            previousResult: params.previousResult,
            runId: params.runId,
            sessionId: params.sessionId,
            source: params.source,
            onChunk: params.onChunk,
            preview: params.preview,
            finalizationDependencies: params.finalizationDependencies,
        }, {
            appendRunEvent: dependencies.appendRunEvent,
        });
        if (result.kind === "stop" || result.kind === "retry") {
            return result;
        }
    }
    return { kind: "none" };
}
//# sourceMappingURL=external-recovery-sequence.js.map