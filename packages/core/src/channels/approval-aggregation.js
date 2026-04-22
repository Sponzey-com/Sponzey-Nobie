export function appendApprovalAggregateItem(context, item, requesterId, observedAt = Date.now()) {
    const next = context ?? {
        runId: item.runId,
        requesterId,
        items: [],
        openedAt: observedAt,
        lastUpdatedAt: observedAt,
    };
    const itemKey = approvalAggregateItemKey(item);
    const exists = next.items.some((existing) => approvalAggregateItemKey(existing) === itemKey);
    if (!exists)
        next.items.push(item);
    next.lastUpdatedAt = observedAt;
    return {
        context: next,
        appended: !exists,
        aggregationLatencyMs: !exists && next.items.length > 1
            ? Math.max(0, observedAt - next.openedAt)
            : null,
    };
}
export function buildApprovalAggregateText(params) {
    const items = params.context.items;
    const primary = items[0];
    const header = primary?.kind === "screen_confirmation"
        ? params.channel === "slack"
            ? "*화면 조작 준비 확인이 필요합니다.*"
            : "화면 조작 준비 확인"
        : params.channel === "slack"
            ? "*도구 실행 승인이 필요합니다.*"
            : "도구 실행 승인 요청";
    const countLine = items.length > 1 ? `승인 항목: ${items.length}개` : undefined;
    const lines = items.flatMap((item, index) => [
        items.length > 1 ? `#${index + 1}` : undefined,
        `도구: ${item.toolName}`,
        item.parentRunId ? `상위 실행: ${item.parentRunId}` : undefined,
        item.subSessionId ? `서브 세션: ${item.subSessionId}` : undefined,
        item.agentId ? `에이전트: ${item.agentId}` : undefined,
        item.teamId ? `팀: ${item.teamId}` : undefined,
        item.riskSummary ? `위험 요약: ${item.riskSummary}` : undefined,
        `파라미터:\n${item.paramsPreview}`,
        item.guidance ? `안내: ${item.guidance}` : undefined,
    ].filter(Boolean).join("\n"));
    const footer = primary?.kind === "screen_confirmation"
        ? "준비가 끝났으면 계속 진행할 수 있습니다."
        : params.channel === "slack"
            ? "아래 버튼을 누르거나, 버튼이 보이지 않으면 이 스레드에 `approve`, `approve once`, `deny` 중 하나로 답해주세요."
            : "허용하시겠습니까?";
    return [header, countLine, ...lines, footer].filter(Boolean).join("\n\n");
}
export function resolveApprovalAggregate(context, decision, reason = "user") {
    for (const item of context.items) {
        item.resolve(decision, reason);
    }
    return [...context.items];
}
function approvalAggregateItemKey(item) {
    return item.approvalId
        ?? [
            item.runId,
            item.parentRunId ?? "",
            item.subSessionId ?? "",
            item.agentId ?? "",
            item.teamId ?? "",
            item.kind,
            item.toolName,
            item.paramsPreview,
        ].join(":");
}
//# sourceMappingURL=approval-aggregation.js.map