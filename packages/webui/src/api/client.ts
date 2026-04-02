import { localAdapter } from "./adapters/local"
import type { ControlPlaneAdapter, MqttRuntimeResponse, ResetSetupResponse, SetupChecksResponse, StatusResponse, TestBackendResponse, TestMcpServerResponse, TestSkillPathResponse, TestTelegramResponse } from "./adapters/types"
import type { AIAuthMode, AIBackendCredentials, AIProviderType } from "../contracts/ai"
import type { FeatureCapability } from "../contracts/capabilities"
import type { ActiveInstructionsResponse } from "../contracts/instructions"
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

  runs: () => request<{ runs: RootRun[] }>("/api/runs"),

  tasks: () => request<{ tasks: TaskModel[] }>("/api/tasks"),

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

  sessions: () => request<{ sessions: Array<{ id: string; updated_at: number; summary: string | null }> }>("/api/agent/sessions"),

  messages: (sessionId: string) =>
    request<{ messages: Array<{ role: string; content: string; created_at: number }> }>(
      `/api/agent/sessions/${sessionId}/messages`,
    ),

  tools: () => request<{ tools: Array<{ name: string; description: string; riskLevel: string }> }>("/api/tools"),

  audit: (params: {
    page?: number; limit?: number; toolName?: string; result?: string;
    from?: string; to?: string; sessionId?: string
  } = {}) => {
    const q = new URLSearchParams()
    if (params.page) q.set("page", String(params.page))
    if (params.limit) q.set("limit", String(params.limit))
    if (params.toolName) q.set("toolName", params.toolName)
    if (params.result) q.set("result", params.result)
    if (params.from) q.set("from", params.from)
    if (params.to) q.set("to", params.to)
    if (params.sessionId) q.set("sessionId", params.sessionId)
    return request<{
      items: Array<{
        timestamp: number; session_id: string; tool_name: string
        params: string; result: string; duration_ms: number
        approval_required: number; approved_by: string | null
      }>
      total: number; page: number; pages: number; limit: number
    }>(`/api/audit?${q.toString()}`)
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

  testLlm: () =>
    request<{ ok: boolean; response?: string; model?: string; error?: string }>(
      "/api/settings/test-llm", { method: "POST" },
    ),

  schedules: () =>
    request<{ schedules: Schedule[] }>("/api/schedules"),

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

  plugins: () => request<Plugin[]>("/api/plugins"),

  installPlugin: (body: { name: string; version: string; description?: string; entryPath: string }) =>
    request<Plugin>("/api/plugins", { method: "POST", body: JSON.stringify(body) }),

  updatePlugin: (name: string, body: { enabled?: boolean; config?: Record<string, unknown> }) =>
    request<Plugin>(`/api/plugins/${name}`, { method: "PATCH", body: JSON.stringify(body) }),

  uninstallPlugin: (name: string) =>
    request<void>(`/api/plugins/${name}`, { method: "DELETE" }),
}

export type { StatusResponse, SetupChecksResponse, TestBackendResponse, TestMcpServerResponse, TestSkillPathResponse, TestTelegramResponse, ResetSetupResponse, FeatureCapability, MqttRuntimeResponse }

export interface Schedule {
  id: string
  name: string
  cron_expression: string
  prompt: string
  enabled: boolean
  model: string | null
  last_run_at: number | null
  next_run_at: number | null
  created_at: number
  updated_at: number
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
