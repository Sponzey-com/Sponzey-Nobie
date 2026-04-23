import { localAdapter } from "./adapters/local"
import type { ControlPlaneAdapter, MqttRuntimeResponse, ResetSetupResponse, SetupChecksResponse, StatusResponse, TestBackendResponse, TestMcpServerResponse, TestSkillPathResponse, TestTelegramResponse } from "./adapters/types"
import type { AIAuthMode, AIBackendCredentials, AIProviderType } from "../contracts/ai"
import type { FeatureCapability } from "../contracts/capabilities"
import type { ConfigExportResult, ConfigurationOperationsSnapshot, DatabaseBackupResult, MigrationDryRunResult, PromptSourceExportResult, PromptSourceImportResult } from "../contracts/config-operations"
import type { DoctorMode, DoctorResponse } from "../contracts/doctor"
import type { ActiveInstructionsResponse } from "../contracts/instructions"
import type { OperationsSummary, StaleRunCleanupResult } from "../contracts/operations"
import type { RootRun, RunEvent, RunStep } from "../contracts/runs"
import type { SetupDraft, SetupMcpServerDraft, SetupState } from "../contracts/setup"
import type { TaskModel } from "../contracts/tasks"
import type { UpdateSnapshot } from "../contracts/update"

const BASE = ""
const UI_MODE_FALLBACK_KEY = "nobie_preferred_ui_mode"

export type UiMode = "beginner" | "advanced" | "admin"
export type PreferredUiMode = "beginner" | "advanced"

export interface UiModeState {
  mode: UiMode
  preferredUiMode: PreferredUiMode
  availableModes: UiMode[]
  adminEnabled: boolean
  canSwitchInUi: boolean
  schemaVersion: 1
}

export type UiModeSaveResponse = UiModeState & { ok: boolean; fallback?: "browser" }

export interface UiShellResponse {
  generatedAt: number
  mode: UiModeState
  setupState: {
    completed: boolean
  }
  runtimeHealth: {
    ai: {
      configured: boolean
      provider: string | null
      modelConfigured: boolean
    }
    channels: {
      webui: boolean
      telegramConfigured: boolean
      telegramEnabled: boolean
      slackConfigured: boolean
      slackEnabled: boolean
    }
    yeonjang: {
      mqttEnabled: boolean
      connectedExtensions: number
    }
  }
  activeRuns: {
    total: number
    pendingApprovals: number
  }
  viewModel: UiShellViewModels
}

export interface AdminShellResponse {
  ok: boolean
  shell: {
    kind: "admin_shell"
    title: string
    warning: string
    badges: Array<{ label: string; tone: string }>
    dangerousActions: Array<{
      id: "retry" | "purge" | "replay" | "export"
      label: string
      description: string
      requiredConfirmation: string
      auditRequired: boolean
    }>
    subscriptions: { webSocketClients: number }
    auditRequired: boolean
  }
  mode: UiModeState
  manifest: { adminUi: { enabled: boolean; subscriptionCount: number; reason: string } }
}

export interface AdminDangerousActionResponse {
  ok: boolean
  action?: "retry" | "purge" | "replay" | "export"
  targetId?: string | null
  status?: "needs_confirmation" | "accepted"
  requiredConfirmation?: string
  error?: string
  summary?: string
}

export interface AdminLiveQuery {
  runId?: string
  requestGroupId?: string
  sessionKey?: string
  component?: string
  severity?: "debug" | "info" | "warning" | "error"
  channel?: string
  eventKind?: string
  status?: string
  deliveryKey?: string
  idempotencyKey?: string
  limit?: number
}

export interface AdminLiveResponse {
  ok: boolean
  generatedAt: number
  filters: Record<string, string | number | null>
  stream: {
    status: "connected" | "waiting_for_subscriber" | "backpressure"
    subscriptionCount: number
    reconnect: {
      supported: boolean
      strategy: string
      eventType: string
    }
    backpressure: {
      status: "ok" | "waiting" | "recovering" | "stopped"
      totalQueues: number
      affectedQueues: number
      queues: Array<{
        queueName: string
        running: number
        pending: number
        oldestPendingAgeMs: number
        retryKeys: number
        deadLetterCount: number
        status: "ok" | "waiting" | "recovering" | "stopped"
      }>
    }
  }
  timeline: {
    events: Array<{
      id: string
      at: number
      eventType: string
      correlationId: string
      runId: string | null
      requestGroupId: string | null
      sessionKey: string | null
      component: string
      severity: "debug" | "info" | "warning" | "error"
      summary: string
      detail: unknown
    }>
    summary: {
      total: number
      severityCounts: Record<"debug" | "info" | "warning" | "error", number>
      duplicateToolCount: number
      duplicateAnswerCount: number
      deliveryRetryCount: number
      recoveryReentryCount: number
    }
  }
  runsInspector: {
    runs: Array<{
      id: string
      requestGroupId: string
      sessionKey: string
      source: string
      title: string
      status: string
      createdAt: number
      updatedAt: number
      failureReversal: boolean
      lifecycle: Array<{
        key: string
        label: string
        status: "pending" | "running" | "completed" | "warning" | "failed"
        startedAt: number | null
        finishedAt: number | null
        durationMs: number | null
        eventCount: number
        ledgerCount: number
        summary: string | null
        failureReason: string | null
      }>
      delivery: {
        status: string
        summary: string | null
        failureReason: string | null
        eventCount: number
      }
      recovery: {
        eventCount: number
        lastSummary: string | null
      }
    }>
  }
  messageLedger: {
    events: Array<{
      id: string
      runId: string | null
      requestGroupId: string | null
      sessionKey: string | null
      threadKey: string | null
      channel: string
      eventKind: string
      deliveryKey: string | null
      idempotencyKey: string | null
      status: string
      summary: string
      channelTarget: string | null
      detail: unknown
      createdAt: number
    }>
    duplicates: Array<{
      key: string
      kind: "delivery" | "idempotency"
      count: number
      firstAt: number
      lastAt: number
      statuses: string[]
    }>
    summary: {
      total: number
      delivered: number
      deliveryFailures: number
      suppressed: number
      duplicates: number
      statusCounts: Record<string, number>
    }
  }
}

export interface AdminToolLabResponse {
  ok: boolean
  generatedAt: number
  filters: Record<string, string | number | null>
  toolCalls: {
    summary: {
      total: number
      failed: number
      waitingApproval: number
      redacted: number
    }
    calls: Array<{
      id: string
      toolName: string
      status: string
      approvalState: string
      runId: string | null
      requestGroupId: string | null
      sessionKey: string | null
      startedAt: number | null
      finishedAt: number | null
      durationMs: number | null
      retryCount: number
      eventCount: number
      paramsRedacted: unknown
      outputRedacted: unknown
      redactionApplied: boolean
      resultSummary: string | null
      lifecycle: Array<{ at: number; source: string; eventKind: string; status: string; summary: string }>
    }>
  }
  webRetrieval: {
    summary: {
      sessions: number
      attempts: number
      degraded: number
      answerable: number
    }
    sessions: Array<{
      id: string
      requestGroupId: string | null
      runId: string | null
      sessionKey: string | null
      target: unknown
      sourceLadder: Array<{ method: string; url: string; sourceDomain: string; sourceKind: string; reliability: string; sourceLabel: string; expectedTargetBinding: string }>
      queryVariants: string[]
      fetchAttempts: Array<{
        id: string
        toolName: string
        status: string
        method: string
        sourceKind: string
        reliability: string
        freshnessPolicy: string
        sourceUrl: string | null
        sourceDomain: string | null
        fetchTimestamp: string | null
        sourceTimestamp: string | null
        durationMs: number | null
        retryCount: number
      }>
      candidateExtraction: { eventCount: number; candidateCount: number; lastSummary: string | null }
      verification: {
        canAnswer: boolean | null
        evidenceSufficiency: string | null
        acceptedValue: string | null
        rejectionReason: string | null
        mustAvoidGuessing: boolean | null
        policy: string | null
        completionStrict: boolean
        semanticComparisonAllowed: boolean
        verificationMode: string
      }
      conflictResolver: { status: string | null; conflicts: string[] }
      cache: { status: string; entryCount: number; entries: Array<{ status: string; reason: string; value: string | null; unit: string | null; sourceDomain: string | null }> }
      adapterMetadata: Array<{ adapterId: string; adapterVersion: string; parserVersion: string; checksum: string; status: string; degradedReason?: string | null }>
      degradedState: { degraded: boolean; reasons: string[] }
      policySeparation: { discovery: string; completion: string; semanticComparisonAllowed: boolean }
    }>
  }
}

export interface AdminFixtureReplayResponse {
  ok: boolean
  generatedAt: number
  networkUsed: boolean
  semanticComparisonAllowed: boolean
  verificationMode: string
  fixtureCount: number
  summary: { kind: string; policyVersion: string; status: string; counts: { total: number; passed: number; failed: number; skipped: number } }
  results: Array<{
    fixtureId: string
    title: string
    status: string
    attempts: number
    candidateCount: number
    canAnswer: boolean
    acceptedValue: string | null
    evidenceSufficiency: string
    failures: string[]
  }>
}

export interface AdminRuntimeInspectorsResponse {
  ok: boolean
  generatedAt: number
  filters: Record<string, string | number | null>
  memory: {
    summary: {
      documents: number
      userDocuments: number
      diagnosticDocuments: number
      writebackPending: number
      writebackFailed: number
      retrievalTraces: number
      linkedFailures: number
    }
    documents: {
      items: Array<{
        id: string
        scope: string
        ownerId: string
        ownerKind: "user" | "diagnostic"
        sourceType: string
        sourceRef: string | null
        title: string | null
        chunkCount: number
        ftsCount: number
        embeddingCount: number
        ftsStatus: string
        vectorStatus: string
        indexStatus: string | null
        indexRetryCount: number
        indexLastError: string | null
        runId: string | null
        requestGroupId: string | null
        updatedAt: number
      }>
      degradedReasons: string[]
    }
    writebackQueue: {
      items: Array<{
        id: string
        scope: string
        ownerId: string
        ownerKind: "user" | "diagnostic"
        sourceType: string
        status: string
        retryCount: number
        lastError: string | null
        runId: string | null
        requestGroupId: string | null
        contentPreview: string
        updatedAt: number
      }>
      degradedReasons: string[]
    }
    retrievalTrace: {
      items: Array<{
        id: string
        runId: string | null
        requestGroupId: string | null
        sessionKey: string | null
        documentId: string | null
        chunkId: string | null
        scope: string | null
        resultSource: string
        score: number | null
        latencyMs: number | null
        reason: string | null
        queryPreview: string
        createdAt: number
      }>
      degradedReasons: string[]
    }
    linkedFailures: Array<{ at: number; source: string; component: string; summary: string; runId: string | null; requestGroupId: string | null }>
  }
  scheduler: {
    summary: { schedules: number; enabled: number; missed: number; retrying: number; receipts: number }
    schedules: Array<{
      id: string
      name: string
      enabled: boolean
      cronExpression: string
      timezone: string | null
      targetChannel: string
      targetSessionId: string | null
      executionDriver: string
      nextRunAt: number | null
      lastRunAt: number | null
      queueState: string
      contract: {
        hasContract: boolean
        schemaVersion: number | null
        identityKey: string | null
        payloadHash: string | null
        deliveryKey: string | null
        payloadKind: string | null
        deliveryChannel: string | null
        missedPolicy: string | null
        timeKind: string
      }
      latestRun: {
        id: string
        startedAt: number
        finishedAt: number | null
        success: boolean | null
        executionSuccess: boolean | null
        deliverySuccess: boolean | null
        deliveryDedupeKey: string | null
        error: string | null
      } | null
      receipts: Array<{ dedupeKey: string; runId: string; dueAt: string; targetChannel: string; status: string; summary: string | null; error: string | null; updatedAt: number }>
    }>
    timelineLinks: Array<{ at: number; eventType: string; component: string; summary: string; runId: string | null; requestGroupId: string | null }>
    fieldChecks: { comparisonMode: string; naturalLanguageMatchingAllowed: boolean; requiredKeys: string[] }
    degradedReasons: string[]
  }
  channels: {
    summary: { channels: number; inbound: number; outbound: number; approvals: number; receipts: number }
    mappings: Array<{
      channel: string
      inboundCount: number
      outboundCount: number
      approvalCount: number
      receiptCount: number
      latestAt: number | null
      refs: Array<{ id: string; sessionKey: string; rootRunId: string; requestGroupId: string; chatId: string; threadId: string | null; messageId: string; role: string; createdAt: number }>
    }>
    ledgerReceipts: Array<{
      id: string
      channel: string
      eventKind: string
      status: string
      summary: string
      deliveryKey: string | null
      idempotencyKey: string | null
      runId: string | null
      requestGroupId: string | null
      sessionKey: string | null
      threadKey: string | null
      chatId: string | null
      threadId: string | null
      userId: string | null
      messageId: string | null
      createdAt: number
    }>
    approvalCallbacks: Array<{
      id: string
      channel: string
      eventKind: string
      status: string
      summary: string
      runId: string | null
      requestGroupId: string | null
      approvalId: string | null
      callbackId: string | null
      buttonPayload: string | null
      userId: string | null
      chatId: string | null
      createdAt: number
    }>
    degradedReasons: string[]
  }
}

export interface AdminDiagnosticExportJob {
  id: string
  status: "queued" | "running" | "succeeded" | "failed"
  progress: number
  createdAt: number
  updatedAt: number
  filters: { runId?: string; requestGroupId?: string; sessionKey?: string; channel?: string }
  includeTimeline: boolean
  includeReport: boolean
  bundlePath: string | null
  bundleFile: string | null
  bundleBytes: number | null
  error: string | null
}

export interface AdminPlatformInspectorsResponse {
  ok: boolean
  generatedAt: number
  filters: Record<string, string | number | null>
  yeonjang: {
    summary: {
      brokerRunning: boolean
      enabled: boolean
      connectedClients: number
      nodes: number
      onlineNodes: number
      heartbeats: number
      reconnectAttempts: number
      disconnects: number
    }
    broker: {
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
    nodes: Array<{
      extensionId: string
      clientId: string | null
      displayName: string | null
      state: string | null
      message: string | null
      version: string | null
      protocolVersion: string | null
      capabilityHash: string | null
      methodCount: number
      platform: string | null
      transport: string[]
      lastSeenAt: number | null
      stale: boolean
      heartbeatCount: number
      reconnectAttempts: number
      capabilities: string[]
    }>
    timelineLinks: Array<{ at: number; eventType: string; component: string; summary: string; extensionId: string | null; state: string | null; reconnectAttempts: number | null }>
    exchangeLog: Array<{ id: string; timestamp: number; direction: string; topic: string; extensionId: string | null; kind: string; clientId: string | null; payloadPreview: unknown }>
    degradedReasons: string[]
  }
  database: {
    summary: {
      currentVersion: number
      latestVersion: number
      pendingMigrations: number
      unknownAppliedVersions: number
      migrationLockActive: boolean
      integrityOk: boolean
      backupSnapshots: number
      migrationDiagnostics: number
    }
    migrations: {
      databasePath: string
      exists: boolean
      currentVersion: number
      latestVersion: number
      appliedVersions: number[]
      pendingVersions: number[]
      unknownAppliedVersions: number[]
      upToDate: boolean
    }
    lock: {
      active: unknown | null
      latest: unknown | null
    }
    integrity: { ok: boolean; schemaVersion: number; integrityCheck: string; missingTables: string[]; missingIndexes: string[] } | null
    backups: { snapshots: Array<{ id: string; createdAt: number; schemaVersion: number | null; latestSchemaVersion: number | null; fileCount: number; manifestFile: string }>; degradedReasons: string[] }
    diagnostics: Array<{ id: string; kind: string; summary: string; runId: string | null; requestGroupId: string | null; createdAt: number; detail: unknown }>
    degradedReasons: string[]
  }
  exports: {
    jobs: AdminDiagnosticExportJob[]
    defaults: { outputDirName: string; sanitized: boolean; backgroundJob: boolean }
  }
}

export interface AdminDiagnosticExportStartResponse {
  ok: boolean
  job: AdminDiagnosticExportJob
}

export interface AdminDiagnosticExportListResponse {
  ok: boolean
  generatedAt: number
  jobs: AdminDiagnosticExportJob[]
}

export interface AdminDiagnosticExportGetResponse {
  ok: boolean
  job: AdminDiagnosticExportJob
}

function buildAdminLiveQuery(params: Record<string, unknown> = {}): string {
  const search = new URLSearchParams()
  Object.entries(params).forEach(([key, value]) => {
    if (value === undefined || value === null || value === "") return
    search.set(key, String(value))
  })
  const query = search.toString()
  return query ? `?${query}` : ""
}

export type UiComponentStatus = "ready" | "needs_setup" | "needs_attention" | "warning" | "idle"
export type UiComponentKey = "setup" | "ai" | "channels" | "yeonjang" | "tasks"

export interface BeginnerUiViewModel {
  kind: "beginner"
  summary: string
  statusLabel: string
  primaryAction: { id: string; label: string; href: string } | null
  needsAttention: boolean
  safeDetails: Array<{ component: string; statusLabel: string; summary: string }>
}

export interface AdvancedUiViewModel {
  kind: "advanced"
  components: Array<{
    key: UiComponentKey
    component: string
    status: UiComponentStatus
    statusLabel: string
    lastCheckedAt: number
    configSummary: Record<string, unknown>
    warnings: string[]
    actions: Array<{ id: string; label: string; href: string }>
  }>
}

export interface AdminUiViewModel {
  kind: "admin"
  ids: Record<string, string | number | boolean>
  timestamps: Record<string, number>
  events: Array<{ component: string; status: UiComponentStatus; needsAttention: boolean }>
  metrics: Record<string, number>
  relationships: Array<{ from: string; to: string; relation: string }>
  sanitizedRaw: unknown
}

export type UiModeViewModel = BeginnerUiViewModel | AdvancedUiViewModel | AdminUiViewModel

export interface UiShellViewModels {
  currentMode: UiMode
  current: UiModeViewModel
  beginner: BeginnerUiViewModel
  advanced: AdvancedUiViewModel
  admin?: AdminUiViewModel
}

function normalizePreferredUiMode(value: unknown): PreferredUiMode | null {
  if (value !== "beginner" && value !== "advanced") return null
  return value
}

function getBrowserPreferredUiModeFallback(): PreferredUiMode {
  return normalizePreferredUiMode(localStorage.getItem(UI_MODE_FALLBACK_KEY)) ?? "beginner"
}

function setBrowserPreferredUiModeFallback(mode: PreferredUiMode): void {
  localStorage.setItem(UI_MODE_FALLBACK_KEY, mode)
}

function buildBrowserUiModeFallback(mode = getBrowserPreferredUiModeFallback()): UiModeState {
  return {
    mode,
    preferredUiMode: mode,
    availableModes: ["beginner", "advanced"],
    adminEnabled: false,
    canSwitchInUi: true,
    schemaVersion: 1,
  }
}

export function getStoredToken(): string {
  return localStorage.getItem("nobie_token") ?? localStorage.getItem("wizby_token") ?? localStorage.getItem("howie_token") ?? ""
}

export function clearStoredToken(): void {
  localStorage.removeItem("nobie_token")
  localStorage.removeItem("wizby_token")
  localStorage.removeItem("howie_token")
}

function authHeaders(): Record<string, string> {
  const token = getStoredToken()
  return token ? { Authorization: `Bearer ${token}` } : {}
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const hasBody = init?.body !== undefined
  const res = await fetch(`${BASE}${path}`, {
    headers: { ...(hasBody ? { "Content-Type": "application/json" } : {}), ...authHeaders(), ...init?.headers },
    ...init,
  })
  if (!res.ok) {
    const bodyText = await res.text().catch(() => "")
    let detail = bodyText.trim()
    if (detail) {
      try {
        const parsed = JSON.parse(detail) as {
          error?: string
          message?: string
          safeMessage?: string
          issues?: Array<{ message?: string }>
        }
        const issueMessages = Array.isArray(parsed.issues)
          ? parsed.issues
              .map((issue) => issue.message?.trim())
              .filter((message): message is string => Boolean(message))
          : []
        const summary = parsed.safeMessage?.trim() || parsed.message?.trim() || parsed.error?.trim() || ""
        detail = [summary, ...issueMessages.slice(0, 3)].filter(Boolean).join(" / ") || detail
      } catch {
        // keep raw text
      }
    }
    throw new Error(detail ? `${res.status} ${res.statusText}: ${detail}` : `${res.status} ${res.statusText}`)
  }
  return res.json() as Promise<T>
}

export function getControlPlaneAdapter(): ControlPlaneAdapter {
  return localAdapter
}

export function getControlPlaneAdapterName(): "local" {
  return localAdapter.name
}

export const api = {
  status: () => getControlPlaneAdapter().getStatus(),
  capabilities: () => getControlPlaneAdapter().getCapabilities(),
  capability: (key: string) => getControlPlaneAdapter().getCapability(key),
  setupStatus: () => getControlPlaneAdapter().getSetupStatus(),
  setupChecks: () => getControlPlaneAdapter().getSetupChecks(),
  setupDraft: () => getControlPlaneAdapter().getSetupDraft(),
  saveSetupDraft: (payload: { draft: SetupDraft; state?: SetupState }) => getControlPlaneAdapter().saveSetupDraft(payload),
  resetSetup: () => getControlPlaneAdapter().resetSetup(),
  completeSetup: () => getControlPlaneAdapter().completeSetup(),
  testBackend: (endpoint: string, providerType: AIProviderType, credentials: AIBackendCredentials, authMode?: AIAuthMode) =>
    getControlPlaneAdapter().testBackend(endpoint, providerType, credentials, authMode),
  testTelegram: (botToken: string) => getControlPlaneAdapter().testTelegram(botToken),
  testSlack: (botToken: string, appToken: string) => getControlPlaneAdapter().testSlack(botToken, appToken),
  testMcpServer: (server: SetupMcpServerDraft) => getControlPlaneAdapter().testMcpServer(server),
  testSkillPath: (path: string) => getControlPlaneAdapter().testSkillPath(path),
  generateAuthToken: () => getControlPlaneAdapter().generateAuthToken(),
  mcpServers: () => getControlPlaneAdapter().getMcpServers(),
  reloadMcpServers: () => getControlPlaneAdapter().reloadMcpServers(),
  mqttRuntime: () => getControlPlaneAdapter().getMqttRuntime(),
  disconnectMqttExtension: (extensionId: string) => getControlPlaneAdapter().disconnectMqttExtension(extensionId),
  updateStatus: () => request<UpdateSnapshot>("/api/update/status"),
  checkForUpdates: () => request<UpdateSnapshot>("/api/update/check", { method: "POST" }),
  doctor: (mode: DoctorMode = "quick", write = false) =>
    request<DoctorResponse>(`/api/doctor?mode=${encodeURIComponent(mode)}${write ? "&write=1" : ""}`),

  uiMode: async () => {
    try {
      const state = await request<UiModeState>("/api/ui/mode")
      setBrowserPreferredUiModeFallback(state.preferredUiMode)
      return state
    } catch {
      return buildBrowserUiModeFallback()
    }
  },

  saveUiMode: async (mode: PreferredUiMode): Promise<UiModeSaveResponse> => {
    setBrowserPreferredUiModeFallback(mode)
    try {
      const state = await request<UiModeSaveResponse>("/api/ui/mode", {
        method: "POST",
        body: JSON.stringify({ mode }),
      })
      setBrowserPreferredUiModeFallback(state.preferredUiMode)
      return state
    } catch {
      return { ok: false, fallback: "browser", ...buildBrowserUiModeFallback(mode) }
    }
  },

  uiShell: async () => {
    try {
      const shell = await request<UiShellResponse>("/api/ui/shell")
      setBrowserPreferredUiModeFallback(shell.mode.preferredUiMode)
      return shell
    } catch {
      const mode = buildBrowserUiModeFallback()
      return {
        generatedAt: Date.now(),
        mode,
        setupState: { completed: false },
        runtimeHealth: {
          ai: { configured: false, provider: null, modelConfigured: false },
          channels: { webui: true, telegramConfigured: false, telegramEnabled: false, slackConfigured: false, slackEnabled: false },
          yeonjang: { mqttEnabled: false, connectedExtensions: 0 },
        },
        activeRuns: { total: 0, pendingApprovals: 0 },
        viewModel: {
          currentMode: mode.mode,
          current: {
            kind: "beginner",
            summary: "연결 상태를 확인할 수 없습니다.",
            statusLabel: "확인 필요",
            primaryAction: null,
            needsAttention: true,
            safeDetails: [],
          },
          beginner: {
            kind: "beginner",
            summary: "연결 상태를 확인할 수 없습니다.",
            statusLabel: "확인 필요",
            primaryAction: null,
            needsAttention: true,
            safeDetails: [],
          },
          advanced: {
            kind: "advanced",
            components: [],
          },
        },
      } satisfies UiShellResponse
    }
  },

  adminShell: () => request<AdminShellResponse>("/api/admin/shell"),

  adminLive: (params: AdminLiveQuery = {}) => request<AdminLiveResponse>(`/api/admin/live${buildAdminLiveQuery(params)}`),

  adminToolLab: (params: AdminLiveQuery & { query?: string } = {}) => request<AdminToolLabResponse>(`/api/admin/tool-lab${buildAdminLiveQuery(params)}`),

  adminRuntimeInspectors: (params: AdminLiveQuery = {}) => request<AdminRuntimeInspectorsResponse>(`/api/admin/runtime-inspectors${buildAdminLiveQuery(params)}`),

  adminPlatformInspectors: (params: AdminLiveQuery = {}) => request<AdminPlatformInspectorsResponse>(`/api/admin/platform-inspectors${buildAdminLiveQuery(params)}`),

  adminDiagnosticExports: () => request<AdminDiagnosticExportListResponse>("/api/admin/diagnostic-exports"),

  adminDiagnosticExport: (id: string) => request<AdminDiagnosticExportGetResponse>(`/api/admin/diagnostic-exports/${encodeURIComponent(id)}`),

  startAdminDiagnosticExport: (body: { runId?: string; requestGroupId?: string; sessionKey?: string; channel?: string; includeTimeline?: boolean; includeReport?: boolean; limit?: number } = {}) =>
    request<AdminDiagnosticExportStartResponse>("/api/admin/diagnostic-exports", {
      method: "POST",
      body: JSON.stringify(body),
    }),

  adminFixtureReplay: (body: { fixtureIds?: string[] } = {}) => request<AdminFixtureReplayResponse>("/api/admin/web-retrieval-fixtures/replay", {
    method: "POST",
    body: JSON.stringify(body),
  }),

  adminDangerousAction: (body: { action: "retry" | "purge" | "replay" | "export"; targetId?: string; confirmation?: string; reason?: string; params?: unknown }) =>
    request<AdminDangerousActionResponse>("/api/admin/actions", {
      method: "POST",
      body: JSON.stringify(body),
    }),

  instructionsActive: (workDir?: string) =>
    request<ActiveInstructionsResponse>(
      `/api/instructions/active${workDir ? `?workDir=${encodeURIComponent(workDir)}` : ""}`,
    ),

  promptSources: (workDir?: string) =>
    request<{ workDir: string; sources: PromptSourceMetadata[] }>(
      `/api/prompt-sources${workDir ? `?workDir=${encodeURIComponent(workDir)}` : ""}`,
    ),

  promptSource: (sourceId: string, locale: "ko" | "en", workDir?: string) =>
    request<{ workDir: string; source: PromptSourceDocument }>(
      `/api/prompt-sources/${encodeURIComponent(sourceId)}/${encodeURIComponent(locale)}${workDir ? `?workDir=${encodeURIComponent(workDir)}` : ""}`,
    ),

  promptSourcesDryRun: (workDir?: string, locale: "ko" | "en" = "ko") =>
    request<{ workDir: string; locale: "ko" | "en"; dryRun: PromptSourceDryRunResult }>(
      `/api/prompt-sources/dry-run?locale=${encodeURIComponent(locale)}${workDir ? `&workDir=${encodeURIComponent(workDir)}` : ""}`,
    ),

  promptSourcesParity: (workDir?: string) =>
    request<{ workDir: string; parity: PromptSourceLocaleParityResult }>(
      `/api/prompt-sources/parity${workDir ? `?workDir=${encodeURIComponent(workDir)}` : ""}`,
    ),

  promptSourcesRegression: (workDir?: string, locale: "ko" | "en" | "all" = "all") =>
    request<{ workDir: string; regression: PromptSourceRegressionResult }>(
      `/api/prompt-sources/regression?locale=${encodeURIComponent(locale)}${workDir ? `&workDir=${encodeURIComponent(workDir)}` : ""}`,
    ),

  writePromptSource: (sourceId: string, locale: "ko" | "en", body: { workDir?: string; content: string; createBackup?: boolean }) =>
    request<PromptSourceWriteResult>(`/api/prompt-sources/${encodeURIComponent(sourceId)}/${encodeURIComponent(locale)}/write`, {
      method: "POST",
      body: JSON.stringify(body),
    }),

  rollbackPromptSource: (body: { sourcePath: string; backupPath: string }) =>
    request<PromptSourceRollbackResult>("/api/prompt-sources/rollback", {
      method: "POST",
      body: JSON.stringify(body),
    }),

  configOperations: (workDir?: string) =>
    request<{ snapshot: ConfigurationOperationsSnapshot }>(
      `/api/config/operations${workDir ? `?workDir=${encodeURIComponent(workDir)}` : ""}`,
    ),

  configMigrationDryRun: () =>
    request<{ dryRun: MigrationDryRunResult }>("/api/config/migrations/dry-run"),

  backupDatabase: () =>
    request<{ ok: boolean; backup: DatabaseBackupResult; snapshot: ConfigurationOperationsSnapshot }>("/api/config/db/backup", { method: "POST" }),

  exportDatabase: () =>
    request<{ ok: boolean; export: DatabaseBackupResult; snapshot: ConfigurationOperationsSnapshot }>("/api/config/db/export", { method: "POST" }),

  importDatabase: (backupPath: string) =>
    request<{ ok: boolean; import: { importedPath: string; rollbackBackup: DatabaseBackupResult; status: ConfigurationOperationsSnapshot["database"] }; snapshot: ConfigurationOperationsSnapshot }>("/api/config/db/import", {
      method: "POST",
      body: JSON.stringify({ backupPath }),
    }),

  exportMaskedConfig: () =>
    request<{ ok: boolean; export: ConfigExportResult }>("/api/config/export", { method: "POST" }),

  exportPromptSourcesOps: (workDir?: string) =>
    request<{ ok: boolean; export: PromptSourceExportResult; snapshot: ConfigurationOperationsSnapshot }>("/api/config/prompt-sources/export", {
      method: "POST",
      body: JSON.stringify({ ...(workDir ? { workDir } : {}) }),
    }),

  importPromptSourcesOps: (body: { exportPath: string; workDir?: string; overwrite?: boolean }) =>
    request<{ ok: boolean; import: PromptSourceImportResult; snapshot: ConfigurationOperationsSnapshot }>("/api/config/prompt-sources/import", {
      method: "POST",
      body: JSON.stringify(body),
    }),

  recoverPromptSourcesOps: (workDir?: string) =>
    request<{ ok: boolean; recovery: { promptsDir: string; created: string[]; existing: string[] }; snapshot: ConfigurationOperationsSnapshot }>("/api/config/prompt-sources/recover", {
      method: "POST",
      body: JSON.stringify({ ...(workDir ? { workDir } : {}) }),
    }),

  runs: () => request<{ runs: RootRun[] }>("/api/runs"),

  tasks: () => request<{ tasks: TaskModel[] }>("/api/tasks"),

  runOperationsSummary: () => request<{ summary: OperationsSummary }>("/api/runs/operations/summary"),

  cleanupStaleRuns: (staleMs?: number) =>
    request<{ ok: boolean; cleanup: StaleRunCleanupResult; summary: OperationsSummary }>("/api/runs/operations/stale-cleanup", {
      method: "POST",
      body: JSON.stringify({ ...(staleMs ? { staleMs } : {}) }),
    }),

  channelSmokeRuns: (limit = 20) =>
    request<ChannelSmokeRunsResponse>(`/api/channel-smoke/runs?limit=${encodeURIComponent(String(limit))}`),

  channelSmokeRun: (id: string) =>
    request<ChannelSmokeRunDetailResponse>(`/api/channel-smoke/runs/${encodeURIComponent(id)}`),

  startChannelSmokeRun: (body: { mode?: ChannelSmokeRunMode; channel?: ChannelSmokeChannel; scenarioIds?: string[] } = {}) =>
    request<ChannelSmokeStartResponse>("/api/channel-smoke/runs", {
      method: "POST",
      body: JSON.stringify(body),
    }),

  run: (runId: string) => request<{ run: RootRun }>(`/api/runs/${runId}`),

  runSteps: (runId: string) => request<{ steps: RunStep[] }>(`/api/runs/${runId}/steps`),

  runTimeline: (runId: string) => request<{ events: RunEvent[] }>(`/api/runs/${runId}/timeline`),

  runRetrievalTimeline: (runId: string, limit = 500) =>
    request<{ timeline: RetrievalTimeline }>(`/api/runs/${encodeURIComponent(runId)}/retrieval-timeline?limit=${encodeURIComponent(String(limit))}`),

  runMemoryTrace: (runId: string, limit = 100) =>
    request<{ traces: MemoryAccessTraceItem[] }>(`/api/runs/${encodeURIComponent(runId)}/memory-trace?limit=${encodeURIComponent(String(limit))}`),

  createRun: (message: string, sessionId?: string) =>
    request<{ requestId: string; runId: string; sessionId: string; source: string; status: string; receipt?: string }>("/api/runs", {
      method: "POST",
      body: JSON.stringify({ message, sessionId }),
    }),

  cancelRun: (runId: string) =>
    request<{ run: RootRun }>(`/api/runs/${runId}/cancel`, {
      method: "POST",
    }),

  deleteRunHistory: (runId: string) =>
    request<{ ok: boolean; deletedRunCount: number }>(`/api/runs/${runId}`, {
      method: "DELETE",
    }),

  clearHistoricalRunHistory: () =>
    request<{ ok: boolean; deletedRunCount: number }>("/api/runs/history/inactive", {
      method: "DELETE",
    }),

  sessions: () => request<{ sessions: Array<{ id: string; updated_at: number; summary: string | null }> }>("/api/agent/sessions"),

  messages: (sessionId: string) =>
    request<{ messages: Array<{ role: string; content: string; created_at: number }> }>(
      `/api/agent/sessions/${sessionId}/messages`,
    ),

  tools: () => request<{ tools: Array<{ name: string; description: string; riskLevel: string }> }>("/api/tools"),

  audit: (params: {
    page?: number; limit?: number; toolName?: string; result?: string; status?: string; kind?: string; timelineKind?: string; channel?: string;
    from?: string; to?: string; sessionId?: string; runId?: string; requestGroupId?: string; q?: string
  } = {}) => {
    const q = new URLSearchParams()
    if (params.page) q.set("page", String(params.page))
    if (params.limit) q.set("limit", String(params.limit))
    if (params.toolName) q.set("toolName", params.toolName)
    if (params.result) q.set("result", params.result)
    if (params.status) q.set("status", params.status)
    if (params.kind) q.set("kind", params.kind)
    if (params.timelineKind) q.set("timelineKind", params.timelineKind)
    if (params.channel) q.set("channel", params.channel)
    if (params.from) q.set("from", params.from)
    if (params.to) q.set("to", params.to)
    if (params.sessionId) q.set("sessionId", params.sessionId)
    if (params.runId) q.set("runId", params.runId)
    if (params.requestGroupId) q.set("requestGroupId", params.requestGroupId)
    if (params.q) q.set("q", params.q)
    return request<AuditEventsResponse>(`/api/audit?${q.toString()}`)
  },

  auditTimeline: (runId: string, limit = 500) =>
    request<AuditEventsResponse>(`/api/audit/runs/${encodeURIComponent(runId)}/timeline?limit=${limit}`),

  auditExport: (runId: string, format: "json" | "markdown" = "markdown") =>
    request<AuditExportResponse>(`/api/audit/runs/${encodeURIComponent(runId)}/export?format=${encodeURIComponent(format)}`),

  controlTimeline: (params: { runId?: string; requestGroupId?: string; correlationId?: string; eventType?: string; component?: string; severity?: ControlEventSeverity; limit?: number; audience?: ControlExportAudience } = {}) => {
    const q = new URLSearchParams()
    if (params.runId) q.set("runId", params.runId)
    if (params.requestGroupId) q.set("requestGroupId", params.requestGroupId)
    if (params.correlationId) q.set("correlationId", params.correlationId)
    if (params.eventType) q.set("eventType", params.eventType)
    if (params.component) q.set("component", params.component)
    if (params.severity) q.set("severity", params.severity)
    if (params.limit) q.set("limit", String(params.limit))
    if (params.audience) q.set("audience", params.audience)
    return request<ControlTimelineResponse>(`/api/control/timeline?${q.toString()}`)
  },

  controlTimelineExport: (params: { runId?: string; requestGroupId?: string; correlationId?: string; audience?: ControlExportAudience; format?: "json" | "markdown"; limit?: number } = {}) => {
    const q = new URLSearchParams()
    if (params.runId) q.set("runId", params.runId)
    if (params.requestGroupId) q.set("requestGroupId", params.requestGroupId)
    if (params.correlationId) q.set("correlationId", params.correlationId)
    if (params.audience) q.set("audience", params.audience)
    if (params.format) q.set("format", params.format)
    if (params.limit) q.set("limit", String(params.limit))
    return request<ControlTimelineExportResponse>(`/api/control/timeline/export?${q.toString()}`)
  },

  promoteAuditEventToErrorCorpus: (eventId: string, note?: string) =>
    request<AuditPromotionResponse>(`/api/audit/events/${encodeURIComponent(eventId)}/promote-error-corpus`, {
      method: "POST",
      body: JSON.stringify({ ...(note ? { note } : {}) }),
    }),

  cleanupAudit: (params: { before?: number; all?: boolean }) => {
    const q = new URLSearchParams()
    if (params.before) q.set("before", String(params.before))
    if (params.all) q.set("all", "true")
    return request<AuditCleanupResponse>(`/api/audit?${q.toString()}`, { method: "DELETE" })
  },

  settings: () => request<Record<string, unknown>>("/api/settings"),

  saveSettings: (body: Record<string, unknown>) =>
    request<{ ok: boolean }>("/api/settings", {
      method: "PUT",
      body: JSON.stringify(body),
    }),

  reloadSettings: () =>
    request<{ ok: boolean }>("/api/settings/reload", { method: "POST" }),

  restartTelegram: () =>
    request<{ ok: boolean; status?: string; error?: string }>("/api/settings/telegram/restart", { method: "POST" }),

  restartChannels: () =>
    request<{ ok: boolean; status?: string; error?: string }>("/api/settings/channels/restart", { method: "POST" }),

  testAi: () =>
    request<{ ok: boolean; response?: string; model?: string; error?: string }>(
      "/api/settings/test-ai", { method: "POST" },
    ),

  schedules: () =>
    request<{ schedules: Schedule[] }>("/api/schedules"),

  legacySchedules: () =>
    request<{ schedules: LegacyScheduleMigrationItem[] }>("/api/schedules/legacy"),

  dryRunLegacySchedule: (id: string) =>
    request<LegacyScheduleMigrationReport>(`/api/schedules/${id}/legacy/dry-run`, { method: "POST" }),

  convertLegacySchedule: (id: string) =>
    request<{ ok: boolean; report: LegacyScheduleMigrationReport }>(`/api/schedules/${id}/legacy/convert`, { method: "POST" }),

  keepLegacySchedule: (id: string) =>
    request<{ ok: boolean; report: LegacyScheduleMigrationReport }>(`/api/schedules/${id}/legacy/keep`, { method: "POST" }),

  createSchedule: (body: { name: string; cron: string; prompt: string; model?: string; enabled?: boolean }) =>
    request<{ id: string }>("/api/schedules", { method: "POST", body: JSON.stringify(body) }),

  updateSchedule: (id: string, body: Partial<{ name: string; cron: string; prompt: string; model: string; enabled: boolean }>) =>
    request<{ ok: boolean }>(`/api/schedules/${id}`, { method: "PUT", body: JSON.stringify(body) }),

  deleteSchedule: (id: string) =>
    request<{ ok: boolean }>(`/api/schedules/${id}`, { method: "DELETE" }),

  toggleSchedule: (id: string) =>
    request<{ ok: boolean; enabled: boolean }>(`/api/schedules/${id}/toggle`, { method: "PATCH" }),

  runScheduleNow: (id: string) =>
    request<{ runId: string; status: string }>(`/api/schedules/${id}/run`, { method: "POST" }),

  scheduleRuns: (id: string, page = 1, limit = 20) =>
    request<{ items: ScheduleRun[]; total: number; page: number; pages: number; limit: number }>(
      `/api/schedules/${id}/runs?page=${page}&limit=${limit}`,
    ),

  scheduleStats: (id: string) =>
    request<{ total: number; successes: number; failures: number; avgDurationMs: number | null; lastRunAt: number | null }>(
      `/api/schedules/${id}/stats`,
    ),

  schedulerHealth: () =>
    request<{
      running: boolean
      activeJobs: number
      activeJobIds: string[]
      nextRuns: Array<{ scheduleId: string; name: string; nextRunAt: number }>
    }>("/api/scheduler/health"),

  memoryQuality: () =>
    request<{ snapshot: MemoryQualitySnapshot }>("/api/memory/quality"),

  memoryWritebackReview: (status: "pending" | "completed" | "discarded" | "failed" | "all" = "pending") =>
    request<{ candidates: MemoryWritebackReviewItem[] }>(`/api/memory/writeback?status=${encodeURIComponent(status)}`),

  reviewMemoryWriteback: (id: string, body: { action: MemoryWritebackReviewAction; editedContent?: string; reviewerId?: string }) =>
    request<MemoryWritebackReviewResult>(`/api/memory/writeback/${encodeURIComponent(id)}/review`, {
      method: "POST",
      body: JSON.stringify(body),
    }),

  plugins: () => request<Plugin[]>("/api/plugins"),

  installPlugin: (body: { name: string; version: string; description?: string; entryPath: string }) =>
    request<Plugin>("/api/plugins", { method: "POST", body: JSON.stringify(body) }),

  updatePlugin: (name: string, body: { enabled?: boolean; config?: Record<string, unknown> }) =>
    request<Plugin>(`/api/plugins/${name}`, { method: "PATCH", body: JSON.stringify(body) }),

  uninstallPlugin: (name: string) =>
    request<void>(`/api/plugins/${name}`, { method: "DELETE" }),
}

export type { StatusResponse, SetupChecksResponse, TestBackendResponse, TestMcpServerResponse, TestSkillPathResponse, TestTelegramResponse, ResetSetupResponse, FeatureCapability, MqttRuntimeResponse }

export interface AuditEvent {
  id: string
  at: number
  kind: "tool_call" | "diagnostic" | "run_event" | "artifact" | "delivery" | "decision_trace"
  timelineKind: "ingress" | "intake" | "contract" | "memory" | "tool" | "delivery" | "recovery" | "completion"
  status: string
  summary: string
  source: string | null
  sessionId: string | null
  runId: string | null
  requestGroupId: string | null
  channel: string | null
  toolName: string | null
  params: unknown
  output: string | null
  durationMs: number | null
  approvalRequired: boolean
  approvedBy: string | null
  errorCode: string | null
  retryCount: number | null
  stopReason: string | null
  detail: unknown
}

export interface AuditEventsResponse {
  items: AuditEvent[]
  total: number
  page: number
  pages: number
  limit: number
}

export interface AuditExportResponse {
  format: "json" | "markdown"
  content: string
  events: AuditEvent[]
}

export type ControlEventSeverity = "debug" | "info" | "warning" | "error"
export type ControlExportAudience = "user" | "developer"

export interface ControlTimelineEvent {
  id: string
  at: number
  eventType: string
  correlationId: string
  runId: string | null
  requestGroupId: string | null
  sessionKey: string | null
  component: string
  severity: ControlEventSeverity
  summary: string
  detail: unknown
  duplicate?: {
    kind: "tool" | "answer" | "delivery" | "recovery"
    key: string
    firstEventId: string
    occurrence: number
  }
}

export interface ControlTimelineSummary {
  total: number
  duplicateToolCount: number
  duplicateAnswerCount: number
  deliveryRetryCount: number
  recoveryReentryCount: number
  severityCounts: Record<ControlEventSeverity, number>
}

export interface ControlTimeline {
  events: ControlTimelineEvent[]
  summary: ControlTimelineSummary
}

export interface ControlTimelineResponse {
  timeline: ControlTimeline
}

export interface ControlTimelineExportResponse {
  export: {
    audience: ControlExportAudience
    format: "json" | "markdown"
    content: string
    timeline: ControlTimeline
  }
}

export type RetrievalTimelineEventKind = "session" | "attempt" | "source" | "candidate" | "verdict" | "planner" | "delivery" | "dedupe" | "stop" | "diagnostic"

export interface RetrievalTimelineEvent {
  id: string
  at: number
  kind: RetrievalTimelineEventKind
  eventType: string
  component: string
  severity: ControlEventSeverity
  summary: string
  detail: unknown
  source: {
    method: string | null
    toolName: string | null
    url: string | null
    domain: string | null
  }
  verdict: {
    canAnswer: boolean | null
    acceptedValue: string | null
    sufficiency: string | null
    rejectionReason: string | null
    conflicts: string[]
  }
  diagnosticRef: {
    controlEventId: string
    eventType: string
    component: string
  }
  duplicate?: ControlTimelineEvent["duplicate"]
}

export interface RetrievalTimelineSummary {
  total: number
  sessionEvents: number
  attempts: number
  sources: number
  candidates: number
  verdicts: number
  plannerActions: number
  deliveryEvents: number
  dedupeSuppressed: number
  stops: number
  conflicts: number
  finalDeliveryStatus: string | null
  stopReason: string | null
  severityCounts: Record<ControlEventSeverity, number>
}

export interface RetrievalTimeline {
  events: RetrievalTimelineEvent[]
  summary: RetrievalTimelineSummary
}

export interface AuditCleanupResponse {
  ok: boolean
  deleted: { auditLogs: number; diagnosticEvents: number; decisionTraces?: number }
  before?: number
  message?: string
}

export interface AuditPromotionResponse {
  ok: boolean
  diagnosticEventId?: string
  event?: AuditEvent
  message?: string
}

export type ChannelSmokeChannel = "webui" | "telegram" | "slack"
export type ChannelSmokeRunMode = "dry-run" | "live-run"
export type ChannelSmokeStatus = "running" | "passed" | "failed" | "skipped"

export interface ChannelSmokeCounts {
  total: number
  passed: number
  failed: number
  skipped: number
}

export interface ChannelSmokeRunSummary {
  id: string
  mode: ChannelSmokeRunMode
  status: ChannelSmokeStatus
  startedAt: number
  finishedAt: number | null
  counts: ChannelSmokeCounts
  initiatedBy: string | null
  summary: string | null
  metadata: unknown
}

export interface ChannelSmokeStepSummary {
  id: string
  runId: string
  scenarioId: string
  channel: ChannelSmokeChannel
  scenarioKind: string
  status: Exclude<ChannelSmokeStatus, "running">
  reason: string | null
  failures: string[]
  trace: unknown
  auditLogId: string | null
  startedAt: number
  finishedAt: number
}

export interface ChannelSmokeRunsResponse {
  runs: ChannelSmokeRunSummary[]
}

export interface ChannelSmokeRunDetailResponse {
  run: ChannelSmokeRunSummary
  steps: ChannelSmokeStepSummary[]
}

export interface ChannelSmokeStartResponse {
  ok: boolean
  runId: string
  status: Exclude<ChannelSmokeStatus, "running">
  counts: ChannelSmokeCounts
  summary: string
  results: Array<{
    scenarioId: string
    channel: ChannelSmokeChannel
    kind: string
    status: Exclude<ChannelSmokeStatus, "running">
    reason?: string
    failures: string[]
    auditLogId?: string
  }>
}

export interface Schedule {
  id: string
  name: string
  cron_expression: string
  timezone: string | null
  prompt: string
  enabled: boolean
  target_channel?: string
  target_session_id?: string | null
  execution_driver?: string
  legacy?: number | boolean
  contract_schema_version?: number | null
  model: string | null
  last_run_at: number | null
  next_run_at: number | null
  created_at: number
  updated_at: number
}

export type LegacyScheduleMigrationRisk = "low" | "medium" | "high" | "blocked"
export type LegacyScheduleMigrationStatus = "already_contract" | "convertible" | "blocked"

export interface LegacyScheduleMigrationPersistencePreview {
  identityKey: string
  payloadHash: string
  deliveryKey: string
  contractSchemaVersion: number
}

export interface LegacyScheduleMigrationReport {
  scheduleId: string
  scheduleName: string
  status: LegacyScheduleMigrationStatus
  legacy: boolean
  convertible: boolean
  risk: LegacyScheduleMigrationRisk
  confidence: number
  reasons: string[]
  warnings: string[]
  contract: unknown | null
  persistence: LegacyScheduleMigrationPersistencePreview | null
}

export interface LegacyScheduleMigrationItem {
  scheduleId: string
  name: string
  rawPrompt: string
  cronExpression: string
  timezone: string | null
  enabled: boolean
  target: {
    channel: string
    sessionId: string | null
  }
  legacy: boolean
  convertible: boolean
  risk: LegacyScheduleMigrationRisk
  reason: string
  createdAt: number
  updatedAt: number
  lastRunAt: number | null
}

export interface ScheduleRun {
  id: string
  schedule_id: string
  started_at: number
  finished_at: number | null
  success: boolean | null
  summary: string | null
  error: string | null
}

export interface Plugin {
  id: string
  name: string
  version: string
  description: string | null
  entry_path: string
  enabled: number
  config: Record<string, unknown>
  is_loaded: boolean
  installed_at: number
  updated_at: number
}

export type MemoryWritebackReviewAction = "approve_long_term" | "approve_edited" | "keep_session" | "discard"

export interface MemoryScopeQualityMetric {
  scope: string
  documents: number
  chunks: number
  missingEmbeddings: number
  staleEmbeddings: number
  staleDocuments: number
  accessCount: number
  avgRetrievalLatencyMs: number | null
  p95RetrievalLatencyMs: number | null
  lastFailure: string | null
}

export interface MemoryQualitySnapshot {
  generatedAt: number
  status: "healthy" | "degraded"
  scopes: MemoryScopeQualityMetric[]
  totals: {
    documents: number
    chunks: number
    missingEmbeddings: number
    staleEmbeddings: number
    staleDocuments: number
    accessCount: number
  }
  writeback: {
    pending: number
    writing: number
    failed: number
    completed: number
    discarded: number
    lastFailure: string | null
  }
  flashFeedback: {
    active: number
    expired: number
    highSeverityActive: number
  }
  learningHistory: {
    pendingReview: number
    autoApplied: number
    appliedByUser: number
    rejected: number
    historyVersions: number
    restoreEvents: number
  }
  retrievalPolicy: {
    fastPathBlocksLongTerm: boolean
    fastPathBlocksVector: boolean
    fastPathBudget: { maxChunks: number; maxChars: number }
    normalBudget: { maxChunks: number; maxChars: number }
    scheduleMemoryDefaultInjection: boolean
  }
  lastFailure: string | null
}

export interface MemoryAccessTraceItem {
  id: string
  run_id: string | null
  session_id: string | null
  request_group_id: string | null
  document_id: string | null
  chunk_id: string | null
  source_checksum: string | null
  scope: string | null
  query: string
  result_source: string
  score: number | null
  latency_ms: number | null
  reason: string | null
  created_at: number
}

export interface MemoryWritebackReviewItem {
  id: string
  scope: string
  ownerId: string
  sourceType: string
  sourceRunId?: string
  sourceChannel?: string
  sessionId?: string
  requestGroupId?: string
  confidence?: string
  ttl?: string
  proposedText: string
  repeatExamples: string[]
  blockReasons: string[]
  status: "pending" | "writing" | "failed" | "completed" | "discarded"
  createdAt: number
  updatedAt: number
}

export interface MemoryWritebackReviewResult {
  ok: boolean
  candidate: MemoryWritebackReviewItem
  documentId?: string
  action: MemoryWritebackReviewAction
  reason?: string
}

export interface PromptSourceMetadata {
  sourceId: string
  locale: "ko" | "en"
  path: string
  version: string
  priority: number
  enabled: boolean
  required: boolean
  usageScope: string
  checksum: string
}

export interface PromptSourceDocument extends PromptSourceMetadata {
  content: string
}

export interface PromptSourceDryRunResult {
  assembly: { text: string; snapshot: { diagnostics: Array<{ severity: string; code: string; sourceId: string; locale: "ko" | "en"; message: string }> } } | null
  sourceOrder: Array<{ sourceId: string; locale: "ko" | "en"; checksum: string; version: string; path: string }>
  totalChars: number
  diagnostics: Array<{ severity: string; code: string; sourceId: string; locale: "ko" | "en"; message: string }>
}

export interface PromptSourceLocaleParityIssue {
  sourceId: string
  code: "missing_locale" | "section_mismatch"
  locale?: "ko" | "en"
  message: string
}

export interface PromptSourceLocaleParityResult {
  ok: boolean
  issues: PromptSourceLocaleParityIssue[]
}

export interface PromptRegressionIssue {
  severity: "error" | "warning"
  code: string
  message: string
  sourceId?: string
  locale?: "ko" | "en"
  evidence?: string
}

export interface PromptResponsibilityRuleResult {
  id: string
  description: string
  ok: boolean
  allowedSourceIds: string[]
  issues: PromptRegressionIssue[]
}

export interface PromptImpactScenarioResult {
  id: string
  description: string
  locale: "ko" | "en"
  ok: boolean
  requiredMarkers: string[]
  missingMarkers: string[]
}

export interface PromptSourceRegressionResult {
  ok: boolean
  workDir: string
  generatedAt: number
  locales: Array<"ko" | "en">
  registry: {
    sourceCount: number
    runtimeSourceCount: number
    checksums: Array<{ sourceId: string; locale: "ko" | "en"; checksum: string; version: string; path: string }>
  }
  localeParity: PromptSourceLocaleParityResult
  responsibility: PromptResponsibilityRuleResult[]
  impact: PromptImpactScenarioResult[]
  issues: PromptRegressionIssue[]
}

export interface PromptSourceWriteResult {
  backup: { backupId: string; sourceId: string; locale: "ko" | "en"; sourcePath: string; backupPath: string; checksum: string; createdAt: number } | null
  source: PromptSourceMetadata
  diff: {
    beforeChecksum: string
    afterChecksum: string
    changed: boolean
    lines: Array<{ kind: "unchanged" | "added" | "removed" | "changed"; beforeLine?: number; afterLine?: number; before?: string; after?: string }>
  }
}

export interface PromptSourceRollbackResult {
  sourcePath: string
  backupPath: string
  restoredChecksum: string
  previousChecksum: string
}
