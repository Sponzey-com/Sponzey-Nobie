import { describe, expect, it } from "vitest"
import type { SetupChecksResponse } from "../packages/webui/src/api/adapters/types.ts"
import type { UiShellResponse } from "../packages/webui/src/api/client.ts"
import type { FeatureCapability } from "../packages/webui/src/contracts/capabilities.ts"
import type { SetupDraft, SetupState } from "../packages/webui/src/contracts/setup.ts"
import { SetupVisualizationCanvas, SetupVisualizationLegend } from "../packages/webui/src/components/setup/SetupVisualizationCanvas.tsx"
import { isSetupStepDirty, revertSetupStepDraft } from "../packages/webui/src/lib/setupFlow.ts"
import { buildSetupVisualizationRegistry } from "../packages/webui/src/lib/setup-visualization-scenes.ts"

function draft(overrides: Partial<SetupDraft> = {}): SetupDraft {
  const base: SetupDraft = {
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
  return {
    ...base,
    ...overrides,
    personal: {
      ...base.personal,
      ...(overrides.personal ?? {}),
    },
  }
}

function checks(): SetupChecksResponse {
  return {
    stateDir: "/tmp/nobie-task003",
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
    { key: "mcp.client", label: "MCP Client", area: "mcp", status: "planned", implemented: true, enabled: false },
  ]
}

function state(currentStep: SetupState["currentStep"] = "welcome"): SetupState {
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

describe("task003 welcome/personal visualization", () => {
  it("builds a full welcome overview map and renders it as a step visualization", () => {
    const registry = buildSetupVisualizationRegistry({
      draft: draft(),
      checks: checks(),
      shell: shell(),
      capabilities: capabilities(),
      state: state("welcome"),
      language: "ko",
    })
    const welcomeScene = registry.scenesById["scene:welcome"]!
    const canvasTree = SetupVisualizationCanvas({
      scene: welcomeScene,
      language: "ko",
      selectedNodeId: "node:personal",
      onSelectNode: () => undefined,
    })
    const legendTree = SetupVisualizationLegend({ scene: welcomeScene, language: "ko" })

    expect(welcomeScene.nodes.map((node) => node.semanticStepIds?.[0])).toEqual([
      "welcome",
      "personal",
      "ai_backends",
      "mcp",
      "skills",
      "security",
      "channels",
      "remote_access",
      "review",
      "done",
    ])
    expect(welcomeScene.nodes.filter((node) => node.badges.includes("required")).map((node) => node.semanticStepIds?.[0])).toEqual([
      "personal",
      "ai_backends",
      "channels",
    ])
    expect(findDataValues(canvasTree, "data-setup-visual-node")).toContain("node:personal")
    expect(findDataValues(canvasTree, "data-setup-visual-node")).toContain("node:remote_access")
    expect(collectText(canvasTree)).toEqual(expect.arrayContaining(["환영", "개인 정보", "AI 연결", "원격 접근", "완료"]))
    expect(collectText(legendTree)).toEqual(expect.arrayContaining(["준비됨", "필수", "시각화 범례"]))
  })

  it("projects personal validation to node states and overlay alerts", () => {
    const invalidRegistry = buildSetupVisualizationRegistry({
      draft: draft({
        personal: {
          profileName: "",
          displayName: "",
          language: "",
          timezone: "",
          workspace: "./Work",
        },
      }),
      checks: checks(),
      shell: shell(),
      capabilities: capabilities(),
      state: state("personal"),
      language: "ko",
    })
    const personalScene = invalidRegistry.scenesById["scene:personal"]!
    const nodeStatusById = Object.fromEntries(personalScene.nodes.map((node) => [node.id, node.status]))

    expect(nodeStatusById["node:personal:identity"]).toBe("required")
    expect(nodeStatusById["node:personal:language"]).toBe("required")
    expect(nodeStatusById["node:personal:timezone"]).toBe("required")
    expect(nodeStatusById["node:personal:workspace"]).toBe("error")
    expect(personalScene.alerts).toEqual(expect.arrayContaining([
      expect.objectContaining({
        message: "이름을 입력해야 합니다.",
        relatedNodeIds: ["node:personal:identity"],
      }),
      expect.objectContaining({
        message: "작업 폴더는 전체 경로로 입력해야 합니다.",
        relatedNodeIds: ["node:personal:workspace"],
        tone: "error",
      }),
    ]))
  })

  it("restores personal graph state when cancel reverts local changes", () => {
    const savedDraft = draft()
    const localDraft = draft({
      personal: {
        profileName: "dongwoo",
        displayName: "",
        language: "ko",
        timezone: "Asia/Seoul",
        workspace: "./relative",
      },
    })

    expect(isSetupStepDirty(savedDraft, localDraft, "personal")).toBe(true)

    const dirtyScene = buildSetupVisualizationRegistry({
      draft: localDraft,
      checks: checks(),
      shell: shell(),
      capabilities: capabilities(),
      state: state("personal"),
      language: "ko",
    }).scenesById["scene:personal"]!

    expect(dirtyScene.nodes.find((node) => node.id === "node:personal:identity")?.status).toBe("required")
    expect(dirtyScene.nodes.find((node) => node.id === "node:personal:workspace")?.status).toBe("error")

    const revertedDraft = revertSetupStepDraft(localDraft, savedDraft, "personal")
    const revertedScene = buildSetupVisualizationRegistry({
      draft: revertedDraft,
      checks: checks(),
      shell: shell(),
      capabilities: capabilities(),
      state: state("personal"),
      language: "ko",
    }).scenesById["scene:personal"]!

    expect(revertedScene.nodes.find((node) => node.id === "node:personal:identity")?.status).toBe("ready")
    expect(revertedScene.nodes.find((node) => node.id === "node:personal:workspace")?.status).toBe("ready")
    expect(revertedScene.alerts).toBeUndefined()
  })
})
