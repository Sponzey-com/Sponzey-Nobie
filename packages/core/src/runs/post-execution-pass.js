import crypto from "node:crypto";
import { insertMessage } from "../db/index.js";
import { logAssistantReply, } from "./delivery.js";
import { runDeliveryPass } from "./delivery-pass.js";
import { decideExecutionPostPassRecovery, } from "./execution-postpass.js";
import { applyExecutionPostPassDecision } from "./execution-postpass-application.js";
import { decideFilesystemPostPassRecovery, } from "./filesystem-postpass.js";
import { applyFilesystemPostPassDecision } from "./filesystem-postpass-application.js";
import { runReviewEntryPass } from "./review-entry-pass.js";
import { getRecoveryBudgetState, canConsumeRecoveryBudget } from "./recovery-budget.js";
const defaultModuleDependencies = {
    decideExecutionPostPassRecovery,
    applyExecutionPostPassDecision,
    runDeliveryPass,
    decideFilesystemPostPassRecovery,
    applyFilesystemPostPassDecision,
    runReviewEntryPass,
};
const defaultDependencies = {
    insertMessage,
    writeReplyLog: logAssistantReply,
    createId: () => crypto.randomUUID(),
    now: () => Date.now(),
};
export async function runPostExecutionPass(params, dependencies, moduleDependencies = defaultModuleDependencies) {
    const mergedDependencies = { ...defaultDependencies, ...dependencies };
    const executionPostPassDecision = moduleDependencies.decideExecutionPostPassRecovery({
        originalRequest: params.originalRequest,
        preview: params.preview,
        directArtifactDeliverySatisfied: params.wantsDirectArtifactDelivery && params.successfulFileDeliveries.length > 0,
        failedCommandTools: params.failedCommandTools,
        commandFailureSeen: params.commandFailureSeen,
        commandRecoveredWithinSamePass: params.commandRecoveredWithinSamePass,
        executionRecovery: params.executionRecovery,
        seenCommandFailureRecoveryKeys: params.seenCommandFailureRecoveryKeys,
        seenExecutionRecoveryKeys: params.seenExecutionRecoveryKeys,
        recoveryBudgetUsage: params.recoveryBudgetUsage,
        usedTurns: params.usedTurns,
        maxDelegationTurns: params.maxDelegationTurns,
    });
    const executionPostPassApplication = await moduleDependencies.applyExecutionPostPassDecision({
        runId: params.runId,
        sessionId: params.sessionId,
        source: params.source,
        onChunk: params.onChunk,
        preview: params.preview,
        decision: executionPostPassDecision,
        recoveryBudgetUsage: params.recoveryBudgetUsage,
        finalizationDependencies: mergedDependencies.getFinalizationDependencies(),
    }, {
        rememberRunFailure: mergedDependencies.rememberRunFailure,
        incrementDelegationTurnCount: mergedDependencies.incrementDelegationTurnCount,
        appendRunEvent: mergedDependencies.appendRunEvent,
        updateRunSummary: mergedDependencies.updateRunSummary,
        setRunStepStatus: mergedDependencies.setRunStepStatus,
        updateRunStatus: mergedDependencies.updateRunStatus,
    });
    if (executionPostPassApplication.kind === "break") {
        return { kind: "break" };
    }
    if (executionPostPassApplication.kind === "retry") {
        return {
            kind: "retry",
            nextMessage: executionPostPassApplication.nextMessage,
            clearWorkerRuntime: executionPostPassApplication.clearWorkerRuntime,
            ...(executionPostPassApplication.seenKey?.kind === "command"
                ? { seenCommandFailureRecoveryKey: executionPostPassApplication.seenKey.key }
                : {}),
            ...(executionPostPassApplication.seenKey?.kind === "generic_execution"
                ? { seenExecutionRecoveryKey: executionPostPassApplication.seenKey.key }
                : {}),
        };
    }
    const deliveryBudget = getRecoveryBudgetState({
        usage: params.recoveryBudgetUsage,
        kind: "delivery",
        maxDelegationTurns: params.maxDelegationTurns,
    });
    const deliveryPass = moduleDependencies.runDeliveryPass({
        preview: params.preview,
        wantsDirectArtifactDelivery: params.wantsDirectArtifactDelivery,
        successfulFileDeliveries: params.successfulFileDeliveries,
        successfulTools: params.successfulTools,
        sawRealFilesystemMutation: params.sawRealFilesystemMutation,
        source: params.source,
        seenDeliveryRecoveryKeys: params.seenDeliveryRecoveryKeys,
        canRetry: (params.maxDelegationTurns <= 0 || params.usedTurns < params.maxDelegationTurns)
            && canConsumeRecoveryBudget({
                usage: params.recoveryBudgetUsage,
                kind: "delivery",
                maxDelegationTurns: params.maxDelegationTurns,
            }),
        maxTurns: params.maxDelegationTurns,
        deliveryBudgetLimit: deliveryBudget.limit,
        originalRequest: params.originalRequest,
        previousResult: params.preview,
    });
    let nextPreview = deliveryPass.preview;
    if (deliveryPass.summaryToLog) {
        mergedDependencies.updateRunSummary(params.runId, deliveryPass.summaryToLog);
    }
    const filesystemPostPassDecision = await moduleDependencies.decideFilesystemPostPassRecovery({
        requiresFilesystemMutation: params.requiresFilesystemMutation,
        deliverySatisfied: deliveryPass.deliveryOutcome.deliverySatisfied,
        sawRealFilesystemMutation: params.sawRealFilesystemMutation,
        filesystemMutationRecoveryAttempted: params.filesystemMutationRecoveryAttempted,
        originalRequest: params.originalRequest,
        verificationRequest: params.verificationRequest,
        preview: nextPreview,
        mutationPaths: params.mutationPaths,
        recoveryBudgetUsage: params.recoveryBudgetUsage,
        usedTurns: params.usedTurns,
        maxDelegationTurns: params.maxDelegationTurns,
        runVerificationSubtask: mergedDependencies.runVerificationSubtask,
    });
    const filesystemPostPassApplication = await moduleDependencies.applyFilesystemPostPassDecision({
        runId: params.runId,
        sessionId: params.sessionId,
        source: params.source,
        onChunk: params.onChunk,
        preview: nextPreview,
        decision: filesystemPostPassDecision,
        recoveryBudgetUsage: params.recoveryBudgetUsage,
        finalizationDependencies: mergedDependencies.getFinalizationDependencies(),
    }, {
        rememberRunFailure: mergedDependencies.rememberRunFailure,
        incrementDelegationTurnCount: mergedDependencies.incrementDelegationTurnCount,
        appendRunEvent: mergedDependencies.appendRunEvent,
        updateRunSummary: mergedDependencies.updateRunSummary,
        setRunStepStatus: mergedDependencies.setRunStepStatus,
        updateRunStatus: mergedDependencies.updateRunStatus,
    });
    if (filesystemPostPassApplication.kind === "break") {
        return { kind: "break" };
    }
    if (filesystemPostPassApplication.kind === "retry") {
        return {
            kind: "retry",
            nextMessage: filesystemPostPassApplication.nextMessage,
            clearWorkerRuntime: filesystemPostPassApplication.clearWorkerRuntime,
            ...(filesystemPostPassApplication.markMutationRecoveryAttempted
                ? { markMutationRecoveryAttempted: true }
                : {}),
        };
    }
    if (filesystemPostPassApplication.preview) {
        nextPreview = filesystemPostPassApplication.preview;
    }
    const reviewEntryPass = await moduleDependencies.runReviewEntryPass({
        runId: params.runId,
        sessionId: params.sessionId,
        source: params.source,
        onChunk: params.onChunk,
        preview: nextPreview,
        ...(params.workerSessionId ? { workerSessionId: params.workerSessionId } : {}),
        persistRuntimePreview: params.activeWorkerRuntime,
        directDeliveryApplication: deliveryPass.directDeliveryApplication,
        recoveryBudgetUsage: params.recoveryBudgetUsage,
        maxDelegationTurns: params.maxDelegationTurns,
    }, {
        rememberRunFailure: mergedDependencies.rememberRunFailure,
        incrementDelegationTurnCount: mergedDependencies.incrementDelegationTurnCount,
        appendRunEvent: mergedDependencies.appendRunEvent,
        updateRunSummary: mergedDependencies.updateRunSummary,
        setRunStepStatus: mergedDependencies.setRunStepStatus,
        updateRunStatus: mergedDependencies.updateRunStatus,
        getFinalizationDependencies: mergedDependencies.getFinalizationDependencies,
        insertMessage: mergedDependencies.insertMessage,
        writeReplyLog: mergedDependencies.writeReplyLog,
        createId: mergedDependencies.createId,
        now: mergedDependencies.now,
    });
    if (reviewEntryPass.kind === "break") {
        return { kind: "break" };
    }
    if (reviewEntryPass.kind === "retry") {
        return {
            kind: "retry",
            nextMessage: reviewEntryPass.nextMessage,
            clearWorkerRuntime: reviewEntryPass.clearWorkerRuntime,
            ...(deliveryPass.directDeliveryApplication.kind === "retry"
                ? { seenDeliveryRecoveryKey: deliveryPass.directDeliveryApplication.recoveryKey }
                : {}),
        };
    }
    return {
        kind: "continue",
        preview: nextPreview,
        deliveryOutcome: deliveryPass.deliveryOutcome,
    };
}
//# sourceMappingURL=post-execution-pass.js.map