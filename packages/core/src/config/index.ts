import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import JSON5 from "json5"
import { DEFAULT_CONFIG, type NobieConfig } from "./types.js"
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

function inferConnectionFromLegacyConfig(rawAi: Record<string, unknown>): Record<string, unknown> | undefined {
  const rawAiProviders = toObject(rawAi.providers)
  const rawAiBackends = toObject(rawAi.backends)
  const configuredProvider = toString(rawAi.defaultProvider)
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
    const openai = toObject(rawAiProviders.openai)
    const auth = toObject(openai.auth)
    return buildConnection("openai", configuredModel, {
      endpoint: toString(openai.baseUrl) || undefined,
      auth: {
        mode: toString(auth.mode) || "api_key",
        apiKey: toStringArray(openai.apiKeys)[0] || undefined,
        oauthAuthFilePath: toString(auth.codexAuthFilePath) || undefined,
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

  const openai = toObject(rawAiBackends.openai)
  if (openai.enabled === true && (toString(openai.providerType) === "openai" || toString(openai.authMode) === "chatgpt_oauth")) {
    return buildConnection("openai", toString(openai.defaultModel), {
      endpoint: toString(openai.endpoint) || undefined,
      auth: {
        mode: toString(openai.authMode) || "api_key",
        apiKey: toString(toObject(openai.credentials).apiKey) || undefined,
        oauthAuthFilePath: toString(toObject(openai.credentials).oauthAuthFilePath) || undefined,
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

  return undefined
}

function normalizeLegacyAiConfig(parsed: Partial<NobieConfig>): Partial<NobieConfig> {
  const root = toObject(parsed)
  const rawAi = toObject(root.ai)
  const rawConnection = toObject(rawAi.connection)

  if (!toString(rawConnection.provider)) {
    rawAi.connection = inferConnectionFromLegacyConfig(rawAi) ?? {}
  } else {
    rawAi.connection = {
      provider: toString(rawConnection.provider),
      model: toString(rawConnection.model),
      endpoint: toString(rawConnection.endpoint) || undefined,
      auth: {
        mode: toString(toObject(rawConnection.auth).mode) || "api_key",
        apiKey: toString(toObject(rawConnection.auth).apiKey) || undefined,
        username: toString(toObject(rawConnection.auth).username) || undefined,
        password: toString(toObject(rawConnection.auth).password) || undefined,
        oauthAuthFilePath: toString(toObject(rawConnection.auth).oauthAuthFilePath) || undefined,
        clientId: toString(toObject(rawConnection.auth).clientId) || undefined,
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
export type { NobieConfig, WizbyConfig, HowieConfig, SecurityConfig, TelegramConfig, MqttConfig, OrchestrationConfig, McpConfig, McpServerConfig } from "./types.js"
