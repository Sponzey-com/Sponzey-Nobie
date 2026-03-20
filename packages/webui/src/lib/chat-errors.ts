import { pickUiText, type UiLanguage } from "../stores/uiLanguage"

export function mapChatErrorMessage(raw: string, language: UiLanguage = "ko"): string {
  const text = raw.trim()
  const lower = text.toLowerCase()

  if (
    lower.includes("no available openai api keys")
    || lower.includes("no available anthropic api keys")
    || lower.includes("api key authentication failed")
    || lower.includes("invalid api key")
    || lower.includes("authentication failed")
  ) {
    return pickUiText(language, "AI 인증에 실패했습니다. API 키 또는 인증 정보를 확인해 주세요.", "AI authentication failed. Check the API key or credentials.")
  }

  if (
    lower.includes("unsupported llm provider")
    || lower.includes("no model")
    || lower.includes("model is required")
    || lower.includes("no backend")
    || lower.includes("provider unavailable")
  ) {
    return pickUiText(language, "사용 가능한 AI가 연결되어 있지 않습니다. AI 백엔드에서 활성화된 모델과 공급자를 설정해 주세요.", "No usable AI is connected. Configure an enabled provider and model in AI Backends.")
  }

  if (
    lower.includes("fetch failed")
    || lower.includes("econnrefused")
    || lower.includes("enotfound")
    || lower.includes("timeout")
    || lower.includes("timed out")
    || lower.includes("socket hang up")
    || lower.includes("network")
  ) {
    return pickUiText(language, "AI 엔드포인트에 연결할 수 없습니다. 엔드포인트 주소와 서버 실행 상태를 확인해 주세요.", "Cannot connect to the AI endpoint. Check the endpoint URL and whether the server is running.")
  }

  if (
    lower.includes("401")
    || lower.includes("403")
    || lower.includes("unauthorized")
    || lower.includes("forbidden")
  ) {
    return pickUiText(language, "AI 인증 또는 권한 확인에 실패했습니다. API 키와 접근 권한을 확인해 주세요.", "AI authentication or permission check failed. Check the API key and access permissions.")
  }

  if (
    lower.includes("429")
    || lower.includes("rate limit")
    || lower.includes("too many requests")
  ) {
    return pickUiText(language, "AI 요청 한도에 도달했습니다. 잠시 후 다시 시도해 주세요.", "The AI rate limit was reached. Please try again later.")
  }

  if (
    lower.includes("model not found")
    || lower.includes("does not exist")
    || lower.includes("unknown model")
    || lower.includes("context length")
    || lower.includes("maximum context length")
  ) {
    return pickUiText(language, "선택한 모델 설정에 문제가 있습니다. 기본 모델과 사용 가능한 모델 목록을 확인해 주세요.", "There is a problem with the selected model. Check the default model and the available model list.")
  }

  if (lower.includes("llm error:")) {
    return pickUiText(language, `AI 실행 오류: ${text.replace(/^llm error:\s*/i, "")}`, `AI execution error: ${text.replace(/^llm error:\s*/i, "")}`)
  }

  if (lower.includes("500 internal server error")) {
    return pickUiText(language, "AI 실행 중 서버 오류가 발생했습니다. 연결된 AI 설정과 gateway 로그를 확인해 주세요.", "A server error occurred during AI execution. Check the configured AI backend and the gateway logs.")
  }

  return text
}

export function isAiRelatedError(raw: string): boolean {
  const text = raw.toLowerCase()
  return (
    text.includes("llm error")
    || text.includes("openai")
    || text.includes("anthropic")
    || text.includes("api key")
    || text.includes("model")
    || text.includes("fetch failed")
    || text.includes("unsupported llm provider")
    || text.includes("rate limit")
    || text.includes("unauthorized")
    || text.includes("forbidden")
    || text.includes("timeout")
    || text.includes("network")
  )
}
