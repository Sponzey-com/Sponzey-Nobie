import { detectAvailableProvider, getDefaultModel, getProvider } from "../ai/index.js";
export async function compareRequestContinuationWithAI(params) {
    const message = params.message.trim();
    if (!message || params.candidates.length === 0) {
        return { kind: "new", reason: "no candidates" };
    }
    const model = params.model?.trim() || getDefaultModel();
    const providerId = params.providerId?.trim() || detectAvailableProvider();
    if (!model || !providerId) {
        return { kind: "new", reason: "no configured provider" };
    }
    const provider = params.provider ?? getProvider(providerId);
    const allowedIds = new Set(params.candidates.map((candidate) => candidate.requestGroupId));
    const messages = [
        {
            role: "user",
            content: [
                `Incoming user request:\n${message}`,
                "",
                "Active task candidates:",
                ...params.candidates.map((candidate, index) => [
                    `${index + 1}. request_group_id=${candidate.requestGroupId}`,
                    `title=${candidate.title || "(empty)"}`,
                    `prompt=${candidate.prompt || "(empty)"}`,
                    `summary=${candidate.summary || "(empty)"}`,
                    `status=${candidate.status}`,
                    `updated_at=${candidate.updatedAt}`,
                ].join("\n")),
            ].join("\n"),
        },
    ];
    let raw = "";
    for await (const chunk of provider.chat({
        model,
        messages,
        system: buildRequestContinuationSystemPrompt(),
        tools: [],
        maxTokens: 220,
        signal: new AbortController().signal,
    })) {
        if (chunk.type === "text_delta")
            raw += chunk.delta;
    }
    const parsed = parseRequestContinuationDecision(raw);
    if (!parsed) {
        return { kind: "new", reason: "unparseable ai comparison result" };
    }
    if (parsed.decision === "reuse") {
        const requestGroupId = parsed.request_group_id?.trim();
        if (!requestGroupId || !allowedIds.has(requestGroupId)) {
            return { kind: "clarify", reason: parsed.reason?.trim() || "invalid candidate selection" };
        }
        return {
            kind: "reuse",
            requestGroupId,
            reason: parsed.reason?.trim() || "matched active task",
        };
    }
    if (parsed.decision === "clarify") {
        return {
            kind: "clarify",
            reason: parsed.reason?.trim() || "ambiguous continuation",
        };
    }
    return {
        kind: "new",
        reason: parsed.reason?.trim() || "new independent task",
    };
}
export function buildRequestContinuationSystemPrompt() {
    return [
        "You are Nobie's isolated request-continuation classifier.",
        "",
        "Decide whether the incoming user request should continue one existing active task or start a new independent task.",
        "This classifier is memoryless.",
        "Use only the incoming request text and the provided candidate task list.",
        "Do not assume any other conversation history, memory, or hidden context.",
        "Return valid JSON only.",
        "",
        "JSON shape:",
        "{",
        '  "decision": "new | reuse | clarify",',
        '  "request_group_id": "required only when decision = reuse",',
        '  "reason": "short explanation in the user language"',
        "}",
        "",
        "Rules:",
        "- Choose reuse only when the incoming request clearly continues or modifies one candidate task.",
        "- Choose new when the incoming request is a new task, even if it is on a related topic.",
        "- Choose clarify when more than one candidate is plausible and the request does not clearly identify one.",
        "- Never invent a request_group_id. Use only one from the candidate list.",
        "- Be conservative. If continuation is not clear, choose new or clarify.",
    ].join("\n");
}
export function parseRequestContinuationDecision(raw) {
    const jsonLike = extractJsonObject(raw.trim());
    if (!jsonLike)
        return null;
    try {
        const parsed = JSON.parse(jsonLike);
        const decision = parsed.decision;
        if (decision !== "new" && decision !== "reuse" && decision !== "clarify")
            return null;
        return {
            decision,
            ...(typeof parsed.request_group_id === "string" ? { request_group_id: parsed.request_group_id } : {}),
            ...(typeof parsed.reason === "string" ? { reason: parsed.reason } : {}),
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
//# sourceMappingURL=entry-comparison.js.map