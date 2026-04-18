import { describe, expect, it } from "vitest"
import type { SetupChecksResponse, StatusResponse } from "../packages/webui/src/api/adapters/types.ts"
import type { DoctorReport } from "../packages/webui/src/contracts/doctor.ts"
import type { RootRun } from "../packages/webui/src/contracts/runs.ts"
import type { SetupDraft } from "../packages/webui/src/contracts/setup.ts"
import {
  buildBeginnerApprovalCard,
  BEGINNER_ACTION_BUTTON_CLASS,
  BEGINNER_CHAT_COMPOSER_CLASS,
  BEGINNER_CHAT_INPUT_CLASS,
  BEGINNER_CHAT_SCROLL_CLASS,
} from "../packages/webui/src/lib/beginner-workspace.js"
import { buildAdvancedDashboardCards, loadAdvancedDashboardSources } from "../packages/webui/src/lib/advanced-dashboard.js"
import {
  clampUiListLimit,
  getUiAccessibilityPolicy,
  getUiApiBudget,
  getUiListWindowPolicy,
  shouldVirtualizeList,
  validateApiCallsForBudget,
} from "../packages/webui/src/lib/ui-performance.js"
import type { ApprovalRequest } from "../packages/webui/src/stores/chat.ts"

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
        credentials: {},
        local: false,
        enabled: true,
        availableModels: ["gpt-5.4"],
        defaultModel: "gpt-5.4",
        status: "ready",
        summary: "",
        tags: ["primary"],
        endpoint: "https://api.openai.com/v1",
      },
    ],
    routingProfiles: [],
    mcp: { servers: [] },
    skills: { items: [] },
    security: { approvalMode: "on-miss", approvalTimeout: 60, approvalTimeoutFallback: "deny", maxDelegationTurns: 5 },
    channels: {
      telegramEnabled: true,
      botToken: "",
      allowedUserIds: "",
      allowedGroupIds: "",
      slackEnabled: false,
      slackBotToken: "",
      slackAppToken: "",
      slackAllowedUserIds: "",
      slackAllowedChannelIds: "",
    },
    mqtt: { enabled: true, host: "127.0.0.1", port: 1883, username: "", password: "" },
    remoteAccess: { authEnabled: false, authToken: "", host: "127.0.0.1", port: 18888 },
  }
}

function checks(): SetupChecksResponse {
  return {
    stateDir: "/tmp/nobie-task016",
    configFile: "/tmp/config.json",
    setupStateFile: "/tmp/setup.json",
    setupCompleted: true,
    telegramConfigured: true,
    authEnabled: false,
    schedulerEnabled: true,
  }
}

function run(id: string, status: RootRun["status"]): RootRun {
  const now = 1_776_489_600_000
  return {
    id,
    sessionId: "session-task016",
    requestGroupId: id,
    lineageRootRunId: id,
    runScope: "root",
    title: "성능 예산 확인",
    prompt: "성능 예산 확인",
    source: "webui",
    status,
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
  }
}

function doctor(): DoctorReport {
  return {
    kind: "nobie.doctor.report",
    version: 1,
    id: "doctor-task016",
    mode: "quick",
    createdAt: "2026-04-18T00:00:00.000Z",
    overallStatus: "ok",
    runtimeManifestId: "manifest-task016",
    checks: [],
    summary: { ok: 5, warning: 0, blocked: 0, unknown: 0 },
    manifest: {
      id: "manifest-task016",
      app: { displayVersion: "0.1.5", gitDescribe: "v0.1.5" },
      database: { currentVersion: 1, latestVersion: 1, upToDate: true },
      promptSources: { count: 4, checksum: "task016", localeParityOk: true },
      provider: { provider: "openai", model: "gpt-5.4", profileId: "default" },
    },
  }
}

describe("task016 UI performance and accessibility", () => {
  it("keeps beginner home inside a small critical API budget", () => {
    const budget = getUiApiBudget("beginner", "/chat")

    const valid = validateApiCallsForBudget([
      "/api/ui/shell",
      "/api/runs?limit=20",
      "/api/status",
    ], budget)
    const invalid = validateApiCallsForBudget([
      "/api/ui/shell",
      "/api/admin/live",
      "/api/gateway/logs",
      "/api/raw/events",
    ], budget)

    expect(budget.maxInitialRequests).toBeLessThanOrEqual(4)
    expect(valid.ok).toBe(true)
    expect(invalid.ok).toBe(false)
    expect(invalid.blocked).toEqual(["/api/admin/live", "/api/gateway/logs", "/api/raw/events"])
  })

  it("isolates advanced dashboard source failures by card", async () => {
    const result = await loadAdvancedDashboardSources({
      status: async () => ({ primaryAiTarget: "provider:openai", setupCompleted: true, mqtt: { running: true } } as StatusResponse),
      runs: async () => [run("run-task016-completed", "completed"), run("run-task016-failed", "failed")],
      operations: async () => { throw new Error("<!doctype html><html><body>403 Bearer sk-secret</body></html>") },
      doctor: async () => doctor(),
    }, "ko")

    const cards = buildAdvancedDashboardCards({
      draft: draft(),
      checks: checks(),
      status: result.sources.status,
      runs: result.sources.runs,
      operations: result.sources.operations,
      doctor: result.sources.doctor,
      errors: result.errors,
      loading: false,
      language: "ko",
    })

    expect(result.sources.status?.primaryAiTarget).toBe("provider:openai")
    expect(result.sources.runs).toHaveLength(2)
    expect(result.errors.operations).toContain("AI 인증 또는 권한")
    expect(result.errors.operations).not.toMatch(/<!doctype|Bearer|sk-secret/i)
    expect(cards.find((card) => card.id === "connections")?.status).toBe("ready")
    expect(cards.find((card) => card.id === "warnings")?.status).toBe("error")
    expect(cards.find((card) => card.id === "doctor")?.status).toBe("ready")
  })

  it("limits large advanced and admin lists before rendering", () => {
    const advancedPolicy = getUiListWindowPolicy("advanced", "/advanced/runs")
    const adminPolicy = getUiListWindowPolicy("admin", "/admin")

    expect(clampUiListLimit(undefined, advancedPolicy)).toBe(50)
    expect(clampUiListLimit(999, advancedPolicy)).toBe(200)
    expect(shouldVirtualizeList(100, advancedPolicy)).toBe(true)
    expect(clampUiListLimit(9999, adminPolicy)).toBe(500)
    expect(shouldVirtualizeList(200, adminPolicy)).toBe(true)
    expect(adminPolicy.serverSideFilterRequiredAbove).toBe(500)
  })

  it("defines mobile touch, label, and text-status requirements for beginner actions", () => {
    const policy = getUiAccessibilityPolicy("mobile")
    const approval = buildBeginnerApprovalCard({
      runId: "run-task016",
      toolName: "screen_capture",
      params: { extensionId: "yeonjang-main" },
      kind: "approval",
      guidance: "현재 화면 전체를 캡처하려고 합니다.",
    } satisfies ApprovalRequest, "ko")

    expect(policy.minTouchTargetPx).toBeGreaterThanOrEqual(44)
    expect(policy.inputStacksVertically).toBe(true)
    expect(policy.approvalButtonsWrap).toBe(true)
    expect(policy.requiresAriaLabel).toBe(true)
    expect(policy.statusRequiresTextLabel).toBe(true)
    expect(BEGINNER_CHAT_INPUT_CLASS).toContain("min-h-[3rem]")
    expect(BEGINNER_CHAT_SCROLL_CLASS).toContain("flex-1")
    expect(BEGINNER_CHAT_SCROLL_CLASS).toContain("overflow-y-auto")
    expect(BEGINNER_CHAT_COMPOSER_CLASS).toContain("shrink-0")
    expect(BEGINNER_CHAT_COMPOSER_CLASS).toContain("border-t")
    expect(BEGINNER_ACTION_BUTTON_CLASS).toContain("min-h-11")
    expect(approval.actions).toHaveLength(3)
    expect(approval.actions.every((action) => action.label.trim() && action.ariaLabel.trim())).toBe(true)
  })
})
