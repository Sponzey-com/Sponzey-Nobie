import { describe, expect, it } from "vitest"
import type { SetupChecksResponse } from "../packages/webui/src/api/adapters/types.ts"
import type { UiShellResponse } from "../packages/webui/src/api/client.ts"
import type { FeatureCapability } from "../packages/webui/src/contracts/capabilities.ts"
import type { SetupDraft, SetupState } from "../packages/webui/src/contracts/setup.ts"
import { SetupVisualizationCanvas } from "../packages/webui/src/components/setup/SetupVisualizationCanvas.tsx"
import { mergeSetupStepDraft, revertSetupStepDraft } from "../packages/webui/src/lib/setupFlow.ts"
import { setSingleAiBackendEnabled } from "../packages/webui/src/lib/single-ai.ts"
import { buildSetupVisualizationRegistry } from "../packages/webui/src/lib/setup-visualization-scenes.ts"

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
      {
        id: "provider:ollama",
        label: "Ollama",
        kind: "provider",
        providerType: "ollama",
        authMode: "api_key",
        credentials: {},
        local: true,
        enabled: false,
        availableModels: [],
        defaultModel: "",
        status: "disabled",
        summary: "Local standby connection",
        tags: ["standby"],
        endpoint: "http://127.0.0.1:11434/v1",
      },
      {
        id: "provider:anthropic",
        label: "Anthropic",
        kind: "provider",
        providerType: "anthropic",
        authMode: "api_key",
        credentials: { apiKey: "sk-ant-live" },
        local: false,
        enabled: false,
        availableModels: [],
        defaultModel: "",
        status: "error",
        summary: "Secondary cloud connection",
        tags: ["error"],
        endpoint: "https://api.anthropic.com",
        reason: "upstream timeout",
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

function checks(): SetupChecksResponse {
  return {
    stateDir: "/tmp/nobie-task004",
    configFile: "/tmp/nobie-config.json",
    setupStateFile: "/tmp/nobie-setup.json",
    setupCompleted: false,
    telegramConfigured: true,
    authEnabled: true,
    schedulerEnabled: false,
  }
}

function shell(): UiShellResponse {
  return {
    generatedAt: 1,
    mode: {
      mode: "advanced",
      preferredUiMode: "advanced",
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

function visitNode(node: unknown, visit: (candidate: Record<string, unknown>) => void) {
  if (node == null || typeof node === "boolean") return

  if (Array.isArray(node)) {
    for (const item of node) {
      visitNode(item, visit)
    }
    return
  }

  if (typeof node === "object" && "props" in node) {
    const candidate = node as Record<string, unknown>
    const type = candidate.type
    if (typeof type === "function") {
      visitNode(type(candidate.props as never), visit)
      return
    }
    visit(candidate)
    const props = candidate.props
    if (props && typeof props === "object" && "children" in props) {
      visitNode((props as Record<string, unknown>).children, visit)
    }
  }
}

function collectText(node: unknown): string[] {
  const values: string[] = []

  const walk = (candidate: unknown) => {
    if (candidate == null || typeof candidate === "boolean") return
    if (typeof candidate === "string" || typeof candidate === "number") {
      values.push(String(candidate))
      return
    }
    if (Array.isArray(candidate)) {
      for (const item of candidate) walk(item)
      return
    }
    if (typeof candidate === "object" && "props" in candidate) {
      const type = (candidate as { type?: unknown }).type
      if (typeof type === "function") {
        walk(type((candidate as { props?: Record<string, unknown> }).props as never))
        return
      }
      const props = (candidate as { props?: Record<string, unknown> }).props
      if (props && "children" in props) {
        walk(props.children)
      }
    }
  }

  walk(node)
  return values
}

function findDataValues(node: unknown, key: string): string[] {
  const values: string[] = []
  visitNode(node, (candidate) => {
    const props = candidate.props
    if (!props || typeof props !== "object") return
    const value = (props as Record<string, unknown>)[key]
    if (typeof value === "string") values.push(value)
  })
  return values
}

describe("task004 AI visualization topology", () => {
  it("projects ai_backends as a single-AI topology with readiness badges and backend alerts", () => {
    const registry = buildSetupVisualizationRegistry({
      draft: draft(),
      checks: checks(),
      shell: shell(),
      capabilities: capabilities(),
      state: state("ai_backends"),
      language: "ko",
      includeAdvancedOptionalScenes: true,
    })
    const scene = registry.scenesById["scene:ai_backends"]!

    const router = scene.nodes.find((node) => node.id === "node:ai:router")
    const openai = scene.nodes.find((node) => node.id === "node:ai:provider:openai")
    const ollama = scene.nodes.find((node) => node.id === "node:ai:provider:ollama")
    const anthropic = scene.nodes.find((node) => node.id === "node:ai:provider:anthropic")

    expect(router).toEqual(expect.objectContaining({
      label: "Nobie Core Router",
      badges: expect.arrayContaining(["profiles:1", "single-ai"]),
    }))
    expect(openai).toEqual(expect.objectContaining({
      status: "ready",
      badges: expect.arrayContaining(["openai", "active", "auth:ready", "endpoint:ready", "model:ready"]),
    }))
    expect(ollama).toEqual(expect.objectContaining({
      status: "draft",
      badges: expect.arrayContaining(["ollama", "standby", "endpoint:ready", "model:missing"]),
    }))
    expect(anthropic).toEqual(expect.objectContaining({
      status: "warning",
    }))
    expect(scene.alerts?.map((alert) => alert.message)).toContain("Anthropic: upstream timeout")
  })

  it("renders dedicated canvas layouts for ai_backends and ai_routing scenes", () => {
    const registry = buildSetupVisualizationRegistry({
      draft: draft(),
      checks: checks(),
      shell: shell(),
      capabilities: capabilities(),
      state: state("ai_backends"),
      language: "ko",
      includeAdvancedOptionalScenes: true,
    })
    const backendsCanvas = SetupVisualizationCanvas({
      scene: registry.scenesById["scene:ai_backends"]!,
      language: "ko",
      selectedNodeId: "node:ai:provider:openai",
      onSelectNode: () => undefined,
    })
    const routingCanvas = SetupVisualizationCanvas({
      scene: registry.scenesById["scene:ai_routing"]!,
      language: "ko",
      selectedNodeId: "node:routing:provider:openai",
      onSelectNode: () => undefined,
    })

    expect(findDataValues(backendsCanvas, "data-setup-visual-node")).toEqual(expect.arrayContaining([
      "node:ai:router",
      "node:ai:provider:openai",
      "node:ai:provider:ollama",
    ]))
    expect(collectText(backendsCanvas)).toEqual(expect.arrayContaining([
      "Nobie Core Router",
      "대기 중이거나 아직 준비되지 않은 연결",
      "현재 선택된 backend",
    ]))

    expect(findDataValues(routingCanvas, "data-setup-visual-node")).toEqual(expect.arrayContaining([
      "node:routing:profile",
      "node:routing:router",
      "node:routing:provider:openai",
    ]))
    expect(collectText(routingCanvas)).toEqual(expect.arrayContaining([
      "Nobie Core Router",
      "Default",
      "이 장면은 list editor의 우선순위를 그대로 보여주는 projection입니다.",
    ]))
  })

  it("keeps routingProfiles coupled to ai_backends merge and revert semantics", () => {
    const savedDraft = draft()
    const localDraft = setSingleAiBackendEnabled(structuredClone(savedDraft), "provider:ollama", true)

    const merged = mergeSetupStepDraft(savedDraft, localDraft, "ai_backends")
    expect(merged.aiBackends.find((backend) => backend.id === "provider:ollama")?.enabled).toBe(true)
    expect(merged.routingProfiles[0]?.targets).toEqual(["provider:ollama"])

    const reverted = revertSetupStepDraft(localDraft, savedDraft, "ai_backends")
    expect(reverted.aiBackends.find((backend) => backend.id === "provider:openai")?.enabled).toBe(true)
    expect(reverted.routingProfiles[0]?.targets).toEqual(["provider:openai"])
  })
})
