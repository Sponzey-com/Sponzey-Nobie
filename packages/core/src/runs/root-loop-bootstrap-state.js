import { bootstrapLoopState } from "./loop-bootstrap.js";
export function prepareRootLoopBootstrapState(params, dependencies) {
    const loopBootstrap = bootstrapLoopState({
        runId: params.runId,
        sessionId: params.sessionId,
        skipIntake: params.skipIntake,
        immediateCompletionText: params.immediateCompletionText,
        reconnectNeedsClarification: params.reconnectNeedsClarification,
        ...(params.reconnectTargetTitle ? { reconnectTarget: { title: params.reconnectTargetTitle } } : {}),
        ...(params.reconnectSelection ? { reconnectSelection: params.reconnectSelection } : {}),
        queuedBehindRequestGroupRun: params.queuedBehindRequestGroupRun,
        aborted: params.controller.signal.aborted,
        ...(params.activeWorkerRuntime ? { activeWorkerRuntime: params.activeWorkerRuntime } : {}),
        requiresFilesystemMutation: params.requiresFilesystemMutation,
        requiresPrivilegedToolExecution: params.requiresPrivilegedToolExecution,
    }, {
        appendRunEvent: dependencies.appendRunEvent,
        updateRunSummary: dependencies.updateRunSummary,
        setRunStepStatus: dependencies.setRunStepStatus,
        updateRunStatus: dependencies.updateRunStatus,
        logInfo: dependencies.onBootstrapInfo ?? (() => { }),
    });
    return {
        intakeProcessed: loopBootstrap.intakeProcessed,
        pendingLoopDirective: loopBootstrap.pendingLoopDirective,
        state: {
            currentMessage: params.currentMessage,
            currentModel: params.currentModel,
            currentProviderId: params.currentProviderId,
            currentProvider: params.currentProvider,
            currentTargetId: params.currentTargetId,
            currentTargetLabel: params.currentTargetLabel,
            activeWorkerRuntime: loopBootstrap.activeWorkerRuntime,
            executionRecoveryLimitStop: null,
            aiRecoveryLimitStop: null,
            sawRealFilesystemMutation: false,
            filesystemMutationRecoveryAttempted: false,
            truncatedOutputRecoveryAttempted: false,
        },
    };
}
//# sourceMappingURL=root-loop-bootstrap-state.js.map