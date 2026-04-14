import { applyRunningContinuationState, } from "./running-application.js";
export function decideSyntheticApprovalContinuation(params) {
    if (params.alreadyApproved) {
        return {
            kind: "continue",
            eventLabel: `${params.request.toolName} 전체 승인 상태로 계속 진행합니다.`,
            reviewSummary: params.request.summary,
            executingSummary: "승인된 작업을 계속 진행합니다.",
            continuationPrompt: params.request.continuationPrompt,
            grantMode: "reuse_scope",
            clearWorkerRuntime: true,
            clearProvider: true,
        };
    }
    if (params.decision === "deny" || !params.decision) {
        return { kind: "stop" };
    }
    return {
        kind: "continue",
        eventLabel: params.decision === "allow_run"
            ? `${params.request.toolName} 전체 승인`
            : `${params.request.toolName} 단계 승인`,
        reviewSummary: params.request.summary,
        executingSummary: "승인된 작업을 계속 진행합니다.",
        continuationPrompt: params.request.continuationPrompt,
        grantMode: params.decision === "allow_run" ? "run" : "single",
        clearWorkerRuntime: true,
        clearProvider: true,
    };
}
export function applySyntheticApprovalContinuation(params, dependencies) {
    if (params.aborted || params.continuation.kind === "stop") {
        return { kind: "stop" };
    }
    if (params.continuation.grantMode === "run") {
        dependencies.rememberRunApprovalScope(params.runId);
        dependencies.grantRunApprovalScope(params.runId);
    }
    else if (params.continuation.grantMode === "single") {
        dependencies.grantRunSingleApproval(params.runId);
    }
    const runningContinuation = applyRunningContinuationState({
        runId: params.runId,
        state: {
            eventLabels: [params.continuation.eventLabel],
            reviewStepStatus: "completed",
            reviewSummary: params.continuation.reviewSummary,
            executingSummary: params.continuation.executingSummary,
            updateRunStatusSummary: params.continuation.executingSummary,
            nextMessage: params.continuation.continuationPrompt,
            clearWorkerRuntime: params.continuation.clearWorkerRuntime,
            clearProvider: params.continuation.clearProvider,
        },
    }, dependencies);
    return {
        kind: "continue",
        ...runningContinuation,
    };
}
//# sourceMappingURL=approval-application.js.map