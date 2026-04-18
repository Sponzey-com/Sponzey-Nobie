export function analyzeRequestEntrySemantics(message) {
    void message;
    return {
        // Conversation reuse is decided by an isolated AI comparison step in start-plan.ts.
        // Active queue cancel/update must come from structured action contracts or explicit ids, not keyword regex.
        reuse_conversation_context: false,
        active_queue_cancellation_mode: null,
    };
}
export function buildActiveQueueCancellationMessage(params) {
    const english = isEnglishCancellationRequest(params.originalMessage);
    if (!params.hadTargets) {
        return english
            ? "There is no active task in this conversation to cancel."
            : "현재 이 대화에서 취소할 실행 중 작업이 없습니다.";
    }
    const titleLines = params.cancelledTitles.map((title) => `- ${title}`).join("\n");
    if (english) {
        const heading = params.mode === "all"
            ? `Cancelled ${params.cancelledTitles.length} active task(s) in this conversation.`
            : "Cancelled the most recent active task in this conversation.";
        const tail = params.remainingCount > 0
            ? `\n\n${params.remainingCount} other active task(s) are still running.`
            : "";
        return titleLines ? `${heading}\n${titleLines}${tail}` : `${heading}${tail}`;
    }
    const heading = params.mode === "all"
        ? `현재 대화의 활성 작업 ${params.cancelledTitles.length}건을 취소했습니다.`
        : "현재 대화에서 가장 최근 활성 작업 1건을 취소했습니다.";
    const tail = params.remainingCount > 0
        ? `\n\n아직 ${params.remainingCount}건의 다른 활성 작업은 계속 진행 중입니다.`
        : "";
    return titleLines ? `${heading}\n${titleLines}${tail}` : `${heading}${tail}`;
}
function isEnglishCancellationRequest(message) {
    return !/[가-힣]/.test(message) && /[a-z]/i.test(message);
}
//# sourceMappingURL=entry-semantics.js.map