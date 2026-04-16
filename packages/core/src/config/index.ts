import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import JSON5 from "json5"
import { DEFAULT_CONFIG, type AIConnectionProvider, type NobieConfig } from "./types.js"
import { PATHS } from "./paths.js"

function toObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? { ...(value as Record<string, unknown>) }
    : {}
}

function toString(value: unknown): string {
  return typeof value === "string" ? value.trim() : ""
}

function toStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter(Boolean)
    : []
}

function normalizeAIConnectionProvider(value: unknown): AIConnectionProvider {
  const raw = toString(value).toLowerCase()
  if (!raw) return ""
  const normalized = raw.replace(/^provider:/, "").replace(/[-\s]+/g, "_")
  switch (normalized) {
    case "openai":
    case "chatgpt":
    case "chatgpt_oauth":
    case "codex":
    case "openai_codex":
    case "openai_oauth":
      return "openai"
    case "anthropic":
    case "claude":
      return "anthropic"
    case "gemini":
    case "google":
      return "gemini"
    case "ollama":
      return "ollama"
    case "llama":
    case "llama_cpp":
    case "llamacpp":
      return "llama"
    case "custom":
      return "custom"
    default:
      return "custom"
  }
}

function normalizeAIAuthMode(input: {
  mode: unknown
  provider: AIConnectionProvider
  rawProvider?: unknown
  auth?: Record<string, unknown>
}): "api_key" | "chatgpt_oauth" {
  const mode = toString(input.mode).toLowerCase().replace(/[-\s]+/g, "_")
  if (mode === "chatgpt_oauth" || mode === "codex" || mode === "oauth") return "chatgpt_oauth"
  if (mode === "api_key" || mode === "apikey") return "api_key"

  const rawProvider = toString(input.rawProvider).toLowerCase().replace(/[-\s]+/g, "_")
  if (input.provider === "openai" && ["chatgpt", "chatgpt_oauth", "codex", "openai_codex", "openai_oauth"].includes(rawProvider)) {
    return "chatgpt_oauth"
  }
  if (input.provider === "openai" && toString(input.auth?.oauthAuthFilePath)) return "chatgpt_oauth"

  return "api_key"
}

function firstObjectWithKeys(...values: unknown[]): Record<string, unknown> {
  for (const value of values) {
    const object = toObject(value)
    if (Object.keys(object).length > 0) return object
  }
  return {}
}

function inferConnectionFromLegacyConfig(rawAi: Record<string, unknown>): Record<string, unknown> | undefined {
  const rawAiProviders = toObject(rawAi.providers)
  const rawAiBackends = toObject(rawAi.backends)
  const configuredProviderRaw = toString(rawAi.defaultProvider)
  const configuredProvider = normalizeAIConnectionProvider(configuredProviderRaw)
  const configuredModel = toString(rawAi.defaultModel)

  const buildConnection = (
    provider: string,
    model: string,
    patch: Record<string, unknown>,
  ): Record<string, unknown> => ({
    provider,
    model,
    ...patch,
  })

  if (configuredProvider === "openai") {
    const openai = firstObjectWithKeys(rawAiProviders.openai, rawAiProviders.codex, rawAiProviders.chatgpt)
    const auth = toObject(openai.auth)
    return buildConnection("openai", configuredModel, {
      endpoint: toString(openai.baseUrl) || undefined,
      auth: {
        mode: normalizeAIAuthMode({ mode: auth.mode, provider: "openai", rawProvider: configuredProviderRaw, auth }),
        apiKey: toStringArray(openai.apiKeys)[0] || undefined,
        oauthAuthFilePath: toString(auth.oauthAuthFilePath) || toString(auth.codexAuthFilePath) || undefined,
        clientId: toString(auth.clientId) || undefined,
      },
    })
  }

  if (configuredProvider === "anthropic") {
    const anthropic = toObject(rawAiProviders.anthropic)
    return buildConnection("anthropic", configuredModel, {
      auth: {
        mode: "api_key",
        apiKey: toStringArray(anthropic.apiKeys)[0] || undefined,
      },
    })
  }

  if (configuredProvider === "gemini") {
    const gemini = toObject(rawAiProviders.gemini)
    return buildConnection("gemini", configuredModel, {
      endpoint: toString(gemini.baseUrl) || undefined,
      auth: {
        mode: "api_key",
        apiKey: toStringArray(gemini.apiKeys)[0] || undefined,
      },
    })
  }

  if (configuredProvider === "ollama") {
    const ollama = toObject(rawAiProviders.ollama)
    return buildConnection("ollama", configuredModel, {
      endpoint: toString(ollama.baseUrl) || undefined,
      auth: {
        mode: "api_key",
      },
    })
  }

  if (configuredProvider === "llama") {
    const llama = toObject(rawAiProviders.llama ?? rawAiProviders.llama_cpp)
    return buildConnection("llama", configuredModel, {
      endpoint: toString(llama.baseUrl) || undefined,
      auth: {
        mode: "api_key",
        apiKey: toStringArray(llama.apiKeys)[0] || undefined,
      },
    })
  }

  const openai = toObject(rawAiBackends.openai)
  if (openai.enabled === true && (toString(openai.providerType) === "openai" || toString(openai.authMode) === "chatgpt_oauth")) {
    const credentials = toObject(openai.credentials)
    return buildConnection("openai", toString(openai.defaultModel), {
      endpoint: toString(openai.endpoint) || undefined,
      auth: {
        mode: normalizeAIAuthMode({ mode: openai.authMode, provider: "openai", rawProvider: openai.providerType, auth: credentials }),
        apiKey: toString(credentials.apiKey) || undefined,
        oauthAuthFilePath: toString(credentials.oauthAuthFilePath) || toString(credentials.codexAuthFilePath) || undefined,
        clientId: toString(credentials.clientId) || undefined,
      },
    })
  }

  const anthropic = toObject(rawAiBackends.anthropic)
  if (anthropic.enabled === true && toString(anthropic.providerType) === "anthropic") {
    return buildConnection("anthropic", toString(anthropic.defaultModel), {
      auth: {
        mode: "api_key",
        apiKey: toString(toObject(anthropic.credentials).apiKey) || undefined,
      },
    })
  }

  const gemini = toObject(rawAiBackends.gemini)
  if (gemini.enabled === true && toString(gemini.providerType) === "gemini") {
    return buildConnection("gemini", toString(gemini.defaultModel), {
      endpoint: toString(gemini.endpoint) || undefined,
      auth: {
        mode: "api_key",
        apiKey: toString(toObject(gemini.credentials).apiKey) || undefined,
      },
    })
  }

  const ollama = toObject(rawAiBackends.ollama)
  if (ollama.enabled === true && toString(ollama.providerType) === "ollama") {
    return buildConnection("ollama", toString(ollama.defaultModel), {
      endpoint: toString(ollama.endpoint) || undefined,
      auth: {
        mode: "api_key",
      },
    })
  }

  const llama = toObject(rawAiBackends.llama_cpp ?? rawAiBackends.llama)
  if (llama.enabled === true && toString(llama.providerType) === "llama") {
    return buildConnection("llama", toString(llama.defaultModel), {
      endpoint: toString(llama.endpoint) || undefined,
      auth: {
        mode: "api_key",
        apiKey: toString(toObject(llama.credentials).apiKey) || undefined,
      },
    })
  }

  return undefined
}

function normalizeLegacyAiConfig(parsed: Partial<NobieConfig>): Partial<NobieConfig> {
  const root = toObject(parsed)
  const rawAi = toObject(root.ai)
  const rawConnection = toObject(rawAi.connection)

  if (!toString(rawConnection.provider)) {
    rawAi.connection = inferConnectionFromLegacyConfig(rawAi) ?? {}
  } else {
    const normalizedProvider = normalizeAIConnectionProvider(rawConnection.provider)
    const rawAuth = toObject(rawConnection.auth)
    rawAi.connection = {
      provider: normalizedProvider,
      model: toString(rawConnection.model),
      endpoint: toString(rawConnection.endpoint) || undefined,
      auth: {
        mode: normalizeAIAuthMode({ mode: rawAuth.mode, provider: normalizedProvider, rawProvider: rawConnection.provider, auth: rawAuth }),
        apiKey: toString(rawAuth.apiKey) || undefined,
        username: toString(rawAuth.username) || undefined,
        password: toString(rawAuth.password) || undefined,
        oauthAuthFilePath: toString(rawAuth.oauthAuthFilePath) || undefined,
        clientId: toString(rawAuth.clientId) || undefined,
      },
    }
  }

  root.ai = rawAi
  return root as Partial<NobieConfig>
}

function parseBooleanEnv(value: string | undefined): boolean | undefined {
  if (value == null) return undefined
  switch (value.trim().toLowerCase()) {
    case "1":
    case "true":
    case "yes":
    case "on":
      return true
    case "0":
    case "false":
    case "no":
    case "off":
      return false
    default:
      return undefined
  }
}

function parseIntegerEnv(value: string | undefined): number | undefined {
  if (value == null) return undefined
  const parsed = Number(value.trim())
  return Number.isInteger(parsed) ? parsed : undefined
}

function readEnvOverrides(): Partial<NobieConfig> {
  const mqttEnabled = parseBooleanEnv(process.env["NOBIE_MQTT_ENABLED"])
  const mqttHost = process.env["NOBIE_MQTT_HOST"]?.trim()
  const mqttPort = parseIntegerEnv(process.env["NOBIE_MQTT_PORT"])
  const mqttUsername = process.env["NOBIE_MQTT_USERNAME"]?.trim()
  const mqttPassword = process.env["NOBIE_MQTT_PASSWORD"]
  const mqttAllowAnonymous = parseBooleanEnv(process.env["NOBIE_MQTT_ALLOW_ANONYMOUS"])

  if (
    mqttEnabled == null &&
    !mqttHost &&
    mqttPort == null &&
    mqttUsername == null &&
    mqttPassword == null &&
    mqttAllowAnonymous == null
  ) {
    return {}
  }

  return {
    mqtt: {
      enabled: mqttEnabled ?? DEFAULT_CONFIG.mqtt.enabled,
      host: mqttHost || DEFAULT_CONFIG.mqtt.host,
      port: mqttPort ?? DEFAULT_CONFIG.mqtt.port,
      username: mqttUsername ?? DEFAULT_CONFIG.mqtt.username,
      password: mqttPassword ?? DEFAULT_CONFIG.mqtt.password,
      allowAnonymous: mqttAllowAnonymous ?? DEFAULT_CONFIG.mqtt.allowAnonymous,
    },
  }
}

/**
 * Parse a .env file and apply values to process.env.
 * - 값이 있는 키: 쉘 환경변수에 없을 때만 설정 (쉘 우선)
 * - 값이 빈 키 (KEY=): 쉘에서 온 값이라도 강제 삭제 — "이 키를 쓰지 않겠다"는 명시적 선언
 */
function loadDotEnv(filePath: string): void {
  if (!existsSync(filePath)) return
  const lines = readFileSync(filePath, "utf-8").split(/\r?\n/)
  for (const raw of lines) {
    const line = raw.trim()
    if (!line || line.startsWith("#")) continue
    const eqIdx = line.indexOf("=")
    if (eqIdx < 1) continue
    const key = line.slice(0, eqIdx).trim()
    let value = line.slice(eqIdx + 1).trim()
    // strip optional surrounding quotes
    if ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }
    if (!key) continue
    if (value === "") {
      // 빈 값으로 명시 → 쉘에서 상속된 값도 제거
      delete process.env[key]
    } else if (!(key in process.env)) {
      process.env[key] = value
    }
  }
}

/**
 * Load .env files. Priority:
 *  1. 쉘 환경변수 (비어있지 않은 값에 한해)
 *  2. cwd()/.env
 *  3. ~/.wizby/.env (legacy ~/.howie/.env fallback via PATHS)
 * .env에서 KEY= (빈 값)으로 설정하면 쉘 환경변수도 무효화됨
 */
export function loadEnv(): void {
  loadDotEnv(join(process.cwd(), ".env"))
  loadDotEnv(join(PATHS.stateDir, ".env"))
}

function substituteEnvVars(value: string): string {
  return value.replace(/\$\{([^}]+)\}/g, (_, name: string) => {
    return process.env[name] ?? ""
  })
}

function substituteDeep(obj: unknown): unknown {
  if (typeof obj === "string") return substituteEnvVars(obj)
  if (Array.isArray(obj)) return obj.map(substituteDeep)
  if (obj !== null && typeof obj === "object") {
    return Object.fromEntries(
      Object.entries(obj as Record<string, unknown>).map(([k, v]) => [k, substituteDeep(v)]),
    )
  }
  return obj
}

function deepMerge<T>(base: T, override: Partial<T>): T {
  if (override === null || typeof override !== "object" || Array.isArray(override)) {
    return override as T
  }
  const result = { ...base } as Record<string, unknown>
  for (const [key, value] of Object.entries(override as Record<string, unknown>)) {
    const baseVal = (base as Record<string, unknown>)[key]
    if (value !== null && typeof value === "object" && !Array.isArray(value) &&
        baseVal !== null && typeof baseVal === "object" && !Array.isArray(baseVal)) {
      result[key] = deepMerge(baseVal, value as Partial<typeof baseVal>)
    } else {
      result[key] = value
    }
  }
  return result as T
}

let _config: NobieConfig | null = null

export function loadConfig(): NobieConfig {
  loadEnv()
  const configPath = PATHS.configFile
  const envOverrides = readEnvOverrides()

  if (!existsSync(configPath)) {
    _config = deepMerge(DEFAULT_CONFIG, envOverrides)
    return _config
  }

  const raw = readFileSync(configPath, "utf-8")
  const parsed = JSON5.parse(raw) as Partial<NobieConfig>
  const normalized = normalizeLegacyAiConfig(parsed)
  const substituted = substituteDeep(normalized) as Partial<NobieConfig>
  _config = deepMerge(deepMerge(DEFAULT_CONFIG, substituted), envOverrides)
  return _config
}

export function getConfig(): NobieConfig {
  if (!_config) return loadConfig()
  return _config
}

export function reloadConfig(): NobieConfig {
  _config = null
  return loadConfig()
}

export { PATHS } from "./paths.js"
export {
  MIGRATION_ROLLBACK_RUNBOOK,
  buildBackupTargetInventory,
  buildMigrationPreflightReport,
  createBackupSnapshot,
  formatInventoryPathForDisplay,
  runRestoreRehearsal,
  verifyBackupSnapshotManifest,
} from "./backup-rehearsal.js"
export type { NobieConfig, WizbyConfig, HowieConfig, SecurityConfig, TelegramConfig, MqttConfig, OrchestrationConfig, McpConfig, McpServerConfig } from "./types.js"
export type {
  BackupInventoryTarget,
  BackupSnapshotFile,
  BackupSnapshotManifest,
  BackupSnapshotOptions,
  BackupTargetInventory,
  BackupTargetKind,
  BackupTargetReason,
  MigrationPreflightCheck,
  MigrationPreflightCheckName,
  MigrationPreflightOptions,
  MigrationPreflightReport,
  MigrationPreflightRisk,
  MigrationRollbackRunbook,
  RestoreRehearsalCheck,
  RestoreRehearsalCheckName,
  RestoreRehearsalOptions,
  RestoreRehearsalReport,
  SnapshotVerificationResult,
} from "./backup-rehearsal.js"
