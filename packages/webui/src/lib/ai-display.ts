import type { AIProviderType, RoutingProfileId } from "../contracts/ai"

export type DisplayLanguage = "ko" | "en"

const PROVIDER_LABELS: Record<AIProviderType, { ko: string; en: string }> = {
  openai: { ko: "OpenAI", en: "OpenAI" },
  ollama: { ko: "Ollama", en: "Ollama" },
  llama: { ko: "Llama", en: "Llama" },
  claude: { ko: "Claude", en: "Claude" },
  gemini: { ko: "Gemini", en: "Gemini" },
  custom: { ko: "사용자 지정", en: "Custom" },
}

const ROUTING_LABELS: Record<RoutingProfileId, { ko: string; en: string }> = {
  default: { ko: "기본", en: "Default" },
  general_chat: { ko: "일반 대화", en: "General Chat" },
  planning: { ko: "계획/설계", en: "Planning / Design" },
  coding: { ko: "코딩", en: "Coding" },
  review: { ko: "리뷰", en: "Review" },
  research: { ko: "리서치", en: "Research" },
  private_local: { ko: "로컬 우선", en: "Local First" },
  summarization: { ko: "요약", en: "Summarization" },
  operations: { ko: "운영", en: "Operations" },
}

const BACKEND_LABELS: Record<string, { ko: string; en: string }> = {
  "provider:openai": { ko: "범용 원격 추론", en: "General Remote Reasoning" },
  "provider:gemini": { ko: "계획·리서치 추론", en: "Planning / Research Reasoning" },
  "provider:ollama": { ko: "로컬 모델 실행", en: "Local Model Runtime" },
  "provider:llama_cpp": { ko: "로컬 추론 서버", en: "Local Inference Server" },
  "worker:claude_code": { ko: "코드 작업 세션", en: "Code Work Session" },
  "worker:codex_cli": { ko: "코드 실행 세션", en: "Code Execution Session" },
}

export function getAIProviderDisplayLabel(providerType: AIProviderType, language: DisplayLanguage): string {
  const labels = PROVIDER_LABELS[providerType]
  return language === "en" ? labels.en : labels.ko
}

export function getRoutingProfileDisplayLabel(profileId: RoutingProfileId, fallbackLabel: string, language: DisplayLanguage): string {
  const labels = ROUTING_LABELS[profileId]
  if (!labels) return fallbackLabel
  return language === "en" ? labels.en : labels.ko
}

export function getBackendDisplayLabel(backendId: string | undefined, fallbackLabel: string | undefined, language: DisplayLanguage): string {
  if (backendId && BACKEND_LABELS[backendId]) {
    return language === "en" ? BACKEND_LABELS[backendId].en : BACKEND_LABELS[backendId].ko
  }
  return (fallbackLabel ?? backendId ?? "").trim()
}
