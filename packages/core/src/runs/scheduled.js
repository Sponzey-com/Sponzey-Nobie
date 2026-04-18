import { buildStructuredExecutionBrief } from "./request-prompt.js";
const TOOL_REQUIRING_TASK_PATTERN = 
// nobie-critical-decision-audit: scheduled.tool_disable_keyword_guard
// Legacy fallback only. New ScheduleContract schedules bypass this language-sensitive tool decision.
/\b(file|files|code|repo|repository|command|commands|shell|terminal|browser|click|open|search|web|website|url|link|process|run|execute|edit|write|read|fetch|download)\b|파일|코드|저장소|명령|쉘|터미널|브라우저|클릭|열어|검색|웹|사이트|링크|주소|프로세스|실행|수정|작성|읽기|가져와|다운로드/u;
// nobie-critical-decision-audit: scheduled.direct_literal_extraction
// Legacy fallback only. Contract schedules store literal delivery in ScheduleContract payloads.
const DIRECT_DELIVERY_PATTERNS = [
    /^(?:(?:메신저|메시지|텔레그램)(?:로)?\s*)?(?:"([^"\n]+)"|'([^'\n]+)'|“([^”\n]+)”|‘([^’\n]+)’|(.+?))\s*(?:이?라고)\s*(?:(?:메신저|메시지|텔레그램)(?:로)?\s*)?(?:말해줘|말해 줘|알려줘|알려 줘|보내줘|보내 줘|해줘|해 줘|해주세요|해 주세요)$/u,
    /^(?:"([^"\n]+)"|'([^'\n]+)'|“([^”\n]+)”|‘([^’\n]+)’|(.+?))\s*(?:이?라고)\s*(?:말해줘|말해 줘|알려줘|알려 줘|보내줘|보내 줘|해줘|해 줘|해주세요|해 주세요)$/u,
    /^(?:say|send)\s+(?:"([^"\n]+)"|'([^'\n]+)'|(.+?))\s+(?:in|via)\s+(?:telegram|message|messenger)$/iu,
    /^(?:say|tell)\s+(?:"([^"\n]+)"|'([^'\n]+)'|(.+?))$/iu,
];
const QUOTED_LITERAL_PATTERN = /"([^"\n]+)"|'([^'\n]+)'|“([^”\n]+)”|‘([^’\n]+)’/u;
const DIRECT_DELIVERY_HINT_PATTERN = /메신저|메시지|텔레그램|슬랙|대화|채팅|알림|알람|말해|알려|보내|전송|안내|message|messenger|telegram|slack|chat|notify|notification|alarm|send|tell|say/iu;
export function shouldDisableToolsForScheduledTask(task, taskProfile) {
    const normalizedTask = task.trim();
    const normalizedProfile = taskProfile?.trim() ?? "general_chat";
    if (!normalizedTask)
        return false;
    if (normalizedProfile !== "general_chat" && normalizedProfile !== "summarization") {
        return false;
    }
    return !TOOL_REQUIRING_TASK_PATTERN.test(normalizedTask);
}
export function getScheduledRunExecutionOptions(task, taskProfile) {
    return {
        toolsEnabled: !shouldDisableToolsForScheduledTask(task, taskProfile),
        contextMode: "isolated",
    };
}
export function extractDirectChannelDeliveryText(task) {
    const normalizedTask = task.trim().replace(/\s+/gu, " ");
    if (!normalizedTask)
        return null;
    for (const pattern of DIRECT_DELIVERY_PATTERNS) {
        const match = normalizedTask.match(pattern);
        if (!match)
            continue;
        const candidate = match.slice(1).find((value) => typeof value === "string" && value.trim().length > 0);
        if (!candidate)
            continue;
        return candidate.trim();
    }
    const quoted = normalizedTask.match(QUOTED_LITERAL_PATTERN);
    const quotedCandidate = quoted?.slice(1).find((value) => typeof value === "string" && value.trim().length > 0);
    if (quotedCandidate
        && DIRECT_DELIVERY_HINT_PATTERN.test(normalizedTask)
        && !TOOL_REQUIRING_TASK_PATTERN.test(normalizedTask)) {
        return quotedCandidate.trim();
    }
    return null;
}
function buildScheduledStructuredRequest(params) {
    const directText = extractDirectChannelDeliveryText(params.task);
    const target = directText
        ? `Deliver the exact literal text "${directText}".`
        : params.goal.trim();
    const destination = params.destination?.trim() || "the scheduled delivery destination";
    const contextLines = [
        `Scheduled task payload: ${params.task.trim()}`,
        `Task profile: ${params.taskProfile.trim()}`,
        "This request is being executed because the scheduled time has been reached.",
        directText ? `Deliver only the literal text "${directText}" without additional explanation.` : "",
    ].filter(Boolean);
    const completeConditionLines = directText
        ? [
            `The exact literal text "${directText}" is delivered once to ${destination}.`,
            "No extra explanation, scheduling preface, or intake echo is included.",
        ]
        : [
            "The scheduled task is executed at the scheduled time.",
            `The resulting output is delivered to ${destination}.`,
        ];
    return buildStructuredExecutionBrief({
        header: "[Scheduled Structured Request]",
        structuredRequest: {
            source_language: "unknown",
            normalized_english: [
                `Target: ${target}`,
                `To: ${destination}`,
                `Context: ${contextLines.join(" | ")}`,
                `Complete condition: ${completeConditionLines.join(" | ")}`,
            ].join("\n"),
            target,
            to: destination,
            context: contextLines,
            complete_condition: completeConditionLines,
        },
        executionSemantics: {
            filesystemEffect: "none",
            privilegedOperation: "none",
            artifactDelivery: "none",
            approvalRequired: false,
            approvalTool: "external_action",
        },
    });
}
export function buildScheduledFollowupPrompt(params) {
    const goal = params.goal?.trim() || params.task.trim();
    const taskProfile = params.taskProfile?.trim() || "general_chat";
    const preferredTarget = params.preferredTarget?.trim();
    return [
        "[Scheduled Task]",
        "이 작업은 이전에 접수되어 예약된 후속 실행입니다.",
        buildScheduledStructuredRequest({
            task: params.task,
            goal,
            taskProfile,
            ...(params.destination ? { destination: params.destination } : {}),
        }),
        preferredTarget ? `선호 대상: ${preferredTarget}` : "",
        "예약 시각이 되었습니다. 지금 이 예약 작업만 실행하세요.",
        "다시 intake 접수 메시지를 만들지 마세요.",
        params.toolsEnabled
            ? "이 특정 작업에 실제로 필요한 경우에만 도구를 사용하세요."
            : extractDirectChannelDeliveryText(params.task)
                ? "요청된 결과만 바로 답하세요. 정확한 문구만 그대로 출력하고, 예약 설명이나 부가 문장은 붙이지 마세요."
                : "요청된 결과만 바로 답하세요. 도구를 사용하지 말고, 필요하지 않다면 예약 이야기도 꺼내지 마세요.",
        "최종 답변은 원래 사용자 요청과 같은 언어로 작성하세요.",
    ]
        .filter(Boolean)
        .join("\n\n");
}
//# sourceMappingURL=scheduled.js.map