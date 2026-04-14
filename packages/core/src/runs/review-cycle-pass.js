import { getRootRun } from "./store.js";
import { defaultReviewPassDependencies, runReviewPass } from "./review-pass.js";
import { runReviewOutcomePass } from "./review-outcome-pass.js";
import { decideReviewGate } from "./review-gate.js";
const defaultModuleDependencies = {
    decideReviewGate,
    runReviewPass,
    runReviewOutcomePass,
    getRootRun,
};
export async function runReviewCyclePass(params, dependencies, moduleDependencies = defaultModuleDependencies) {
    const reviewGate = moduleDependencies.decideReviewGate({
        executionSemantics: params.executionSemantics,
        preview: params.preview,
        deliveryOutcome: params.deliveryOutcome,
        successfulTools: params.successfulTools,
        sawRealFilesystemMutation: params.sawRealFilesystemMutation,
        requiresFilesystemMutation: params.requiresFilesystemMutation,
        truncatedOutputRecoveryAttempted: params.truncatedOutputRecoveryAttempted,
    });
    const reviewPass = reviewGate.kind === "skip"
        ? {
            review: null,
            syntheticApproval: null,
        }
        : await moduleDependencies.runReviewPass({
            executionProfile: {
                approvalRequired: params.approvalRequired,
                approvalTool: params.approvalTool,
            },
            originalRequest: params.originalRequest,
            preview: params.preview,
            priorAssistantMessages: params.priorAssistantMessages,
            ...(params.model ? { model: params.model } : {}),
            ...(params.providerId ? { providerId: params.providerId } : {}),
            ...(params.provider ? { provider: params.provider } : {}),
            ...(params.workDir ? { workDir: params.workDir } : {}),
            usesWorkerRuntime: params.usesWorkerRuntime,
            requiresPrivilegedToolExecution: params.requiresPrivilegedToolExecution,
            successfulTools: params.successfulTools,
            successfulFileDeliveries: params.successfulFileDeliveries,
            sawRealFilesystemMutation: params.sawRealFilesystemMutation,
        }, {
            ...defaultReviewPassDependencies,
            ...(dependencies.onReviewError ? { onReviewError: dependencies.onReviewError } : {}),
        });
    params.priorAssistantMessages.push(params.preview);
    const currentRun = moduleDependencies.getRootRun(params.runId);
    const normalizedFollowupPrompt = reviewPass.review?.status === "followup"
        ? reviewPass.review.followupPrompt?.replace(/\s+/g, " ").trim().toLowerCase()
        : undefined;
    return moduleDependencies.runReviewOutcomePass({
        runId: params.runId,
        sessionId: params.sessionId,
        source: params.source,
        onChunk: params.onChunk,
        signal: params.signal,
        preview: params.preview,
        review: reviewPass.review,
        syntheticApproval: reviewPass.syntheticApproval,
        executionSemantics: params.executionSemantics,
        deliveryOutcome: params.deliveryOutcome,
        successfulTools: params.successfulTools,
        sawRealFilesystemMutation: params.sawRealFilesystemMutation,
        requiresFilesystemMutation: params.requiresFilesystemMutation,
        truncatedOutputRecoveryAttempted: params.truncatedOutputRecoveryAttempted,
        originalRequest: params.originalRequest,
        recoveryBudgetUsage: params.recoveryBudgetUsage,
        ...(typeof currentRun?.delegationTurnCount === "number"
            ? { delegationTurnCount: currentRun.delegationTurnCount }
            : {}),
        ...(typeof currentRun?.maxDelegationTurns === "number"
            ? { maxDelegationTurns: currentRun.maxDelegationTurns }
            : {}),
        defaultMaxDelegationTurns: params.defaultMaxDelegationTurns,
        followupPromptSeen: Boolean(normalizedFollowupPrompt && params.seenFollowupPrompts.has(normalizedFollowupPrompt)),
        syntheticApprovalAlreadyApproved: params.syntheticApprovalAlreadyApproved,
        syntheticApprovalSourceLabel: params.workerRuntimeKind ?? "agent_reply",
        syntheticApprovalRuntimeDependencies: params.syntheticApprovalRuntimeDependencies,
        finalizationDependencies: params.finalizationDependencies,
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
    });
}
//# sourceMappingURL=review-cycle-pass.js.map