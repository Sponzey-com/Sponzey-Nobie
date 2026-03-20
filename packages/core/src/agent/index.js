import { homedir } from "node:os";
import { eventBus } from "../events/index.js";
import { getProvider, getDefaultModel, inferProviderId, shouldForceReasoningMode } from "../llm/index.js";
import { toolDispatcher } from "../tools/dispatcher.js";
import { createLogger } from "../logger/index.js";
import { getDb, insertSession, getSession, insertMessage, getMessages, getMessagesForRequestGroup, getMessagesForRequestGroupWithRunMeta, insertMemoryItem, markMessagesCompressed } from "../db/index.js";
import { loadNobieMd } from "../memory/nobie-md.js";
import { buildMemoryContext } from "../memory/store.js";
import { needsCompression, compressContext } from "../memory/compressor.js";
import { loadMergedInstructions } from "../instructions/merge.js";
import { selectRequestGroupContextMessages } from "./request-group-context.js";
import { buildUserProfilePromptContext } from "./profile-context.js";
const log = createLogger("agent");
const MAX_TOOL_ROUNDS = 20; // prevent infinite loops
const MAX_CONTEXT_TOKENS = 150_000;
const WEB_POLICY_PATTERN = [
    /https?:\/\//i,
    /\b(web|internet|browse|browser|search|google|docs?|documentation|readme|website|site|url|link)\b/i,
    /\b(latest|recent|current|today|news|official|release(?:s| notes?)?|update(?:d|s)?)\b/i,
    /웹|인터넷|검색|브라우저|최신|최근|현재|오늘|뉴스|공식\s*문서|문서|사이트|웹사이트|링크|주소|릴리즈\s*노트|업데이트/u,
];
export async function* runAgent(params) {
    const runId = params.runId ?? crypto.randomUUID();
    const sessionId = params.sessionId ?? crypto.randomUUID();
    const model = params.model ?? getDefaultModel();
    const workDir = params.workDir ?? homedir();
    const signal = params.signal ?? new AbortController().signal;
    const toolsEnabled = params.toolsEnabled ?? true;
    const contextMode = params.contextMode ?? "full";
    const now = Date.now();
    // Upsert session
    const existing = getSession(sessionId);
    if (!existing) {
        insertSession({
            id: sessionId,
            source: params.source ?? "cli",
            source_id: null,
            created_at: now,
            updated_at: now,
            summary: null,
        });
    }
    else {
        getDb().prepare("UPDATE sessions SET updated_at = ? WHERE id = ?").run(now, sessionId);
    }
    eventBus.emit("agent.start", { sessionId, runId });
    log.info(`Agent run ${runId} started (session=${sessionId}, model=${model})`);
    // Load prior messages from DB
    const priorDbMessages = contextMode === "isolated"
        ? []
        : contextMode === "request_group"
            ? (params.requestGroupId ? selectRequestGroupContextMessages(getMessagesForRequestGroupWithRunMeta(sessionId, params.requestGroupId)) : [])
            : params.requestGroupId
                ? getMessagesForRequestGroup(sessionId, params.requestGroupId)
                : getMessages(sessionId);
    const rawMessages = priorDbMessages.map((m) => ({
        role: m.role,
        content: m.tool_calls ? JSON.parse(m.tool_calls) : m.content,
    }));
    // Sanitize: strip orphaned tool_call blocks
    const messages = [];
    for (let i = 0; i < rawMessages.length; i++) {
        const msg = rawMessages[i];
        if (msg.role === "assistant" &&
            Array.isArray(msg.content) &&
            msg.content.some((b) => b.type === "tool_use")) {
            const next = rawMessages[i + 1];
            const nextHasToolResults = next != null &&
                Array.isArray(next.content) &&
                next.content.some((b) => b.type === "tool_result");
            if (!nextHasToolResults) {
                const textOnly = msg.content
                    .filter((b) => b.type === "text")
                    .map((b) => b.text ?? "")
                    .join("\n");
                if (textOnly)
                    messages.push({ role: "assistant", content: textOnly });
                log.warn(`Stripped orphaned tool_calls from assistant message (session=${sessionId})`);
                continue;
            }
        }
        messages.push(msg);
    }
    // Append the new user message
    const userMsg = { role: "user", content: params.userMessage };
    messages.push(userMsg);
    insertMessage({
        id: crypto.randomUUID(),
        session_id: sessionId,
        root_run_id: runId,
        role: "user",
        content: params.userMessage,
        tool_calls: null,
        tool_call_id: null,
        created_at: Date.now(),
    });
    // Build tool definitions
    const allowWebAccess = shouldAllowWebAccess(params.userMessage);
    const tools = toolsEnabled
        ? toolDispatcher.getAll().filter((tool) => allowWebAccess || (tool.name !== "web_search" && tool.name !== "web_fetch"))
        : [];
    const toolDefs = tools.map((t) => ({
        name: t.name,
        description: t.description,
        input_schema: t.parameters,
    }));
    const resolvedProviderId = params.providerId ?? inferProviderId(model);
    const provider = params.provider ?? getProvider(resolvedProviderId);
    const forceReasoningMode = shouldForceReasoningMode(resolvedProviderId, model);
    // ── Build system prompt with NOBIE.md + memory context ────────────────
    const baseSystemPrompt = params.systemPrompt ??
        [
            "You are Nobie, the orchestration-first personal AI assistant for Sponzey Nobie running on the user's personal computer.",
            `Today is ${new Date().toLocaleDateString()}.`,
            "",
            "[기본 역할]",
            "들어온 요구 조건을 먼저 이해하고, 이 작업을 어떻게 진행해야 하는지 스스로 고민하세요.",
            "필요하면 작업을 단계로 나누고, 어떤 도구나 어떤 AI가 이 문제를 가장 잘 해결할 수 있는지 판단하세요.",
            "직접 해결하는 것보다 더 적합한 AI나 실행 경로가 있으면 그 대상에게 작업을 전달해 처리하게 하세요.",
            "전달 후에는 결과를 검토하고, 아직 남은 작업이 있으면 설정된 한도 안에서 재귀적으로 후속 처리를 계속하세요.",
            "모든 후속 처리가 끝났을 때만 완료로 판단하고, 사용자 입력이 꼭 필요할 때만 멈추세요.",
            "",
            "[행동 원칙]",
            "항상 정확하고 실행 지향적으로 행동하세요.",
            "불필요한 장황함을 피하고, 실제로 문제를 해결하는 데 집중하세요.",
            "중간 추론을 장황하게 노출하지 말고, 최종적으로 필요한 정보와 결과를 간결하게 제시하세요.",
            "로컬 환경, 파일, 도구, 메모리, 지침 체인을 우선적으로 활용하세요.",
            "사용자 질문의 언어를 유지해서 답변하세요. 사용자가 한국어로 물으면 한국어로, 영어로 물으면 영어로 답하세요. 사용자가 명시적으로 번역을 요청하지 않으면 답변 언어를 임의로 바꾸지 마세요.",
        ].join("\n");
    const reasoningDirective = forceReasoningMode
        ? `\n[추론 정책]\n현재 실행 대상은 llama/ollama 계열로 간주합니다. 항상 사유 모드를 켜고 더 신중하게 검토한 뒤 답하세요. 즉시 반응하지 말고, 작업 계획과 가능한 해결 경로를 먼저 내부적으로 점검한 뒤 진행하세요. 내부적으로 충분히 숙고하되, 중간 추론을 길게 노출하지 말고 최종 답변만 간결하게 제시하세요.`
        : "";
    const webPolicyDirective = `\n[웹 접근 정책]\nweb_search와 web_fetch는 사용자가 명시적으로 웹 검색, 최신 정보, 공식 문서, 특정 사이트 확인을 요청했거나, 답변에 외부 최신 정보 검증이 꼭 필요한 경우에만 사용하세요. 그 외에는 로컬 파일, 메모리, 기존 대화와 내장 지식으로 먼저 답하세요.`;
    const instructions = loadMergedInstructions(workDir);
    const profileContext = buildUserProfilePromptContext();
    const nobieMd = loadNobieMd(workDir);
    const memoryContext = await buildMemoryContext(params.userMessage);
    const systemPrompt = [
        baseSystemPrompt,
        reasoningDirective,
        webPolicyDirective,
        instructions.mergedText ? `\n[Instruction Chain]\n${instructions.mergedText}` : "",
        profileContext ? `\n${profileContext}` : "",
        nobieMd ? `\n[프로젝트 메모리]\n${nobieMd}` : "",
        memoryContext ? `\n${memoryContext}` : "",
    ].join("");
    // ── Context compression if needed ────────────────────────────────────
    let totalTokens = 0;
    if (needsCompression(messages, 0)) {
        log.info(`컨텍스트 압축 중... (messages: ${messages.length})`);
        try {
            const compressed = await compressContext(messages, priorDbMessages, provider, model);
            // Replace in-memory messages with compressed version
            messages.length = 0;
            for (const m of compressed.messages)
                messages.push(m);
            // Persist summary to memory_items
            const summaryId = crypto.randomUUID();
            insertMemoryItem({
                content: compressed.summary,
                sessionId,
                type: "session_summary",
                importance: "medium",
            });
            // Mark old DB messages as compressed
            markMessagesCompressed(compressed.compressedIds, summaryId);
            log.info(`압축 완료 — ${compressed.compressedIds.length}개 메시지 → 요약 1개 + tail ${messages.length - 1}개`);
        }
        catch (err) {
            log.warn(`컨텍스트 압축 실패 (무시): ${err instanceof Error ? err.message : String(err)}`);
        }
    }
    let textBuffer = "";
    const ctx = {
        sessionId,
        runId,
        workDir,
        userMessage: params.userMessage,
        allowWebAccess,
        signal,
        onProgress: (msg) => {
            if (msg.trim())
                log.debug(`[tool progress] ${msg.trim()}`);
        },
    };
    // Tool-call loop
    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
        if (signal.aborted) {
            yield { type: "error", message: "Aborted by user" };
            return;
        }
        const pendingToolUses = [];
        try {
            for await (const chunk of provider.chat({
                model,
                messages,
                system: systemPrompt,
                tools: toolDefs,
                signal,
            })) {
                if (signal.aborted)
                    break;
                if (chunk.type === "text_delta") {
                    textBuffer += chunk.delta;
                    yield { type: "text", delta: chunk.delta };
                    eventBus.emit("agent.stream", { sessionId, runId, delta: chunk.delta });
                }
                else if (chunk.type === "tool_use") {
                    pendingToolUses.push({ id: chunk.id, name: chunk.name, input: chunk.input });
                }
                else if (chunk.type === "message_stop") {
                    totalTokens += chunk.usage.input_tokens + chunk.usage.output_tokens;
                }
            }
        }
        catch (err) {
            if (signal.aborted) {
                yield { type: "error", message: "Aborted" };
                return;
            }
            const msg = err instanceof Error ? err.message : String(err);
            log.error(`LLM error: ${msg}`);
            yield { type: "error", message: `LLM error: ${msg}` };
            return;
        }
        // No tool calls → final response
        if (pendingToolUses.length === 0) {
            if (textBuffer) {
                insertMessage({
                    id: crypto.randomUUID(),
                    session_id: sessionId,
                    root_run_id: runId,
                    role: "assistant",
                    content: textBuffer,
                    tool_calls: null,
                    tool_call_id: null,
                    created_at: Date.now(),
                });
            }
            break;
        }
        // Build assistant message with tool_use blocks
        const assistantContent = [
            ...(textBuffer ? [{ type: "text", text: textBuffer }] : []),
            ...pendingToolUses.map((tu) => ({
                type: "tool_use",
                id: tu.id,
                name: tu.name,
                input: tu.input,
            })),
        ];
        messages.push({ role: "assistant", content: assistantContent });
        insertMessage({
            id: crypto.randomUUID(),
            session_id: sessionId,
            root_run_id: runId,
            role: "assistant",
            content: textBuffer,
            tool_calls: JSON.stringify(assistantContent),
            tool_call_id: null,
            created_at: Date.now(),
        });
        textBuffer = "";
        // Execute tools
        const toolResultContents = [];
        for (const tu of pendingToolUses) {
            yield { type: "tool_start", toolName: tu.name, params: tu.input };
            log.info(`Executing tool: ${tu.name}`);
            const result = await toolDispatcher.dispatch(tu.name, tu.input, ctx);
            yield { type: "tool_end", toolName: tu.name, success: result.success, output: result.output };
            toolResultContents.push({
                type: "tool_result",
                tool_use_id: tu.id,
                content: result.output,
                is_error: !result.success,
            });
        }
        messages.push({ role: "user", content: toolResultContents });
        insertMessage({
            id: crypto.randomUUID(),
            session_id: sessionId,
            root_run_id: runId,
            role: "user",
            content: "",
            tool_calls: JSON.stringify(toolResultContents),
            tool_call_id: null,
            created_at: Date.now(),
        });
        // Guard against runaway context
        if (totalTokens > MAX_CONTEXT_TOKENS) {
            log.warn("Context token limit approached — stopping tool loop");
            break;
        }
    }
    const durationMs = Date.now() - now;
    eventBus.emit("agent.end", { sessionId, runId, durationMs });
    log.info(`Agent run ${runId} done in ${durationMs}ms (tokens≈${totalTokens})`);
    yield { type: "done", totalTokens };
}
function shouldAllowWebAccess(userMessage) {
    const normalized = userMessage.trim();
    if (!normalized)
        return false;
    return WEB_POLICY_PATTERN.some((pattern) => pattern.test(normalized));
}
//# sourceMappingURL=index.js.map