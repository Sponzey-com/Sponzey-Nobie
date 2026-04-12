export function decideCompletionTerminalOutcome(params) {
    if (params.state.completionSatisfied) {
        return { kind: "complete" };
    }
    return {
        kind: "stop",
        summary: "완료 판정 근거가 부족해 자동 진행을 중단합니다.",
        reason: params.state.blockingReasons[0]
            ?? "receipt 기준 완료 근거가 부족합니다.",
        remainingItems: ["실행/전달/복구 상태를 다시 확인해야 합니다."],
    };
}
export function decideFatalFailureTerminalOutcome(params) {
    return params.aborted ? "cancelled" : "failed";
}
export function decideTerminalApplicationOutcome(params) {
    return params.applicationKind === "awaiting_user" ? "awaiting_user" : "cancelled";
}
//# sourceMappingURL=terminal-outcome-policy.js.map