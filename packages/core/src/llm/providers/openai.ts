import OpenAI from "openai"
import type { LLMChunk, LLMProvider, ChatParams, AuthProfile, Message, ToolDefinition } from "../types.js"
import { nextApiKey, markKeyFailure } from "../types.js"
import { createLogger } from "../../logger/index.js"

const log = createLogger("llm:openai")

const CONTEXT_LIMITS: Record<string, number> = {
  "gpt-4o": 128_000,
  "gpt-4o-mini": 128_000,
  "gpt-4-turbo": 128_000,
  "gpt-4": 8_192,
  "gpt-3.5-turbo": 16_385,
  "o1": 200_000,
  "o1-mini": 128_000,
  "o3-mini": 200_000,
}

// ─── Message format conversion ───────────────────────────────────────────────

function toOpenAIMessages(messages: Message[]): OpenAI.ChatCompletionMessageParam[] {
  const result: OpenAI.ChatCompletionMessageParam[] = []

  for (const msg of messages) {
    if (typeof msg.content === "string") {
      result.push({ role: msg.role, content: msg.content })
      continue
    }

    // Array content — split out tool_result into separate "tool" role messages
    const toolResults: OpenAI.ChatCompletionToolMessageParam[] = []
    const textParts: string[] = []
    const toolCalls: OpenAI.ChatCompletionMessageToolCall[] = []

    for (const block of msg.content) {
      if (block.type === "text") {
        textParts.push(block.text)
      } else if (block.type === "tool_use") {
        toolCalls.push({
          id: block.id,
          type: "function",
          function: {
            name: block.name,
            arguments: JSON.stringify(block.input),
          },
        })
      } else if (block.type === "tool_result") {
        toolResults.push({
          role: "tool",
          tool_call_id: block.tool_use_id,
          content: block.content,
        })
      }
    }

    if (msg.role === "assistant") {
      const assistantMsg: OpenAI.ChatCompletionAssistantMessageParam = {
        role: "assistant",
        ...(textParts.length > 0 ? { content: textParts.join("\n") } : { content: null }),
        ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
      }
      result.push(assistantMsg)
    } else {
      // user role — push text first, then tool results
      if (textParts.length > 0) {
        result.push({ role: "user", content: textParts.join("\n") })
      }
      for (const tr of toolResults) {
        result.push(tr)
      }
    }
  }

  return result
}

function toOpenAITools(tools: ToolDefinition[]): OpenAI.ChatCompletionTool[] {
  return tools.map((t) => ({
    type: "function" as const,
    function: {
      name: t.name,
      description: t.description,
      parameters: t.input_schema as Record<string, unknown>,
    },
  }))
}

// ─── Provider ────────────────────────────────────────────────────────────────

export class OpenAIProvider implements LLMProvider {
  readonly id = "openai"
  readonly supportedModels = Object.keys(CONTEXT_LIMITS)

  constructor(
    private profile: AuthProfile,
    private baseUrl?: string | undefined,
  ) {}

  maxContextTokens(model: string): number {
    return CONTEXT_LIMITS[model] ?? 128_000
  }

  async *chat(params: ChatParams): AsyncGenerator<LLMChunk> {
    const apiKey = nextApiKey(this.profile)
    if (!apiKey) throw new Error("No available OpenAI API keys (all on cooldown)")

    const client = new OpenAI({
      apiKey,
      ...(this.baseUrl != null ? { baseURL: this.baseUrl } : {}),
    })

    log.debug(`chat() model=${params.model} messages=${params.messages.length}`)

    const oaiMessages = toOpenAIMessages(params.messages)
    if (params.system) {
      oaiMessages.unshift({ role: "system", content: params.system })
    }

    const tools = params.tools && params.tools.length > 0
      ? toOpenAITools(params.tools)
      : undefined

    try {
      const stream = await client.chat.completions.create({
        model: params.model,
        messages: oaiMessages,
        stream: true,
        max_tokens: params.maxTokens ?? 8192,
        ...(tools ? { tools, tool_choice: "auto" } : {}),
      }, { signal: params.signal })

      // Accumulate streamed tool call chunks
      const toolCallBuffers = new Map<number, { id: string; name: string; args: string }>()
      let inputTokens = 0
      let outputTokens = 0

      for await (const chunk of stream) {
        const choice = chunk.choices[0]
        if (!choice) continue

        const delta = choice.delta

        // Text content
        if (delta.content) {
          yield { type: "text_delta", delta: delta.content }
        }

        // Tool call chunks
        if (delta.tool_calls) {
          for (const tc of delta.tool_calls) {
            const idx = tc.index
            if (!toolCallBuffers.has(idx)) {
              toolCallBuffers.set(idx, { id: tc.id ?? "", name: tc.function?.name ?? "", args: "" })
            }
            const buf = toolCallBuffers.get(idx)!
            if (tc.id) buf.id = tc.id
            if (tc.function?.name) buf.name = tc.function.name
            if (tc.function?.arguments) buf.args += tc.function.arguments
          }
        }

        // Usage (may appear in last chunk)
        if (chunk.usage) {
          inputTokens = chunk.usage.prompt_tokens ?? 0
          outputTokens = chunk.usage.completion_tokens ?? 0
        }

        if (choice.finish_reason === "tool_calls" || choice.finish_reason === "stop") {
          // Emit completed tool calls
          for (const [, buf] of toolCallBuffers) {
            let parsedInput: unknown = {}
            try { parsedInput = JSON.parse(buf.args) } catch { /* leave as {} */ }
            yield { type: "tool_use", id: buf.id, name: buf.name, input: parsedInput }
          }
          toolCallBuffers.clear()

          yield { type: "message_stop", usage: { input_tokens: inputTokens, output_tokens: outputTokens } }
        }
      }
    } catch (err) {
      if (err instanceof OpenAI.AuthenticationError) {
        log.warn("API key authentication failed, marking for cooldown")
        markKeyFailure(this.profile, apiKey)
      }
      throw err
    }
  }
}
