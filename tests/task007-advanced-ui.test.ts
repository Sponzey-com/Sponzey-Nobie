import { describe, expect, it } from "vitest"
import type { SetupChecksResponse, StatusResponse } from "../packages/webui/src/api/adapters/types.ts"
import type { DoctorReport } from "../packages/webui/src/contracts/doctor.ts"
import type { OperationsSummary } from "../packages/webui/src/contracts/operations.ts"
import type { RootRun } from "../packages/webui/src/contracts/runs.ts"
import type { SetupDraft } from "../packages/webui/src/contracts/setup.ts"
import { buildAdvancedDashboardCards, loadAdvancedDashboardSources } from "../packages/webui/src/lib/advanced-dashboard.js"
import {
  ADVANCED_SETTINGS_TAB_ORDER,
  buildAdvancedSettingsTabs,
  hasMultipleAiConnectionCreationTab,
  isDraftSavingAdvancedSettingsTab,
  resolveAdvancedSettingsPath,
  resolveAdvancedSettingsTabFromPath,
} from "../packages/webui/src/lib/advanced-settings.js"

function draft(): SetupDraft {
  return {
    personal: { profileName: "", displayName: "", language: "ko", timezone: "Asia/Seoul", workspace: "" },
    aiBackends: [
      {
        id: "provider:openai",
        label: "OpenAI",
        kind: "provider",
        providerType: "openai",
        authMode: "chatgpt_oauth",
        credentials: { oauthAuthFilePath: "/Users/example/.codex/auth.json" },
        local: false,
        enabled: true,
        availableModels: ["gpt-5.4"],
        defaultModel: "gpt-5.4",
        status: "ready",
        summary: "primary",
        tags: ["primary"],
        endpoint: "https://api.openai.com/v1",
      },
    ],
    routingProfiles: [{ id: "default", label: "Default", targets: ["provider:openai"] }],
    mcp: { servers: [] },
    skills: { items: [] },
    security: { approvalMode: "on-miss", approvalTimeout: 60, approvalTimeoutFallback: "deny", maxDelegationTurns: 5 },
    channels: {
      telegramEnabled: true,
      botToken: "123:token",
      allowedUserIds: "",
      allowedGroupIds: "",
      slackEnabled: false,
      slackBotToken: "",
      slackAppToken: "",
      slackAllowedUserIds: "",
      slackAllowedChannelIds: "",
    },
    mqtt: { enabled: true, host: "0.0.0.0", port: 1883, username: "u", password: "p" },
    remoteAccess: { authEnabled: false, authToken: "", host: "127.0.0.1", port: 18888 },
  }
}

function checks(): SetupChecksResponse {
  return {
    stateDir: "/tmp/nobie-task007",
    configFile: "/tmp/config.json",
    setupStateFile: "/tmp/setup.json",
    setupCompleted: true,
    telegramConfigured: true,
    authEnabled: false,
    schedulerEnabled: true,
  }
}

function run(overrides: Partial<RootRun>): RootRun {
  const now = 1_776_489_600_000
  return {
    id: "run-task007",
    sessionId: "session-task007",
    requestGroupId: "run-task007",
    lineageRootRunId: "run-task007",
    runScope: "root",
    title: "메인 화면 캡쳐",
    prompt: "메인 화면 캡쳐",
    source: "webui",
    status: "completed",
    taskProfile: "general_chat",
    contextMode: "full",
    delegationTurnCount: 0,
    maxDelegationTurns: 0,
    currentStepKey: "done",
    currentStepIndex: 1,
    totalSteps: 1,
    summary: "완료",
    canCancel: false,
    createdAt: now,
    updatedAt: now,
    steps: [],
    recentEvents: [],
    ...overrides,
  }
}

function operations(): OperationsSummary {
  return {
    generatedAt: 1_776_489_600_000,
    health: {
      overall: { key: "overall", label: "overall", status: "ok", reason: "ok", count: 0 },
      memory: { key: "memory", label: "memory", status: "ok", reason: "ok", count: 0 },
      vector: { key: "vector", label: "vector", status: "ok", reason: "ok", count: 0 },
      schedule: { key: "schedule", label: "schedule", status: "ok", reason: "ok", count: 0 },
      channel: { key: "channel", label: "channel", status: "ok", reason: "ok", count: 0 },
    },
    repeatedIssues: [{ key: "channel-send", kind: "channel", label: "channel send", status: "degraded", count: 2, lastAt: 1_776_489_600_000, sample: "delivery retry" }],
    stale: { thresholdMs: 60000, pendingApprovals: [], pendingDeliveries: [], runs: [], total: 0 },
    counts: { runs: 2, tasks: 2, repeatedIssues: 1, stale: 0 },
  }
}

function doctor(): DoctorReport {
  return {
    kind: "nobie.doctor.report",
    version: 1,
    id: "doctor-task007",
    mode: "quick",
    createdAt: "2026-04-18T00:00:00.000Z",
    overallStatus: "warning",
    runtimeManifestId: "manifest-task007",
    checks: [],
    summary: { ok: 4, warning: 1, blocked: 0, unknown: 0 },
    manifest: {
      id: "manifest-task007",
      app: { displayVersion: "0.1.5", gitDescribe: "v0.1.5" },
      database: { currentVersion: 1, latestVersion: 1, upToDate: true },
      promptSources: { count: 4, checksum: "abc", localeParityOk: true },
      provider: { provider: "openai", model: "gpt-5.4", profileId: "default" },
    },
  }
}

describe("task007 advanced dashboard and settings", () => {
  it("loads dashboard sources independently and keeps successful cards available when one source fails", async () => {
    const result = await loadAdvancedDashboardSources({
      status: async () => ({ primaryAiTarget: "provider:openai", setupCompleted: true, mqtt: { running: true } } as StatusResponse),
      runs: async () => { throw new Error("<!doctype html><html><body>403 Bearer sk-secret</body></html>") },
      operations: async () => operations(),
      doctor: async () => doctor(),
    }, "ko")

    expect(result.sources.status?.primaryAiTarget).toBe("provider:openai")
    expect(result.sources.operations?.counts.repeatedIssues).toBe(1)
    expect(result.sources.doctor?.overallStatus).toBe("warning")
    expect(result.errors.runs).toContain("AI 인증 또는 권한")
    expect(result.errors.runs).not.toMatch(/<!doctype|Bearer|sk-secret/i)
  })

  it("builds advanced dashboard cards with failure isolation by card", () => {
    const cards = buildAdvancedDashboardCards({
      draft: draft(),
      checks: checks(),
      status: { primaryAiTarget: "provider:openai", setupCompleted: true, mqtt: { running: true } } as StatusResponse,
      runs: [run({ id: "run-approval", status: "awaiting_approval", title: "승인 필요" }), run({ id: "run-failed", status: "failed", title: "전송 실패" })],
      operations: operations(),
      doctor: doctor(),
      errors: { runs: "실행 목록을 불러오지 못했습니다." },
      loading: false,
      language: "ko",
    })

    expect(cards.map((card) => card.id)).toEqual(["connections", "recent_runs", "pending_approvals", "warnings", "doctor"])
    expect(cards.find((card) => card.id === "connections")?.status).toBe("ready")
    expect(cards.find((card) => card.id === "recent_runs")?.status).toBe("error")
    expect(cards.find((card) => card.id === "doctor")?.status).toBe("ready")
    expect(cards.find((card) => card.id === "pending_approvals")?.summary).toContain("실행 목록")
  })

  it("defines advanced settings around process tabs without multi-AI creation", () => {
    const tabs = buildAdvancedSettingsTabs("ko")

    expect(tabs.map((tab) => tab.id)).toEqual(ADVANCED_SETTINGS_TAB_ORDER)
    expect(tabs.map((tab) => tab.label)).toEqual(["AI 연결", "채널", "연장", "메모리", "스케줄", "도구 권한", "백업/배포"])
    expect(hasMultipleAiConnectionCreationTab(tabs)).toBe(false)
    expect(isDraftSavingAdvancedSettingsTab("ai")).toBe(true)
    expect(isDraftSavingAdvancedSettingsTab("memory")).toBe(false)
    expect(isDraftSavingAdvancedSettingsTab("release")).toBe(false)
    expect(resolveAdvancedSettingsTabFromPath("/advanced/channels")).toBe("channels")
    expect(resolveAdvancedSettingsTabFromPath("/advanced/extensions")).toBe("yeonjang")
    expect(resolveAdvancedSettingsPath("tool_permissions")).toBe("/advanced/tools")
  })
})
