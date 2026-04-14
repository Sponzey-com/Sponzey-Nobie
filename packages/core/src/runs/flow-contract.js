export const TERMINAL_RUN_STATUSES = ["completed", "failed", "cancelled", "interrupted"];
const terminalRunStatusSet = new Set(TERMINAL_RUN_STATUSES);
export function isTerminalRunStatus(status) {
    return terminalRunStatusSet.has(status);
}
export function canTransitionRunStatus(currentStatus, nextStatus) {
    if (currentStatus === nextStatus)
        return { allowed: true };
    if (isTerminalRunStatus(currentStatus)) {
        return {
            allowed: false,
            reason: `terminal_status_locked:${currentStatus}->${nextStatus}`,
        };
    }
    return { allowed: true };
}
export function resolveRunFlowIdentifiers(params) {
    const requestGroupId = params.requestGroupId?.trim() || params.runId;
    const lineageRootRunId = params.lineageRootRunId?.trim() || requestGroupId;
    const runScope = params.runScope ?? (params.parentRunId ? "child" : "root");
    return {
        runId: params.runId,
        sessionId: params.sessionId,
        requestGroupId,
        lineageRootRunId,
        runScope,
        ...(params.parentRunId?.trim() ? { parentRunId: params.parentRunId.trim() } : {}),
        ...(params.scheduleId?.trim() ? { scheduleId: params.scheduleId.trim() } : {}),
    };
}
export function deriveRunCompletionOutcome(input) {
    if (input.impossible) {
        return {
            status: "completed_impossible",
            reason: "요청이 물리적 또는 논리적으로 불가능해 사유 반환으로 완료됩니다.",
        };
    }
    if (input.approvalPending) {
        return {
            status: "awaiting_approval",
            reason: "도구 실행 승인을 기다리고 있습니다.",
        };
    }
    const completion = input.completion;
    if (completion?.interpretationStatus === "user_input_required") {
        return {
            status: "awaiting_user_input",
            reason: completion.conflictReason ?? "추가 사용자 입력이 필요합니다.",
        };
    }
    if (completion?.completionSatisfied) {
        if (completion.deliveryStatus === "satisfied") {
            return {
                status: "completed_delivered",
                reason: "실행과 직접 결과 전달이 모두 완료되었습니다.",
            };
        }
        return {
            status: "completed_in_chat",
            reason: "요청된 정보가 채팅 본문으로 완료되었습니다.",
        };
    }
    if (input.finalFailure) {
        return {
            status: "failed_final",
            reason: completion?.conflictReason ?? "자동 대안이 없어 최종 실패로 종료합니다.",
        };
    }
    return {
        status: "failed_recoverable",
        reason: completion?.conflictReason ?? "복구 가능한 미완료 상태입니다.",
    };
}
//# sourceMappingURL=flow-contract.js.map