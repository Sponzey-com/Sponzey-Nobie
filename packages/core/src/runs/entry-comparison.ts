import { detectAvailableProvider, getDefaultModel, getProvider, type AIProvider } from "../ai/index.js"
import type { Message } from "../ai/types.js"
import type { RootRun } from "./types.js"

export type RequestContinuationDecisionKind = "new" | "reuse" | "clarify"

export interface RequestContinuationDecision {
  kind: RequestContinuationDecisionKind
  requestGroupId?: string
  reason: string
}

interface ParsedRequestContinuationDecision {
  decision: RequestContinuationDecisionKind
  request_group_id?: string
  reason?: string
}

export async function compareRequestContinuationWithAI(params: {
  message: string
  sessionId?: string
  candidates: RootRun[]
  model?: string
  providerId?: string
  provider?: AIProvider
}): Promise<RequestContinuationDecision> {
  const message = params.message.trim()
  if (!message || params.candidates.length === 0) {
    return { kind: "new", reason: "no candidates" }
  }

  const model = params.model?.trim() || getDefaultModel()
  const providerId = params.providerId?.trim() || detectAvailableProvider()
  if (!model || !providerId) {
    return { kind: "new", reason: "no configured provider" }
  }

  const provider = params.provider ?? getProvider(providerId)
  const allowedIds = new Set(params.candidates.map((candidate) => candidate.requestGroupId))
  const messages: Message[] = [
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
  ]

  let raw = ""
  for await (const chunk of provider.chat({
    model,
    messages,
    system: buildRequestContinuationSystemPrompt(),
    tools: [],
    maxTokens: 220,
    signal: new AbortController().signal,
  })) {
    if (chunk.type === "text_delta") raw += chunk.delta
  }

  const parsed = parseRequestContinuationDecision(raw)
  if (!parsed) {
    return { kind: "new", reason: "unparseable ai comparison result" }
  }

  if (parsed.decision === "reuse") {
    const requestGroupId = parsed.request_group_id?.trim()
    if (!requestGroupId || !allowedIds.has(requestGroupId)) {
      return { kind: "clarify", reason: parsed.reason?.trim() || "invalid candidate selection" }
    }
    return {
      kind: "reuse",
      requestGroupId,
      reason: parsed.reason?.trim() || "matched active task",
    }
  }

  if (parsed.decision === "clarify") {
    return {
      kind: "clarify",
      reason: parsed.reason?.trim() || "ambiguous continuation",
    }
  }

  return {
    kind: "new",
    reason: parsed.reason?.trim() || "new independent task",
  }
}

export function buildRequestContinuationSystemPrompt(): string {
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
  ].join("\n")
}

export function parseRequestContinuationDecision(raw: string): ParsedRequestContinuationDecision | null {
  const jsonLike = extractJsonObject(raw.trim())
  if (!jsonLike) return null
  try {
    const parsed = JSON.parse(jsonLike) as Partial<Record<string, unknown>>
    const decision = parsed.decision
    if (decision !== "new" && decision !== "reuse" && decision !== "clarify") return null
    return {
      decision,
      ...(typeof parsed.request_group_id === "string" ? { request_group_id: parsed.request_group_id } : {}),
      ...(typeof parsed.reason === "string" ? { reason: parsed.reason } : {}),
    }
  } catch {
    return null
  }
}

function extractJsonObject(text: string): string | null {
  const withoutFence = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "")
  const start = withoutFence.indexOf("{")
  const end = withoutFence.lastIndexOf("}")
  if (start === -1 || end === -1 || end <= start) return null
  return withoutFence.slice(start, end + 1)
}
