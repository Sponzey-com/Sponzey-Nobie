import { applySyntheticApprovalContinuation } from "./approval-application.js";
import { runSyntheticApprovalPass } from "./approval-pass.js";
import { applyCompletionApplicationPass } from "./completion-application-pass.js";
import { runCompletionPass } from "./completion-pass.js";
const defaultModuleDependencies = {
    runSyntheticApprovalPass,
    applySyntheticApprovalContinuation,
    runCompletionPass,
    applyCompletionApplicationPass,
};
export async function runReviewOutcomePass(params, dependencies, moduleDependencies = defaultModuleDependencies) {
    if (params.syntheticApproval) {
        const continuation = await moduleDependencies.runSyntheticApprovalPass({
            request: params.syntheticApproval,
            runId: params.runId,
            sessionId: params.sessionId,
            signal: params.signal,
            alreadyApproved: params.syntheticApprovalAlreadyApproved,
            sourceLabel: params.syntheticApprovalSourceLabel,
            originalRequest: params.originalRequest,
            latestAssistantMessage: params.preview,
            runtimeDependencies: params.syntheticApprovalRuntimeDependencies,
        });
        const approvalApplication = moduleDependencies.applySyntheticApprovalContinuation({
            runId: params.runId,
            continuation,
            aborted: params.signal.aborted,
        }, dependencies);
        if (approvalApplication.kind === "stop") {
            return { kind: "break" };
        }
        return {
            kind: "retry",
            nextMessage: approvalApplication.nextMessage,
            clearWorkerRuntime: approvalApplication.clearWorkerRuntime,
            ...(approvalApplication.clearProvider ? { clearProvider: approvalApplication.clearProvider } : {}),
        };
    }
    const normalizedFollowupPrompt = params.review?.status === "followup"
        ? params.review.followupPrompt?.replace(/\s+/g, " ").trim().toLowerCase()
        : undefined;
    const completionPass = moduleDependencies.runCompletionPass({
        review: params.review,
        executionSemantics: params.executionSemantics,
        preview: params.preview,
        deliveryOutcome: params.deliveryOutcome,
        successfulTools: params.successfulTools,
        sawRealFilesystemMutation: params.sawRealFilesystemMutation,
        requiresFilesystemMutation: params.requiresFilesystemMutation,
        truncatedOutputRecoveryAttempted: params.truncatedOutputRecoveryAttempted,
        originalRequest: params.originalRequest,
        recoveryBudgetUsage: params.recoveryBudgetUsage,
        ...(typeof params.delegationTurnCount === "number"
            ? { delegationTurnCount: params.delegationTurnCount }
            : {}),
        ...(typeof params.maxDelegationTurns === "number"
            ? { maxDelegationTurns: params.maxDelegationTurns }
            : {}),
        defaultMaxDelegationTurns: params.defaultMaxDelegationTurns,
        followupAlreadySeen: params.followupPromptSeen,
    });
    const completionApplicationPass = await moduleDependencies.applyCompletionApplicationPass({
        runId: params.runId,
        sessionId: params.sessionId,
        source: params.source,
        onChunk: params.onChunk,
        preview: params.preview,
        state: completionPass.state,
        application: completionPass.application,
        maxTurns: completionPass.maxTurns,
        recoveryBudgetUsage: params.recoveryBudgetUsage,
        finalizationDependencies: params.finalizationDependencies,
    }, dependencies);
    if (completionApplicationPass.kind === "retry") {
        return {
            kind: "retry",
            nextMessage: completionApplicationPass.nextMessage,
            clearWorkerRuntime: completionApplicationPass.clearWorkerRuntime,
            ...(completionApplicationPass.normalizedFollowupPrompt
                ? { normalizedFollowupPrompt: completionApplicationPass.normalizedFollowupPrompt }
                : normalizedFollowupPrompt
                    ? { normalizedFollowupPrompt }
                    : {}),
            ...(completionApplicationPass.markTruncatedOutputRecoveryAttempted
                ? { markTruncatedOutputRecoveryAttempted: completionApplicationPass.markTruncatedOutputRecoveryAttempted }
                : {}),
        };
    }
    return { kind: "break" };
}
//# sourceMappingURL=review-outcome-pass.js.map