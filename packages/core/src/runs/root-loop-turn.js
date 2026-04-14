import { applyLoopEntryPassResult } from "./loop-pass-application.js";
import { runLoopEntryPass } from "./loop-entry-pass.js";
import { prepareRootExecutionCyclePassLaunch, prepareRootLoopEntryPassLaunch, } from "./root-loop-pass-launch.js";
import { runExecutionCyclePass } from "./execution-cycle-pass.js";
const defaultModuleDependencies = {
    prepareRootLoopEntryPassLaunch,
    runLoopEntryPass,
    applyLoopEntryPassResult,
    prepareRootExecutionCyclePassLaunch,
    runExecutionCyclePass,
};
export async function runRootLoopTurn(params, dependencies, moduleDependencies = defaultModuleDependencies) {
    const loopEntryLaunch = moduleDependencies.prepareRootLoopEntryPassLaunch({
        runId: params.runId,
        sessionId: params.sessionId,
        source: params.source,
        onChunk: params.onChunk,
        pendingLoopDirective: params.pendingLoopDirective,
        intakeProcessed: params.intakeProcessed,
        currentMessage: params.state.currentMessage,
        recoveryBudgetUsage: params.recoveryBudgetUsage,
    }, dependencies);
    const loopEntryPass = await moduleDependencies.runLoopEntryPass(loopEntryLaunch.params, loopEntryLaunch.dependencies);
    const loopEntryApplication = moduleDependencies.applyLoopEntryPassResult(loopEntryPass);
    if (loopEntryApplication.kind === "break") {
        return { kind: "break" };
    }
    const nextPendingLoopDirective = loopEntryApplication.state.pendingLoopDirective;
    const nextIntakeProcessed = loopEntryApplication.state.intakeProcessed;
    if (loopEntryApplication.kind === "retry") {
        return {
            kind: "continue",
            pendingLoopDirective: nextPendingLoopDirective,
            intakeProcessed: nextIntakeProcessed,
            state: {
                ...params.state,
                currentMessage: loopEntryApplication.nextMessage,
            },
        };
    }
    if (nextPendingLoopDirective) {
        return {
            kind: "continue",
            pendingLoopDirective: nextPendingLoopDirective,
            intakeProcessed: nextIntakeProcessed,
            state: params.state,
        };
    }
    const executionCycleLaunch = moduleDependencies.prepareRootExecutionCyclePassLaunch({
        runId: params.runId,
        sessionId: params.sessionId,
        requestGroupId: params.requestGroupId,
        source: params.source,
        onChunk: params.onChunk,
        signal: params.signal,
        abortExecutionStream: params.abortExecutionStream,
        state: params.state,
        executionSemantics: params.executionSemantics,
        originalRequest: params.originalRequest,
        ...(params.structuredRequest ? { structuredRequest: params.structuredRequest } : {}),
        requestMessage: params.requestMessage,
        workDir: params.workDir,
        ...(params.toolsEnabled === false ? { toolsEnabled: false } : {}),
        isRootRequest: params.isRootRequest,
        contextMode: params.contextMode,
        taskProfile: params.taskProfile,
        ...(params.workerSessionId ? { workerSessionId: params.workerSessionId } : {}),
        wantsDirectArtifactDelivery: params.wantsDirectArtifactDelivery,
        requiresFilesystemMutation: params.requiresFilesystemMutation,
        requiresPrivilegedToolExecution: params.requiresPrivilegedToolExecution,
        pendingToolParams: params.pendingToolParams,
        filesystemMutationPaths: params.filesystemMutationPaths,
        seenFollowupPrompts: params.seenFollowupPrompts,
        seenCommandFailureRecoveryKeys: params.seenCommandFailureRecoveryKeys,
        seenExecutionRecoveryKeys: params.seenExecutionRecoveryKeys,
        seenDeliveryRecoveryKeys: params.seenDeliveryRecoveryKeys,
        seenAiRecoveryKeys: params.seenAiRecoveryKeys,
        recoveryBudgetUsage: params.recoveryBudgetUsage,
        priorAssistantMessages: params.priorAssistantMessages,
        syntheticApprovalRuntimeDependencies: params.syntheticApprovalRuntimeDependencies,
        defaultMaxDelegationTurns: params.defaultMaxDelegationTurns,
    }, dependencies);
    const executionCyclePass = await moduleDependencies.runExecutionCyclePass(executionCycleLaunch.params, executionCycleLaunch.dependencies);
    if (executionCyclePass.kind === "retry") {
        return {
            kind: "continue",
            pendingLoopDirective: nextPendingLoopDirective,
            intakeProcessed: nextIntakeProcessed,
            state: executionCyclePass.state,
        };
    }
    return { kind: "break" };
}
//# sourceMappingURL=root-loop-turn.js.map