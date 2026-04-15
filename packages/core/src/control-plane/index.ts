import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname } from "node:path"
import { randomBytes } from "node:crypto"
import JSON5 from "json5"
import { getConfig, PATHS, reloadConfig, type NobieConfig } from "../config/index.js"
import { resetAIProviderCache } from "../ai/index.js"
import { DEFAULT_CONFIG } from "../config/types.js"
import {
  buildMcpSetupDraft,
  buildSkillsSetupDraft,
  persistMcpSetupDraft,
  persistSkillsSetupDraft,
  type SetupMcpServerDraft,
  type SetupSkillDraftItem,
} from "./setup-extensions.js"
import { getActiveTelegramChannel, getTelegramRuntimeError } from "../channels/telegram/runtime.js"
import { getActiveSlackChannel, getSlackRuntimeError } from "../channels/slack/runtime.js"
import { mcpRegistry } from "../mcp/registry.js"
import { getMqttBrokerSnapshot } from "../mqtt/broker.js"
import { updateActiveRunsMaxDelegationTurns } from "../runs/store.js"
import {
  OPENAI_CODEX_KNOWN_MODELS,
  OPENAI_CODEX_RESPONSES_PATH,
  OPENAI_CODEX_USER_AGENT,
  readOpenAICodexAccessToken,
  resolveOpenAICodexAuthFilePath,
  resolveOpenAICodexBaseUrl,
} from "../auth/openai-codex-oauth.js"

export type CapabilityStatus = "ready" | "disabled" | "planned" | "error"

export interface FeatureCapability {
  key: string
  label: string
  area: "setup" | "gateway" | "runs" | "chat" | "ai" | "security" | "telegram" | "slack" | "scheduler" | "plugins" | "memory" | "mcp" | "mqtt"
  status: CapabilityStatus
  implemented: boolean
  enabled: boolean
  reason?: string
  dependsOn?: string[]
}

export interface CapabilityCounts {
  ready: number
  disabled: number
  planned: number
  error: number
}

export interface AIBackendCard {
  id: string
  label: string
  kind: "provider"
  providerType: "openai" | "ollama" | "llama" | "anthropic" | "gemini" | "custom"
  authMode: "api_key" | "chatgpt_oauth"
  credentials: {
    apiKey?: string
    username?: string
    password?: string
    oauthAuthFilePath?: string
  }
  local: boolean
  enabled: boolean
  availableModels: string[]
  defaultModel: string
  status: CapabilityStatus
  summary: string
  tags: string[]
  reason?: string
  endpoint?: string
}

export interface RoutingProfile {
  id:
    | "default"
    | "general_chat"
    | "planning"
    | "coding"
    | "review"
    | "research"
    | "private_local"
    | "summarization"
    | "operations"
  label: string
  targets: string[]
}

export interface SetupState {
  version: 1
  completed: boolean
  currentStep:
    | "welcome"
    | "personal"
    | "ai_backends"
    | "ai_routing"
    | "mcp"
    | "skills"
    | "security"
    | "channels"
    | "remote_access"
    | "review"
    | "done"
  completedAt?: number
  skipped: {
    telegram: boolean
    remoteAccess: boolean
  }
}

export interface SetupDraft {
  personal: {
    profileName: string
    displayName: string
    language: string
    timezone: string
    workspace: string
  }
  aiBackends: AIBackendCard[]
  routingProfiles: RoutingProfile[]
  mcp: {
    servers: SetupMcpServerDraft[]
  }
  skills: {
    items: SetupSkillDraftItem[]
  }
  security: {
    approvalMode: "always" | "on-miss" | "off"
    approvalTimeout: number
    approvalTimeoutFallback: "deny" | "allow"
    maxDelegationTurns: number
  }
  channels: {
    telegramEnabled: boolean
    botToken: string
    allowedUserIds: string
    allowedGroupIds: string
    slackEnabled: boolean
    slackBotToken: string
    slackAppToken: string
    slackAllowedUserIds: string
    slackAllowedChannelIds: string
  }
  mqtt: {
    enabled: boolean
    host: string
    port: number
    username: string
    password: string
  }
  remoteAccess: {
    authEnabled: boolean
    authToken: string
    host: string
    port: number
  }
}

export interface SetupChecks {
  stateDir: string
  configFile: string
  setupStateFile: string
  setupCompleted: boolean
  telegramConfigured: boolean
  authEnabled: boolean
  schedulerEnabled: boolean
}

type JsonObject = Record<string, unknown>

const KNOWN_BACKENDS = [
  "provider:openai",
  "provider:anthropic",
  "provider:gemini",
  "provider:ollama",
  "provider:llama_cpp",
] as const

const GENERIC_BACKEND_REASONS = new Set([
  "계획·리서치 특화 provider runtime은 아직 gateway에 연결되지 않았습니다.",
  "엔드포인트와 모델 조회는 가능하지만 실제 라우팅 런타임은 아직 연결되지 않았습니다.",
  "로컬 경량 추론 provider runtime은 후속 Phase에서 연결합니다.",
  "사용자 추가 backend이며 실제 연결 테스트는 setup에서 확인합니다.",
])

const GENERIC_BACKEND_SUMMARIES = new Set([
  "일반 대화, 검토, 도구 호출에 두루 쓰는 원격 추론 기본값",
  "Anthropic 계열 원격 추론 후보",
  "계획, 리서치, 긴 문맥 처리를 위한 후보",
  "로컬 모델 우선 후보",
  "로컬 대체 추론 서버",
  "사용자 추가 backend",
])

function countCapabilities(items: FeatureCapability[]): CapabilityCounts {
  return items.reduce<CapabilityCounts>(
    (acc, item) => {
      acc[item.status] += 1
      return acc
    },
    { ready: 0, disabled: 0, planned: 0, error: 0 },
  )
}

function toObject(value: unknown): JsonObject {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonObject)
    : {}
}

function toStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : []
}

function toCredentials(value: unknown): AIBackendCard["credentials"] {
  const raw = toObject(value)
  const credentials: AIBackendCard["credentials"] = {}
  if (typeof raw.apiKey === "string") credentials.apiKey = raw.apiKey
  if (typeof raw.username === "string") credentials.username = raw.username
  if (typeof raw.password === "string") credentials.password = raw.password
  if (typeof raw.oauthAuthFilePath === "string") credentials.oauthAuthFilePath = raw.oauthAuthFilePath
  return credentials
}

function sanitizeBackendReason(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined
  const normalized = value.trim()
  if (!normalized) return undefined
  if (GENERIC_BACKEND_REASONS.has(normalized)) return undefined
  return normalized
}

function sanitizeBackendSummary(value: unknown): string {
  if (typeof value !== "string") return ""
  const normalized = value.trim()
  if (!normalized) return ""
  if (GENERIC_BACKEND_SUMMARIES.has(normalized)) return ""
  return normalized
}

function toNumberArrayString(value: unknown): string {
  if (!Array.isArray(value)) return ""
  return value
    .filter((item): item is number => typeof item === "number" && Number.isFinite(item))
    .join("\n")
}

function parseIdString(value: string): number[] {
  return value
    .split(/[\s,]+/)
    .map((item) => Number(item.trim()))
    .filter((item) => Number.isFinite(item))
}

function ensureParentDir(filePath: string): void {
  mkdirSync(dirname(filePath), { recursive: true })
}

function readRawConfig(): JsonObject {
  if (!existsSync(PATHS.configFile)) return {}
  try {
    return toObject(JSON5.parse(readFileSync(PATHS.configFile, "utf-8")))
  } catch {
    return {}
  }
}

function writeRawConfig(raw: JsonObject): void {
  ensureParentDir(PATHS.configFile)
  writeFileSync(PATHS.configFile, JSON5.stringify(raw, null, 2), "utf-8")
  reloadConfig()
  resetAIProviderCache()
}

function defaultSetupState(): SetupState {
  return {
    version: 1,
    completed: false,
    currentStep: "welcome",
    skipped: {
      telegram: false,
      remoteAccess: false,
    },
  }
}

export function readSetupState(): SetupState {
  if (!existsSync(PATHS.setupStateFile)) return defaultSetupState()
  try {
    const parsed = JSON.parse(readFileSync(PATHS.setupStateFile, "utf-8")) as Partial<SetupState>
    const state = {
      ...defaultSetupState(),
      ...parsed,
      skipped: { ...defaultSetupState().skipped, ...(parsed.skipped ?? {}) },
    }
    if (!state.completed && state.currentStep === "done") {
      state.currentStep = "review"
      writeSetupState(state)
    }
    return state
  } catch {
    return defaultSetupState()
  }
}

export function writeSetupState(state: SetupState): SetupState {
  ensureParentDir(PATHS.setupStateFile)
  writeFileSync(PATHS.setupStateFile, JSON.stringify(state, null, 2), "utf-8")
  return state
}

function createDefaultRoutingProfiles(): RoutingProfile[] {
  return [
    { id: "default", label: "기본", targets: ["provider:openai", "provider:gemini", "provider:ollama"] },
    { id: "general_chat", label: "일반 대화", targets: ["provider:openai", "provider:gemini", "provider:ollama"] },
    { id: "planning", label: "계획/설계", targets: ["provider:gemini", "provider:openai", "provider:anthropic"] },
    { id: "coding", label: "코딩", targets: ["provider:anthropic", "provider:openai", "provider:gemini"] },
    { id: "review", label: "리뷰", targets: ["provider:anthropic", "provider:openai", "provider:gemini"] },
    { id: "research", label: "리서치", targets: ["provider:gemini", "provider:openai", "provider:anthropic"] },
    { id: "private_local", label: "로컬 우선", targets: ["provider:ollama", "provider:llama_cpp"] },
    { id: "summarization", label: "요약", targets: ["provider:ollama", "provider:openai", "provider:gemini"] },
    { id: "operations", label: "운영", targets: ["provider:anthropic", "provider:openai", "provider:ollama"] },
  ]
}

function createSingleConnectionRoutingProfiles(targetId: string | undefined): RoutingProfile[] {
  const defaults = createDefaultRoutingProfiles()
  return defaults.map((profile) => ({
    ...profile,
    targets: targetId ? [targetId] : [],
  }))
}

function hasConfiguredOpenAIOAuthConnection(config: NobieConfig): boolean {
  const connection = config.ai.connection
  if (connection.provider !== "openai") return false
  if (connection.auth?.mode !== "chatgpt_oauth") return false
  return existsSync(resolveOpenAICodexAuthFilePath({
    authFilePath: connection.auth?.oauthAuthFilePath,
    clientId: connection.auth?.clientId,
  }))
}

function isActiveConnection(config: NobieConfig, providerType: AIBackendCard["providerType"]): boolean {
  return config.ai.connection.provider === providerType
}

function hasConfiguredConnection(config: NobieConfig, providerType: AIBackendCard["providerType"]): boolean {
  if (!isActiveConnection(config, providerType)) return false
  const connection = config.ai.connection

  if (providerType === "openai") {
    if (connection.auth?.mode === "chatgpt_oauth") return hasConfiguredOpenAIOAuthConnection(config)
    return Boolean(connection.auth?.apiKey?.trim() || connection.endpoint?.trim())
  }

  if (providerType === "anthropic" || providerType === "gemini") {
    return Boolean(connection.auth?.apiKey?.trim() || connection.endpoint?.trim())
  }

  if (providerType === "ollama" || providerType === "llama" || providerType === "custom") {
    return Boolean(connection.endpoint?.trim())
  }

  return false
}

function createDefaultAiBackends(config: NobieConfig): AIBackendCard[] {
  const connection = config.ai.connection
  const openaiAuthMode = isActiveConnection(config, "openai")
    ? (connection.auth?.mode ?? "api_key")
    : "api_key"
  const openaiEndpoint = isActiveConnection(config, "openai")
    ? (openaiAuthMode === "chatgpt_oauth"
      ? resolveOpenAICodexBaseUrl(connection.endpoint?.trim())
      : (connection.endpoint?.trim() || undefined))
    : undefined
  const geminiEndpoint = isActiveConnection(config, "gemini") ? connection.endpoint?.trim() || undefined : undefined
  const ollamaEndpoint = isActiveConnection(config, "ollama") ? connection.endpoint?.trim() || undefined : undefined
  const llamaEndpoint = isActiveConnection(config, "llama") ? connection.endpoint?.trim() || undefined : undefined

  return [
    {
      id: "provider:openai",
      label: "범용 원격 추론",
      kind: "provider",
      providerType: "openai",
      authMode: openaiAuthMode,
      credentials: {
        apiKey: isActiveConnection(config, "openai") ? (connection.auth?.apiKey ?? "") : "",
        oauthAuthFilePath: isActiveConnection(config, "openai") ? (connection.auth?.oauthAuthFilePath ?? "") : "",
      },
      local: false,
      enabled: hasConfiguredConnection(config, "openai"),
      availableModels: [],
      defaultModel: isActiveConnection(config, "openai") ? connection.model : "",
      status: hasConfiguredConnection(config, "openai") ? "ready" : "planned",
      summary: "",
      tags: ["general", "review", "tool_use"],
      ...(openaiEndpoint ? { endpoint: openaiEndpoint } : {}),
    },
    {
      id: "provider:gemini",
      label: "계획·리서치 특화",
      kind: "provider",
      providerType: "gemini",
      authMode: "api_key",
      credentials: {
        apiKey: isActiveConnection(config, "gemini") ? (connection.auth?.apiKey ?? "") : "",
      },
      local: false,
      enabled: hasConfiguredConnection(config, "gemini"),
      availableModels: [],
      defaultModel: isActiveConnection(config, "gemini") ? connection.model : "",
      status: hasConfiguredConnection(config, "gemini") ? "ready" : "planned",
      summary: "",
      tags: ["planning", "research", "long_context"],
      ...(geminiEndpoint ? { endpoint: geminiEndpoint } : {}),
    },
    {
      id: "provider:ollama",
      label: "로컬 모델 우선",
      kind: "provider",
      providerType: "ollama",
      authMode: "api_key",
      credentials: {},
      local: true,
      enabled: hasConfiguredConnection(config, "ollama"),
      availableModels: [],
      defaultModel: isActiveConnection(config, "ollama") ? connection.model : "",
      status: hasConfiguredConnection(config, "ollama") ? "ready" : "disabled",
      summary: "",
      tags: ["local", "coding", "private_local"],
      ...(ollamaEndpoint ? { endpoint: ollamaEndpoint } : {}),
    },
    {
      id: "provider:llama_cpp",
      label: "Llama",
      kind: "provider",
      providerType: "llama",
      authMode: "api_key",
      credentials: {
        apiKey: isActiveConnection(config, "llama") ? (connection.auth?.apiKey ?? "") : "",
      },
      local: true,
      enabled: hasConfiguredConnection(config, "llama"),
      availableModels: [],
      defaultModel: isActiveConnection(config, "llama") ? connection.model : "",
      status: hasConfiguredConnection(config, "llama") ? "ready" : "planned",
      summary: "",
      tags: ["local", "private_local"],
      ...(llamaEndpoint ? { endpoint: llamaEndpoint } : {}),
    },
    {
      id: "provider:anthropic",
      label: "Anthropic 추론",
      kind: "provider",
      providerType: "anthropic",
      authMode: "api_key",
      credentials: {
        apiKey: isActiveConnection(config, "anthropic") ? (connection.auth?.apiKey ?? "") : "",
      },
      local: false,
      enabled: hasConfiguredConnection(config, "anthropic"),
      availableModels: [],
      defaultModel: isActiveConnection(config, "anthropic") ? connection.model : "",
      status: hasConfiguredConnection(config, "anthropic") ? "ready" : "planned",
      summary: "",
      tags: ["coding", "operations", "review", "general"],
    },
  ]
}

function normalizeBackendProviderType(value: unknown): AIBackendCard["providerType"] | undefined {
  return ["openai", "ollama", "llama", "anthropic", "gemini", "custom"].includes(String(value))
    ? (value as AIBackendCard["providerType"])
    : undefined
}

function mergeBackend(base: AIBackendCard, value: unknown): AIBackendCard {
  if (value === undefined) {
    return {
      ...base,
      credentials: { ...base.credentials },
      availableModels: [],
    }
  }

  const raw = toObject(value)
  const merged: AIBackendCard = {
    ...base,
    enabled: typeof raw.enabled === "boolean" ? raw.enabled : base.enabled,
    local: typeof raw.local === "boolean" ? raw.local : base.local,
    providerType: normalizeBackendProviderType(raw.providerType) ?? base.providerType,
    authMode: ["api_key", "chatgpt_oauth"].includes(String(raw.authMode))
      ? (raw.authMode as AIBackendCard["authMode"])
      : base.authMode,
    credentials: toCredentials(raw.credentials),
    defaultModel: typeof raw.defaultModel === "string" ? raw.defaultModel : base.defaultModel,
    summary: typeof raw.summary === "string" ? sanitizeBackendSummary(raw.summary) : base.summary,
    tags: toStringArray(raw.tags).length > 0 ? toStringArray(raw.tags) : base.tags,
    status: ["ready", "disabled", "planned", "error"].includes(String(raw.status))
      ? (raw.status as CapabilityStatus)
      : base.status,
    availableModels: [],
  }
  if (typeof raw.endpoint === "string" && raw.endpoint.trim()) merged.endpoint = raw.endpoint.trim()
  const nextReason = sanitizeBackendReason(raw.reason)
  if (nextReason) merged.reason = nextReason
  return merged
}

function mergeBuiltinBackendState(base: AIBackendCard, value: unknown): AIBackendCard {
  if (value === undefined) {
    return {
      ...base,
      credentials: { ...base.credentials },
      availableModels: [],
    }
  }

  const raw = toObject(value)
  return {
    ...base,
    enabled: raw.enabled === false ? false : base.enabled,
    credentials: { ...base.credentials },
    availableModels: [],
  }
}

function sanitizeRoutingProfiles(value: unknown): RoutingProfile[] {
  if (!Array.isArray(value)) return createDefaultRoutingProfiles()
  const parsed = value
    .map((entry) => {
      const row = toObject(entry)
      if (typeof row.id !== "string" || typeof row.label !== "string") return null
      const targets = toStringArray(row.targets)
        .filter((target) => !target.startsWith("worker:"))
      return {
        id: row.id as RoutingProfile["id"],
        label: row.label,
        targets: [...new Set(targets)],
      }
    })
    .filter((entry): entry is RoutingProfile => entry !== null && entry.targets.length > 0)
  return parsed.length > 0 ? parsed : createDefaultRoutingProfiles()
}

function sanitizeCustomBackends(value: unknown): AIBackendCard[] {
  if (!Array.isArray(value)) return []
  return value
    .map((entry) => {
      const raw = toObject(entry)
      if (typeof raw.id !== "string" || typeof raw.label !== "string") return null
      if (raw.id.startsWith("worker:") || raw.kind === "worker") return null
      const kind = "provider"
      const reason = sanitizeBackendReason(raw.reason)
      const backend: AIBackendCard = {
        id: raw.id,
        label: raw.label,
        kind,
        providerType: normalizeBackendProviderType(raw.providerType) ?? "custom",
        authMode: ["api_key", "chatgpt_oauth"].includes(String(raw.authMode))
          ? (raw.authMode as AIBackendCard["authMode"])
          : "api_key",
        credentials: toCredentials(raw.credentials),
        local: typeof raw.local === "boolean" ? raw.local : false,
        enabled: typeof raw.enabled === "boolean" ? raw.enabled : false,
        availableModels: [],
        defaultModel: typeof raw.defaultModel === "string" ? raw.defaultModel : "",
        status: ["ready", "disabled", "planned", "error"].includes(String(raw.status))
          ? (raw.status as CapabilityStatus)
          : "disabled",
        summary: typeof raw.summary === "string" ? sanitizeBackendSummary(raw.summary) : "",
        tags: toStringArray(raw.tags),
        ...(reason ? { reason } : {}),
      }
      if (typeof raw.endpoint === "string") backend.endpoint = raw.endpoint
      return backend
    })
    .filter((entry): entry is AIBackendCard => entry !== null)
}

export function buildSetupDraft(): SetupDraft {
  const config = getConfig()
  const raw = readRawConfig()
  const defaults = createDefaultAiBackends(config)
  const customBackends = config.ai.connection.provider === "custom"
    ? [{
        id: "provider:custom",
        label: "사용자 정의 연결",
        kind: "provider" as const,
        providerType: "custom" as const,
        authMode: config.ai.connection.auth?.mode ?? "api_key",
        credentials: {
          apiKey: config.ai.connection.auth?.apiKey ?? "",
          username: config.ai.connection.auth?.username ?? "",
          password: config.ai.connection.auth?.password ?? "",
          oauthAuthFilePath: config.ai.connection.auth?.oauthAuthFilePath ?? "",
        },
        local: false,
        enabled: Boolean(config.ai.connection.provider.trim()),
        availableModels: [],
        defaultModel: config.ai.connection.model,
        status: config.ai.connection.provider ? "ready" as const : "disabled" as const,
        summary: "",
        tags: ["general"],
        ...(config.ai.connection.endpoint?.trim() ? { endpoint: config.ai.connection.endpoint.trim() } : {}),
      }]
    : []
  const activeTarget = [...defaults, ...customBackends].find((backend) => backend.enabled)?.id

  return {
    personal: {
      profileName: config.profile.profileName ?? "",
      displayName: config.profile.displayName ?? "",
      language: config.profile.language ?? "ko",
      timezone: config.profile.timezone ?? config.scheduler.timezone,
      workspace: config.profile.workspace ?? "",
    },
    aiBackends: [...defaults, ...customBackends],
    routingProfiles: createSingleConnectionRoutingProfiles(activeTarget),
    mcp: buildMcpSetupDraft(config),
    skills: buildSkillsSetupDraft(config),
    security: {
      approvalMode: config.security.approvalMode,
      approvalTimeout: config.security.approvalTimeout,
      approvalTimeoutFallback: config.security.approvalTimeoutFallback,
      maxDelegationTurns: config.orchestration.maxDelegationTurns,
    },
    channels: {
      telegramEnabled: config.telegram?.enabled ?? false,
      botToken: config.telegram?.botToken ?? "",
      allowedUserIds: toNumberArrayString(config.telegram?.allowedUserIds ?? []),
      allowedGroupIds: toNumberArrayString(config.telegram?.allowedGroupIds ?? []),
      slackEnabled: config.slack?.enabled ?? false,
      slackBotToken: config.slack?.botToken ?? "",
      slackAppToken: config.slack?.appToken ?? "",
      slackAllowedUserIds: (config.slack?.allowedUserIds ?? []).join("\n"),
      slackAllowedChannelIds: (config.slack?.allowedChannelIds ?? []).join("\n"),
    },
    mqtt: {
      enabled: config.mqtt.enabled,
      host: config.mqtt.host,
      port: config.mqtt.port,
      username: config.mqtt.username,
      password: config.mqtt.password,
    },
    remoteAccess: {
      authEnabled: config.webui.auth.enabled,
      authToken: config.webui.auth.token ?? "",
      host: config.webui.host,
      port: config.webui.port,
    },
  }
}

function persistBackends(raw: JsonObject, draft: SetupDraft): void {
  if (!raw.ai) raw.ai = {}
  const ai = toObject(raw.ai)
  const backends: JsonObject = {}
  const customBackends: JsonObject[] = []

  for (const backend of draft.aiBackends) {
    const persisted: JsonObject = {
      enabled: backend.enabled,
    }

    if ((KNOWN_BACKENDS as readonly string[]).includes(backend.id)) {
      const key = backend.id.split(":")[1] ?? backend.id
      backends[key] = persisted
    } else {
      persisted.kind = backend.kind
      persisted.local = backend.local
      persisted.defaultModel = backend.defaultModel
      persisted.providerType = backend.providerType
      persisted.authMode = backend.authMode ?? "api_key"
      persisted.credentials = backend.credentials
      persisted.tags = backend.tags
      persisted.status = backend.status
      if (backend.summary.trim()) persisted.summary = backend.summary.trim()
      if (backend.endpoint?.trim()) persisted.endpoint = backend.endpoint.trim()
      if (backend.reason?.trim()) persisted.reason = backend.reason.trim()
      customBackends.push({
        id: backend.id,
        label: backend.label,
        ...persisted,
      })
    }
  }

  ai.backends = backends
  ai.customBackends = customBackends
  ai.routingProfiles = draft.routingProfiles
  raw.ai = ai
}

export function saveSetupDraft(draft: SetupDraft, state?: SetupState): { draft: SetupDraft; state: SetupState } {
  const raw = readRawConfig()
  const rawWebuiAuth = {
    ...toObject(toObject(raw.webui).auth),
  }
  delete rawWebuiAuth.oauth

  raw.profile = {
    ...toObject(raw.profile),
    profileName: draft.personal.profileName,
    displayName: draft.personal.displayName,
    language: draft.personal.language,
    timezone: draft.personal.timezone,
    workspace: draft.personal.workspace,
  }

  raw.scheduler = {
    ...toObject(raw.scheduler),
    timezone: draft.personal.timezone,
  }

  raw.security = {
    ...toObject(raw.security),
    approvalMode: draft.security.approvalMode,
    approvalTimeout: draft.security.approvalTimeout,
    approvalTimeoutFallback: draft.security.approvalTimeoutFallback,
  }

  raw.orchestration = {
    ...toObject(raw.orchestration),
    maxDelegationTurns: Math.max(0, Math.floor(Number.isFinite(draft.security.maxDelegationTurns) ? draft.security.maxDelegationTurns : 5)),
  }

  raw.telegram = {
    ...toObject(raw.telegram),
    enabled: draft.channels.telegramEnabled,
    botToken: draft.channels.botToken,
    allowedUserIds: parseIdString(draft.channels.allowedUserIds),
    allowedGroupIds: parseIdString(draft.channels.allowedGroupIds),
  }

  raw.slack = {
    ...toObject(raw.slack),
    enabled: draft.channels.slackEnabled,
    botToken: draft.channels.slackBotToken,
    appToken: draft.channels.slackAppToken,
    allowedUserIds: draft.channels.slackAllowedUserIds
      .split(/[\s,]+/)
      .map((value) => value.trim())
      .filter(Boolean),
    allowedChannelIds: draft.channels.slackAllowedChannelIds
      .split(/[\s,]+/)
      .map((value) => value.trim())
      .filter(Boolean),
  }

  raw.mqtt = {
    ...toObject(raw.mqtt),
    enabled: draft.mqtt.enabled,
    host: draft.mqtt.host.trim(),
    port: Math.max(1, Math.min(65535, Math.floor(Number.isFinite(draft.mqtt.port) ? draft.mqtt.port : 1883))),
    username: draft.mqtt.username.trim(),
    password: draft.mqtt.password,
    allowAnonymous: false,
  }

  raw.webui = {
    ...toObject(raw.webui),
    host: draft.remoteAccess.host,
    port: draft.remoteAccess.port,
    auth: {
      ...rawWebuiAuth,
      enabled: draft.remoteAccess.authEnabled,
      token: draft.remoteAccess.authToken,
    },
  }

  if (!raw.ai) raw.ai = {}
  const rawAi = toObject(raw.ai)
  const enabledBackends = draft.aiBackends.filter((backend) => backend.enabled)
  if (enabledBackends.length > 1) {
    throw new Error("Only one active AI connection can be enabled.")
  }

  const activeBackend = enabledBackends[0]
  const persistedProviderType = activeBackend?.providerType
  rawAi.connection = activeBackend
    ? {
        provider: persistedProviderType,
        model: activeBackend.defaultModel.trim(),
        endpoint: persistedProviderType === "openai" && activeBackend.authMode === "chatgpt_oauth"
          ? resolveOpenAICodexBaseUrl(activeBackend.endpoint)
          : activeBackend.endpoint?.trim() || undefined,
        auth: {
          mode: activeBackend.authMode ?? "api_key",
          apiKey: activeBackend.credentials.apiKey?.trim() || undefined,
          username: activeBackend.credentials.username?.trim() || undefined,
          password: activeBackend.credentials.password || undefined,
          oauthAuthFilePath: activeBackend.credentials.oauthAuthFilePath?.trim() || undefined,
          clientId: typeof toObject(toObject(rawAi.connection).auth).clientId === "string"
            ? toObject(toObject(rawAi.connection).auth).clientId
            : undefined,
        },
      }
    : {
        provider: "",
        model: "",
      }
  raw.ai = rawAi
  delete rawAi.providers
  delete rawAi.defaultProvider
  delete rawAi.defaultModel
  delete rawAi.backends
  delete rawAi.customBackends
  delete rawAi.routingProfiles
  delete raw.llm
  persistMcpSetupDraft(raw, draft.mcp)
  persistSkillsSetupDraft(raw, draft.skills)
  writeRawConfig(raw)
  updateActiveRunsMaxDelegationTurns(Math.max(0, Math.floor(Number.isFinite(draft.security.maxDelegationTurns) ? draft.security.maxDelegationTurns : 5)))

  const nextState = state ? writeSetupState(state) : readSetupState()
  return { draft: buildSetupDraft(), state: nextState }
}

export function resetSetupEnvironment(): { draft: SetupDraft; state: SetupState; checks: SetupChecks } {
  writeRawConfig(JSON.parse(JSON.stringify(DEFAULT_CONFIG)) as JsonObject)
  const state = writeSetupState(defaultSetupState())
  return {
    draft: buildSetupDraft(),
    state,
    checks: createSetupChecks(),
  }
}

export function completeSetup(): SetupState {
  const current = readSetupState()
  return writeSetupState({
    ...current,
    completed: true,
    currentStep: "done",
    completedAt: Date.now(),
  })
}

export function createSetupChecks(): SetupChecks {
  const config = getConfig()
  const state = readSetupState()
  return {
    stateDir: PATHS.stateDir,
    configFile: PATHS.configFile,
    setupStateFile: PATHS.setupStateFile,
    setupCompleted: state.completed,
    telegramConfigured: Boolean(config.telegram?.botToken),
    authEnabled: config.webui.auth.enabled,
    schedulerEnabled: config.scheduler.enabled,
  }
}

export function createTransientAuthToken(): string {
  return randomBytes(32).toString("hex")
}

export function createCapabilities(): FeatureCapability[] {
  const config = getConfig()
  const telegramRunning = getActiveTelegramChannel() !== null
  const telegramRuntimeError = getTelegramRuntimeError()
  const slackRunning = getActiveSlackChannel() !== null
  const slackRuntimeError = getSlackRuntimeError()
  const mcpSummary = mcpRegistry.getSummary()
  const mcpStatuses = mcpRegistry.getStatuses()
  const mqtt = getMqttBrokerSnapshot()

  const mcpCapability: FeatureCapability = {
    key: "mcp.client",
    label: "MCP Client",
    area: "mcp",
    status: "disabled",
    implemented: true,
    enabled: false,
  }

  if (mcpSummary.serverCount === 0) {
    mcpCapability.reason = "MCP 서버가 설정되지 않았습니다."
  } else if (mcpSummary.requiredFailures > 0) {
    mcpCapability.status = "error"
    mcpCapability.reason = `필수 MCP 서버 ${mcpSummary.requiredFailures}개가 준비되지 않았습니다.`
  } else if (mcpSummary.readyCount > 0) {
    mcpCapability.status = "ready"
    mcpCapability.enabled = true
    if (mcpSummary.readyCount < mcpSummary.serverCount) {
      mcpCapability.reason = `MCP 서버 ${mcpSummary.readyCount}/${mcpSummary.serverCount}개가 준비되었습니다.`
    }
  } else {
    const firstError = mcpStatuses.find((item) => item.error)?.error
    mcpCapability.reason = firstError ?? "설정된 MCP 서버가 아직 준비되지 않았습니다."
  }

  const telegramCapability: FeatureCapability = {
    key: "telegram.channel",
    label: "Telegram Channel",
    area: "telegram",
    status: config.telegram?.botToken
      ? config.telegram.enabled
        ? telegramRunning
          ? "ready"
          : telegramRuntimeError ? "error" : "disabled"
        : "disabled"
      : "disabled",
    implemented: true,
    enabled: Boolean(config.telegram?.enabled && telegramRunning),
  }
  if (!config.telegram?.botToken) {
    telegramCapability.reason = "봇 토큰이 설정되지 않았습니다."
  } else if (!config.telegram.enabled) {
    telegramCapability.reason = "Telegram 채널이 비활성화되어 있습니다."
  } else if (telegramRuntimeError) {
    telegramCapability.reason = telegramRuntimeError
  } else if (!telegramRunning) {
    telegramCapability.reason = "Telegram 설정은 저장되었지만 현재 런타임이 시작되지 않았습니다."
  }

  const slackCapability: FeatureCapability = {
    key: "slack.channel",
    label: "Slack Channel",
    area: "slack",
    status: config.slack?.botToken && config.slack?.appToken
      ? config.slack.enabled
        ? slackRunning
          ? "ready"
          : slackRuntimeError ? "error" : "disabled"
        : "disabled"
      : "disabled",
    implemented: true,
    enabled: Boolean(config.slack?.enabled && slackRunning),
  }
  if (!config.slack?.botToken || !config.slack?.appToken) {
    slackCapability.reason = "Slack Bot Token과 App Token이 설정되지 않았습니다."
  } else if (!config.slack.enabled) {
    slackCapability.reason = "Slack 채널이 비활성화되어 있습니다."
  } else if (slackRuntimeError) {
    slackCapability.reason = slackRuntimeError
  } else if (!slackRunning) {
    slackCapability.reason = "Slack 설정은 저장되었지만 현재 런타임이 시작되지 않았습니다."
  }

  const mqttCapability: FeatureCapability = {
    key: "mqtt.broker",
    label: "MQTT Broker",
    area: "mqtt",
    status: !config.mqtt.enabled ? "disabled" : mqtt.running ? "ready" : mqtt.reason ? "error" : "disabled",
    implemented: true,
    enabled: Boolean(config.mqtt.enabled && mqtt.running),
  }
  if (!config.mqtt.enabled) {
    mqttCapability.reason = "MQTT 브로커가 설정에서 비활성화되어 있습니다."
  } else if (mqtt.running) {
    const hostLabel = mqtt.host === "0.0.0.0" ? "모든 네트워크 인터페이스" : mqtt.host
    const authLabel = mqtt.authEnabled
      ? mqtt.allowAnonymous
        ? "ID/password 인증이 켜져 있고 익명 접속도 허용됩니다."
        : "ID/password 인증이 필요합니다."
      : "익명 접속만 허용됩니다."
    mqttCapability.reason = `${hostLabel}:${mqtt.port} 에서 브로커가 실행 중입니다. ${authLabel}`
  } else if (mqtt.reason) {
    mqttCapability.reason = mqtt.reason
  }

  return [
    { key: "setup.wizard", label: "Setup Wizard", area: "setup", status: "ready", implemented: true, enabled: true },
    { key: "dashboard.overview", label: "Dashboard Overview", area: "gateway", status: "ready", implemented: true, enabled: true },
    {
      key: "gateway.orchestrator",
      label: "Gateway Orchestrator",
      area: "gateway",
      status: "planned",
      implemented: false,
      enabled: false,
      reason: "실제 오케스트레이터와 위임 제어 루프는 Phase 0003 이후 연결합니다.",
    },
    { key: "runs.monitor", label: "Run Monitor", area: "runs", status: "ready", implemented: true, enabled: true },
    { key: "runs.cancel", label: "Run Cancel", area: "runs", status: "ready", implemented: true, enabled: true },
    {
      key: "chat.workspace",
      label: "Chat Workspace",
      area: "chat",
      status: "ready",
      implemented: true,
      enabled: true,
    },
    {
      key: "chat.streaming",
      label: "Chat Streaming",
      area: "chat",
      status: "disabled",
      implemented: true,
      enabled: false,
      reason: "채팅은 완료 응답 기준으로 동작하며, 토큰 단위 실시간 스트리밍 표시는 아직 정리 중입니다.",
    },
    { key: "ai.backends", label: "AI Backends", area: "ai", status: "ready", implemented: true, enabled: true },
    mcpCapability,
    { key: "ai.routing", label: "AI Routing", area: "ai", status: "ready", implemented: true, enabled: true },
    { key: "instructions.chain", label: "Active Instructions", area: "gateway", status: "ready", implemented: true, enabled: true },
    { key: "settings.control", label: "Settings Control", area: "security", status: "ready", implemented: true, enabled: true },
    {
      key: "audit.viewer",
      label: "Audit Viewer",
      area: "gateway",
      status: "ready",
      implemented: true,
      enabled: true,
    },
    {
      key: "ai.overrides",
      label: "AI Overrides",
      area: "ai",
      status: "planned",
      implemented: false,
      enabled: false,
      reason: "세션별/요청별 override는 후속 Phase에서 연결합니다.",
    },
    telegramCapability,
    slackCapability,
    mqttCapability,
    (() => {
      const capability: FeatureCapability = {
        key: "scheduler.core",
        label: "Scheduler",
        area: "scheduler",
        status: config.scheduler.enabled ? "ready" : "disabled",
        implemented: true,
        enabled: config.scheduler.enabled,
      }
      if (!config.scheduler.enabled) {
        capability.reason = "스케줄러가 설정에서 비활성화되어 있습니다."
      }
      return capability
    })(),
    {
      key: "plugins.runtime",
      label: "Plugin Runtime",
      area: "plugins",
      status: "disabled",
      implemented: true,
      enabled: false,
      reason: "플러그인 런타임은 기존 구현이 있으나 WebUI-first 제어면과의 통합은 아직 완료되지 않았습니다.",
    },
    {
      key: "memory.semantic_search",
      label: "Semantic Search",
      area: "memory",
      status: "planned",
      implemented: false,
      enabled: false,
      reason: "시맨틱 메모리/검색 제어면은 후속 Phase 범위입니다.",
    },
  ]
}

export function createCapabilityCounts(): CapabilityCounts {
  return countCapabilities(createCapabilities())
}

export function getPrimaryAiTarget(): string | null {
  const draft = buildSetupDraft()
  return draft.routingProfiles.find((profile) => profile.id === "default")?.targets[0] ?? null
}

function normalizeEndpoint(endpoint: string): string {
  return endpoint.trim().replace(/\/+$/, "")
}

function normalizeModelName(value: string): string {
  return value.replace(/^models\//, "").trim()
}

function parseCommonModels(payload: unknown): string[] {
  const rows = [
    ...toArray(toObject(payload).data),
    ...toArray(toObject(payload).models),
  ]

  return [...new Set(
    rows
      .map((row) => {
        const raw = toObject(row)
        return [
          raw.id,
          raw.name,
          raw.model,
          raw.baseModelId,
        ]
          .find((value) => typeof value === "string" && value.trim().length > 0)
      })
      .filter((value): value is string => typeof value === "string")
      .map(normalizeModelName),
  )]
}

function toArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function stripKnownEndpointSuffix(endpoint: string): string {
  const suffixes = [
    "/v1beta/openai",
    "/v1/models",
    "/v1beta/models",
    "/api/tags",
    "/models",
    "/v1beta",
    "/v1",
  ]

  for (const suffix of suffixes) {
    if (endpoint.endsWith(suffix)) {
      return endpoint.slice(0, -suffix.length) || endpoint
    }
  }

  return endpoint
}

function candidatePaths(providerType: AIBackendCard["providerType"]): string[] {
  switch (providerType) {
    case "ollama":
      return ["/api/tags"]
    case "gemini":
      return ["/v1beta/models", "/v1/models", "/models"]
    case "anthropic":
      return ["/v1/models", "/models"]
    case "openai":
      return ["/v1/models", "/models"]
    case "llama":
      return ["/v1/models", "/models", "/api/tags"]
    case "custom":
      return ["/v1/models", "/models", "/v1beta/models", "/api/tags"]
  }
}

function candidateUrls(endpoint: string, providerType: AIBackendCard["providerType"]): string[] {
  const normalized = normalizeEndpoint(endpoint)
  const root = stripKnownEndpointSuffix(normalized)
  return [...new Set(candidatePaths(providerType).map((path) => `${root}${path}`))]
}

function createDiscoveryHeaders(
  providerType: AIBackendCard["providerType"],
  credentials: AIBackendCard["credentials"],
  authMode: AIBackendCard["authMode"] = "api_key",
): Promise<Record<string, string>> | Record<string, string> {
  const headers: Record<string, string> = {
    Accept: "application/json",
  }

  const username = credentials.username?.trim()
  const password = credentials.password?.trim()
  const apiKey = credentials.apiKey?.trim()

  if (username || password) {
    headers.Authorization = `Basic ${Buffer.from(`${username ?? ""}:${password ?? ""}`).toString("base64")}`
    return headers
  }

  if (providerType === "openai" && authMode === "chatgpt_oauth") {
    return readOpenAICodexAccessToken({
      authFilePath: credentials.oauthAuthFilePath,
    }).then(({ accessToken }) => ({
      ...headers,
      Authorization: `Bearer ${accessToken}`,
    }))
  }

  if (!apiKey) return headers

  switch (providerType) {
    case "anthropic":
      headers["x-api-key"] = apiKey
      headers["anthropic-version"] = "2023-06-01"
      return headers
    case "gemini":
      headers["x-goog-api-key"] = apiKey
      return headers
    case "openai":
    case "llama":
    case "custom":
      headers.Authorization = `Bearer ${apiKey}`
      return headers
    case "ollama":
      headers.Authorization = `Bearer ${apiKey}`
      return headers
  }
}

export async function discoverModelsFromEndpoint(
  endpoint: string,
  providerType: AIBackendCard["providerType"] = "custom",
  credentials: AIBackendCard["credentials"] = {},
  authMode: AIBackendCard["authMode"] = "api_key",
): Promise<{ models: string[]; sourceUrl: string }> {
  const normalized = normalizeEndpoint(endpoint)
  if (!normalized) {
    throw new Error("엔드포인트를 먼저 입력하세요.")
  }

  if (providerType === "openai" && authMode === "chatgpt_oauth") {
    const { accessToken } = await readOpenAICodexAccessToken({
      authFilePath: credentials.oauthAuthFilePath,
    })
    const baseUrl = resolveOpenAICodexBaseUrl(normalized)
    const sourceUrl = `${baseUrl}${OPENAI_CODEX_RESPONSES_PATH}`
    const response = await fetch(sourceUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        Accept: "text/event-stream",
        "User-Agent": OPENAI_CODEX_USER_AGENT,
      },
      body: JSON.stringify({
        model: OPENAI_CODEX_KNOWN_MODELS[0],
        input: [{ role: "user", content: [{ type: "input_text", text: "ping" }] }],
        instructions: "You are Codex.",
        store: false,
        stream: true,
      }),
    })
    if (!response.ok) {
      const detail = (await response.text().catch(() => "")).trim()
      throw new Error(detail || `${response.status} ${response.statusText}`)
    }
    try {
      await response.body?.cancel?.()
    } catch {
      // ignore cancellation failure for probe requests
    }
    return {
      models: [...OPENAI_CODEX_KNOWN_MODELS],
      sourceUrl,
    }
  }

  const headers = await createDiscoveryHeaders(providerType, credentials, authMode)
  const errors: string[] = []
  for (const candidate of candidateUrls(normalized, providerType)) {
    try {
      const response = await fetch(candidate, {
        method: "GET",
        headers,
      })
      if (!response.ok) {
        errors.push(`${candidate}: ${response.status} ${response.statusText}`)
        continue
      }
      const payload = await response.json()
      const models = parseCommonModels(payload)
      if (models.length > 0) {
        return { models, sourceUrl: candidate }
      }
      errors.push(`${candidate}: 모델 없음`)
    } catch (error) {
      errors.push(`${candidate}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  throw new Error(errors[0] ?? "모델 목록을 가져오지 못했습니다.")
}
