import { buildStructuredExecutionBrief } from "./request-prompt.js";
export function shouldDisableToolsForScheduledTask(task, taskProfile, executionSemantics) {
    void task;
    void taskProfile;
    if (!executionSemantics)
        return false;
    return executionSemantics.filesystemEffect === "none"
        && executionSemantics.privilegedOperation === "none"
        && executionSemantics.artifactDelivery !== "direct";
}
export function getScheduledRunExecutionOptions(task, taskProfile, executionSemantics) {
    return {
        toolsEnabled: !shouldDisableToolsForScheduledTask(task, taskProfile, executionSemantics),
        contextMode: "isolated",
    };
}
export function extractDirectChannelDeliveryText(task) {
    void task;
    return null;
}
function buildScheduledStructuredRequest(params) {
    const target = params.goal.trim();
    const destination = params.destination?.trim() || "the scheduled delivery destination";
    const contextLines = [
        `Scheduled task payload: ${params.task.trim()}`,
        `Task profile: ${params.taskProfile.trim()}`,
        "This request is being executed because the scheduled time has been reached.",
    ].filter(Boolean);
    const completeConditionLines = [
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
            : "요청된 결과만 바로 답하세요. 도구를 사용하지 말고, 필요하지 않다면 예약 이야기도 꺼내지 마세요.",
        "최종 답변은 원래 사용자 요청과 같은 언어로 작성하세요.",
    ]
        .filter(Boolean)
        .join("\n\n");
}
//# sourceMappingURL=scheduled.js.map
