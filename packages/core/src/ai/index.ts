import { existsSync } from "node:fs"
import { getConfig } from "../config/index.js"
import {
  resolveOpenAICodexBaseUrl,
  resolveOpenAICodexAuthFilePath,
  type OpenAICodexOAuthConfig,
} from "../auth/openai-codex-oauth.js"
import { AnthropicProvider } from "./providers/anthropic.js"
import { GeminiProvider } from "./providers/gemini.js"
import { OpenAIProvider } from "./providers/openai.js"
import type { AIConnectionConfig } from "../config/types.js"
import type { AuthProfile, AIProvider } from "./types.js"

export type ProviderCredentialKind = "api_key" | "chatgpt_oauth" | "local_endpoint" | "custom_endpoint" | "none"
export type ProviderAdapterType =
  | "openai_chat"
  | "openai_codex_oauth"
  | "openai_compatible"
  | "anthropic"
  | "gemini"
  | "none"
export type ProviderBaseUrlClass =
  | "official_openai"
  | "chatgpt_codex"
  | "local"
  | "custom"
  | "provider_native"
  | "none"

export interface ProviderAuditTrace {
  source: "config.ai.connection"
  profileId?: string | undefined
  requestedProviderId: string
  providerId: string
  adapterType: ProviderAdapterType
  baseUrlClass: ProviderBaseUrlClass
  modelId: string
  authType: ProviderCredentialKind
  credentialSourceKind?: ProviderCredentialKind | undefined
  resolverPath?: string | undefined
  endpointMismatch?: boolean | undefined
  configured: boolean
  healthy: boolean
  fallbackReason: string | null
  diagnosticId: string
}

export interface ProviderResolutionSnapshot {
  source: "config.ai.connection"
  providerId: string
  credentialKind: ProviderCredentialKind
  adapterType: ProviderAdapterType
  authType: ProviderCredentialKind
  baseUrlClass: ProviderBaseUrlClass
  authMode: "api_key" | "chatgpt_oauth"
  model: string
  endpoint: string
  configured: boolean
  enabled: boolean
  healthy: boolean
  fallbackReason: string | null
  diagnosticId: string
  auditTrace: ProviderAuditTrace
}

export interface ResolvedAiConnection extends ProviderResolutionSnapshot {
  requestedProviderId: string
  connection: AIConnectionConfig
}

export interface ResolvedAiProvider {
  providerId: string
  model: string
  provider: AIProvider
  resolution: ResolvedAiConnection
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

export function normalizeOpenAICompatibleEndpoint(
  providerId: "openai" | "ollama" | "llama" | "custom",
  endpoint: string | undefined,
): string | undefined {
  const normalized = endpoint?.trim()
  if (!normalized) return undefined
  if (providerId !== "ollama") return normalized
  return /\/v1\/?$/i.test(normalized) ? normalized.replace(/\/+$/, "") : `${normalized.replace(/\/+$/, "")}/v1`
}

function isLocalEndpoint(endpoint: string | undefined): boolean {
  if (!endpoint?.trim()) return false
  try {
    const hostname = new URL(endpoint).hostname.toLowerCase()
    return hostname === "localhost"
      || hostname === "127.0.0.1"
      || hostname === "::1"
      || hostname.startsWith("192.168.")
      || /^10\./.test(hostname)
      || /^172\.(1[6-9]|2\d|3[01])\./.test(hostname)
  } catch {
    return false
  }
}

function isOfficialOpenAIEndpoint(endpoint: string | undefined): boolean {
  if (!endpoint?.trim()) return true
  try {
    const hostname = new URL(endpoint).hostname.toLowerCase()
    return hostname === "api.openai.com" || hostname.endsWith(".openai.com")
  } catch {
    return false
  }
}

function resolveAdapterType(connection: AIConnectionConfig): ProviderAdapterType {
  const providerId = connection.provider.trim()
  const authMode = connection.auth?.mode ?? "api_key"
  if (!providerId) return "none"
  if (providerId === "openai" && authMode === "chatgpt_oauth") return "openai_codex_oauth"
  if (providerId === "openai") return "openai_chat"
  if (providerId === "ollama" || providerId === "llama" || providerId === "custom") return "openai_compatible"
  if (providerId === "anthropic") return "anthropic"
  if (providerId === "gemini") return "gemini"
  return "none"
}

function classifyBaseUrl(connection: AIConnectionConfig): ProviderBaseUrlClass {
  const providerId = connection.provider.trim()
  const authMode = connection.auth?.mode ?? "api_key"
  const endpoint = providerId === "openai" || providerId === "ollama" || providerId === "llama" || providerId === "custom"
    ? normalizeOpenAICompatibleEndpoint(providerId, connection.endpoint)
    : connection.endpoint?.trim()

  if (!providerId) return "none"
  if (providerId === "openai" && authMode === "chatgpt_oauth") return "chatgpt_codex"
  if (providerId === "openai") return isOfficialOpenAIEndpoint(endpoint) ? "official_openai" : (isLocalEndpoint(endpoint) ? "local" : "custom")
  if (providerId === "ollama" || providerId === "llama") return isLocalEndpoint(endpoint) ? "local" : "custom"
  if (providerId === "custom") return isLocalEndpoint(endpoint) ? "local" : "custom"
  return endpoint ? "custom" : "provider_native"
}

function buildOAuthConfig(connection: AIConnectionConfig): OpenAICodexOAuthConfig | undefined {
  if (connection.provider !== "openai") return undefined
  if (connection.auth?.mode !== "chatgpt_oauth") return undefined
  return {
    authFilePath: connection.auth?.oauthAuthFilePath,
    clientId: connection.auth?.clientId,
  }
}

function resolveProviderEndpoint(connection: AIConnectionConfig): string | undefined {
  const providerId = connection.provider.trim()
  if (providerId === "openai" && connection.auth?.mode === "chatgpt_oauth") {
    const endpoint = connection.endpoint?.trim()
    return endpoint ? resolveOpenAICodexBaseUrl(endpoint) : undefined
  }
  if (providerId === "openai" || providerId === "ollama" || providerId === "llama" || providerId === "custom") {
    return normalizeOpenAICompatibleEndpoint(providerId, connection.endpoint)
  }
  return connection.endpoint?.trim() || undefined
}

function buildProviderFingerprint(connection: AIConnectionConfig): string {
  const providerId = connection.provider.trim()
  const authMode = connection.auth?.mode ?? "api_key"
  const endpoint = resolveProviderEndpoint(connection) ?? ""
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

export function resolveAIConnection(connection: AIConnectionConfig, providerId?: string): ResolvedAiConnection {
  const activeProviderId = connection.provider.trim()
  const requestedProviderId = providerId?.trim() ?? ""
  const model = connection.model.trim()
  const authMode = connection.auth?.mode ?? "api_key"
  const endpoint = resolveProviderEndpoint(connection) ?? ""
  const configured = resolveProviderConfigured(connection)
  let fallbackReason = configured.reason

  if (requestedProviderId && requestedProviderId !== activeProviderId) {
    fallbackReason = `provider_mismatch:${requestedProviderId}->${activeProviderId || "none"}`
  } else if (configured.configured && !model) {
    fallbackReason = "model_missing"
  }

  const credentialKind = resolveCredentialKind(connection)
  const adapterType = resolveAdapterType(connection)
  const baseUrlClass = classifyBaseUrl(connection)
  const healthy = configured.configured && Boolean(model) && !(requestedProviderId && requestedProviderId !== activeProviderId)
  const diagnosticId = [
    activeProviderId || "none",
    adapterType,
    authMode,
    credentialKind,
    baseUrlClass,
    model || "model_missing",
  ].join(":")
  const auditTrace: ProviderAuditTrace = {
    source: "config.ai.connection",
    requestedProviderId,
    providerId: activeProviderId,
    adapterType,
    baseUrlClass,
    modelId: model,
    authType: credentialKind,
    configured: configured.configured,
    healthy,
    fallbackReason,
    diagnosticId,
  }

  return {
    source: "config.ai.connection",
    providerId: activeProviderId,
    credentialKind,
    adapterType,
    authType: credentialKind,
    baseUrlClass,
    authMode,
    model,
    endpoint,
    configured: configured.configured,
    enabled: configured.configured,
    healthy,
    fallbackReason,
    diagnosticId,
    auditTrace,
    requestedProviderId,
    connection,
  }
}

export function resolveProviderResolutionSnapshot(providerId?: string, config = getConfig()): ProviderResolutionSnapshot {
  const { requestedProviderId: _requestedProviderId, connection: _connection, ...snapshot } = resolveAIConnection(getActiveAIConnection(config), providerId)
  return snapshot
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

export function createProviderForConnection(connection: AIConnectionConfig): AIProvider {
  const activeProviderId = connection.provider.trim()

  if (activeProviderId === "anthropic") {
    const apiKey = connection.auth?.apiKey?.trim()
    if (!apiKey) {
      throw new Error("Anthropic AI is not configured. Connect it in settings before using it.")
    }
    return new AnthropicProvider(buildProfile([apiKey]))
  }

  if (activeProviderId === "gemini") {
    const apiKey = connection.auth?.apiKey?.trim()
    if (!apiKey) {
      throw new Error("Gemini AI is not configured. Connect it in settings before using it.")
    }
    return new GeminiProvider(buildProfile([apiKey]), connection.endpoint?.trim() || undefined)
  }

  if (activeProviderId === "openai" || activeProviderId === "ollama" || activeProviderId === "llama" || activeProviderId === "custom") {
    const apiKey = connection.auth?.apiKey?.trim()
    const profile = buildOAuthConfig(connection)
      ? buildProfile([])
      : buildOpenAICompatibleProfile(activeProviderId, apiKey)
    const endpoint = resolveProviderEndpoint(connection)
    return new OpenAIProvider(profile, endpoint, buildOAuthConfig(connection))
  }

  throw new Error(`Unsupported AI backend: "${activeProviderId}"`)
}

export function resolveProviderForConnection(connection: AIConnectionConfig, providerId?: string): ResolvedAiProvider | null {
  const resolution = resolveAIConnection(connection, providerId)
  if (!resolution.healthy) return null
  return {
    providerId: resolution.providerId,
    model: resolution.model,
    provider: createProviderForConnection(connection),
    resolution,
  }
}

export function getProvider(providerId?: string): AIProvider {
  const connection = getActiveAIConnection()
  const resolved = resolveAIConnection(connection, providerId)
  const snapshot = resolved
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
  const provider = createProviderForConnection(connection)
  providers.set(activeProviderId, provider)
  return provider
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

export function formatProviderAuditTrace(trace: ProviderAuditTrace): string {
  return [
    "provider_trace",
    ...(trace.profileId ? [`profile=${trace.profileId}`] : []),
    `provider=${trace.providerId || "none"}`,
    `requested=${trace.requestedProviderId || "none"}`,
    ...(trace.resolverPath ? [`resolver=${trace.resolverPath}`] : []),
    `adapter=${trace.adapterType}`,
    `base=${trace.baseUrlClass}`,
    `model=${trace.modelId || "model_missing"}`,
    `auth=${trace.credentialSourceKind ?? trace.authType}`,
    ...(trace.endpointMismatch !== undefined ? [`endpoint_mismatch=${trace.endpointMismatch ? "true" : "false"}`] : []),
    `healthy=${trace.healthy ? "true" : "false"}`,
    ...(trace.fallbackReason ? [`reason=${trace.fallbackReason}`] : []),
  ].join(" ")
}

export type { AIProvider, AIChunk, Message, ToolDefinition, ChatParams } from "./types.js"
