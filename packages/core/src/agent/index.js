import { homedir } from "node:os";
import { eventBus } from "../events/index.js";
import { detectAvailableProvider, getProvider, getDefaultModel, shouldForceReasoningMode } from "../ai/index.js";
import { toolDispatcher } from "../tools/dispatcher.js";
import { createLogger } from "../logger/index.js";
import { getDb, insertSession, getSession, insertMessage, getMessages, getMessagesForRequestGroup, getMessagesForRequestGroupWithRunMeta, getMessagesForRun, insertDiagnosticEvent, markMessagesCompressed, updateRunPromptSourceSnapshot, upsertPromptSources, getPromptSourceStates, upsertTaskContinuity } from "../db/index.js";
import { loadNobieMd, loadPromptSourceRegistry, loadSystemPromptSourceAssembly } from "../memory/nobie-md.js";
import { buildMemoryContext, storeMemorySync } from "../memory/store.js";
import { buildFlashFeedbackContext } from "../memory/flash-feedback.js";
import { compressContext } from "../memory/compressor.js";
import { needsSessionCompaction, persistSessionCompactionMaintenance } from "../memory/compaction.js";
import { buildScheduleMemoryContext } from "../schedules/context.js";
import { loadMergedInstructions } from "../instructions/merge.js";
import { selectRequestGroupContextMessages } from "./request-group-context.js";
import { buildUserProfilePromptContext } from "./profile-context.js";
import { shouldTerminateRunAfterSuccessfulTool } from "../runs/isolated-tool-response.js";
import { sanitizeUserFacingError } from "../runs/error-sanitizer.js";
import { appendRunEvent } from "../runs/store.js";
import { createContextBlock, renderContextBlockForPrompt } from "../security/trust-boundary.js";
import { chatWithContextPreflight } from "../runs/context-preflight.js";
const log = createLogger("agent");
const MAX_TOOL_ROUNDS = 20; // prevent infinite loops
const MAX_CONTEXT_TOKENS = 150_000;
const WEB_POLICY_PATTERN = [
    /https?:\/\//i,
    /\b(web|internet|browse|browser|search|google|docs?|documentation|readme|website|site|url|link)\b/i,
    /\b(latest|recent|current|today|news|official|release(?:s| notes?)?|update(?:d|s)?)\b/i,
    /웹|인터넷|검색|브라우저|최신|최근|현재|오늘|뉴스|공식\s*문서|문서|사이트|웹사이트|링크|주소|릴리즈\s*노트|업데이트/u,
];
const DIAGNOSTIC_MEMORY_PATTERN = /(diagnostic|diagnostics|debug|error|failure|failed|stack trace|로그|진단|디버그|오류|에러|실패|복구|원인|왜\s*안|안\s*돼|안돼)/i;
const EXECUTION_RECOVERY_TOOL_NAMES = new Set([
    "shell_exec",
    "app_launch",
    "process_kill",
    "screen_capture",
    "mouse_move",
    "mouse_click",
    "keyboard_type",
    "yeonjang_camera_list",
    "yeonjang_camera_capture",
]);
function renderPromptContext(params) {
    const content = params.content.trim();
    if (!content)
        return "";
    return `\n${renderContextBlockForPrompt(createContextBlock({
        id: params.id,
        tag: params.tag,
        title: params.title,
        content,
    }))}`;
}
const DEFAULT_SYSTEM_PROMPT = [
    "You are Nobie.",
    "",
    "[Identity]",
    "Nobie is an orchestration-first personal AI assistant running on the user's personal computer.",
    "Your main job is not explanation. Your main job is execution orchestration and problem solving.",
    "You must understand the user's request, choose the best tool, AI, and execution path, and drive the work to completion.",
    "",
    "[Definition of Yeonjang]",
    "Yeonjang is an external execution tool connected to Nobie.",
    "Yeonjang can perform privileged local operations such as system control, screen capture, camera access, keyboard control, mouse control, and command execution.",
    "Yeonjang is a separate execution actor from the Nobie core and connects through MQTT.",
    "A single Nobie instance may have multiple connected Yeonjang extensions.",
    "Each extension may be on a different computer or device.",
    "Nobie can choose which extension to use based on extension connection data and extension IDs.",
    "When a task requires system privileges or device control, the default policy is to choose an appropriate connected extension instead of doing the work directly in the Nobie core.",
    "If the user explicitly names a computer, operating system, or Yeonjang extension ID, every Yeonjang tool call must keep that same target extension.",
    "Do not invent aliases such as 'yeonjang-windows' unless that is the real connected extension ID.",
    "Do not switch to another extension during recovery unless the user explicitly approves the target change.",
    "",
    "[Top-Level Objective]",
    "Always prioritize the following:",
    "1. Understand the user's request accurately.",
    "2. Execute as soon as reasonably possible.",
    "3. Review the result.",
    "4. Continue follow-up work if anything remains.",
    "5. Ask the user only when clarification is truly necessary.",
    "",
    "[Core Behavioral Rules]",
    "Prefer real execution over long planning or long explanations.",
    "If a request is actionable, execute first and summarize after execution.",
    "If the user gives feedback, do not restart from zero. Continue from the latest result and revise it.",
    "Interpret the user's request based on the literal wording first.",
    "Also infer the normal, common-sense purpose and the usual intended outcome contained in that wording.",
    "Do not read the request in an overly mechanical way. Interpret it as a normal user would typically expect the result.",
    "Do not invent special hidden goals, expand the scope too far, or over-interpret unstated intent.",
    "Do not transform the request into a different task.",
    "Decide for yourself which tool, AI, or execution route is best for the task.",
    "If another AI or execution path is better than handling it directly, route the work there.",
    "After delegation or routing, review the result and continue follow-up execution when needed.",
    "For tasks that require system privileges, system control, local device control, command execution, app launch, screen capture, keyboard input, or mouse control, use Yeonjang only.",
    "Do not fall back to Nobie core local execution for those tasks.",
    "If Yeonjang is unavailable or the connected extension does not support the required method, stop clearly and report that the extension path is required.",
    "Prefer local environment, local files, local tools, memory, and instruction chain context.",
    "If a task can be solved without the web, solve it locally first.",
    "If the user asks in Korean, answer in Korean.",
    "If the user asks in English, answer in English.",
    "Do not switch languages unless the user explicitly asks for translation.",
    "For simple checks, confirmations, counts, summaries, and status reports, deliver the result as normal text in the current channel.",
    "Do not create temporary text or document files just to send a plain answer.",
    "Use file delivery only when the result is inherently a file artifact such as a screenshot, camera photo, generated document explicitly requested by the user, or an existing file the user explicitly asked to send.",
    "If the user explicitly requires a front or rear lens on an iPhone Continuity Camera and the extension reports that lens selection is unsupported, do not capture or send a substitute image.",
    "In that case, explain the limitation clearly and ask the user to switch the phone lens manually or choose another camera.",
    "",
    "[Failure Handling Rules]",
    "If a tool fails, read the reason.",
    "Do not repeat the same failed method blindly.",
    "Re-check path, permissions, input format, execution order, and available alternative tools.",
    "Try another workable method when possible.",
    "If an AI call fails, do not stop immediately.",
    "Analyze the reason for failure.",
    "If needed, change the target, the model, or the execution route.",
    "Do not simply retry the exact same request in the exact same way.",
    "Automatic recovery and retry must stay within the configured retry limit for the current request.",
    "When the limit is reached, stop clearly instead of looping forever.",
    "Leave a clear reason for the stop.",
    "",
    "[Completion Rules]",
    "Mark the task complete only when all required follow-up work is finished.",
    "If the request requires real local file creation or modification, actual results must exist before the task is considered complete.",
    "Do not claim completion based only on plans, partial output, or example code.",
    "",
    "[When To Ask The User Again]",
    "Ask the user again only when the target is ambiguous and executing the wrong target would be risky.",
    "Ask again when there are multiple existing work candidates and the correct one cannot be chosen safely.",
    "Ask again when a required input value is missing and execution is impossible without it.",
    "Ask again when approval is required before continuing.",
    "Otherwise, prefer making a reasonable decision and continuing execution.",
    "",
    "[Response Style Rules]",
    "Be accurate and execution-oriented.",
    "Do not be unnecessarily verbose.",
    "Do not expose long internal reasoning.",
    "Present only the result and the information the user actually needs.",
    "",
    "[Short Memory Rules]",
    "Interpret the request literally first.",
    "Also infer normal common-sense intent.",
    "Execute before over-explaining.",
    "Use Yeonjang only for privileged system work and local device control.",
    "If something fails, analyze the cause and try another method.",
    "Do not loop forever.",
    "Preserve the user's language.",
    "Completion requires real results.",
].join("\n");
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
        : contextMode === "handoff"
            ? getMessagesForRun(sessionId, runId)
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
        ? toolDispatcher.getAll().filter((tool) => toolDispatcher.isToolAvailableForSource(tool, params.source ?? "cli")
            && (allowWebAccess || (tool.name !== "web_search" && tool.name !== "web_fetch")))
        : [];
    const toolDefs = tools.map((t) => ({
        name: t.name,
        description: t.description,
        input_schema: t.parameters,
    }));
    const resolvedProviderId = params.providerId ?? detectAvailableProvider();
    const provider = params.provider ?? getProvider(resolvedProviderId);
    const forceReasoningMode = shouldForceReasoningMode(resolvedProviderId, model);
    // ── Build system prompt with NOBIE.md + memory context ────────────────
    const promptStartedAt = Date.now();
    const promptSourceRegistry = loadPromptSourceRegistry(workDir);
    upsertPromptSources(promptSourceRegistry.map(({ content: _content, ...metadata }) => metadata));
    const promptAssembly = loadSystemPromptSourceAssembly(workDir, "ko", getPromptSourceStates());
    if (promptAssembly)
        updateRunPromptSourceSnapshot(runId, promptAssembly.snapshot);
    const baseSystemPrompt = params.systemPrompt
        ?? promptAssembly?.text
        ?? DEFAULT_SYSTEM_PROMPT;
    const runtimeDirective = `[Runtime]\nToday is ${new Date().toLocaleDateString()}.`;
    const reasoningDirective = forceReasoningMode
        ? `\n[추론 정책]\n현재 실행 대상은 llama/ollama 계열로 간주합니다. 항상 사유 모드를 켜고 더 신중하게 검토한 뒤 답하세요. 즉시 반응하지 말고, 작업 계획과 가능한 해결 경로를 먼저 내부적으로 점검한 뒤 진행하세요. 내부적으로 충분히 숙고하되, 중간 추론을 길게 노출하지 말고 최종 답변만 간결하게 제시하세요.`
        : "";
    const webPolicyDirective = `\n[웹 접근 정책]\nweb_search와 web_fetch는 사용자가 명시적으로 웹 검색, 최신 정보, 공식 문서, 특정 사이트 확인을 요청했거나, 답변에 외부 최신 정보 검증이 꼭 필요한 경우에만 사용하세요. 그 외에는 로컬 파일, 메모리, 기존 대화와 내장 지식으로 먼저 답하세요. 같은 요청 안에서 동일한 검색어, URL, 출처를 반복 호출하지 마세요. 웹 도구가 중복 호출을 skipped로 반환하면 그 결과를 실패가 아니라 이미 확보한 근거로 간주하세요. web_search는 검색 발견 단계이며 사용자 문장 분류나 별도 게이트 판단으로 완료를 막지 않습니다. 도구 결과의 freshnessPolicy와 sourceGuard.status를 우선 따르세요. freshnessPolicy=latest_approximate 또는 sourceGuard.status=approximate_latest이면 source와 fetchTimestamp를 함께 밝히고 "수집 시각 기준 근사값"으로 답할 수 있습니다. 단, 근사값 허용은 추정 허용이 아닙니다. 요청 대상과 같은 출처 항목, 심볼, 이름, 검색 결과 항목에 직접 붙어 있는 수치 후보만 사용하세요. 주변 지수, 다른 티커, 다른 표 행, 기사 숫자, 과거 값, 모델 기억값으로 범위나 숫자를 만들지 마세요. web_search만 성공한 상태에서 값이 없다고 최종 답변하지 마세요. 값 미추출로 완료하려면 같은 요청 안에서 web_fetch 또는 브라우저 근거 확인을 최소 1회 수행했어야 합니다. freshnessPolicy=strict_timestamp이면 sourceTimestamp 또는 신뢰 가능한 기준 시각이 없을 때 수치를 확정하지 마세요. web_fetch나 브라우저 페이지에서 숫자가 잘 추출되지 않아도 이미 확보한 web_search 스니펫에 요청 대상과 직접 연결된 수치 후보가 있고 도구 정책이 근사값을 허용하면 그 근사값으로 답하세요. 웹 페이지 값 추출을 위해 로컬 workspace file_search를 사용하지 마세요. file_search는 로컬 파일 검색 전용이며 웹 검색 결과나 브라우저 HTML의 숫자 추출 fallback이 아닙니다. 브라우저 검색은 느린 보조 근거입니다. 직접 fetch나 공식 API가 이미 충분하면 브라우저 timeout을 전체 실패로 뒤집지 마세요.`;
    const instructions = loadMergedInstructions(workDir);
    const profileContext = buildUserProfilePromptContext();
    const nobieMd = loadNobieMd(workDir);
    if (nobieMd) {
        appendRunEvent(runId, "prompt_legacy_project_memory_loaded");
        insertDiagnosticEvent({
            kind: "legacy_prompt_source_used",
            summary: "Legacy project memory was appended after prompt source registry assembly.",
            runId,
            sessionId,
            ...(params.requestGroupId ? { requestGroupId: params.requestGroupId } : {}),
            detail: {
                priority: "prompts/ registry first, legacy NOBIE.md/WIZBY.md/HOWIE.md appended as project memory context",
                workDir,
            },
        });
    }
    appendAgentLatencyEvent(runId, "prompt_ms", Date.now() - promptStartedAt);
    const memoryStartedAt = Date.now();
    const flashFeedbackContext = buildFlashFeedbackContext({
        sessionId,
        limit: 4,
        maxChars: contextMode === "isolated" ? 500 : 800,
    });
    const scheduleMemoryContext = params.includeScheduleMemory && params.scheduleId
        ? buildScheduleMemoryContext({ scheduleId: params.scheduleId, maxRuns: 3 })
        : "";
    const memoryContext = await buildMemoryContext({
        query: params.memorySearchQuery ?? params.userMessage,
        sessionId,
        runId,
        ...(params.requestGroupId ? { requestGroupId: params.requestGroupId } : {}),
        ...(params.scheduleId ? { scheduleId: params.scheduleId } : {}),
        ...(params.includeScheduleMemory ? { includeSchedule: true } : {}),
        ...(shouldIncludeDiagnosticMemory(params.userMessage) ? { includeDiagnostic: true } : {}),
        budget: {
            maxChunks: contextMode === "handoff" ? 3 : 4,
            maxChars: contextMode === "isolated" ? 1400 : 2200,
            maxChunkChars: 420,
        },
    });
    appendAgentLatencyEvent(runId, "memory_total_ms", Date.now() - memoryStartedAt);
    const systemPrompt = [
        baseSystemPrompt,
        `\n${runtimeDirective}`,
        reasoningDirective,
        webPolicyDirective,
        instructions.mergedText ? `\n[Instruction Chain]\n${instructions.mergedText}` : "",
        profileContext ? `\n${profileContext}` : "",
        nobieMd ? renderPromptContext({ id: "project-memory", tag: "file_content", title: "프로젝트 메모리", content: nobieMd }) : "",
        flashFeedbackContext ? renderPromptContext({ id: "flash-feedback-context", tag: "user_input", title: "Flash Feedback Context", content: flashFeedbackContext }) : "",
        scheduleMemoryContext ? renderPromptContext({ id: "schedule-memory-context", tag: "user_input", title: "Schedule Memory Context", content: scheduleMemoryContext }) : "",
        memoryContext ? renderPromptContext({ id: "memory-context", tag: "tool_result", title: "Memory Context", content: memoryContext }) : "",
    ].join("");
    // ── Context compression if needed ────────────────────────────────────
    let totalTokens = 0;
    if (needsSessionCompaction(messages, totalTokens)) {
        log.info(`컨텍스트 압축 중... (messages: ${messages.length})`);
        try {
            const compressed = await compressContext(messages, priorDbMessages, provider, model);
            // Replace in-memory messages with compressed version
            messages.length = 0;
            for (const m of compressed.messages)
                messages.push(m);
            // Persist summary to memory_items
            const summaryId = storeMemorySync({
                content: compressed.summary,
                scope: "session",
                sessionId,
                runId,
                ...(params.requestGroupId ? { requestGroupId: params.requestGroupId } : {}),
                type: "session_summary",
                importance: "medium",
            });
            // Mark old DB messages as compressed
            markMessagesCompressed(compressed.compressedIds, summaryId);
            const maintenance = persistSessionCompactionMaintenance({
                sessionId,
                summary: compressed.summary,
                ...(params.requestGroupId ? { requestGroupId: params.requestGroupId } : {}),
                runId,
                durableFacts: [compressed.summary],
            });
            if (params.requestGroupId) {
                upsertTaskContinuity({
                    lineageRootRunId: params.requestGroupId,
                    lastGoodState: `session_snapshot:${maintenance.snapshotId}`,
                    status: "recoverable",
                });
            }
            appendAgentLatencyEvent(runId, "compaction_snapshot", 0);
            log.info(`압축 완료 — ${compressed.compressedIds.length}개 메시지 → 요약 1개 + tail ${messages.length - 1}개`);
        }
        catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            log.warn(`컨텍스트 압축 실패: ${message}`);
            appendRunEvent(runId, "context_compaction_failed");
            insertDiagnosticEvent({
                kind: "context_compaction_failed",
                summary: "컨텍스트 압축에 실패했습니다. 마지막 usable snapshot 또는 pruning 경로를 사용해야 합니다.",
                runId,
                sessionId,
                ...(params.requestGroupId ? { requestGroupId: params.requestGroupId } : {}),
                recoveryKey: `context_compaction:${sessionId}`,
                detail: { error: message, messageCount: messages.length },
            });
        }
    }
    let textBuffer = "";
    let firstChunkRecorded = false;
    const ctx = {
        sessionId,
        runId,
        ...(params.requestGroupId ? { requestGroupId: params.requestGroupId } : {}),
        workDir,
        userMessage: params.userMessage,
        source: params.source ?? "cli",
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
            for await (const chunk of chatWithContextPreflight({
                provider,
                model,
                messages,
                system: systemPrompt,
                tools: toolDefs,
                signal,
                metadata: {
                    runId,
                    sessionId,
                    ...(params.requestGroupId ? { requestGroupId: params.requestGroupId } : {}),
                    operation: `agent.round.${round}`,
                },
            })) {
                if (signal.aborted)
                    break;
                if (!firstChunkRecorded) {
                    firstChunkRecorded = true;
                    appendAgentLatencyEvent(runId, "first_chunk_ms", Date.now() - now);
                }
                if (chunk.type === "text_delta") {
                    textBuffer += chunk.delta;
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
            const sanitized = sanitizeUserFacingError(msg);
            log.error(`AI error: ${msg}`);
            textBuffer = "";
            yield {
                type: "ai_recovery",
                summary: "AI 응답 생성 중 오류가 발생해 다른 방법을 다시 시도합니다.",
                reason: sanitized.reason,
                message: sanitized.userMessage,
            };
            return;
        }
        // No tool calls → final response
        if (pendingToolUses.length === 0) {
            if (textBuffer) {
                const deliveredText = textBuffer;
                yield { type: "text", delta: deliveredText };
                eventBus.emit("agent.stream", { sessionId, runId, delta: deliveredText });
                insertMessage({
                    id: crypto.randomUUID(),
                    session_id: sessionId,
                    root_run_id: runId,
                    role: "assistant",
                    content: deliveredText,
                    tool_calls: null,
                    tool_call_id: null,
                    created_at: Date.now(),
                });
                textBuffer = "";
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
        const executionRecoveryFailures = [];
        const executedToolResults = [];
        for (const tu of pendingToolUses) {
            yield { type: "tool_start", toolName: tu.name, params: tu.input };
            log.info(`Executing tool: ${tu.name}`);
            const result = await toolDispatcher.dispatch(tu.name, tu.input, ctx);
            yield {
                type: "tool_end",
                toolName: tu.name,
                success: result.success,
                output: result.output,
                ...(result.details !== undefined ? { details: result.details } : {}),
            };
            executedToolResults.push({ toolName: tu.name, result });
            if (shouldSignalExecutionRecovery(tu.name, result)) {
                executionRecoveryFailures.push({
                    toolName: tu.name,
                    output: result.output,
                    ...(result.error ? { error: result.error } : {}),
                });
            }
            toolResultContents.push({
                type: "tool_result",
                tool_use_id: tu.id,
                content: buildToolResultContent(tu.name, result),
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
        const terminalFailureText = getTerminalFailureText(executedToolResults);
        if (terminalFailureText) {
            yield { type: "text", delta: terminalFailureText };
            eventBus.emit("agent.stream", { sessionId, runId, delta: terminalFailureText });
            insertMessage({
                id: crypto.randomUUID(),
                session_id: sessionId,
                root_run_id: runId,
                role: "assistant",
                content: terminalFailureText,
                tool_calls: null,
                tool_call_id: null,
                created_at: Date.now(),
            });
            break;
        }
        if (shouldStopAfterToolRound({
            source: ctx.source,
            toolResults: executedToolResults,
        })) {
            break;
        }
        if (executionRecoveryFailures.length > 0) {
            yield {
                type: "execution_recovery",
                toolNames: [...new Set(executionRecoveryFailures.map((failure) => failure.toolName))],
                summary: buildExecutionRecoverySummary(executionRecoveryFailures),
                reason: buildExecutionRecoveryReason(executionRecoveryFailures),
            };
        }
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
function shouldStopAfterToolRound(params) {
    for (const toolResult of params.toolResults) {
        if (shouldTerminateRunAfterSuccessfulTool({
            type: "tool_end",
            toolName: toolResult.toolName,
            success: toolResult.result.success,
            output: toolResult.result.output,
            ...(toolResult.result.details !== undefined ? { details: toolResult.result.details } : {}),
        })) {
            return true;
        }
    }
    if (params.source !== "telegram") {
        return false;
    }
    return params.toolResults.some(({ toolName, result }) => toolName === "telegram_send_file" && !result.success);
}
function appendAgentLatencyEvent(runId, name, durationMs) {
    try {
        appendRunEvent(runId, `${name}=${Math.max(0, Math.floor(durationMs))}ms`);
    }
    catch {
        // Latency tracing must never affect model execution.
    }
}
function shouldIncludeDiagnosticMemory(userMessage) {
    return DIAGNOSTIC_MEMORY_PATTERN.test(userMessage.trim());
}
function shouldAllowWebAccess(userMessage) {
    const normalized = userMessage.trim();
    if (!normalized)
        return false;
    return WEB_POLICY_PATTERN.some((pattern) => pattern.test(normalized));
}
function shouldSignalExecutionRecovery(toolName, result) {
    return !result.success
        && EXECUTION_RECOVERY_TOOL_NAMES.has(toolName)
        && !isNonRecoverableExecutionToolFailure(result);
}
function isNonRecoverableExecutionToolFailure(result) {
    return result.error === "CAMERA_FACING_SELECTION_UNSUPPORTED";
}
function getTerminalFailureText(toolResults) {
    for (const { result } of toolResults) {
        if (!result.success && shouldStopAfterFailure(result.details)) {
            const text = result.output.trim();
            if (text)
                return text;
        }
    }
    return null;
}
function shouldStopAfterFailure(details) {
    if (!details || typeof details !== "object")
        return false;
    return Boolean(details.stopAfterFailure);
}
function buildExecutionRecoverySummary(failures) {
    const toolNames = [...new Set(failures.map((failure) => failure.toolName))];
    if (toolNames.length === 0) {
        return "실행 실패 원인을 분석하고 다른 방법을 다시 시도합니다.";
    }
    if (toolNames.length === 1) {
        return `${toolNames[0]} 실패 원인을 분석하고 다른 방법을 다시 시도합니다.`;
    }
    return `${toolNames.join(", ")} 실패 원인을 분석하고 대안을 다시 시도합니다.`;
}
function buildExecutionRecoveryReason(failures) {
    const latest = failures[failures.length - 1];
    const latestOutput = latest?.output ?? "";
    if (/(not found|command not found|enoent|is not recognized)/i.test(latestOutput)) {
        return "실행 대상 명령이나 프로그램을 찾지 못했습니다.";
    }
    if (/(permission denied|operation not permitted|eacces|not authorized|권한)/i.test(latestOutput)) {
        return "권한 또는 접근 제한으로 작업 실행이 실패했습니다.";
    }
    if (/(no such file|cannot find|not a directory|경로|파일을 찾을 수 없음)/i.test(latestOutput)) {
        return "대상 경로나 파일 이름이 맞지 않아 작업이 실패했습니다.";
    }
    if (/(timeout|timed out|시간 초과)/i.test(latestOutput)) {
        return "시간 초과로 작업 실행이 실패했습니다.";
    }
    return latest?.error?.trim() || "작업 실행이 실패해 다른 방법 검토가 필요합니다.";
}
function describeAiErrorReason(message) {
    return sanitizeUserFacingError(message).reason;
}
function buildToolResultContent(toolName, result) {
    const sections = [];
    const output = result.output.trim();
    sections.push(output || "(no output)");
    if (!result.success) {
        sections.push([
            "[tool_failure]",
            `tool: ${toolName}`,
            `error: ${(result.error ?? "unknown").trim() || "unknown"}`,
        ].join("\n"));
    }
    const details = stringifyToolDetails(result.details);
    if (details) {
        sections.push(`[details]\n${details}`);
    }
    return sections.join("\n\n");
}
function stringifyToolDetails(details) {
    if (details == null)
        return null;
    try {
        const text = JSON.stringify(details, null, 2);
        if (!text || text === "{}")
            return null;
        return text.length > 4000 ? `${text.slice(0, 3999)}…` : text;
    }
    catch {
        return null;
    }
}
//# sourceMappingURL=index.js.map