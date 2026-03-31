import type { FeatureCapability } from "../../contracts/capabilities"
import type { AIAuthMode, AIBackendCredentials, AIProviderType } from "../../contracts/ai"
import type { McpServersResponse } from "../../contracts/mcp"
import type { SetupDraft, SetupMcpServerDraft, SetupState } from "../../contracts/setup"

export interface StatusResponse {
  version: string
  provider: string
  model: string
  uptime: number
  toolCount: number
  setupCompleted: boolean
  capabilityCounts: {
    ready: number
    disabled: number
    planned: number
    error: number
  }
  primaryAiTarget: string | null
  orchestratorStatus: {
    status: "ready" | "disabled" | "planned" | "error"
    reason: string | null
  }
  mcp: {
    serverCount: number
    readyCount: number
    toolCount: number
    requiredFailures: number
  }
  mqtt: {
    enabled: boolean
    running: boolean
    host: string
    port: number
    url: string
    clientCount: number
    authEnabled: boolean
    allowAnonymous: boolean
    reason: string | null
  }
  paths: {
    stateDir: string
    configFile: string
    dbFile: string
    setupStateFile: string
  }
  webui: {
    port: number
    host: string
    authEnabled: boolean
  }
  update: {
    status: "idle" | "latest" | "update_available" | "unsupported" | "error"
    latestVersion: string | null
    checkedAt: number | null
    updateAvailable: boolean
  }
}

export interface SetupChecksResponse {
  stateDir: string
  configFile: string
  setupStateFile: string
  setupCompleted: boolean
  telegramConfigured: boolean
  authEnabled: boolean
  schedulerEnabled: boolean
}

export interface TestBackendResponse {
  ok: boolean
  models?: string[]
  sourceUrl?: string
  error?: string
}

export interface MqttExtensionSnapshot {
  extensionId: string
  clientId: string | null
  displayName: string | null
  state: string | null
  message: string | null
  version: string | null
  methods: string[]
  lastSeenAt: number
}

export interface MqttExchangeLogEntry {
  id: string
  timestamp: number
  direction: "nobie_to_extension" | "extension_to_nobie"
  topic: string
  extensionId: string | null
  kind: "status" | "capabilities" | "request" | "response" | "event" | "unknown"
  clientId: string | null
  payload: unknown
}

export interface MqttRuntimeResponse {
  extensions: MqttExtensionSnapshot[]
  logs: MqttExchangeLogEntry[]
}

export interface TestTelegramResponse {
  ok: boolean
  message: string
}

export interface TestMcpServerResponse {
  ok: boolean
  message: string
  tools: string[]
}

export interface TestSkillPathResponse {
  ok: boolean
  message: string
  resolvedPath?: string
}

export interface ResetSetupResponse {
  draft: SetupDraft
  state: SetupState
  checks: SetupChecksResponse
}

export interface ControlPlaneAdapter {
  readonly name: "local"
  getStatus: () => Promise<StatusResponse>
  getCapabilities: () => Promise<{ items: FeatureCapability[]; generatedAt: number }>
  getCapability: (key: string) => Promise<FeatureCapability>
  getSetupStatus: () => Promise<SetupState>
  getSetupChecks: () => Promise<SetupChecksResponse>
  getSetupDraft: () => Promise<SetupDraft>
  saveSetupDraft: (payload: { draft: SetupDraft; state?: SetupState }) => Promise<{ draft: SetupDraft; state: SetupState }>
  resetSetup: () => Promise<ResetSetupResponse>
  completeSetup: () => Promise<SetupState>
  testBackend: (endpoint: string, providerType: AIProviderType, credentials: AIBackendCredentials, authMode?: AIAuthMode) => Promise<TestBackendResponse>
  testTelegram: (botToken: string) => Promise<TestTelegramResponse>
  testMcpServer: (server: SetupMcpServerDraft) => Promise<TestMcpServerResponse>
  testSkillPath: (path: string) => Promise<TestSkillPathResponse>
  generateAuthToken: () => Promise<{ token: string }>
  getMcpServers: () => Promise<McpServersResponse>
  reloadMcpServers: () => Promise<McpServersResponse>
  getMqttRuntime: () => Promise<MqttRuntimeResponse>
  disconnectMqttExtension: (extensionId: string) => Promise<{ ok: boolean; message: string }>
}
