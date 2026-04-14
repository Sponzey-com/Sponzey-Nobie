function normalizeLine(value) {
    return value?.trim() ?? "";
}
function normalizeList(values) {
    return values
        .map((value) => normalizeLine(value))
        .filter(Boolean);
}
function buildChecklistLines(params) {
    const lines = [
        `- [ ] 목표 확인: ${params.target}`,
        params.executionSemantics.filesystemEffect === "mutate"
            ? "- [ ] 실제 파일 또는 폴더 결과를 생성하거나 수정한다."
            : "- [ ] 요청된 실제 작업을 수행한다.",
        ...params.completeConditionLines.map((line) => `- [ ] 완료 조건 확인: ${line}`),
        params.executionSemantics.artifactDelivery === "direct"
            ? `- [ ] 결과물 자체를 ${params.destination}에 직접 전달한다.`
            : `- [ ] 최종 결과를 ${params.destination}에 전달한다.`,
        "- [ ] 완료된 항목은 내부적으로 [x] 기준으로 확인하고, 남은 항목이 없을 때만 종료한다.",
    ];
    return normalizeList(lines);
}
export function buildStructuredExecutionBrief(params) {
    const target = normalizeLine(params.structuredRequest.target) || "Execute the requested work.";
    const destination = normalizeLine(params.structuredRequest.to) || "the current execution target";
    const contextLines = normalizeList(params.structuredRequest.context);
    const normalizedEnglish = normalizeLine(params.structuredRequest.normalized_english);
    const completeConditionLines = normalizeList(params.structuredRequest.complete_condition);
    const checklistLines = buildChecklistLines({
        target,
        destination,
        completeConditionLines: completeConditionLines.length > 0
            ? completeConditionLines
            : ["Produce the requested result in the current execution."],
        executionSemantics: params.executionSemantics,
    });
    const sections = [
        params.header,
        ...normalizeList(params.introLines ?? []),
        normalizeLine(params.originalRequest) ? `원래 사용자 요청: ${normalizeLine(params.originalRequest)}` : "",
        [
            "[target]",
            target,
        ].join("\n"),
        [
            "[to]",
            destination,
        ].join("\n"),
        contextLines.length > 0
            ? ["[context]", ...contextLines.map((line) => `- ${line}`)].join("\n")
            : "",
        normalizedEnglish
            ? ["[normalized-english]", normalizedEnglish].join("\n")
            : "",
        [
            "[complete-condition]",
            ...(completeConditionLines.length > 0
                ? completeConditionLines.map((line) => `- ${line}`)
                : ["- Produce the requested result in the current execution."]),
        ].join("\n"),
        [
            "[checklist]",
            ...checklistLines,
        ].join("\n"),
        ...normalizeList(params.extraSections ?? []),
        ...normalizeList(params.closingLines ?? []),
    ];
    return sections.filter(Boolean).join("\n\n");
}
//# sourceMappingURL=request-prompt.js.map