import { detectAvailableProvider, getDefaultModel, getProvider, type AIProvider } from "../ai/index.js"
import type { Message } from "../ai/types.js"
import { createLogger } from "../logger/index.js"
import { loadMergedInstructions } from "../instructions/merge.js"
import { buildUserProfilePromptContext } from "./profile-context.js"
import { chatWithContextPreflight } from "../runs/context-preflight.js"

const log = createLogger("agent:completion-review")

export type CompletionReviewStatus = "complete" | "followup" | "ask_user"

export interface CompletionReviewResult {
  status: CompletionReviewStatus
  summary: string
  reason: string
  followupPrompt?: string
  userMessage?: string
  remainingItems: string[]
}

export async function reviewTaskCompletion(params: {
  originalRequest: string
  latestAssistantMessage: string
  priorAssistantMessages?: string[]
  model?: string
  providerId?: string
  provider?: AIProvider
  workDir?: string
}): Promise<CompletionReviewResult | null> {
  const originalRequest = params.originalRequest.trim()
  const latestAssistantMessage = params.latestAssistantMessage.trim()
  if (!originalRequest || !latestAssistantMessage) return null

  const model = params.model ?? getDefaultModel()
  const providerId = params.providerId ?? detectAvailableProvider()
  const provider = params.provider ?? getProvider(providerId)
  const instructions = loadMergedInstructions(params.workDir ?? process.cwd())
  const profileContext = buildUserProfilePromptContext()

  const messages: Message[] = [
    {
      role: "user",
      content: [
        "Review whether the latest assistant result fully satisfies the original user request.",
        "Return valid JSON only.",
        "",
        `Original request:\n${originalRequest}`,
        params.priorAssistantMessages && params.priorAssistantMessages.length > 0
          ? `\nPreviously completed assistant results:\n${params.priorAssistantMessages.map((item, index) => `${index + 1}. ${item}`).join("\n")}`
          : "",
        `\nLatest assistant result:\n${latestAssistantMessage}`,
      ]
        .filter(Boolean)
        .join("\n"),
    },
  ]

  let raw = ""

  for await (const chunk of chatWithContextPreflight({
    provider,
    model,
    messages,
    system: [
      buildCompletionReviewSystemPrompt(),
      instructions.mergedText ? `\n[Instruction Chain]\n${instructions.mergedText}` : "",
      profileContext ? `\n${profileContext}` : "",
    ].join("\n"),
    tools: [],
    signal: new AbortController().signal,
    metadata: { operation: "completion_review" },
  })) {
    if (chunk.type === "text_delta") raw += chunk.delta
  }

  const parsed = parseCompletionReviewResult(raw)
  log.debug("completion review result", {
    providerId,
    model,
    parsed,
    rawPreview: raw.slice(0, 600),
  })
  return parsed
}

export function buildCompletionReviewSystemPrompt(): string {
  return [
    "You are Nobie's completion reviewer for Sponzey Nobie.",
    "",
    "Your job is to check whether the latest assistant result fully satisfies the original request.",
    "Always output valid JSON only.",
    "Do not output markdown or explanatory prose.",
    "",
    "Return JSON with this shape:",
    "{",
    '  "status": "complete | followup | ask_user",',
    '  "summary": "short Korean summary",',
    '  "reason": "why you chose this status",',
    '  "followup_prompt": "required only when status = followup",',
    '  "user_message": "required only when status = ask_user",',
    '  "remaining_items": ["list of remaining items if any"]',
    "}",
    "",
    "Rules:",
    "- Choose complete when the original request is already satisfied.",
    "- Choose followup when work is still missing but the system can continue autonomously without user input.",
    "- Choose ask_user when required information is missing, the request is ambiguous, or the assistant explicitly needs user confirmation.",
    "- If the original request asked for a current/latest externally retrievable value and the latest result only says the value was not extracted, cannot be confirmed, or asks whether to continue checking, choose followup instead of complete or ask_user.",
    "- For that followup, instruct the next pass to use a different concrete source path such as web_fetch on an already discovered result URL or a known direct source URL. Do not repeat only the same web_search query.",
    "- If you choose followup, provide a focused followup_prompt that tells the next agent pass exactly what remains to be done.",
    "- The followup_prompt must avoid repeating already completed work.",
    "- Be conservative: do not request followup unless something concrete is still missing.",
    "- Do not ask for web access unless the original request clearly requires it.",
    "- Keep summary, reason, user_message, and followup_prompt in the same language as the original user request unless the user explicitly asked for translation.",
  ].join("\n")
}

export function parseCompletionReviewResult(raw: string): CompletionReviewResult | null {
  const trimmed = raw.trim()
  if (!trimmed) return null

  const jsonLike = extractJsonObject(trimmed)
  if (!jsonLike) return null

  try {
    const parsed = JSON.parse(jsonLike) as Partial<Record<string, unknown>>
    const status = normalizeStatus(parsed.status)
    if (!status) return null

    return {
      status,
      summary: typeof parsed.summary === "string" ? parsed.summary.trim() : "",
      reason: typeof parsed.reason === "string" ? parsed.reason.trim() : "",
      ...(typeof parsed.followup_prompt === "string" && parsed.followup_prompt.trim()
        ? { followupPrompt: parsed.followup_prompt.trim() }
        : {}),
      ...(typeof parsed.user_message === "string" && parsed.user_message.trim()
        ? { userMessage: parsed.user_message.trim() }
        : {}),
      remainingItems: Array.isArray(parsed.remaining_items)
        ? parsed.remaining_items.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
        : [],
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

function normalizeStatus(value: unknown): CompletionReviewStatus | null {
  return value === "complete" || value === "followup" || value === "ask_user" ? value : null
}
