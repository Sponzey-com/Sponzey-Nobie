import { describe, expect, it } from "vitest"
import type { SetupChecksResponse } from "../packages/webui/src/api/adapters/types.ts"
import type { UiShellResponse } from "../packages/webui/src/api/client.ts"
import type { SetupDraft } from "../packages/webui/src/contracts/setup.ts"
import {
  buildBeginnerConnectionCards,
  buildBeginnerSetupSmokeResult,
  buildBeginnerSetupSteps,
  getBeginnerActiveAiBackend,
  isBeginnerAiConfigured,
  markBeginnerAiTestResult,
  sanitizeBeginnerSetupError,
  upsertBeginnerAiBackend,
} from "../packages/webui/src/lib/beginner-setup.js"

function draft(overrides: Partial<SetupDraft> = {}): SetupDraft {
  const base: SetupDraft = {
    personal: {
      profileName: "",
      displayName: "",
      language: "ko",
      timezone: "Asia/Seoul",
      workspace: "",
    },
    aiBackends: [],
    routingProfiles: [],
    mcp: { servers: [] },
    skills: { items: [] },
    security: {
      approvalMode: "on-miss",
      approvalTimeout: 60,
      approvalTimeoutFallback: "deny",
      maxDelegationTurns: 5,
    },
    channels: {
      telegramEnabled: false,
      botToken: "",
      allowedUserIds: "",
      allowedGroupIds: "",
      slackEnabled: false,
      slackBotToken: "",
      slackAppToken: "",
      slackAllowedUserIds: "",
      slackAllowedChannelIds: "",
    },
    mqtt: {
      enabled: false,
      host: "0.0.0.0",
      port: 1883,
      username: "",
      password: "",
    },
    remoteAccess: {
      authEnabled: false,
      authToken: "",
      host: "127.0.0.1",
      port: 18888,
    },
  }
  return { ...base, ...overrides }
}

function checks(overrides: Partial<SetupChecksResponse> = {}): SetupChecksResponse {
  return {
    stateDir: "/tmp/nobie-task006",
    configFile: "",
    setupStateFile: "",
    setupCompleted: false,
    telegramConfigured: false,
    authEnabled: false,
    schedulerEnabled: false,
    ...overrides,
  }
}

function shell(overrides: Partial<UiShellResponse["runtimeHealth"]> = {}): UiShellResponse {
  return {
    generatedAt: 1,
    mode: {
      mode: "beginner",
      preferredUiMode: "beginner",
      availableModes: ["beginner", "advanced"],
      adminEnabled: false,
      canSwitchInUi: true,
      schemaVersion: 1,
    },
    setupState: { completed: false },
    runtimeHealth: {
      ai: { configured: false, provider: null, modelConfigured: false },
      channels: { webui: true, telegramConfigured: false, telegramEnabled: false, slackConfigured: false, slackEnabled: false },
      yeonjang: { mqttEnabled: false, connectedExtensions: 0 },
      ...overrides,
    },
    activeRuns: { total: 0, pendingApprovals: 0 },
    viewModel: {} as UiShellResponse["viewModel"],
  }
}

describe("task006 beginner setup", () => {
  it("builds four beginner steps with clear ready, attention, and skipped states", () => {
    const steps = buildBeginnerSetupSteps({ draft: draft(), checks: checks(), shell: shell(), language: "ko" })

    expect(steps.map((step) => [step.id, step.status])).toEqual([
      ["ai", "needs_attention"],
      ["channels", "skipped"],
      ["computer", "skipped"],
      ["test", "needs_attention"],
    ])
    expect(JSON.stringify(steps)).not.toMatch(/phase|task|raw|verdict/i)
  })

  it("upserts the beginner AI connection without losing saved credentials or routing", () => {
    const saved = upsertBeginnerAiBackend(draft(), {
      providerType: "openai",
      authMode: "chatgpt_oauth",
      endpoint: "https://api.openai.com/v1",
      defaultModel: "gpt-5.4",
      credentials: { oauthAuthFilePath: "/Users/example/.codex/auth.json" },
    })

    const backend = getBeginnerActiveAiBackend(saved)
    expect(backend).toEqual(expect.objectContaining({
      id: "provider:openai",
      enabled: true,
      providerType: "openai",
      authMode: "chatgpt_oauth",
      defaultModel: "gpt-5.4",
      endpoint: "https://api.openai.com/v1",
    }))
    expect(backend?.credentials.oauthAuthFilePath).toContain(".codex/auth.json")
    expect(saved.routingProfiles).toEqual([{ id: "default", label: "Default", targets: ["provider:openai"] }])
    expect(isBeginnerAiConfigured(saved)).toBe(true)
  })

  it("records AI test results while preserving the saved connection fields", () => {
    const saved = upsertBeginnerAiBackend(draft(), {
      providerType: "ollama",
      authMode: "api_key",
      endpoint: "http://127.0.0.1:11434/v1",
      defaultModel: "llama3.2",
      credentials: {},
    })
    const tested = markBeginnerAiTestResult(saved, "provider:ollama", { ok: true, models: ["llama3.2", "qwen2.5"], message: "ok" })
    const backend = getBeginnerActiveAiBackend(tested)

    expect(backend).toEqual(expect.objectContaining({
      providerType: "ollama",
      endpoint: "http://127.0.0.1:11434/v1",
      defaultModel: "llama3.2",
      status: "ready",
      reason: "ok",
    }))
    expect(backend?.availableModels).toEqual(["llama3.2", "qwen2.5"])
  })

  it("builds connection cards for AI, channels, Yeonjang, and storage", () => {
    const configured = upsertBeginnerAiBackend(draft({
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
    }), {
      providerType: "ollama",
      authMode: "api_key",
      endpoint: "http://127.0.0.1:11434/v1",
      defaultModel: "llama3.2",
      credentials: {},
    })
    const cards = buildBeginnerConnectionCards({
      draft: configured,
      checks: checks({ configFile: "/tmp/config.json", setupStateFile: "/tmp/setup.json" }),
      shell: shell({ yeonjang: { mqttEnabled: true, connectedExtensions: 1 } }),
      language: "ko",
    })

    expect(cards.map((card) => [card.id, card.status])).toEqual([
      ["ai", "ready"],
      ["channels", "ready"],
      ["yeonjang", "ready"],
      ["storage", "ready"],
    ])
    expect(cards.map((card) => card.actionLabel)).toEqual(["AI 연결하기", "채널 연결하기", "내 컴퓨터 연결하기", "저장 상태 확인"])
  })

  it("uses strict completion checks for the final beginner smoke result", () => {
    const emptySmoke = buildBeginnerSetupSmokeResult({ draft: draft(), checks: checks(), shell: shell(), language: "ko" })
    expect(emptySmoke.ok).toBe(false)
    expect(emptySmoke.missing).toContain("ai")

    const configured = upsertBeginnerAiBackend(draft(), {
      providerType: "ollama",
      authMode: "api_key",
      endpoint: "http://127.0.0.1:11434/v1",
      defaultModel: "llama3.2",
      credentials: {},
    })
    const readySmoke = buildBeginnerSetupSmokeResult({
      draft: configured,
      checks: checks({ configFile: "/tmp/config.json", setupStateFile: "/tmp/setup.json" }),
      shell: shell(),
      language: "ko",
    })

    expect(readySmoke).toEqual(expect.objectContaining({ ok: true, missing: [] }))
  })

  it("sanitizes setup failures instead of exposing raw service payloads", () => {
    const text = sanitizeBeginnerSetupError("<!doctype html><html><body>403 Forbidden Bearer sk-secret</body></html>", "ko")
    expect(text).toContain("AI 인증 또는 권한")
    expect(text).not.toMatch(/<!doctype|<html|Bearer|sk-secret/i)
  })
})
