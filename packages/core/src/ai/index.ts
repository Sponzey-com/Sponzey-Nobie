import { existsSync } from "node:fs"
import { getConfig } from "../config/index.js"
import { resolveOpenAICodexAuthFilePath } from "../auth/openai-codex-oauth.js"
import { AnthropicProvider } from "./providers/anthropic.js"
import { GeminiProvider } from "./providers/gemini.js"
import { OpenAIProvider } from "./providers/openai.js"
import type { AIConnectionConfig } from "../config/types.js"
import type { AuthProfile, AIProvider } from "./types.js"

export type ProviderCredentialKind = "api_key" | "chatgpt_oauth" | "local_endpoint" | "custom_endpoint" | "none"

export interface ProviderResolutionSnapshot {
  source: "config.ai.connection"
  providerId: string
  credentialKind: ProviderCredentialKind
  authMode: "api_key" | "chatgpt_oauth"
  model: string
  endpoint: string
  configured: boolean
  enabled: boolean
  healthy: boolean
  fallbackReason: string | null
  diagnosticId: string
}

const profiles = new Map<string, AuthProfile>()
const providers = new Map<string, AIProvider>()
const providerFingerprints = new Map<string, string>()

function buildProfile(apiKeys: string[]): AuthProfile {
  return { apiKeys, currentKeyIndex: 0, cooldowns: new Map() }
}

function buildOpenAICompatibleProfile(
  providerId: "openai" | "ollama" | "llama" | "custom",
  apiKey: string | undefined,
): AuthProfile {
  if (apiKey) return buildProfile([apiKey])
  if (providerId === "ollama") return buildProfile(["nobie-local"])
  if (providerId === "llama") return buildProfile(["nobie-llama"])
  if (providerId === "custom") return buildProfile(["nobie-custom"])
  return buildProfile([])
}

function normalizeOpenAICompatibleEndpoint(
  providerId: "openai" | "ollama" | "llama" | "custom",
  endpoint: string | undefined,
): string | undefined {
  const normalized = endpoint?.trim()
  if (!normalized) return undefined
  if (providerId !== "ollama") return normalized
  return /\/v1\/?$/i.test(normalized) ? normalized.replace(/\/+$/, "") : `${normalized.replace(/\/+$/, "")}/v1`
}

function buildProviderFingerprint(connection: AIConnectionConfig): string {
  const providerId = connection.provider.trim()
  const authMode = connection.auth?.mode ?? "api_key"
  const endpoint = providerId === "openai" || providerId === "ollama" || providerId === "llama" || providerId === "custom"
    ? normalizeOpenAICompatibleEndpoint(providerId, connection.endpoint) ?? ""
    : connection.endpoint?.trim() ?? ""
  const model = connection.model.trim()
  const oauthAuthFilePath = connection.auth?.oauthAuthFilePath?.trim() ?? ""
  const clientId = connection.auth?.clientId?.trim() ?? ""
  const apiKeyFingerprint = connection.auth?.apiKey?.trim() ? "api-key:set" : "api-key:empty"
  return [providerId, authMode, endpoint, model, oauthAuthFilePath, clientId, apiKeyFingerprint].join("|")
}

export function resetAIProviderCache(): void {
  providers.clear()
  profiles.clear()
  providerFingerprints.clear()
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

function resolveCredentialKind(connection: AIConnectionConfig): ProviderCredentialKind {
  const providerId = connection.provider.trim()
  const authMode = connection.auth?.mode ?? "api_key"
  if (!providerId) return "none"
  if (providerId === "openai" && authMode === "chatgpt_oauth") return "chatgpt_oauth"
  if (connection.auth?.apiKey?.trim()) return "api_key"
  if (providerId === "ollama" || providerId === "llama") return "local_endpoint"
  if (providerId === "custom") return "custom_endpoint"
  return "none"
}

function resolveProviderConfigured(connection: AIConnectionConfig): { configured: boolean; reason: string | null } {
  const providerId = connection.provider.trim()
  if (!providerId) return { configured: false, reason: "provider_missing" }

  if (providerId === "openai") {
    const authMode = connection.auth?.mode ?? "api_key"
    if (authMode === "chatgpt_oauth") {
      return isOpenAIOAuthConfigured(connection)
        ? { configured: true, reason: null }
        : { configured: false, reason: "chatgpt_oauth_auth_file_missing" }
    }
    return connection.auth?.apiKey?.trim()
      ? { configured: true, reason: null }
      : { configured: false, reason: "openai_api_key_missing" }
  }

  if (providerId === "anthropic" || providerId === "gemini") {
    return connection.auth?.apiKey?.trim()
      ? { configured: true, reason: null }
      : { configured: false, reason: `${providerId}_api_key_missing` }
  }

  if (providerId === "ollama" || providerId === "llama" || providerId === "custom") {
    return connection.endpoint?.trim()
      ? { configured: true, reason: null }
      : { configured: false, reason: `${providerId}_endpoint_missing` }
  }

  return { configured: false, reason: "provider_unsupported" }
}

function hasConfiguredConnection(connection = getActiveAIConnection()): boolean {
  return resolveProviderConfigured(connection).configured
}

export function resolveProviderResolutionSnapshot(providerId?: string, config = getConfig()): ProviderResolutionSnapshot {
  const connection = getActiveAIConnection(config)
  const activeProviderId = connection.provider.trim()
  const requestedProviderId = providerId?.trim() ?? ""
  const model = connection.model.trim()
  const authMode = connection.auth?.mode ?? "api_key"
  const endpoint = activeProviderId === "openai" || activeProviderId === "ollama" || activeProviderId === "llama" || activeProviderId === "custom"
    ? normalizeOpenAICompatibleEndpoint(activeProviderId, connection.endpoint) ?? ""
    : connection.endpoint?.trim() ?? ""
  const configured = resolveProviderConfigured(connection)
  let fallbackReason = configured.reason

  if (requestedProviderId && requestedProviderId !== activeProviderId) {
    fallbackReason = `provider_mismatch:${requestedProviderId}->${activeProviderId || "none"}`
  } else if (configured.configured && !model) {
    fallbackReason = "model_missing"
  }

  return {
    source: "config.ai.connection",
    providerId: activeProviderId,
    credentialKind: resolveCredentialKind(connection),
    authMode,
    model,
    endpoint,
    configured: configured.configured,
    enabled: configured.configured,
    healthy: configured.configured && Boolean(model) && !(requestedProviderId && requestedProviderId !== activeProviderId),
    fallbackReason,
    diagnosticId: [activeProviderId || "none", authMode, resolveCredentialKind(connection), model || "model_missing"].join(":"),
  }
}

export function detectAvailableProvider(): string {
  const snapshot = resolveProviderResolutionSnapshot()
  return snapshot.configured ? snapshot.providerId : ""
}

export function getDefaultModel(): string {
  const snapshot = resolveProviderResolutionSnapshot()
  return snapshot.configured ? snapshot.model : ""
}

export function inferProviderId(_model: string): string {
  return detectAvailableProvider()
}

export function getProvider(providerId?: string): AIProvider {
  const connection = getActiveAIConnection()
  const snapshot = resolveProviderResolutionSnapshot(providerId)
  const activeProviderId = snapshot.configured ? snapshot.providerId : ""
  const requestedProviderId = providerId?.trim() ?? ""
  const currentFingerprint = buildProviderFingerprint(connection)

  if (!activeProviderId) {
    throw new Error(`No configured AI backend is available. Connect an AI in settings first. reason=${snapshot.fallbackReason ?? "unknown"}`)
  }

  if (requestedProviderId && requestedProviderId !== activeProviderId) {
    throw new Error(`Only the configured active AI backend can be used. Active backend: "${activeProviderId}".`)
  }

  if (providers.has(activeProviderId) && providerFingerprints.get(activeProviderId) === currentFingerprint) {
    return providers.get(activeProviderId)!
  }

  providers.delete(activeProviderId)
  profiles.delete(activeProviderId)
  providerFingerprints.set(activeProviderId, currentFingerprint)

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

  if (activeProviderId === "openai" || activeProviderId === "ollama" || activeProviderId === "llama" || activeProviderId === "custom") {
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

  if (providerId === "ollama" || providerId === "llama") return true
  if (LLAMA_MODEL_PATTERN.test(model)) return true
  if (OLLAMA_BASEURL_PATTERN.test(endpoint)) return true

  return false
}

export type { AIProvider, AIChunk, Message, ToolDefinition, ChatParams } from "./types.js"
