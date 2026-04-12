import { reviewTaskCompletion } from "../agent/completion-review.js";
import { detectSyntheticApprovalRequest, } from "./approval.js";
export async function runReviewPass(params, dependencies) {
    const review = await dependencies.reviewTaskCompletion({
        originalRequest: params.originalRequest,
        latestAssistantMessage: params.preview,
        priorAssistantMessages: params.priorAssistantMessages,
        ...(params.model ? { model: params.model } : {}),
        ...(params.providerId ? { providerId: params.providerId } : {}),
        ...(params.provider ? { provider: params.provider } : {}),
        ...(params.workDir ? { workDir: params.workDir } : {}),
    }).catch((error) => {
        dependencies.onReviewError?.(error instanceof Error ? error.message : String(error));
        return null;
    });
    const syntheticApproval = detectSyntheticApprovalRequest({
        executionProfile: params.executionProfile,
        originalRequest: params.originalRequest,
        preview: params.preview,
        review,
        usesWorkerRuntime: params.usesWorkerRuntime,
        requiresPrivilegedToolExecution: params.requiresPrivilegedToolExecution,
        successfulTools: params.successfulTools,
        successfulFileDeliveries: params.successfulFileDeliveries,
        sawRealFilesystemMutation: params.sawRealFilesystemMutation,
    });
    return { review, syntheticApproval };
}
export const defaultReviewPassDependencies = {
    reviewTaskCompletion,
};
//# sourceMappingURL=review-pass.js.map