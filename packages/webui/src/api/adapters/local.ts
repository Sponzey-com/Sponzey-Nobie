import type { FeatureCapability } from "../../contracts/capabilities"
import type { AIAuthMode, AIBackendCredentials, AIProviderType } from "../../contracts/ai"
import type { McpServersResponse } from "../../contracts/mcp"
import type { SetupDraft, SetupMcpServerDraft, SetupState } from "../../contracts/setup"
import type {
  ControlPlaneAdapter,
  ResetSetupResponse,
  SetupChecksResponse,
  StatusResponse,
  TestBackendResponse,
  TestMcpServerResponse,
  TestSkillPathResponse,
  TestTelegramResponse,
} from "./types"

const BASE = ""

function authHeaders(): Record<string, string> {
  const token = localStorage.getItem("nobie_token") ?? localStorage.getItem("wizby_token") ?? localStorage.getItem("howie_token") ?? ""
  return token ? { Authorization: `Bearer ${token}` } : {}
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const hasBody = init?.body !== undefined
  const response = await fetch(`${BASE}${path}`, {
    headers: {
      ...authHeaders(),
      ...(hasBody ? { "Content-Type": "application/json" } : {}),
      ...init?.headers,
    },
    ...init,
  })

  if (!response.ok) {
    const bodyText = await response.text().catch(() => "")
    let detail = bodyText.trim()
    if (detail) {
      try {
        const parsed = JSON.parse(detail) as { error?: string; message?: string }
        detail = parsed.message?.trim() || parsed.error?.trim() || detail
      } catch {
        // keep raw text
      }
    }
    throw new Error(detail ? `${response.status} ${response.statusText}: ${detail}` : `${response.status} ${response.statusText}`)
  }

  return response.json() as Promise<T>
}

export const localAdapter: ControlPlaneAdapter = {
  name: "local",
  getStatus: () => request<StatusResponse>("/api/status"),
  getCapabilities: () => request<{ items: FeatureCapability[]; generatedAt: number }>("/api/capabilities"),
  getCapability: (key) => request<FeatureCapability>(`/api/capabilities/${key}`),
  getSetupStatus: () => request<SetupState>("/api/setup/status"),
  getSetupChecks: () => request<SetupChecksResponse>("/api/setup/checks"),
  getSetupDraft: () => request<SetupDraft>("/api/setup/draft"),
  saveSetupDraft: (payload) =>
    request<{ draft: SetupDraft; state: SetupState }>("/api/setup/draft", {
      method: "PUT",
      body: JSON.stringify(payload),
    }),
  resetSetup: () => request<ResetSetupResponse>("/api/setup/reset", { method: "POST" }),
  completeSetup: () => request<SetupState>("/api/setup/complete", { method: "POST" }),
  testBackend: (endpoint: string, providerType: AIProviderType, credentials: AIBackendCredentials, authMode?: AIAuthMode) =>
    request<TestBackendResponse>("/api/setup/test-backend", {
      method: "POST",
      body: JSON.stringify({ endpoint, providerType, credentials, authMode }),
    }),
  testTelegram: (botToken) =>
    request<TestTelegramResponse>("/api/setup/test-telegram", {
      method: "POST",
      body: JSON.stringify({ botToken }),
    }),
  testMcpServer: (server: SetupMcpServerDraft) =>
    request<TestMcpServerResponse>("/api/setup/test-mcp-server", {
      method: "POST",
      body: JSON.stringify({ server }),
    }),
  testSkillPath: (path: string) =>
    request<TestSkillPathResponse>("/api/setup/test-skill-path", {
      method: "POST",
      body: JSON.stringify({ path }),
    }),
  generateAuthToken: () =>
    request<{ token: string }>("/api/setup/generate-auth-token", { method: "POST" }),
  getMcpServers: () => request<McpServersResponse>("/api/mcp/servers"),
  reloadMcpServers: () => request<McpServersResponse>("/api/mcp/reload", { method: "POST" }),
}
