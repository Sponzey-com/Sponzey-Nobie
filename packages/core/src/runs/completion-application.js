import { buildEmptyResultRecoveryPrompt, buildTruncatedOutputRecoveryPrompt, } from "./recovery.js";
export function decideCompletionApplication(params) {
    const { decision } = params;
    if (decision.kind === "complete") {
        return decision;
    }
    if (decision.kind === "invalid_followup") {
        return {
            kind: "stop",
            summary: decision.summary,
            reason: decision.reason,
            remainingItems: decision.remainingItems,
        };
    }
    if (decision.kind === "recover_empty_result") {
        if (!params.canRetryExecution || (params.maxTurns > 0 && params.usedTurns >= params.maxTurns)) {
            return {
                kind: "stop",
                summary: `실행 결과가 비어 있고 완료 근거가 없어 자동 진행을 멈췄습니다.`,
                reason: decision.reason,
                remainingItems: decision.remainingItems,
            };
        }
        return {
            kind: "retry",
            budgetKind: "execution",
            summary: decision.summary,
            detail: decision.reason,
            title: "empty_result_recovery",
            eventLabel: "빈 결과 복구 재시도",
            nextMessage: buildEmptyResultRecoveryPrompt({
                originalRequest: params.originalRequest,
                previousResult: params.previousResult,
                successfulTools: params.successfulTools,
                sawRealFilesystemMutation: params.sawRealFilesystemMutation,
            }),
            reviewStepStatus: "running",
            executingStepSummary: decision.summary,
            updateRunStatusSummary: decision.summary,
        };
    }
    if (decision.kind === "followup") {
        const normalizedPrompt = decision.followupPrompt.replace(/\s+/g, " ").trim().toLowerCase();
        if (normalizedPrompt && params.followupAlreadySeen) {
            return {
                kind: "stop",
                summary: "같은 후속 지시가 반복되어 자동 진행을 멈췄습니다.",
                reason: decision.reason || "반복 후속 지시 감지",
                remainingItems: decision.remainingItems,
            };
        }
        if (!params.canRetryInterpretation || (params.maxTurns > 0 && params.usedTurns >= params.maxTurns)) {
            return {
                kind: "stop",
                summary: `해석/후속 처리 한도(${params.interpretationBudgetLimit > 0 ? params.interpretationBudgetLimit : params.maxTurns}회)에 도달했습니다.`,
                reason: decision.reason || "최대 자동 후속 처리 횟수 초과",
                ...(decision.remainingItems ? { remainingItems: decision.remainingItems } : {}),
            };
        }
        return {
            kind: "retry",
            budgetKind: "interpretation",
            summary: decision.summary,
            eventLabel: "후속 처리",
            nextMessage: decision.followupPrompt,
            reviewStepStatus: "completed",
            executingStepSummary: decision.summary,
            ...(normalizedPrompt ? { normalizedFollowupPrompt: normalizedPrompt } : {}),
        };
    }
    if (decision.kind === "retry_truncated") {
        if (!params.canRetryExecution || (params.maxTurns > 0 && params.usedTurns >= params.maxTurns)) {
            return {
                kind: "stop",
                summary: `실행 복구 재시도 한도(${params.executionBudgetLimit > 0 ? params.executionBudgetLimit : params.maxTurns}회)에 도달했습니다.`,
                reason: decision.reason || "최대 자동 후속 처리 횟수 초과",
                ...(decision.remainingItems ? { remainingItems: decision.remainingItems } : {}),
            };
        }
        return {
            kind: "retry",
            budgetKind: "execution",
            summary: decision.summary,
            eventLabel: "중간 절단 복구 재시도",
            nextMessage: buildTruncatedOutputRecoveryPrompt({
                originalRequest: params.originalRequest,
                previousResult: params.previousResult,
                summary: decision.summary,
                ...(decision.reason ? { reason: decision.reason } : {}),
                ...(decision.remainingItems ? { remainingItems: decision.remainingItems } : {}),
            }),
            reviewStepStatus: "completed",
            executingStepSummary: "중간에 끊긴 작업을 자동으로 다시 시도합니다.",
            updateRunStatusSummary: "중간에 끊긴 작업을 자동으로 다시 시도합니다.",
            markTruncatedOutputRecoveryAttempted: true,
            clearWorkerRuntime: true,
        };
    }
    return {
        kind: "awaiting_user",
        summary: decision.summary,
        ...(decision.reason ? { reason: decision.reason } : {}),
        ...(decision.remainingItems ? { remainingItems: decision.remainingItems } : {}),
        ...(decision.userMessage ? { userMessage: decision.userMessage } : {}),
    };
}
//# sourceMappingURL=completion-application.js.map