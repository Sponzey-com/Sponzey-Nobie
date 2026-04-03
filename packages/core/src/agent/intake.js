import { getMessages, getMessagesForRequestGroupWithRunMeta } from "../db/index.js";
import { getConfig } from "../config/index.js";
import { getDefaultModel, getProvider, inferProviderId } from "../ai/index.js";
import { createLogger } from "../logger/index.js";
import { buildTaskIntakeSystemPrompt } from "./intake-prompt.js";
import { loadMergedInstructions } from "../instructions/merge.js";
import { selectRequestGroupContextMessages } from "./request-group-context.js";
import { buildUserProfilePromptContext } from "./profile-context.js";
const log = createLogger("agent:intake");
export async function analyzeTaskIntake(params) {
    const maxDelegationTurns = getConfig().orchestration.maxDelegationTurns;
    const heuristic = detectRelativeScheduleRequest(params.userMessage, Date.now(), maxDelegationTurns);
    if (heuristic) {
        log.info("relative schedule heuristic matched", {
            sessionId: params.sessionId ?? null,
            category: heuristic.intent.category,
            schedule: heuristic.scheduling.schedule_text,
            runAt: heuristic.scheduling.run_at ?? null,
            actions: heuristic.action_items.map((item) => item.type),
        });
        return heuristic;
    }
    const model = params.model ?? getDefaultModel();
    const provider = getProvider(inferProviderId(model));
    const context = buildConversationContext(params.sessionId, params.requestGroupId, params.userMessage);
    const instructions = loadMergedInstructions(params.workDir ?? process.cwd());
    const profileContext = buildUserProfilePromptContext();
    log.debug("starting intake analysis", {
        sessionId: params.sessionId ?? null,
        model,
        providerId: provider.id,
        workDir: params.workDir ?? process.cwd(),
        contextLength: context.length,
        instructionSources: instructions.chain.sources.map((source) => source.path),
    });
    const messages = [
        {
            role: "user",
            content: [
                "Analyze the following conversation and latest user request.",
                "Return valid JSON only.",
                "",
                context,
            ].join("\n"),
        },
    ];
    let raw = "";
    for await (const chunk of provider.chat({
        model,
        messages,
        system: [
            buildTaskIntakeSystemPrompt({ maxDelegationTurns }),
            instructions.mergedText ? `\n[Instruction Chain]\n${instructions.mergedText}` : "",
            profileContext ? `\n${profileContext}` : "",
        ].join("\n"),
        tools: [],
        signal: new AbortController().signal,
    })) {
        if (chunk.type === "text_delta")
            raw += chunk.delta;
    }
    const parsed = parseTaskIntakeResult(raw, maxDelegationTurns);
    log.debug("finished intake analysis", {
        sessionId: params.sessionId ?? null,
        parsed: parsed == null
            ? null
            : {
                category: parsed.intent.category,
                actions: parsed.action_items.map((item) => item.type),
                scheduling: parsed.scheduling,
            },
        rawPreview: raw.slice(0, 600),
    });
    return parsed;
}
export function detectRelativeScheduleRequest(userMessage, now = Date.now(), maxDelegationTurns = getConfig().orchestration.maxDelegationTurns) {
    const parsedItems = parseRelativeDelays(userMessage);
    if (parsedItems.length === 0)
        return null;
    const missingTaskItems = parsedItems.filter((item) => !item.task);
    if (missingTaskItems.length > 0) {
        return {
            intent: {
                category: "clarification",
                summary: "상대시간 일정 요청 중 일부 실행할 작업이 비어 있습니다.",
                confidence: 0.98,
            },
            user_message: {
                mode: "clarification_receipt",
                text: `${missingTaskItems.map((item) => item.delayLabel).join(", ")} 후에 무엇을 해야 하는지 비어 있습니다. 실행할 내용을 함께 알려주세요.`,
            },
            action_items: [
                {
                    id: "ask-delayed-task",
                    type: "ask_user",
                    title: "지연 실행 내용 확인",
                    priority: "normal",
                    reason: "상대시간은 파악했지만 실행할 작업 내용이 없습니다.",
                    payload: {
                        question: "각 시간마다 무엇을 해야 하나요?",
                        missing_fields: ["task"],
                    },
                },
            ],
            scheduling: {
                detected: true,
                kind: "one_time",
                status: "needs_clarification",
                schedule_text: parsedItems.map((item) => item.delayLabel).join(", "),
            },
            execution: {
                requires_run: false,
                requires_delegation: false,
                suggested_target: "auto",
                max_delegation_turns: maxDelegationTurns,
                needs_tools: false,
                needs_web: false,
            },
            notes: ["relative-delay-heuristic"],
        };
    }
    const actionItems = parsedItems.map((item, index) => {
        const runAt = new Date(now + item.delayMs).toISOString();
        return {
            id: `create-relative-delay-schedule-${index + 1}`,
            type: "create_schedule",
            title: `${item.delayLabel} 후 실행`,
            priority: "normal",
            reason: "상대시간 기반 일회성 지연 실행 요청입니다.",
            payload: {
                title: `${item.delayLabel} 후 실행`,
                task: item.task,
                schedule_kind: "one_time",
                schedule_text: item.delayLabel,
                run_at: runAt,
                followup_run_payload: {
                    goal: item.task,
                    task_profile: inferTaskProfileFromTask(item.task),
                    preferred_target: "auto",
                },
            },
        };
    });
    return {
        intent: {
            category: "schedule_request",
            summary: parsedItems.map((item) => `${item.delayLabel} 후 실행 요청: ${item.task}`).join(" / "),
            confidence: 0.99,
        },
        user_message: {
            mode: "accepted_receipt",
            text: parsedItems.length === 1
                ? `${parsedItems[0]?.delayLabel} 후에 "${parsedItems[0]?.task}" 작업을 실행하도록 접수했습니다.`
                : "여러 예약 작업을 접수했습니다.",
        },
        action_items: actionItems,
        scheduling: {
            detected: true,
            kind: "one_time",
            status: "accepted",
            schedule_text: parsedItems.map((item) => item.delayLabel).join(", "),
        },
        execution: {
            requires_run: false,
            requires_delegation: false,
            suggested_target: "auto",
            max_delegation_turns: maxDelegationTurns,
            needs_tools: false,
            needs_web: false,
        },
        notes: parsedItems.length > 1
            ? ["relative-delay-heuristic", "multi-action-item"]
            : ["relative-delay-heuristic"],
    };
}
function buildConversationContext(sessionId, requestGroupId, latestUserMessage) {
    const lines = [];
    if (sessionId) {
        const recentMessages = requestGroupId
            ? selectRequestGroupContextMessages(getMessagesForRequestGroupWithRunMeta(sessionId, requestGroupId))
            : getMessages(sessionId);
        const recent = recentMessages.slice(-8);
        if (recent.length > 0) {
            lines.push("Recent conversation:");
            for (const message of recent) {
                const role = message.role === "assistant" ? "assistant" : "user";
                const content = message.content.trim();
                if (content) {
                    lines.push(`- ${role}: ${content}`);
                }
            }
            lines.push("");
        }
    }
    lines.push("Latest user message:");
    lines.push(latestUserMessage.trim());
    return lines.join("\n");
}
function parseRelativeDelays(userMessage) {
    const trimmed = userMessage.trim();
    const koreanMatches = [...trimmed.matchAll(/(\d+)\s*(초|분|시간|일)\s*(?:뒤|후)(?:에)?/gu)];
    if (koreanMatches.length > 0) {
        return koreanMatches.flatMap((match, index) => {
            const amount = Number(match[1]);
            const unit = match[2];
            if (!Number.isFinite(amount) || amount <= 0 || !unit || match.index == null)
                return [];
            const nextIndex = koreanMatches[index + 1]?.index ?? trimmed.length;
            const rawTask = trimmed.slice(match.index + match[0].length, nextIndex);
            const task = cleanRelativeDelayTask(rawTask);
            const unitMs = unit === "초"
                ? 1_000
                : unit === "분"
                    ? 60_000
                    : unit === "시간"
                        ? 3_600_000
                        : 86_400_000;
            return [{
                    delayMs: amount * unitMs,
                    delayLabel: `${amount}${unit}`,
                    task,
                }];
        });
    }
    const englishMatches = [...trimmed.matchAll(/(?:in|after)\s+(\d+)\s*(seconds?|minutes?|hours?|days?)/gi)];
    if (englishMatches.length > 0) {
        return englishMatches.flatMap((match, index) => {
            const amount = Number(match[1]);
            const unit = (match[2] ?? "").toLowerCase();
            if (!Number.isFinite(amount) || amount <= 0 || !unit || match.index == null)
                return [];
            const nextIndex = englishMatches[index + 1]?.index ?? trimmed.length;
            const rawTask = trimmed.slice(match.index + match[0].length, nextIndex);
            const task = cleanRelativeDelayTask(rawTask);
            const unitMs = unit.startsWith("second")
                ? 1_000
                : unit.startsWith("minute")
                    ? 60_000
                    : unit.startsWith("hour")
                        ? 3_600_000
                        : 86_400_000;
            return [{
                    delayMs: amount * unitMs,
                    delayLabel: `${amount}${unit.startsWith("second") ? "초" : unit.startsWith("minute") ? "분" : unit.startsWith("hour") ? "시간" : "일"}`,
                    task,
                }];
        });
    }
    return [];
}
function cleanRelativeDelayTask(value) {
    return value
        .trim()
        .replace(/^[,\s]+/u, "")
        .replace(/^(?:그리고|그다음|그 다음|and then|and|then)\s+/iu, "")
        .replace(/^(?:는|은|이|가|을|를)\s+/u, "")
        .replace(/[,\s]+$/u, "")
        .replace(/\s*(?:그리고|그다음|그 다음|and then|and|then)\s*$/iu, "");
}
function inferTaskProfileFromTask(task) {
    const normalized = task.toLowerCase();
    if (/\b(code|bug|fix|refactor|test|build|repo|file)\b/i.test(task) || /코드|버그|수정|리팩터링|테스트|빌드|파일/u.test(task)) {
        return "coding";
    }
    if (/\b(search|browse|web|latest|official|docs?)\b/i.test(normalized) || /검색|웹|최신|공식|문서/u.test(task)) {
        return "research";
    }
    if (/\b(plan|design|roadmap|architecture|compare)\b/i.test(normalized) || /계획|설계|로드맵|아키텍처|비교/u.test(task)) {
        return "planning";
    }
    if (/\b(run|execute|open|click|type|paste|app|process)\b/i.test(normalized) || /실행|열어|클릭|입력|붙여넣기|앱|프로세스/u.test(task)) {
        return "operations";
    }
    return "general_chat";
}
function parseTaskIntakeResult(raw, maxDelegationTurns) {
    const trimmed = raw.trim();
    if (!trimmed)
        return null;
    const jsonLike = extractJsonObject(trimmed);
    if (!jsonLike)
        return null;
    try {
        const parsed = JSON.parse(jsonLike);
        if (!parsed.intent || !parsed.user_message || !Array.isArray(parsed.action_items) || !parsed.scheduling || !parsed.execution) {
            return null;
        }
        if (typeof parsed.intent.summary !== "string" || typeof parsed.user_message.text !== "string") {
            return null;
        }
        return {
            intent: {
                category: isIntentCategory(parsed.intent.category) ? parsed.intent.category : "clarification",
                summary: parsed.intent.summary,
                confidence: typeof parsed.intent.confidence === "number" ? parsed.intent.confidence : 0,
            },
            user_message: {
                mode: isMessageMode(parsed.user_message.mode) ? parsed.user_message.mode : "clarification_receipt",
                text: parsed.user_message.text,
            },
            action_items: parsed.action_items
                .filter((item) => typeof item?.id === "string"
                && isActionType(item.type)
                && typeof item.title === "string"
                && isPriority(item.priority)
                && typeof item.reason === "string"
                && !!item.payload
                && typeof item.payload === "object"),
            scheduling: {
                detected: Boolean(parsed.scheduling.detected),
                kind: parsed.scheduling.kind === "one_time" || parsed.scheduling.kind === "recurring" ? parsed.scheduling.kind : "none",
                status: parsed.scheduling.status === "accepted"
                    || parsed.scheduling.status === "failed"
                    || parsed.scheduling.status === "needs_clarification"
                    ? parsed.scheduling.status
                    : "not_applicable",
                schedule_text: typeof parsed.scheduling.schedule_text === "string" ? parsed.scheduling.schedule_text : "",
                ...(typeof parsed.scheduling.cron === "string" ? { cron: parsed.scheduling.cron } : {}),
                ...(typeof parsed.scheduling.run_at === "string" ? { run_at: parsed.scheduling.run_at } : {}),
                ...(typeof parsed.scheduling.failure_reason === "string" ? { failure_reason: parsed.scheduling.failure_reason } : {}),
            },
            execution: {
                requires_run: Boolean(parsed.execution.requires_run),
                requires_delegation: Boolean(parsed.execution.requires_delegation),
                suggested_target: typeof parsed.execution.suggested_target === "string" ? parsed.execution.suggested_target : "auto",
                max_delegation_turns: typeof parsed.execution.max_delegation_turns === "number" ? parsed.execution.max_delegation_turns : maxDelegationTurns,
                needs_tools: Boolean(parsed.execution.needs_tools),
                needs_web: Boolean(parsed.execution.needs_web),
            },
            notes: Array.isArray(parsed.notes) ? parsed.notes.filter((item) => typeof item === "string") : [],
        };
    }
    catch {
        return null;
    }
}
function extractJsonObject(text) {
    const withoutFence = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
    const start = withoutFence.indexOf("{");
    const end = withoutFence.lastIndexOf("}");
    if (start === -1 || end === -1 || end <= start)
        return null;
    return withoutFence.slice(start, end + 1);
}
function isIntentCategory(value) {
    return value === "direct_answer" || value === "task_intake" || value === "schedule_request" || value === "clarification" || value === "reject";
}
function isMessageMode(value) {
    return value === "direct_answer" || value === "accepted_receipt" || value === "failed_receipt" || value === "clarification_receipt";
}
function isActionType(value) {
    return value === "reply"
        || value === "run_task"
        || value === "delegate_agent"
        || value === "create_schedule"
        || value === "update_schedule"
        || value === "cancel_schedule"
        || value === "ask_user"
        || value === "log_only";
}
function isPriority(value) {
    return value === "low" || value === "normal" || value === "high" || value === "urgent";
}
//# sourceMappingURL=intake.js.map