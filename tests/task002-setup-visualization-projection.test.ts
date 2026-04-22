import { describe, expect, it } from "vitest"
import type { SetupChecksResponse } from "../packages/webui/src/api/adapters/types.ts"
import type { UiShellResponse } from "../packages/webui/src/api/client.ts"
import type { FeatureCapability } from "../packages/webui/src/contracts/capabilities.ts"
import type { SetupDraft, SetupState } from "../packages/webui/src/contracts/setup.ts"
import {
  buildBeginnerConnectionCards,
  buildBeginnerSetupSteps,
} from "../packages/webui/src/lib/beginner-setup.ts"
import {
  buildAdvancedVisualizationState,
  beginnerSelectionCoversAdvancedStep,
  mapAdvancedStepToBeginnerStep,
  resolveAdvancedStepForBeginnerSelection,
} from "../packages/webui/src/lib/setup-visualization-advanced.ts"
import { buildBeginnerVisualizationDeck } from "../packages/webui/src/lib/setup-visualization-beginner.ts"
import { buildSetupVisualizationRegistry } from "../packages/webui/src/lib/setup-visualization-scenes.ts"
import { normalizeBeginnerSetupVisualizationStatus } from "../packages/webui/src/lib/setup-visualization.ts"

function draft(): SetupDraft {
  return {
    personal: {
      profileName: "dongwoo",
      displayName: "Dongwoo",
      language: "ko",
      timezone: "Asia/Seoul",
      workspace: "/Users/dongwoo/work",
    },
    aiBackends: [
      {
        id: "provider:openai",
        label: "OpenAI",
        kind: "provider",
        providerType: "openai",
        authMode: "api_key",
        credentials: { apiKey: "sk-live" },
        local: false,
        enabled: true,
        availableModels: ["gpt-5.4"],
        defaultModel: "gpt-5.4",
        status: "ready",
        summary: "Primary AI connection",
        tags: ["primary"],
        endpoint: "https://api.openai.com/v1",
      },
    ],
    routingProfiles: [{ id: "default", label: "Default", targets: ["provider:openai"] }],
    mcp: { servers: [] },
    skills: { items: [] },
    security: {
      approvalMode: "on-miss",
      approvalTimeout: 60,
      approvalTimeoutFallback: "deny",
      maxDelegationTurns: 5,
    },
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
    mqtt: {
      enabled: true,
      host: "127.0.0.1",
      port: 1883,
      username: "mqtt-user",
      password: "mqtt-pass",
    },
    remoteAccess: {
      authEnabled: true,
      authToken: "secret-token",
      host: "127.0.0.1",
      port: 18888,
    },
  }
}

function checks(overrides: Partial<SetupChecksResponse> = {}): SetupChecksResponse {
  return {
    stateDir: "/tmp/nobie-task002",
    configFile: "/tmp/nobie-config.json",
    setupStateFile: "/tmp/nobie-setup.json",
    setupCompleted: false,
    telegramConfigured: true,
    authEnabled: true,
    schedulerEnabled: false,
    ...overrides,
  }
}

function shell(): UiShellResponse {
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
      ai: { configured: true, provider: "openai", modelConfigured: true },
      channels: { webui: true, telegramConfigured: true, telegramEnabled: true, slackConfigured: false, slackEnabled: false },
      yeonjang: { mqttEnabled: true, connectedExtensions: 1 },
    },
    activeRuns: { total: 0, pendingApprovals: 0 },
    viewModel: {} as UiShellResponse["viewModel"],
  }
}

function capabilities(): FeatureCapability[] {
  return [
    { key: "ai.backends", label: "AI Backends", area: "ai", status: "ready", implemented: true, enabled: true },
    { key: "telegram.channel", label: "Telegram", area: "telegram", status: "ready", implemented: true, enabled: true },
    { key: "settings.control", label: "Settings Control", area: "security", status: "ready", implemented: true, enabled: true },
    { key: "mcp.client", label: "MCP Client", area: "mcp", status: "planned", implemented: true, enabled: false },
  ]
}

function state(currentStep: SetupState["currentStep"] = "ai_backends"): SetupState {
  return {
    version: 1,
    completed: false,
    currentStep,
    skipped: {
      telegram: false,
      remoteAccess: false,
    },
  }
}

describe("task002 setup visualization projection", () => {
  it("projects shared scenes and beginner cards from the same semantic source", () => {
    const sharedDraft = draft()
    const sharedChecks = checks()
    const sharedShell = shell()
    const registry = buildSetupVisualizationRegistry({
      draft: sharedDraft,
      checks: sharedChecks,
      shell: sharedShell,
      capabilities: capabilities(),
      state: state(),
      language: "ko",
    })
    const beginnerSteps = buildBeginnerSetupSteps({
      draft: sharedDraft,
      checks: sharedChecks,
      shell: sharedShell,
      language: "ko",
      aiTestOk: true,
    })
    const beginnerConnections = buildBeginnerConnectionCards({
      draft: sharedDraft,
      checks: sharedChecks,
      shell: sharedShell,
      language: "ko",
    })
    const deck = buildBeginnerVisualizationDeck({
      steps: beginnerSteps,
      connections: beginnerConnections,
      registry,
      selectedStepId: "ai",
    })

    expect(registry.sceneOrder).toEqual([
      "scene:welcome",
      "scene:personal",
      "scene:ai_backends",
      "scene:mcp",
      "scene:skills",
      "scene:security",
      "scene:channels",
      "scene:remote_access",
      "scene:review",
      "scene:done",
    ])

    expect(deck.cards.map((card) => [card.id, card.sceneIds])).toEqual([
      ["ai", ["scene:ai_backends"]],
      ["channels", ["scene:channels"]],
      ["computer", ["scene:remote_access"]],
      ["test", ["scene:review", "scene:done"]],
    ])

    const aiCard = deck.cards.find((card) => card.id === "ai")
    const channelsCard = deck.cards.find((card) => card.id === "channels")
    const computerCard = deck.cards.find((card) => card.id === "computer")
    expect(aiCard?.semanticStatus).toBe(normalizeBeginnerSetupVisualizationStatus(beginnerSteps.find((step) => step.id === "ai")!.status))
    expect(channelsCard?.semanticStatus).toBe(normalizeBeginnerSetupVisualizationStatus(beginnerSteps.find((step) => step.id === "channels")!.status))
    expect(computerCard?.semanticStatus).toBe(normalizeBeginnerSetupVisualizationStatus(beginnerSteps.find((step) => step.id === "computer")!.status))
    expect(JSON.stringify(deck)).not.toMatch(/task|phase|raw|verdict/i)
  })

  it("keeps selection semantics stable across beginner and advanced mode mappings", () => {
    expect(mapAdvancedStepToBeginnerStep("personal")).toBe("ai")
    expect(mapAdvancedStepToBeginnerStep("security")).toBe("computer")
    expect(resolveAdvancedStepForBeginnerSelection("computer", "security")).toBe("security")
    expect(resolveAdvancedStepForBeginnerSelection("computer", "welcome")).toBe("remote_access")
    expect(beginnerSelectionCoversAdvancedStep("ai", "personal")).toBe(true)
    expect(beginnerSelectionCoversAdvancedStep("channels", "security")).toBe(false)
  })

  it("treats ai_routing as an optional advanced-only scene and falls back safely when absent", () => {
    const sharedInput = {
      draft: draft(),
      checks: checks(),
      shell: shell(),
      capabilities: capabilities(),
      state: state("ai_routing"),
      language: "ko" as const,
    }

    const baseRegistry = buildSetupVisualizationRegistry(sharedInput)
    expect(baseRegistry.sceneIdByStepId.ai_routing).toBeUndefined()

    const fallback = buildAdvancedVisualizationState({
      registry: baseRegistry,
      currentStep: "ai_routing",
    })
    expect(fallback).toEqual(expect.objectContaining({
      stepId: "ai_backends",
      sceneId: "scene:ai_backends",
      fallbackApplied: true,
    }))

    const advancedRegistry = buildSetupVisualizationRegistry({
      ...sharedInput,
      includeAdvancedOptionalScenes: true,
    })
    expect(advancedRegistry.sceneIdByStepId.ai_routing).toBe("scene:ai_routing")

    const direct = buildAdvancedVisualizationState({
      registry: advancedRegistry,
      currentStep: "ai_routing",
    })
    expect(direct).toEqual(expect.objectContaining({
      stepId: "ai_routing",
      sceneId: "scene:ai_routing",
      fallbackApplied: false,
    }))
  })
})
