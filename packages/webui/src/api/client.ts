import { localAdapter } from "./adapters/local"
import type { ControlPlaneAdapter, MqttRuntimeResponse, ResetSetupResponse, SetupChecksResponse, StatusResponse, TestBackendResponse, TestMcpServerResponse, TestSkillPathResponse, TestTelegramResponse } from "./adapters/types"
import type { AIAuthMode, AIBackendCredentials, AIProviderType } from "../contracts/ai"
import type { FeatureCapability } from "../contracts/capabilities"
import type { ConfigExportResult, ConfigurationOperationsSnapshot, DatabaseBackupResult, MigrationDryRunResult, PromptSourceExportResult, PromptSourceImportResult } from "../contracts/config-operations"
import type { ActiveInstructionsResponse } from "../contracts/instructions"
import type { OperationsSummary, StaleRunCleanupResult } from "../contracts/operations"
import type { RootRun, RunEvent, RunStep } from "../contracts/runs"
import type { SetupDraft, SetupMcpServerDraft, SetupState } from "../contracts/setup"
import type { TaskModel } from "../contracts/tasks"
import type { UpdateSnapshot } from "../contracts/update"

const BASE = ""

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
        const parsed = JSON.parse(detail) as { error?: string; message?: string }
        detail = parsed.message?.trim() || parsed.error?.trim() || detail
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

  run: (runId: string) => request<{ run: RootRun }>(`/api/runs/${runId}`),

  runSteps: (runId: string) => request<{ steps: RunStep[] }>(`/api/runs/${runId}/steps`),

  runTimeline: (runId: string) => request<{ events: RunEvent[] }>(`/api/runs/${runId}/timeline`),

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
    page?: number; limit?: number; toolName?: string; result?: string; status?: string; kind?: string; channel?: string;
    from?: string; to?: string; sessionId?: string; runId?: string; requestGroupId?: string; q?: string
  } = {}) => {
    const q = new URLSearchParams()
    if (params.page) q.set("page", String(params.page))
    if (params.limit) q.set("limit", String(params.limit))
    if (params.toolName) q.set("toolName", params.toolName)
    if (params.result) q.set("result", params.result)
    if (params.status) q.set("status", params.status)
    if (params.kind) q.set("kind", params.kind)
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
  kind: "tool_call" | "diagnostic" | "run_event" | "artifact" | "delivery"
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

export interface AuditCleanupResponse {
  ok: boolean
  deleted: { auditLogs: number; diagnosticEvents: number }
  before?: number
  message?: string
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
