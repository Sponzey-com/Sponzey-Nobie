import { runExternalRecoverySequence, } from "./external-recovery-sequence.js";
import { enqueueRunRecovery } from "./recovery-queue.js";
import { applyTerminalApplication } from "./terminal-application.js";
const defaultModuleDependencies = {
    applyTerminalApplication,
    runExternalRecoverySequence,
    enqueueRunRecovery,
};
export async function runRecoveryEntryPass(params, dependencies, moduleDependencies = defaultModuleDependencies) {
    return moduleDependencies.enqueueRunRecovery({
        runId: params.runId,
        task: async () => {
            if (params.executionRecoveryLimitStop) {
                await moduleDependencies.applyTerminalApplication({
                    runId: params.runId,
                    sessionId: params.sessionId,
                    source: params.source,
                    onChunk: params.onChunk,
                    application: {
                        kind: "stop",
                        preview: params.preview,
                        summary: params.executionRecoveryLimitStop.summary,
                        reason: params.executionRecoveryLimitStop.reason,
                        ...(params.executionRecoveryLimitStop.rawMessage ? { rawMessage: params.executionRecoveryLimitStop.rawMessage } : {}),
                        remainingItems: params.executionRecoveryLimitStop.remainingItems,
                    },
                    dependencies: params.finalizationDependencies,
                });
                return { kind: "break" };
            }
            if (params.aiRecoveryLimitStop) {
                await moduleDependencies.applyTerminalApplication({
                    runId: params.runId,
                    sessionId: params.sessionId,
                    source: params.source,
                    onChunk: params.onChunk,
                    application: {
                        kind: "stop",
                        preview: params.preview,
                        summary: params.aiRecoveryLimitStop.summary,
                        reason: params.aiRecoveryLimitStop.reason,
                        ...(params.aiRecoveryLimitStop.rawMessage ? { rawMessage: params.aiRecoveryLimitStop.rawMessage } : {}),
                        remainingItems: params.aiRecoveryLimitStop.remainingItems,
                    },
                    dependencies: params.finalizationDependencies,
                });
                return { kind: "break" };
            }
            const externalRecoverySequence = await moduleDependencies.runExternalRecoverySequence({
                recoveries: params.recoveries,
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
            if (externalRecoverySequence.kind === "stop") {
                return { kind: "break" };
            }
            if (externalRecoverySequence.kind === "retry") {
                return {
                    kind: "retry",
                    nextState: externalRecoverySequence.nextState,
                    nextMessage: externalRecoverySequence.nextMessage,
                };
            }
            if (params.aborted || params.failed) {
                return { kind: "break" };
            }
            return { kind: "continue" };
        },
    }, {
        appendRunEvent: dependencies.appendRunEvent,
    });
}
//# sourceMappingURL=recovery-entry-pass.js.map