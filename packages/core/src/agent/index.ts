import { homedir } from "node:os"
import { eventBus } from "../events/index.js"
import { getProvider, getDefaultModel, inferProviderId } from "../llm/index.js"
import type { Message, ToolDefinition, LLMChunk } from "../llm/types.js"
import { toolDispatcher } from "../tools/dispatcher.js"
import type { ToolContext } from "../tools/types.js"
import { createLogger } from "../logger/index.js"
import { getDb, insertSession, getSession, insertMessage, getMessages } from "../db/index.js"

const log = createLogger("agent")

const MAX_TOOL_ROUNDS = 20 // prevent infinite loops
const MAX_CONTEXT_TOKENS = 150_000

export type AgentChunk =
  | { type: "text"; delta: string }
  | { type: "tool_start"; toolName: string; params: unknown }
  | { type: "tool_end"; toolName: string; success: boolean; output: string }
  | { type: "done"; totalTokens: number }
  | { type: "error"; message: string }

export interface RunAgentParams {
  userMessage: string
  sessionId?: string | undefined
  model?: string | undefined
  providerId?: string | undefined
  systemPrompt?: string | undefined
  workDir?: string | undefined
  signal?: AbortSignal | undefined
}

export async function* runAgent(params: RunAgentParams): AsyncGenerator<AgentChunk> {
  const runId = crypto.randomUUID()
  const sessionId = params.sessionId ?? crypto.randomUUID()
  const model = params.model ?? getDefaultModel()
  const workDir = params.workDir ?? homedir()
  const signal = params.signal ?? new AbortController().signal

  const now = Date.now()

  // Upsert session — INSERT OR IGNORE to avoid cascade-deleting existing messages
  const existing = getSession(sessionId)
  if (!existing) {
    insertSession({
      id: sessionId,
      source: "cli",
      source_id: null,
      created_at: now,
      updated_at: now,
      summary: null,
    })
  } else {
    // Only touch updated_at so messages are preserved
    getDb().prepare("UPDATE sessions SET updated_at = ? WHERE id = ?").run(now, sessionId)
  }

  eventBus.emit("agent.start", { sessionId, runId })
  log.info(`Agent run ${runId} started (session=${sessionId}, model=${model})`)

  // Load prior messages from DB
  const priorMessages = getMessages(sessionId)
  const messages: Message[] = priorMessages.map((m) => ({
    role: m.role as "user" | "assistant",
    content: m.tool_calls ? JSON.parse(m.tool_calls) : m.content,
  }))

  // Append the new user message
  const userMsg: Message = { role: "user", content: params.userMessage }
  messages.push(userMsg)
  insertMessage({
    id: crypto.randomUUID(),
    session_id: sessionId,
    role: "user",
    content: params.userMessage,
    tool_calls: null,
    tool_call_id: null,
    created_at: Date.now(),
  })

  // Build tool definitions for LLM
  const tools = toolDispatcher.getAll()
  const toolDefs: ToolDefinition[] = tools.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.parameters,
  }))

  const resolvedProviderId = params.providerId ?? inferProviderId(model)
  const provider = getProvider(resolvedProviderId)

  const systemPrompt =
    params.systemPrompt ??
    `You are SidekickSponzey, a helpful AI assistant running on the user's personal computer. ` +
    `You can read and write files, execute shell commands, and help with various tasks. ` +
    `Always be concise and accurate. Today is ${new Date().toLocaleDateString()}.`

  let totalTokens = 0
  let textBuffer = ""

  const ctx: ToolContext = {
    sessionId,
    runId,
    workDir,
    signal,
    onProgress: (msg) => {
      // Forward progress updates as partial text output
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
      yield { type: "error", message: `LLM error: ${msg}` }
      return
    }

    // If no tool calls → final response
    if (pendingToolUses.length === 0) {
      // Save assistant message to DB
      if (textBuffer) {
        insertMessage({
          id: crypto.randomUUID(),
          session_id: sessionId,
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
      role: "assistant",
      content: textBuffer,
      tool_calls: JSON.stringify(assistantContent),
      tool_call_id: null,
      created_at: Date.now(),
    })
    textBuffer = ""

    // Execute each tool and collect results
    const toolResultContents: Array<{
      type: "tool_result"
      tool_use_id: string
      content: string
      is_error?: boolean
    }> = []

    for (const tu of pendingToolUses) {
      yield { type: "tool_start", toolName: tu.name, params: tu.input }
      log.info(`Executing tool: ${tu.name}`)

      const result = await toolDispatcher.dispatch(
        tu.name,
        tu.input as Record<string, unknown>,
        ctx,
      )

      yield { type: "tool_end", toolName: tu.name, success: result.success, output: result.output }

      toolResultContents.push({
        type: "tool_result",
        tool_use_id: tu.id,
        content: result.output,
        is_error: !result.success,
      })
    }

    // Append tool_result message and continue loop
    messages.push({ role: "user", content: toolResultContents })

    // Guard against context size
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
