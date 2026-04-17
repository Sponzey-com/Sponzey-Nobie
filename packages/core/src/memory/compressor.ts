import type { Message, AIProvider } from "../ai/types.js"
import type { DbMessage } from "../db/index.js"
import { chatWithContextPreflight } from "../runs/context-preflight.js"

export const COMPRESS_THRESHOLD = 120_000   // tokens
export const COMPRESS_MSG_COUNT = 40        // message count
const TAIL_SIZE = 10                        // keep last N messages uncompressed

const SUMMARIZE_PROMPT = `다음 대화 내용을 한국어로 간결하게 요약해 주세요.
중요한 결정, 실행된 명령, 파일 변경 내역을 반드시 포함하세요.
200자 이내로 작성하세요.

[대화 내용]`

export function needsCompression(messages: Message[], totalTokens: number): boolean {
  return totalTokens > COMPRESS_THRESHOLD || messages.length > COMPRESS_MSG_COUNT
}

/**
 * Compress the in-memory message list by summarizing old messages.
 * Returns the new (shorter) message list and the summary text.
 * The caller is responsible for marking the original DB rows as compressed.
 */
export async function compressContext(
  messages: Message[],
  dbMessages: DbMessage[],
  provider: AIProvider,
  model: string,
): Promise<{ messages: Message[]; summary: string; compressedIds: string[] }> {
  const tail = messages.slice(-TAIL_SIZE)
  const head = messages.slice(0, -TAIL_SIZE)

  // Build a text representation of the head for summarization
  const conversationText = head.map((m) => {
    const role = m.role === "user" ? "사용자" : "어시스턴트"
    const content =
      typeof m.content === "string"
        ? m.content
        : "[도구 호출/결과]"
    return `${role}: ${content.slice(0, 500)}`
  }).join("\n\n")

  // Call the configured AI backend to summarize
  let summary = ""
  for await (const chunk of chatWithContextPreflight({
    provider,
    model,
    messages: [{ role: "user", content: `${SUMMARIZE_PROMPT}\n${conversationText}` }],
    maxTokens: 500,
    metadata: { operation: "session_compaction_summary" },
  })) {
    if (chunk.type === "text_delta") summary += chunk.delta
  }
  summary = summary.trim()

  // Replace head with a single summary message
  const summaryMessage: Message = {
    role: "user",
    content: `[이전 대화 요약]\n${summary}`,
  }

  // IDs of DB messages that are now compressed (the head)
  const compressedCount = head.length
  const compressedIds = dbMessages
    .slice(0, compressedCount)
    .map((m) => m.id)

  return {
    messages: [summaryMessage, ...tail],
    summary,
    compressedIds,
  }
}
