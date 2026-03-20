import { randomUUID } from "node:crypto"
import type { AuthProfile, ChatParams, LLMChunk, LLMProvider, Message, ToolDefinition } from "../types.js"
import { createLogger } from "../../logger/index.js"
import { markKeyFailure, nextApiKey } from "../types.js"

const log = createLogger("llm:gemini")
const DEFAULT_BASE_URL = "https://generativelanguage.googleapis.com"

const CONTEXT_LIMITS: Record<string, number> = {
  "gemini-2.5-pro": 1_048_576,
  "gemini-2.5-flash": 1_048_576,
  "gemini-2.0-flash": 1_048_576,
  "gemini-1.5-pro": 2_000_000,
  "gemini-1.5-flash": 1_000_000,
}

type GeminiContent = {
  role: "user" | "model"
  parts: Array<Record<string, unknown>>
}

function toGeminiTools(tools: ToolDefinition[] | undefined): Array<Record<string, unknown>> | undefined {
  if (!tools || tools.length === 0) return undefined
  return [{
    functionDeclarations: tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      parameters: tool.input_schema,
    })),
  }]
}

function toGeminiContents(messages: Message[]): GeminiContent[] {
  const toolNames = new Map<string, string>()
  const contents: GeminiContent[] = []

  for (const message of messages) {
    if (typeof message.content === "string") {
      const content = message.content.trim()
      if (!content) continue
      contents.push({
        role: message.role === "assistant" ? "model" : "user",
        parts: [{ text: content }],
      })
      continue
    }

    const parts: Array<Record<string, unknown>> = []
    for (const block of message.content) {
      if (block.type === "text") {
        if (block.text.trim()) parts.push({ text: block.text })
        continue
      }

      if (block.type === "tool_use") {
        toolNames.set(block.id, block.name)
        parts.push({ functionCall: { name: block.name, args: block.input ?? {} } })
        continue
      }

      if (block.type === "tool_result") {
        parts.push({
          functionResponse: {
            name: toolNames.get(block.tool_use_id) ?? block.tool_use_id,
            response: {
              content: block.content,
              ...(block.is_error ? { is_error: true } : {}),
            },
          },
        })
      }
    }

    if (parts.length === 0) continue
    contents.push({
      role: message.role === "assistant" ? "model" : "user",
      parts,
    })
  }

  return contents
}

function getErrorMessage(payload: unknown, fallback: string): string {
  if (!payload || typeof payload !== "object") return fallback
  const root = payload as Record<string, unknown>
  const error = root.error
  if (!error || typeof error !== "object") return fallback
  const message = (error as Record<string, unknown>).message
  return typeof message === "string" && message.trim() ? message.trim() : fallback
}

export class GeminiProvider implements LLMProvider {
  readonly id = "gemini"
  readonly supportedModels = Object.keys(CONTEXT_LIMITS)

  constructor(
    private profile: AuthProfile,
    private baseUrl?: string | undefined,
  ) {}

  maxContextTokens(model: string): number {
    return CONTEXT_LIMITS[model] ?? 1_048_576
  }

  async *chat(params: ChatParams): AsyncGenerator<LLMChunk> {
    const apiKey = nextApiKey(this.profile)
    if (!apiKey) {
      throw new Error("No available Gemini API keys (all on cooldown)")
    }

    const baseUrl = (this.baseUrl?.trim() || DEFAULT_BASE_URL).replace(/\/+$/, "")
    const url = `${baseUrl}/v1beta/models/${encodeURIComponent(params.model)}:generateContent`
    const tools = toGeminiTools(params.tools)
    const body: Record<string, unknown> = {
      contents: toGeminiContents(params.messages),
      generationConfig: {
        ...(params.maxTokens !== undefined ? { maxOutputTokens: params.maxTokens } : {}),
      },
      ...(params.system?.trim() ? { system_instruction: { parts: [{ text: params.system }] } } : {}),
      ...(tools ? { tools, toolConfig: { functionCallingConfig: { mode: "AUTO" } } } : {}),
    }

    log.debug(`chat() model=${params.model} messages=${params.messages.length}`)

    try {
      const requestInit: RequestInit = {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-goog-api-key": apiKey,
        },
        body: JSON.stringify(body),
        ...(params.signal ? { signal: params.signal } : {}),
      }
      const response = await fetch(url, requestInit)

      const payload = await response.json().catch(() => null)
      if (!response.ok) {
        const message = getErrorMessage(payload, `Gemini API request failed (${response.status})`)
        if (response.status === 401 || response.status === 403) {
          log.warn("Gemini API key authentication failed, marking for cooldown")
          markKeyFailure(this.profile, apiKey)
        }
        throw new Error(message)
      }

      const candidates = payload && typeof payload === "object"
        ? ((payload as Record<string, unknown>).candidates as unknown[] | undefined)
        : undefined
      const candidate = Array.isArray(candidates) ? candidates[0] : undefined
      const content = candidate && typeof candidate === "object"
        ? (candidate as Record<string, unknown>).content
        : undefined
      const parts = content && typeof content === "object"
        ? ((content as Record<string, unknown>).parts as Array<Record<string, unknown>> | undefined) ?? []
        : []

      for (const part of parts) {
        const text = typeof part.text === "string" ? part.text : undefined
        if (text) {
          yield { type: "text_delta", delta: text }
        }

        const functionCall = part.functionCall
        if (functionCall && typeof functionCall === "object") {
          const call = functionCall as Record<string, unknown>
          const name = typeof call.name === "string" ? call.name : "unknown_tool"
          yield {
            type: "tool_use",
            id: `gemini-tool-${randomUUID()}`,
            name,
            input: call.args ?? {},
          }
        }
      }

      const usage = payload && typeof payload === "object"
        ? (payload as Record<string, unknown>).usageMetadata
        : undefined
      const usageObject = usage && typeof usage === "object" ? usage as Record<string, unknown> : {}
      yield {
        type: "message_stop",
        usage: {
          input_tokens: typeof usageObject.promptTokenCount === "number" ? usageObject.promptTokenCount : 0,
          output_tokens: typeof usageObject.candidatesTokenCount === "number" ? usageObject.candidatesTokenCount : 0,
        },
      }
    } catch (error) {
      if (error instanceof Error && /api key|permission|forbidden|unauthorized/i.test(error.message)) {
        markKeyFailure(this.profile, apiKey)
      }
      throw error
    }
  }
}
