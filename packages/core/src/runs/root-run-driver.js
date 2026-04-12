import { createExecutionLoopRuntimeState } from "./execution-profile.js";
import { applyRootRunDriverFailure } from "./root-run-driver-failure.js";
import { prepareRootLoopLaunch } from "./root-loop-launch.js";
import { runRootLoop } from "./root-loop.js";
const defaultModuleDependencies = {
    createExecutionLoopRuntimeState,
    prepareRootLoopLaunch,
    runRootLoop,
    applyRootRunDriverFailure,
};
export async function executeRootRunDriver(params, dependencies, moduleDependencies = defaultModuleDependencies) {
    const executionLoopRuntime = moduleDependencies.createExecutionLoopRuntimeState({
        message: params.message,
        ...(params.originalRequest ? { originalRequest: params.originalRequest } : {}),
        ...(params.executionSemantics ? { executionSemantics: params.executionSemantics } : {}),
        ...(params.structuredRequest ? { structuredRequest: params.structuredRequest } : {}),
        ...(params.intentEnvelope ? { intentEnvelope: params.intentEnvelope } : {}),
    });
    const rootLoopLaunch = moduleDependencies.prepareRootLoopLaunch({
        runId: params.runId,
        sessionId: params.sessionId,
        requestGroupId: params.requestGroupId,
        source: params.source,
        onChunk: params.onChunk,
        controller: params.controller,
        message: params.message,
        currentModel: params.currentModel,
        currentProviderId: params.currentProviderId,
        currentProvider: params.currentProvider,
        currentTargetId: params.currentTargetId,
        currentTargetLabel: params.currentTargetLabel,
        workDir: params.workDir,
        ...(params.skipIntake ? { skipIntake: params.skipIntake } : {}),
        ...(params.immediateCompletionText ? { immediateCompletionText: params.immediateCompletionText } : {}),
        reconnectNeedsClarification: params.reconnectNeedsClarification,
        ...(params.reconnectTargetTitle ? { reconnectTargetTitle: params.reconnectTargetTitle } : {}),
        ...(params.reconnectSelection ? { reconnectSelection: params.reconnectSelection } : {}),
        queuedBehindRequestGroupRun: params.queuedBehindRequestGroupRun,
        activeWorkerRuntime: params.activeWorkerRuntime,
        ...(params.workerSessionId ? { workerSessionId: params.workerSessionId } : {}),
        ...(params.toolsEnabled === false ? { toolsEnabled: false } : {}),
        isRootRequest: params.isRootRequest,
        contextMode: params.contextMode,
        taskProfile: params.taskProfile,
        syntheticApprovalRuntimeDependencies: params.syntheticApprovalRuntimeDependencies,
        defaultMaxDelegationTurns: params.defaultMaxDelegationTurns,
    }, dependencies, executionLoopRuntime);
    try {
        await new Promise((resolve) => setImmediate(resolve));
        await moduleDependencies.runRootLoop(rootLoopLaunch.rootLoopParams, rootLoopLaunch.rootLoopDependencies);
    }
    catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await moduleDependencies.applyRootRunDriverFailure({
            runId: params.runId,
            sessionId: params.sessionId,
            source: params.source,
            onChunk: params.onChunk,
            aborted: params.controller.signal.aborted,
            message,
        }, {
            appendRunEvent: dependencies.appendRunEvent,
            setRunStepStatus: dependencies.setRunStepStatus,
            updateRunStatus: dependencies.updateRunStatus,
            rememberRunFailure: dependencies.rememberRunFailure,
            markAbortedRunCancelledIfActive: dependencies.markAbortedRunCancelledIfActive,
            ...(dependencies.onDeliveryError ? { onDeliveryError: dependencies.onDeliveryError } : {}),
        });
    }
    finally {
        dependencies.onFinally?.();
    }
}
//# sourceMappingURL=root-run-driver.js.map