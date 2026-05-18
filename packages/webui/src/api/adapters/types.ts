import type { FeatureCapability } from "../../contracts/capabilities"
import type { AIAuthMode, AIBackendCredentials, AIProviderType, ProviderCapabilityMatrix } from "../../contracts/ai"
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
    mode?: "single_nobie" | "orchestration"
    reasonCode?: string
    activeSubAgentCount?: number
  }
  orchestration?: {
    mode: "single_nobie" | "orchestration"
    status: "ready" | "disabled" | "degraded"
    featureFlagEnabled: boolean
    requestedMode: "single_nobie" | "orchestration"
    activeSubAgentCount: number
    totalSubAgentCount: number
    disabledSubAgentCount: number
    activeSubAgents: Array<{
      agentId: string
      displayName: string
      nickname?: string
      source: "topology" | "db" | "config"
      topologyId?: string
      executorId?: string
    }>
    reasonCode: string
    reason: string
    generatedAt: number
  }
  startupRecovery: {
    createdAt: number
    totalActiveRuns: number
    recoveredRunCount: number
    interruptedRunCount: number
    awaitingApprovalCount: number
    pendingDeliveryCount: number
    deliveredCount: number
    staleCount: number
    interruptedScheduleRunCount: number
    userFacingSummary: string
  }
  fast_response_health: {
    generatedAt: number
    status: "ok" | "slow" | "timeout"
    reason: string
    recentWindowMs: number
    metrics: Array<{
      name: string
      count: number
      p95Ms: number | null
      lastMs: number | null
      budgetMs: number
      timeoutCount: number
      slowCount: number
      status: "ok" | "slow" | "timeout"
      lastAt: number | null
    }>
    recentTimeouts: Array<{
      id: string
      name: string
      durationMs: number
      budgetMs: number
      status: "ok" | "slow" | "timeout"
      createdAt: number
      runId?: string
      sessionId?: string
      requestGroupId?: string
      source?: string
      detail?: Record<string, unknown>
    }>
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
  capabilityMatrix?: ProviderCapabilityMatrix
  error?: string
}

export interface MqttExtensionSnapshot {
  extensionId: string
  clientId: string | null
  displayName: string | null
  instanceId?: string | null
  instanceAlias?: string | null
  state: string | null
  message: string | null
  version: string | null
  protocolVersion?: string | null
  gitTag?: string | null
  gitCommit?: string | null
  buildTarget?: string | null
  platform?: string | null
  os?: string | null
  arch?: string | null
  transport?: string[]
  capabilityHash?: string | null
  methods: string[]
  methodCount?: number
  permissions?: Record<string, unknown>
  toolHealth?: Record<string, unknown>
  capabilityMatrix?: Record<string, unknown>
  lastCapabilityRefreshAt?: number | null
  sessionId?: string | null
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

export type YeonjangSupportProfile =
  | "desktop_interactive"
  | "desktop_limited"
  | "headless_managed"

export type YeonjangInstanceLocation = "local" | "remote"
export type YeonjangTrustState = "trusted" | "pending" | "revoked" | "quarantined" | "unknown"
export type YeonjangScopeAccess = "allowed" | "foreign" | "unassigned"
export type YeonjangDefaultTargetUiAction = "none" | "ask_user" | "ui_selection"
export type YeonjangRegistryState =
  | "online"
  | "offline"
  | "degraded"
  | "permission_required"
  | "update_required"
  | "discovered"

export interface YeonjangInstanceSessionView {
  sessionId: string
  clientId: string | null
  startupMode: string | null
  windowMode: string | null
  trayState: string | null
  state: string
  message: string | null
  startedAt: number
  lastSeenAt: number
  endedAt: number | null
  stale: boolean
}

export interface YeonjangProjectedInstance {
  instanceId: string
  instanceAlias: string
  displayName: string
  normalizedCallName: string
  nodeId: string
  supportProfile: YeonjangSupportProfile
  platform: string | null
  arch: string | null
  version: string | null
  protocolVersion: string | null
  capabilityHash: string | null
  methodCount: number
  state: YeonjangRegistryState
  stateMessage: string | null
  lastSeenAt: number
  liveSessionCount: number
  duplicateLiveSessionDetected: boolean
  isLocalCandidate: boolean
  localMarker: boolean
  ownerUserId: string | null
  workspaceScopeId: string | null
  scopeAccess: YeonjangScopeAccess
  hostFingerprintPreview: string | null
  installFingerprintPreview: string | null
  pairingFingerprintPreview?: string | null
  transport: string[]
  session: YeonjangInstanceSessionView | null
  location: YeonjangInstanceLocation
  localityConfidence: "high" | "medium" | "low"
  localityReasonCodes: string[]
  trustState: YeonjangTrustState
  trustReason?: string | null
  runnableTarget?: boolean
  runnableReasonCodes?: string[]
  interactiveDesktop: boolean
  trayWindowExpected: boolean
  buildTarget: string | null
  supportedMethods: string[]
  connectivityLatencyMs: number | null
  lastHeartbeatAgeMs: number | null
  defaultTargetEligible: boolean
  defaultTargetReasonCodes: string[]
}

export interface YeonjangDiffField<T> {
  local: T
  remote: T
  different: boolean
}

export interface YeonjangLocalRemoteDiffSummary {
  localInstanceId: string
  localNodeId: string
  remoteInstanceId: string
  remoteNodeId: string
  reasonCodes: string[]
  version: YeonjangDiffField<string | null>
  protocolVersion: YeonjangDiffField<string | null>
  permissionState: YeonjangDiffField<string>
  buildTarget: YeonjangDiffField<string | null>
  platform: YeonjangDiffField<string | null>
  connectivityLatencyMs: YeonjangDiffField<number | null>
  lastHeartbeatAgeMs: YeonjangDiffField<number | null>
  supportedMethods: {
    localOnly: string[]
    remoteOnly: string[]
  }
  updateRequired: boolean
  permissionMismatch: boolean
}

export interface YeonjangDefaultTargetSelection {
  ok: boolean
  status:
    | "auto_selected_local_interactive"
    | "auto_selected_pinned_remote"
    | "selection_required"
    | "ambiguous_state"
  reasonCodes: string[]
  uiAction: YeonjangDefaultTargetUiAction
  extensionId?: string
  instanceId?: string
  targetSessionId?: string | null
}

export interface YeonjangPromptTargetCandidate {
  instanceId: string
  nodeId: string
  instanceAlias: string
  displayName: string
  normalizedCallName: string
  location: YeonjangInstanceLocation
  supportProfile: YeonjangSupportProfile
  trustState: YeonjangTrustState
  scopeAccess: YeonjangScopeAccess
  state: YeonjangRegistryState
  defaultTargetEligible: boolean
}

export interface YeonjangGovernanceEvent {
  id: string
  at: number
  action: string
  result: string
  actor: string | null
  instanceId: string | null
  instanceAlias: string | null
  displayName: string | null
  workspaceScopeId: string | null
  trustState: string | null
  reason: string | null
}

export interface YeonjangFleetResponse {
  ok: boolean
  summary: {
    totalInstances: number
    online: number
    offline: number
    degraded: number
    permissionRequired: number
    updateRequired: number
    discovered: number
    duplicateLiveSessionInstances: number
    localCandidates: number
    localInstances: number
    remoteInstances: number
    trusted: number
    pending: number
    revoked: number
    quarantined: number
    foreignInstances: number
    unassignedScopeInstances: number
    activeWorkspaceScopeId: string
    localMarkerInstanceId: string | null
    supportProfiles: {
      desktopInteractive: number
      desktopLimited: number
      headlessManaged: number
    }
    duplicateLocalDetected: boolean
    defaultTarget: YeonjangDefaultTargetSelection
  }
  instances: YeonjangProjectedInstance[]
  diffSummaries: YeonjangLocalRemoteDiffSummary[]
  defaultTarget: YeonjangDefaultTargetSelection
  promptProjection: {
    registrySummary: YeonjangFleetResponse["summary"]
    exactTargetCandidates: YeonjangPromptTargetCandidate[]
    defaultTarget: YeonjangDefaultTargetSelection
    localRemoteDiffs: YeonjangLocalRemoteDiffSummary[]
  }
  governanceHistory: YeonjangGovernanceEvent[]
  broadcastPolicies: {
    summary: {
      broadcastSafeTools: number
      blockedTools: number
      approvalRequiredTools: number
    }
  }
}

export interface TestTelegramResponse {
  ok: boolean
  message: string
}

export interface TestSlackResponse {
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
  getCapabilities: () => Promise<{ items: FeatureCapability[]; generatedAt: number; orchestration?: StatusResponse["orchestration"] }>
  getCapability: (key: string) => Promise<FeatureCapability>
  getSetupStatus: () => Promise<SetupState>
  getSetupChecks: () => Promise<SetupChecksResponse>
  getSetupDraft: () => Promise<SetupDraft>
  saveSetupDraft: (payload: { draft: SetupDraft; state?: SetupState }) => Promise<{ draft: SetupDraft; state: SetupState }>
  resetSetup: () => Promise<ResetSetupResponse>
  completeSetup: () => Promise<SetupState>
  testBackend: (endpoint: string, providerType: AIProviderType, credentials: AIBackendCredentials, authMode?: AIAuthMode) => Promise<TestBackendResponse>
  testTelegram: (botToken: string) => Promise<TestTelegramResponse>
  testSlack: (botToken: string, appToken: string) => Promise<TestSlackResponse>
  testMcpServer: (server: SetupMcpServerDraft) => Promise<TestMcpServerResponse>
  testSkillPath: (path: string) => Promise<TestSkillPathResponse>
  generateAuthToken: () => Promise<{ token: string }>
  getMcpServers: () => Promise<McpServersResponse>
  reloadMcpServers: () => Promise<McpServersResponse>
  getMqttRuntime: () => Promise<MqttRuntimeResponse>
  getYeonjangFleet: () => Promise<YeonjangFleetResponse>
  approveYeonjangPairing: (instanceId: string, payload: { pairingSecret: string; actor?: string; ownerUserId?: string; workspaceScopeId?: string; reason?: string }) => Promise<YeonjangFleetResponse>
  updateYeonjangTrust: (instanceId: string, payload: { trustState: "pending" | "trusted" | "revoked" | "quarantined"; actor?: string; reason?: string }) => Promise<YeonjangFleetResponse>
  renameYeonjangInstance: (instanceId: string, payload: { instanceAlias?: string; displayName?: string; actor?: string; reason?: string }) => Promise<YeonjangFleetResponse>
  assignYeonjangLocalMarker: (instanceId: string, payload: { actor?: string; reason?: string }) => Promise<YeonjangFleetResponse>
  disconnectMqttExtension: (extensionId: string) => Promise<{ ok: boolean; message: string }>
}
