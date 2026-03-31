import { homedir } from "node:os"
import { eventBus } from "../events/index.js"
import { getProvider, getDefaultModel, inferProviderId, shouldForceReasoningMode, type LLMProvider } from "../llm/index.js"
import type { Message, ToolDefinition, LLMChunk } from "../llm/types.js"
import { toolDispatcher } from "../tools/dispatcher.js"
import type { ToolContext, ToolResult } from "../tools/types.js"
import { createLogger } from "../logger/index.js"
import { getDb, insertSession, getSession, insertMessage, getMessages, getMessagesForRequestGroup, getMessagesForRequestGroupWithRunMeta, insertMemoryItem, markMessagesCompressed } from "../db/index.js"
import { loadNobieMd, loadSysPropMd } from "../memory/nobie-md.js"
import { buildMemoryContext } from "../memory/store.js"
import { needsCompression, compressContext } from "../memory/compressor.js"
import { loadMergedInstructions } from "../instructions/merge.js"
import { selectRequestGroupContextMessages } from "./request-group-context.js"
import { buildUserProfilePromptContext } from "./profile-context.js"

const log = createLogger("agent")

const MAX_TOOL_ROUNDS = 20 // prevent infinite loops
const MAX_CONTEXT_TOKENS = 150_000
const WEB_POLICY_PATTERN = [
  /https?:\/\//i,
  /\b(web|internet|browse|browser|search|google|docs?|documentation|readme|website|site|url|link)\b/i,
  /\b(latest|recent|current|today|news|official|release(?:s| notes?)?|update(?:d|s)?)\b/i,
  /웹|인터넷|검색|브라우저|최신|최근|현재|오늘|뉴스|공식\s*문서|문서|사이트|웹사이트|링크|주소|릴리즈\s*노트|업데이트/u,
]
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
])

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
  "For tasks that require system privileges, system control, or local device control, prefer Yeonjang first.",
  "Use Nobie core local tools only as a fallback when Yeonjang is unavailable or cannot perform the task.",
  "Prefer local environment, local files, local tools, memory, and instruction chain context.",
  "If a task can be solved without the web, solve it locally first.",
  "If the user asks in Korean, answer in Korean.",
  "If the user asks in English, answer in English.",
  "Do not switch languages unless the user explicitly asks for translation.",
  "",
  "[Failure Handling Rules]",
  "If a tool fails, read the reason.",
  "Do not repeat the same failed method blindly.",
  "Re-check path, permissions, input format, execution order, and available alternative tools.",
  "Try another workable method when possible.",
  "If an LLM call fails, do not stop immediately.",
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
  "Prefer Yeonjang for privileged system work.",
  "If something fails, analyze the cause and try another method.",
  "Do not loop forever.",
  "Preserve the user's language.",
  "Completion requires real results.",
].join("\n")

export type AgentChunk =
  | { type: "text"; delta: string }
  | { type: "tool_start"; toolName: string; params: unknown }
  | { type: "tool_end"; toolName: string; success: boolean; output: string; details?: unknown }
  | { type: "execution_recovery"; toolNames: string[]; summary: string; reason: string }
  | { type: "llm_recovery"; summary: string; reason: string; message: string }
  | { type: "done"; totalTokens: number }
  | { type: "error"; message: string }

export type AgentContextMode = "full" | "isolated" | "request_group"

export interface RunAgentParams {
  userMessage: string
  memorySearchQuery?: string | undefined
  sessionId?: string | undefined
  requestGroupId?: string | undefined
  runId?: string | undefined
  model?: string | undefined
  providerId?: string | undefined
  provider?: LLMProvider | undefined
  systemPrompt?: string | undefined
  workDir?: string | undefined
  source?: "webui" | "cli" | "telegram" | undefined
  signal?: AbortSignal | undefined
  toolsEnabled?: boolean | undefined
  contextMode?: AgentContextMode | undefined
}

interface ExecutionRecoveryFailure {
  toolName: string
  output: string
  error?: string
}

export async function* runAgent(params: RunAgentParams): AsyncGenerator<AgentChunk> {
  const runId = params.runId ?? crypto.randomUUID()
  const sessionId = params.sessionId ?? crypto.randomUUID()
  const model = params.model ?? getDefaultModel()
  const workDir = params.workDir ?? homedir()
  const signal = params.signal ?? new AbortController().signal
  const toolsEnabled = params.toolsEnabled ?? true
  const contextMode = params.contextMode ?? "full"

  const now = Date.now()

  // Upsert session
  const existing = getSession(sessionId)
  if (!existing) {
    insertSession({
      id: sessionId,
      source: params.source ?? "cli",
      source_id: null,
      created_at: now,
      updated_at: now,
      summary: null,
    })
  } else {
    getDb().prepare("UPDATE sessions SET updated_at = ? WHERE id = ?").run(now, sessionId)
  }

  eventBus.emit("agent.start", { sessionId, runId })
  log.info(`Agent run ${runId} started (session=${sessionId}, model=${model})`)

  // Load prior messages from DB
  const priorDbMessages = contextMode === "isolated"
    ? []
    : contextMode === "request_group"
      ? (params.requestGroupId ? selectRequestGroupContextMessages(getMessagesForRequestGroupWithRunMeta(sessionId, params.requestGroupId)) : [])
      : params.requestGroupId
        ? getMessagesForRequestGroup(sessionId, params.requestGroupId)
        : getMessages(sessionId)
  const rawMessages: Message[] = priorDbMessages.map((m) => ({
    role: m.role as "user" | "assistant",
    content: m.tool_calls ? JSON.parse(m.tool_calls) : m.content,
  }))

  // Sanitize: strip orphaned tool_call blocks
  const messages: Message[] = []
  for (let i = 0; i < rawMessages.length; i++) {
    const msg = rawMessages[i]!
    if (
      msg.role === "assistant" &&
      Array.isArray(msg.content) &&
      (msg.content as Array<{ type: string }>).some((b) => b.type === "tool_use")
    ) {
      const next = rawMessages[i + 1]
      const nextHasToolResults =
        next != null &&
        Array.isArray(next.content) &&
        (next.content as Array<{ type: string }>).some((b) => b.type === "tool_result")
      if (!nextHasToolResults) {
        const textOnly = (msg.content as Array<{ type: string; text?: string }>)
          .filter((b) => b.type === "text")
          .map((b) => b.text ?? "")
          .join("\n")
        if (textOnly) messages.push({ role: "assistant", content: textOnly })
        log.warn(`Stripped orphaned tool_calls from assistant message (session=${sessionId})`)
        continue
      }
    }
    messages.push(msg)
  }

  // Append the new user message
  const userMsg: Message = { role: "user", content: params.userMessage }
  messages.push(userMsg)
  insertMessage({
    id: crypto.randomUUID(),
    session_id: sessionId,
    root_run_id: runId,
    role: "user",
    content: params.userMessage,
    tool_calls: null,
    tool_call_id: null,
    created_at: Date.now(),
  })

  // Build tool definitions
  const allowWebAccess = shouldAllowWebAccess(params.userMessage)
  const tools = toolsEnabled
    ? toolDispatcher.getAll().filter((tool) =>
        allowWebAccess || (tool.name !== "web_search" && tool.name !== "web_fetch"),
      )
    : []
  const toolDefs: ToolDefinition[] = tools.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.parameters,
  }))

  const resolvedProviderId = params.providerId ?? inferProviderId(model)
  const provider = params.provider ?? getProvider(resolvedProviderId)
  const forceReasoningMode = shouldForceReasoningMode(resolvedProviderId, model)

  // ── Build system prompt with NOBIE.md + memory context ────────────────
  const sysPropPrompt = loadSysPropMd(workDir)
  const baseSystemPrompt =
    params.systemPrompt
    ?? sysPropPrompt
    ?? DEFAULT_SYSTEM_PROMPT

  const runtimeDirective = `[Runtime]\nToday is ${new Date().toLocaleDateString()}.`

  const reasoningDirective = forceReasoningMode
    ? `\n[추론 정책]\n현재 실행 대상은 llama/ollama 계열로 간주합니다. 항상 사유 모드를 켜고 더 신중하게 검토한 뒤 답하세요. 즉시 반응하지 말고, 작업 계획과 가능한 해결 경로를 먼저 내부적으로 점검한 뒤 진행하세요. 내부적으로 충분히 숙고하되, 중간 추론을 길게 노출하지 말고 최종 답변만 간결하게 제시하세요.`
    : ""

  const webPolicyDirective = `\n[웹 접근 정책]\nweb_search와 web_fetch는 사용자가 명시적으로 웹 검색, 최신 정보, 공식 문서, 특정 사이트 확인을 요청했거나, 답변에 외부 최신 정보 검증이 꼭 필요한 경우에만 사용하세요. 그 외에는 로컬 파일, 메모리, 기존 대화와 내장 지식으로 먼저 답하세요.`

  const instructions = loadMergedInstructions(workDir)
  const profileContext = buildUserProfilePromptContext()
  const nobieMd = loadNobieMd(workDir)
  const memoryContext = await buildMemoryContext(params.memorySearchQuery ?? params.userMessage)

  const systemPrompt = [
    baseSystemPrompt,
    `\n${runtimeDirective}`,
    reasoningDirective,
    webPolicyDirective,
    instructions.mergedText ? `\n[Instruction Chain]\n${instructions.mergedText}` : "",
    profileContext ? `\n${profileContext}` : "",
    nobieMd ? `\n[프로젝트 메모리]\n${nobieMd}` : "",
    memoryContext ? `\n${memoryContext}` : "",
  ].join("")

  // ── Context compression if needed ────────────────────────────────────
  let totalTokens = 0

  if (needsCompression(messages, 0)) {
    log.info(`컨텍스트 압축 중... (messages: ${messages.length})`)
    try {
      const compressed = await compressContext(messages, priorDbMessages, provider, model)
      // Replace in-memory messages with compressed version
      messages.length = 0
      for (const m of compressed.messages) messages.push(m)

      // Persist summary to memory_items
      const summaryId = crypto.randomUUID()
      insertMemoryItem({
        content: compressed.summary,
        sessionId,
        type: "session_summary",
        importance: "medium",
      })

      // Mark old DB messages as compressed
      markMessagesCompressed(compressed.compressedIds, summaryId)

      log.info(`압축 완료 — ${compressed.compressedIds.length}개 메시지 → 요약 1개 + tail ${messages.length - 1}개`)
    } catch (err) {
      log.warn(`컨텍스트 압축 실패 (무시): ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  let textBuffer = ""

  const ctx: ToolContext = {
    sessionId,
    runId,
    workDir,
    userMessage: params.userMessage,
    source: params.source ?? "cli",
    allowWebAccess,
    signal,
    onProgress: (msg) => {
      if (msg.trim()) log.debug(`[tool progress] ${msg.trim()}`)
    },
  }

  // Tool-call loop
  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    if (signal.aborted) {
      yield { type: "error", message: "Aborted by user" }
      return
    }

    const pendingToolUses: Array<{ id: string; name: string; input: unknown }> = []

    try {
      for await (const chunk of provider.chat({
        model,
        messages,
        system: systemPrompt,
        tools: toolDefs,
        signal,
      })) {
        if (signal.aborted) break

        if (chunk.type === "text_delta") {
          textBuffer += chunk.delta
          yield { type: "text", delta: chunk.delta }
          eventBus.emit("agent.stream", { sessionId, runId, delta: chunk.delta })
        } else if (chunk.type === "tool_use") {
          pendingToolUses.push({ id: chunk.id, name: chunk.name, input: chunk.input })
        } else if (chunk.type === "message_stop") {
          totalTokens += chunk.usage.input_tokens + chunk.usage.output_tokens
        }
      }
    } catch (err) {
      if (signal.aborted) {
        yield { type: "error", message: "Aborted" }
        return
      }
      const msg = err instanceof Error ? err.message : String(err)
      log.error(`LLM error: ${msg}`)
      yield {
        type: "llm_recovery",
        summary: "LLM 응답 생성 중 오류가 발생해 다른 방법을 다시 시도합니다.",
        reason: describeLlmErrorReason(msg),
        message: msg,
      }
      return
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
        })
      }
      break
    }

    // Build assistant message with tool_use blocks
    const assistantContent = [
      ...(textBuffer ? [{ type: "text" as const, text: textBuffer }] : []),
      ...pendingToolUses.map((tu) => ({
        type: "tool_use" as const,
        id: tu.id,
        name: tu.name,
        input: tu.input,
      })),
    ]
    messages.push({ role: "assistant", content: assistantContent })
    insertMessage({
      id: crypto.randomUUID(),
      session_id: sessionId,
      root_run_id: runId,
      role: "assistant",
      content: textBuffer,
      tool_calls: JSON.stringify(assistantContent),
      tool_call_id: null,
      created_at: Date.now(),
    })
    textBuffer = ""

    // Execute tools
    const toolResultContents: Array<{
      type: "tool_result"
      tool_use_id: string
      content: string
      is_error?: boolean
    }> = []
    const executionRecoveryFailures: ExecutionRecoveryFailure[] = []

    for (const tu of pendingToolUses) {
      yield { type: "tool_start", toolName: tu.name, params: tu.input }
      log.info(`Executing tool: ${tu.name}`)

      const result = await toolDispatcher.dispatch(
        tu.name,
        tu.input as Record<string, unknown>,
        ctx,
      )

      yield {
        type: "tool_end",
        toolName: tu.name,
        success: result.success,
        output: result.output,
        ...(result.details !== undefined ? { details: result.details } : {}),
      }

      if (shouldSignalExecutionRecovery(tu.name, result)) {
        executionRecoveryFailures.push({
          toolName: tu.name,
          output: result.output,
          ...(result.error ? { error: result.error } : {}),
        })
      }

      toolResultContents.push({
        type: "tool_result",
        tool_use_id: tu.id,
        content: buildToolResultContent(tu.name, result),
        is_error: !result.success,
      })
    }

    messages.push({ role: "user", content: toolResultContents })
    insertMessage({
      id: crypto.randomUUID(),
      session_id: sessionId,
      root_run_id: runId,
      role: "user",
      content: "",
      tool_calls: JSON.stringify(toolResultContents),
      tool_call_id: null,
      created_at: Date.now(),
    })

    if (executionRecoveryFailures.length > 0) {
      yield {
        type: "execution_recovery",
        toolNames: [...new Set(executionRecoveryFailures.map((failure) => failure.toolName))],
        summary: buildExecutionRecoverySummary(executionRecoveryFailures),
        reason: buildExecutionRecoveryReason(executionRecoveryFailures),
      }
    }

    // Guard against runaway context
    if (totalTokens > MAX_CONTEXT_TOKENS) {
      log.warn("Context token limit approached — stopping tool loop")
      break
    }
  }

  const durationMs = Date.now() - now
  eventBus.emit("agent.end", { sessionId, runId, durationMs })
  log.info(`Agent run ${runId} done in ${durationMs}ms (tokens≈${totalTokens})`)

  yield { type: "done", totalTokens }
}

function shouldAllowWebAccess(userMessage: string): boolean {
  const normalized = userMessage.trim()
  if (!normalized) return false
  return WEB_POLICY_PATTERN.some((pattern) => pattern.test(normalized))
}

function shouldSignalExecutionRecovery(toolName: string, result: ToolResult): boolean {
  return !result.success && EXECUTION_RECOVERY_TOOL_NAMES.has(toolName)
}

function buildExecutionRecoverySummary(failures: ExecutionRecoveryFailure[]): string {
  const toolNames = [...new Set(failures.map((failure) => failure.toolName))]
  if (toolNames.length === 0) {
    return "실행 실패 원인을 분석하고 다른 방법을 다시 시도합니다."
  }
  if (toolNames.length === 1) {
    return `${toolNames[0]} 실패 원인을 분석하고 다른 방법을 다시 시도합니다.`
  }
  return `${toolNames.join(", ")} 실패 원인을 분석하고 대안을 다시 시도합니다.`
}

function buildExecutionRecoveryReason(failures: ExecutionRecoveryFailure[]): string {
  const latest = failures[failures.length - 1]
  const latestOutput = latest?.output ?? ""
  if (/(not found|command not found|enoent|is not recognized)/i.test(latestOutput)) {
    return "실행 대상 명령이나 프로그램을 찾지 못했습니다."
  }
  if (/(permission denied|operation not permitted|eacces|not authorized|권한)/i.test(latestOutput)) {
    return "권한 또는 접근 제한으로 작업 실행이 실패했습니다."
  }
  if (/(no such file|cannot find|not a directory|경로|파일을 찾을 수 없음)/i.test(latestOutput)) {
    return "대상 경로나 파일 이름이 맞지 않아 작업이 실패했습니다."
  }
  if (/(timeout|timed out|시간 초과)/i.test(latestOutput)) {
    return "시간 초과로 작업 실행이 실패했습니다."
  }
  return latest?.error?.trim() || "작업 실행이 실패해 다른 방법 검토가 필요합니다."
}

function describeLlmErrorReason(message: string): string {
  const normalized = message.toLowerCase()
  if (/(timeout|timed out|time-out|시간 초과)/i.test(message)) {
    return "모델 응답 생성 중 시간 초과가 발생했습니다."
  }
  if (/(rate limit|too many requests|429)/i.test(message)) {
    return "모델 호출 빈도 제한 때문에 응답 생성이 중단되었습니다."
  }
  if (/(cloudflare|challenge|authentication|unauthorized|forbidden|api key|credential|401|403)/i.test(message)) {
    return "인증 또는 접근 차단 문제 때문에 모델 호출이 실패했습니다."
  }
  if (/(context|token|maximum context|too long|length)/i.test(message)) {
    return "입력 길이 또는 컨텍스트 크기 때문에 모델 호출이 실패했습니다."
  }
  if (/(invalid|unsupported|schema|parameter|tool)/i.test(message)) {
    return "모델 또는 도구 호출 파라미터가 현재 실행 대상과 맞지 않아 실패했습니다."
  }
  if (/(network|socket|econn|connection|dns|getaddrinfo|reset|refused)/i.test(normalized)) {
    return "네트워크 또는 연결 문제 때문에 모델 호출이 끊겼습니다."
  }
  return "모델 호출이 실패해서 다른 방법 또는 다른 진행 경로 검토가 필요합니다."
}

function buildToolResultContent(toolName: string, result: ToolResult): string {
  const sections: string[] = []
  const output = result.output.trim()
  sections.push(output || "(no output)")

  if (!result.success) {
    sections.push(
      [
        "[tool_failure]",
        `tool: ${toolName}`,
        `error: ${(result.error ?? "unknown").trim() || "unknown"}`,
      ].join("\n"),
    )
  }

  const details = stringifyToolDetails(result.details)
  if (details) {
    sections.push(`[details]\n${details}`)
  }

  return sections.join("\n\n")
}

function stringifyToolDetails(details: unknown): string | null {
  if (details == null) return null
  try {
    const text = JSON.stringify(details, null, 2)
    if (!text || text === "{}") return null
    return text.length > 4000 ? `${text.slice(0, 3999)}…` : text
  } catch {
    return null
  }
}
