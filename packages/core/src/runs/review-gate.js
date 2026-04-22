import { deriveCompletionStageState } from "./completion-state.js";
export function decideReviewGate(params) {
    const state = deriveCompletionStageState({
        review: null,
        executionSemantics: params.executionSemantics,
        preview: params.preview,
        deliverySatisfied: params.deliveryOutcome.deliverySatisfied,
        successfulTools: params.successfulTools,
        sawRealFilesystemMutation: params.sawRealFilesystemMutation,
        requiresFilesystemMutation: params.requiresFilesystemMutation,
        truncatedOutputRecoveryAttempted: params.truncatedOutputRecoveryAttempted,
    });
    if (params.deliveryOutcome.directArtifactDeliveryRequested
        && params.deliveryOutcome.deliverySatisfied
        && state.completionSatisfied) {
        return {
            kind: "skip",
            state,
            reason: "직접 결과 전달과 checklist 기준 완료 항목이 이미 모두 충족되어 completion review를 생략합니다.",
        };
    }
    if (!params.deliveryOutcome.directArtifactDeliveryRequested
        && state.completionSatisfied
        && params.deliveryOutcome.hasSuccessfulTextDelivery
        && !params.requiresFilesystemMutation
        && !params.sawRealFilesystemMutation) {
        return {
            kind: "skip",
            state,
            reason: "reply 텍스트 전달 receipt와 checklist 기준 완료 항목이 이미 충족되어 completion review를 생략합니다.",
        };
    }
    if (!params.deliveryOutcome.directArtifactDeliveryRequested
        && state.completionSatisfied
        && params.successfulTools.length > 0
        && !params.requiresFilesystemMutation
        && !params.sawRealFilesystemMutation) {
        return {
            kind: "skip",
            state,
            reason: "read-only 실행이 성공했고 checklist 기준 완료 항목이 이미 충족되어 completion review를 생략합니다.",
        };
    }
    return {
        kind: "run",
        state,
    };
}
export function decideSubSessionReviewGate(reviews) {
    const blocked = reviews.filter((item) => !item.review.accepted);
    if (blocked.length === 0) {
        return {
            kind: "allow_parent_completion",
            blockedSubSessionIds: [],
            reasonCodes: ["all_sub_session_results_accepted"],
        };
    }
    const needsManualAction = blocked.some((item) => !item.review.canRetry);
    return {
        kind: needsManualAction ? "manual_action_required" : "wait_for_revision",
        blockedSubSessionIds: blocked.map((item) => item.subSessionId),
        reasonCodes: [...new Set(blocked.map((item) => item.review.manualActionReason
                ?? item.review.normalizedFailureKey
                ?? "sub_session_result_not_accepted"))].sort(),
    };
}
//# sourceMappingURL=review-gate.js.map