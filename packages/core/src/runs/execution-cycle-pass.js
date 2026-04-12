import { applyPostExecutionPassResult, applyRecoveryEntryPassResult, applyReviewCyclePassResult } from "./loop-pass-application.js";
import { runExecutionAttemptPass, } from "./execution-attempt-pass.js";
import { runRecoveryEntryPass, } from "./recovery-entry-pass.js";
import { runPostExecutionPass, } from "./post-execution-pass.js";
import { runReviewCyclePass, } from "./review-cycle-pass.js";
const defaultModuleDependencies = {
    runExecutionAttemptPass,
    runRecoveryEntryPass,
    runPostExecutionPass,
    runReviewCyclePass,
    applyRecoveryEntryPassResult,
    applyPostExecutionPassResult,
    applyReviewCyclePassResult,
};
export async function runExecutionCyclePass(params, dependencies, moduleDependencies = defaultModuleDependencies) {
    let preview = "";
    let failed = false;
    let aiRecovery = null;
    let workerRuntimeRecovery = null;
    let executionRecovery = null;
    const failedCommandTools = [];
    const successfulFileDeliveries = [];
    const successfulTextDeliveries = [];
    let commandFailureSeen = false;
    let commandRecoveredWithinSamePass = false;
    const executionAttemptPass = await moduleDependencies.runExecutionAttemptPass({
        runId: params.runId,
        sessionId: params.sessionId,
        source: params.source,
        onChunk: params.onChunk,
        ...(params.onDeliveryError ? { onDeliveryError: params.onDeliveryError } : {}),
        currentMessage: params.state.currentMessage,
        memorySearchQuery: params.memorySearchQuery,
        ...(params.state.currentModel ? { model: params.state.currentModel } : {}),
        ...(params.state.currentProviderId ? { providerId: params.state.currentProviderId } : {}),
        ...(params.state.currentProvider ? { provider: params.state.currentProvider } : {}),
        workDir: params.workDir,
        signal: params.signal,
        ...(params.toolsEnabled === false ? { toolsEnabled: false } : {}),
        isRootRequest: params.isRootRequest,
        requestGroupId: params.requestGroupId,
        contextMode: params.contextMode,
        preview,
        ...(params.state.activeWorkerRuntime ? { activeWorkerRuntime: params.state.activeWorkerRuntime } : {}),
        ...(params.workerSessionId ? { workerSessionId: params.workerSessionId } : {}),
        pendingToolParams: params.pendingToolParams,
        successfulTools: params.successfulTools,
        filesystemMutationPaths: params.filesystemMutationPaths,
        failedCommandTools,
        successfulFileDeliveries,
        successfulTextDeliveries,
        commandFailureSeen,
        recoveryBudgetUsage: params.recoveryBudgetUsage,
        executionRecoveryLimitStop: params.state.executionRecoveryLimitStop,
        stopAfterDirectArtifactDeliverySuccess: params.wantsDirectArtifactDelivery,
        abortExecutionStream: () => { },
    }, {
        rememberRunFailure: dependencies.rememberRunFailure,
        incrementDelegationTurnCount: dependencies.incrementDelegationTurnCount,
        appendRunEvent: dependencies.appendRunEvent,
        updateRunSummary: dependencies.updateRunSummary,
        setRunStepStatus: dependencies.setRunStepStatus,
        updateRunStatus: dependencies.updateRunStatus,
        markAbortedRunCancelledIfActive: dependencies.markAbortedRunCancelledIfActive,
    });
    preview = executionAttemptPass.preview;
    failed = executionAttemptPass.failed;
    aiRecovery = executionAttemptPass.aiRecovery;
    workerRuntimeRecovery = executionAttemptPass.workerRuntimeRecovery;
    executionRecovery = executionAttemptPass.executionRecovery;
    commandFailureSeen = executionAttemptPass.commandFailureSeen;
    commandRecoveredWithinSamePass = executionAttemptPass.commandRecoveredWithinSamePass;
    const nextStateFromAttempt = {
        ...params.state,
        executionRecoveryLimitStop: executionAttemptPass.executionRecoveryLimitStop,
        aiRecoveryLimitStop: executionAttemptPass.aiRecoveryLimitStop,
        sawRealFilesystemMutation: params.state.sawRealFilesystemMutation || executionAttemptPass.sawRealFilesystemMutation,
    };
    const recoveryEntryPass = await moduleDependencies.runRecoveryEntryPass({
        runId: params.runId,
        sessionId: params.sessionId,
        source: params.source,
        onChunk: params.onChunk,
        preview,
        executionRecoveryLimitStop: nextStateFromAttempt.executionRecoveryLimitStop,
        aiRecoveryLimitStop: nextStateFromAttempt.aiRecoveryLimitStop,
        recoveries: [
            { kind: "ai", payload: aiRecovery },
            { kind: "worker_runtime", payload: workerRuntimeRecovery },
        ],
        aborted: params.signal.aborted,
        failed,
        taskProfile: params.taskProfile,
        current: {
            model: nextStateFromAttempt.currentModel,
            providerId: nextStateFromAttempt.currentProviderId,
            provider: nextStateFromAttempt.currentProvider,
            targetId: nextStateFromAttempt.currentTargetId,
            targetLabel: nextStateFromAttempt.currentTargetLabel,
            workerRuntime: nextStateFromAttempt.activeWorkerRuntime,
        },
        seenKeys: params.seenAiRecoveryKeys,
        originalRequest: params.originalRequest,
        previousResult: preview,
        finalizationDependencies: dependencies.getFinalizationDependencies(),
    }, {
        appendRunEvent: dependencies.appendRunEvent,
    });
    const recoveryEntryApplication = moduleDependencies.applyRecoveryEntryPassResult({
        result: recoveryEntryPass,
        currentMessage: nextStateFromAttempt.currentMessage,
    });
    if (recoveryEntryApplication.kind === "break") {
        return { kind: "break" };
    }
    if (recoveryEntryApplication.kind === "retry") {
        return {
            kind: "retry",
            state: {
                ...nextStateFromAttempt,
                ...recoveryEntryApplication.state,
            },
        };
    }
    const { usedTurns, maxTurns } = dependencies.getDelegationTurnState();
    const postExecutionPass = await moduleDependencies.runPostExecutionPass({
        runId: params.runId,
        sessionId: params.sessionId,
        source: params.source,
        onChunk: params.onChunk,
        preview,
        originalRequest: params.originalRequest,
        verificationRequest: params.verificationRequest,
        wantsDirectArtifactDelivery: params.wantsDirectArtifactDelivery,
        requiresFilesystemMutation: params.requiresFilesystemMutation,
        activeWorkerRuntime: Boolean(nextStateFromAttempt.activeWorkerRuntime),
        ...(params.workerSessionId ? { workerSessionId: params.workerSessionId } : {}),
        successfulFileDeliveries,
        successfulTools: params.successfulTools,
        sawRealFilesystemMutation: nextStateFromAttempt.sawRealFilesystemMutation,
        filesystemMutationRecoveryAttempted: nextStateFromAttempt.filesystemMutationRecoveryAttempted,
        mutationPaths: [...params.filesystemMutationPaths],
        failedCommandTools,
        commandFailureSeen,
        commandRecoveredWithinSamePass,
        executionRecovery,
        seenCommandFailureRecoveryKeys: params.seenCommandFailureRecoveryKeys,
        seenExecutionRecoveryKeys: params.seenExecutionRecoveryKeys,
        seenDeliveryRecoveryKeys: params.seenDeliveryRecoveryKeys,
        recoveryBudgetUsage: params.recoveryBudgetUsage,
        usedTurns,
        maxDelegationTurns: maxTurns,
    }, {
        rememberRunFailure: dependencies.rememberRunFailure,
        incrementDelegationTurnCount: dependencies.incrementDelegationTurnCount,
        appendRunEvent: dependencies.appendRunEvent,
        updateRunSummary: dependencies.updateRunSummary,
        setRunStepStatus: dependencies.setRunStepStatus,
        updateRunStatus: dependencies.updateRunStatus,
        getFinalizationDependencies: dependencies.getFinalizationDependencies,
        insertMessage: dependencies.insertMessage,
        writeReplyLog: dependencies.writeReplyLog,
        createId: dependencies.createId,
        now: dependencies.now,
        runVerificationSubtask: dependencies.runVerificationSubtask,
    });
    const postExecutionApplication = moduleDependencies.applyPostExecutionPassResult({
        result: postExecutionPass,
        currentMessage: nextStateFromAttempt.currentMessage,
        filesystemMutationRecoveryAttempted: nextStateFromAttempt.filesystemMutationRecoveryAttempted,
        activeWorkerRuntime: nextStateFromAttempt.activeWorkerRuntime,
        seenCommandFailureRecoveryKeys: params.seenCommandFailureRecoveryKeys,
        seenExecutionRecoveryKeys: params.seenExecutionRecoveryKeys,
        seenDeliveryRecoveryKeys: params.seenDeliveryRecoveryKeys,
    });
    if (postExecutionApplication.kind === "break") {
        return { kind: "break" };
    }
    if (postExecutionApplication.kind === "retry") {
        return {
            kind: "retry",
            state: {
                ...nextStateFromAttempt,
                currentMessage: postExecutionApplication.state.currentMessage,
                filesystemMutationRecoveryAttempted: postExecutionApplication.state.filesystemMutationRecoveryAttempted,
                activeWorkerRuntime: postExecutionApplication.state.activeWorkerRuntime,
            },
        };
    }
    const reviewOutcomePass = await moduleDependencies.runReviewCyclePass({
        runId: params.runId,
        sessionId: params.sessionId,
        source: params.source,
        onChunk: params.onChunk,
        signal: params.signal,
        preview: postExecutionApplication.preview,
        priorAssistantMessages: params.priorAssistantMessages,
        executionSemantics: params.executionSemantics,
        requiresFilesystemMutation: params.requiresFilesystemMutation,
        originalRequest: params.originalRequest,
        ...(nextStateFromAttempt.currentModel ? { model: nextStateFromAttempt.currentModel } : {}),
        ...(nextStateFromAttempt.currentProviderId ? { providerId: nextStateFromAttempt.currentProviderId } : {}),
        ...(nextStateFromAttempt.currentProvider ? { provider: nextStateFromAttempt.currentProvider } : {}),
        workDir: params.workDir,
        usesWorkerRuntime: Boolean(postExecutionApplication.state.activeWorkerRuntime),
        ...(postExecutionApplication.state.activeWorkerRuntime?.kind
            ? { workerRuntimeKind: postExecutionApplication.state.activeWorkerRuntime.kind }
            : {}),
        requiresPrivilegedToolExecution: params.requiresPrivilegedToolExecution,
        deliveryOutcome: postExecutionApplication.deliveryOutcome,
        successfulTools: params.successfulTools,
        successfulFileDeliveries,
        sawRealFilesystemMutation: nextStateFromAttempt.sawRealFilesystemMutation,
        truncatedOutputRecoveryAttempted: nextStateFromAttempt.truncatedOutputRecoveryAttempted,
        recoveryBudgetUsage: params.recoveryBudgetUsage,
        defaultMaxDelegationTurns: params.defaultMaxDelegationTurns,
        seenFollowupPrompts: params.seenFollowupPrompts,
        syntheticApprovalAlreadyApproved: params.syntheticApprovalAlreadyApproved,
        approvalRequired: params.executionSemantics.approvalRequired,
        approvalTool: params.executionSemantics.approvalTool,
        syntheticApprovalRuntimeDependencies: params.syntheticApprovalRuntimeDependencies,
        finalizationDependencies: dependencies.getFinalizationDependencies(),
    }, {
        rememberRunApprovalScope: dependencies.rememberRunApprovalScope,
        grantRunApprovalScope: dependencies.grantRunApprovalScope,
        grantRunSingleApproval: dependencies.grantRunSingleApproval,
        rememberRunFailure: dependencies.rememberRunFailure,
        incrementDelegationTurnCount: dependencies.incrementDelegationTurnCount,
        appendRunEvent: dependencies.appendRunEvent,
        updateRunSummary: dependencies.updateRunSummary,
        setRunStepStatus: dependencies.setRunStepStatus,
        updateRunStatus: dependencies.updateRunStatus,
        ...(dependencies.onReviewError ? { onReviewError: dependencies.onReviewError } : {}),
    });
    const reviewCycleApplication = moduleDependencies.applyReviewCyclePassResult({
        result: reviewOutcomePass,
        currentMessage: postExecutionApplication.state.currentMessage,
        truncatedOutputRecoveryAttempted: nextStateFromAttempt.truncatedOutputRecoveryAttempted,
        activeWorkerRuntime: postExecutionApplication.state.activeWorkerRuntime,
        currentProvider: nextStateFromAttempt.currentProvider,
        seenFollowupPrompts: params.seenFollowupPrompts,
    });
    if (reviewCycleApplication.kind === "retry") {
        return {
            kind: "retry",
            state: {
                ...nextStateFromAttempt,
                currentMessage: reviewCycleApplication.state.currentMessage,
                activeWorkerRuntime: reviewCycleApplication.state.activeWorkerRuntime,
                currentProvider: reviewCycleApplication.state.currentProvider,
                filesystemMutationRecoveryAttempted: postExecutionApplication.state.filesystemMutationRecoveryAttempted,
                truncatedOutputRecoveryAttempted: reviewCycleApplication.state.truncatedOutputRecoveryAttempted,
            },
        };
    }
    return { kind: "break" };
}
//# sourceMappingURL=execution-cycle-pass.js.map