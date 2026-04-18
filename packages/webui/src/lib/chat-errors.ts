import type { UiLanguage } from "../stores/uiLanguage"
import { formatWebUiErrorMessage } from "./message-catalog"

export function mapChatErrorMessage(raw: string, language: UiLanguage = "ko", repeatCount = 0): string {
  return formatWebUiErrorMessage(raw, language, repeatCount).message
}

export function isAiRelatedError(raw: string): boolean {
  const text = raw.toLowerCase()
  return (
    text.includes("ai error")
    || text.includes("openai")
    || text.includes("anthropic")
    || text.includes("api key")
    || text.includes("model")
    || text.includes("fetch failed")
    || text.includes("unsupported ai backend")
    || text.includes("rate limit")
    || text.includes("unauthorized")
    || text.includes("forbidden")
    || text.includes("timeout")
    || text.includes("network")
  )
}
