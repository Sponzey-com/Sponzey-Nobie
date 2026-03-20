import { getConfig } from "../config/index.js"
import { AnthropicProvider } from "./providers/anthropic.js"
import { GeminiProvider } from "./providers/gemini.js"
import { OpenAIProvider } from "./providers/openai.js"
import type { AuthProfile, LLMProvider } from "./types.js"

const profiles = new Map<string, AuthProfile>()
const providers = new Map<string, LLMProvider>()

function buildProfile(apiKeys: string[]): AuthProfile {
  return { apiKeys, currentKeyIndex: 0, cooldowns: new Map() }
}

export function getProvider(providerId?: string): LLMProvider {
  const config = getConfig()
  const id = providerId ?? config.llm.defaultProvider

  if (providers.has(id)) return providers.get(id)!

  const cfg = config.llm.providers

  if (id === "anthropic") {
    const keys = (cfg.anthropic?.apiKeys ?? []).filter(Boolean)
    if (keys.length === 0 && process.env["ANTHROPIC_API_KEY"]) {
      keys.push(process.env["ANTHROPIC_API_KEY"])
    }
    const profile = buildProfile(keys)
    profiles.set(id, profile)
    const p = new AnthropicProvider(profile)
    providers.set(id, p)
    return p
  }

  if (id === "openai") {
    const keys = (cfg.openai?.apiKeys ?? []).filter(Boolean)
    if (keys.length === 0 && process.env["OPENAI_API_KEY"]) {
      keys.push(process.env["OPENAI_API_KEY"])
    }
    const profile = buildProfile(keys)
    profiles.set(id, profile)
    const p = new OpenAIProvider(profile, cfg.openai?.baseUrl)
    providers.set(id, p)
    return p
  }

  if (id === "gemini") {
    const keys = (cfg.gemini?.apiKeys ?? []).filter(Boolean)
    if (keys.length === 0 && process.env["GEMINI_API_KEY"]) {
      keys.push(process.env["GEMINI_API_KEY"])
    }
    const profile = buildProfile(keys)
    profiles.set(id, profile)
    const p = new GeminiProvider(profile, cfg.gemini?.baseUrl)
    providers.set(id, p)
    return p
  }

  throw new Error(`Unsupported LLM provider: "${id}"`)
}

const MODEL_PROVIDER_PREFIXES: Array<[RegExp, string]> = [
  [/^gpt-/i, "openai"],
  [/^o\d/i, "openai"],    // o1, o3-mini, etc.
  [/^claude-/i, "anthropic"],
  [/^gemini-/i, "gemini"],
]

const DEFAULT_MODELS: Record<string, string> = {
  anthropic: "claude-3-5-haiku-20241022",
  openai: "gpt-4o-mini",
  gemini: "gemini-2.5-flash",
}

const LLAMA_MODEL_PATTERN = /\bllama(?:[.\-:\w]*)?\b/i
const OLLAMA_BASEURL_PATTERN = /(^|\/\/)(?:[^/]*ollama|127\.0\.0\.1:11434|localhost:11434)/i

/**
 * 사용 가능한 API 키를 기준으로 공급자를 자동 감지한다.
 * 우선순위: config 명시 → ANTHROPIC_API_KEY → OPENAI_API_KEY
 */
export function detectAvailableProvider(): string {
  const config = getConfig()

  // config에 명시된 기본 공급자가 키를 갖고 있으면 그대로 사용
  const configured = config.llm.defaultProvider
  const cfg = config.llm.providers
  if (configured === "anthropic") {
    const hasKey = (cfg.anthropic?.apiKeys ?? []).filter(Boolean).length > 0 || !!process.env["ANTHROPIC_API_KEY"]
    if (hasKey) return "anthropic"
  }
  if (configured === "openai") {
    const hasKey = (cfg.openai?.apiKeys ?? []).filter(Boolean).length > 0 || !!process.env["OPENAI_API_KEY"]
    if (hasKey) return "openai"
  }
  if (configured === "gemini") {
    const hasKey = (cfg.gemini?.apiKeys ?? []).filter(Boolean).length > 0 || !!process.env["GEMINI_API_KEY"]
    if (hasKey) return "gemini"
  }

  // config 공급자에 키가 없으면 환경변수 순서로 폴백
  if (process.env["ANTHROPIC_API_KEY"]) return "anthropic"
  if (process.env["OPENAI_API_KEY"]) return "openai"
  if (process.env["GEMINI_API_KEY"]) return "gemini"

  // 키가 하나도 없어도 config 기본값 반환 (에러는 실제 호출 시 발생)
  return configured
}

export function getDefaultModel(): string {
  const config = getConfig()
  const availableProvider = detectAvailableProvider()

  if (config.llm.defaultModel) {
    // config 모델이 실제 사용 가능한 공급자의 것인지 확인
    const modelProvider = MODEL_PROVIDER_PREFIXES.find(([p]) => p.test(config.llm.defaultModel))?.[1]
    // 모델 공급자가 감지된 공급자와 일치하거나 알 수 없는 접두사면 그대로 사용
    if (!modelProvider || modelProvider === availableProvider) return config.llm.defaultModel
    // 불일치 → 가용 공급자의 기본 모델로 폴백
  }

  return DEFAULT_MODELS[availableProvider] ?? "claude-3-5-haiku-20241022"
}

/** Infer the provider ID from a model name, falling back to the auto-detected provider. */
export function inferProviderId(model: string): string {
  for (const [pattern, id] of MODEL_PROVIDER_PREFIXES) {
    if (pattern.test(model)) return id
  }
  return detectAvailableProvider()
}

export function shouldForceReasoningMode(providerId: string, model: string): boolean {
  const config = getConfig()
  const openaiBaseUrl = config.llm.providers.openai?.baseUrl?.trim() ?? ""
  const ollamaBaseUrl = config.llm.providers.ollama?.baseUrl?.trim() ?? ""

  if (providerId === "ollama") return true
  if (LLAMA_MODEL_PATTERN.test(model)) return true
  if (OLLAMA_BASEURL_PATTERN.test(openaiBaseUrl)) return true
  if (OLLAMA_BASEURL_PATTERN.test(ollamaBaseUrl)) return true

  return false
}

export type { LLMProvider, LLMChunk, Message, ToolDefinition, ChatParams } from "./types.js"
