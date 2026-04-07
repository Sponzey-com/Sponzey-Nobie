import { existsSync } from "node:fs"
import { getConfig } from "../config/index.js"
import { resolveOpenAICodexAuthFilePath } from "../auth/openai-codex-oauth.js"
import { AnthropicProvider } from "./providers/anthropic.js"
import { GeminiProvider } from "./providers/gemini.js"
import { OpenAIProvider } from "./providers/openai.js"
import type { AIConnectionConfig } from "../config/types.js"
import type { AuthProfile, AIProvider } from "./types.js"

const profiles = new Map<string, AuthProfile>()
const providers = new Map<string, AIProvider>()

function buildProfile(apiKeys: string[]): AuthProfile {
  return { apiKeys, currentKeyIndex: 0, cooldowns: new Map() }
}

function buildOpenAICompatibleProfile(
  providerId: "openai" | "ollama" | "custom",
  apiKey: string | undefined,
): AuthProfile {
  if (apiKey) return buildProfile([apiKey])
  if (providerId === "ollama") return buildProfile(["nobie-local"])
  if (providerId === "custom") return buildProfile(["nobie-custom"])
  return buildProfile([])
}

function normalizeOpenAICompatibleEndpoint(
  providerId: "openai" | "ollama" | "custom",
  endpoint: string | undefined,
): string | undefined {
  const normalized = endpoint?.trim()
  if (!normalized) return undefined
  if (providerId !== "ollama") return normalized
  return /\/v1\/?$/i.test(normalized) ? normalized.replace(/\/+$/, "") : `${normalized.replace(/\/+$/, "")}/v1`
}

export function getActiveAIConnection(config = getConfig()): AIConnectionConfig {
  return config.ai.connection
}

function isOpenAIOAuthConfigured(connection = getActiveAIConnection()): boolean {
  if (connection.provider !== "openai") return false
  if (connection.auth?.mode !== "chatgpt_oauth") return false
  return existsSync(resolveOpenAICodexAuthFilePath({
    authFilePath: connection.auth?.oauthAuthFilePath,
    clientId: connection.auth?.clientId,
  }))
}

function hasConfiguredConnection(connection = getActiveAIConnection()): boolean {
  const providerId = connection.provider.trim()
  if (!providerId) return false

  if (providerId === "openai") {
    const authMode = connection.auth?.mode ?? "api_key"
    if (authMode === "chatgpt_oauth") return isOpenAIOAuthConfigured(connection)
    return Boolean(connection.auth?.apiKey?.trim() || connection.endpoint?.trim())
  }

  if (providerId === "anthropic" || providerId === "gemini") {
    return Boolean(connection.auth?.apiKey?.trim() || connection.endpoint?.trim())
  }

  if (providerId === "ollama" || providerId === "custom") {
    return Boolean(connection.endpoint?.trim())
  }

  return false
}

export function detectAvailableProvider(): string {
  const connection = getActiveAIConnection()
  return hasConfiguredConnection(connection) ? connection.provider.trim() : ""
}

export function getDefaultModel(): string {
  const connection = getActiveAIConnection()
  if (!hasConfiguredConnection(connection)) return ""
  return connection.model.trim()
}

export function inferProviderId(_model: string): string {
  return detectAvailableProvider()
}

export function getProvider(providerId?: string): AIProvider {
  const connection = getActiveAIConnection()
  const activeProviderId = detectAvailableProvider()
  const requestedProviderId = providerId?.trim() ?? ""

  if (!activeProviderId) {
    throw new Error("No configured AI backend is available. Connect an AI in settings first.")
  }

  if (requestedProviderId && requestedProviderId !== activeProviderId) {
    throw new Error(`Only the configured active AI backend can be used. Active backend: "${activeProviderId}".`)
  }

  if (providers.has(activeProviderId)) return providers.get(activeProviderId)!

  if (activeProviderId === "anthropic") {
    const apiKey = connection.auth?.apiKey?.trim()
    if (!apiKey) {
      throw new Error("Anthropic AI is not configured. Connect it in settings before using it.")
    }
    const profile = buildProfile([apiKey])
    profiles.set(activeProviderId, profile)
    const provider = new AnthropicProvider(profile)
    providers.set(activeProviderId, provider)
    return provider
  }

  if (activeProviderId === "gemini") {
    const apiKey = connection.auth?.apiKey?.trim()
    if (!apiKey && !connection.endpoint?.trim()) {
      throw new Error("Gemini AI is not configured. Connect it in settings before using it.")
    }
    const profile = buildProfile(apiKey ? [apiKey] : [])
    profiles.set(activeProviderId, profile)
    const provider = new GeminiProvider(profile, connection.endpoint?.trim() || undefined)
    providers.set(activeProviderId, provider)
    return provider
  }

  if (activeProviderId === "openai" || activeProviderId === "ollama" || activeProviderId === "custom") {
    const authMode = connection.auth?.mode ?? "api_key"
    const apiKey = connection.auth?.apiKey?.trim()
    const profile = buildOpenAICompatibleProfile(activeProviderId, apiKey)
    const endpoint = normalizeOpenAICompatibleEndpoint(activeProviderId, connection.endpoint)
    profiles.set(activeProviderId, profile)
    const provider = new OpenAIProvider(
      profile,
      endpoint,
      activeProviderId === "openai" && authMode === "chatgpt_oauth"
        ? {
            authFilePath: connection.auth?.oauthAuthFilePath,
            clientId: connection.auth?.clientId,
          }
        : undefined,
    )
    providers.set(activeProviderId, provider)
    return provider
  }

  throw new Error(`Unsupported AI backend: "${activeProviderId}"`)
}

const LLAMA_MODEL_PATTERN = /\bllama(?:[.\-:\w]*)?\b/i
const OLLAMA_BASEURL_PATTERN = /(^|\/\/)(?:[^/]*ollama|127\.0\.0\.1:11434|localhost:11434)/i

export function shouldForceReasoningMode(providerId: string, model: string): boolean {
  const connection = getActiveAIConnection()
  const endpoint = connection.endpoint?.trim() ?? ""

  if (providerId === "ollama") return true
  if (LLAMA_MODEL_PATTERN.test(model)) return true
  if (OLLAMA_BASEURL_PATTERN.test(endpoint)) return true

  return false
}

export type { AIProvider, AIChunk, Message, ToolDefinition, ChatParams } from "./types.js"
