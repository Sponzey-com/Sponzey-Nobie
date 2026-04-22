import { describe, expect, it } from "vitest"
import type { SetupChecksResponse } from "../packages/webui/src/api/adapters/types.ts"
import type { UiShellResponse } from "../packages/webui/src/api/client.ts"
import type { FeatureCapability } from "../packages/webui/src/contracts/capabilities.ts"
import type { SetupDraft, SetupState } from "../packages/webui/src/contracts/setup.ts"
import { SetupVisualizationCanvas } from "../packages/webui/src/components/setup/SetupVisualizationCanvas.tsx"
import { mergeSetupStepDraft, revertSetupStepDraft } from "../packages/webui/src/lib/setupFlow.ts"
import { buildSetupVisualizationRegistry } from "../packages/webui/src/lib/setup-visualization-scenes.ts"
import { decorateSetupScene } from "../packages/webui/src/pages/SetupPage.tsx"

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
      approvalMode: "off",
      approvalTimeout: 12,
      approvalTimeoutFallback: "allow",
      maxDelegationTurns: 0,
    },
    channels: {
      telegramEnabled: true,
      botToken: "123:token",
      allowedUserIds: "",
      allowedGroupIds: "",
      slackEnabled: true,
      slackBotToken: "xoxb-123",
      slackAppToken: "xapp-456",
      slackAllowedUserIds: "U12345",
      slackAllowedChannelIds: "C67890",
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
    stateDir: "/tmp/nobie-task006-visual",
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
      channels: { webui: true, telegramConfigured: true, telegramEnabled: false, slackConfigured: true, slackEnabled: true },
      yeonjang: { mqttEnabled: true, connectedExtensions: 1 },
    },
    activeRuns: { total: 0, pendingApprovals: 0 },
    viewModel: {} as UiShellResponse["viewModel"],
  }
}

function capabilities(): FeatureCapability[] {
  return [
    { key: "ai.backends", label: "AI Backends", area: "ai", status: "ready", implemented: true, enabled: true },
    { key: "settings.control", label: "Settings Control", area: "security", status: "ready", implemented: true, enabled: true },
    { key: "telegram.channel", label: "Telegram", area: "telegram", status: "ready", implemented: true, enabled: true },
    { key: "slack.channel", label: "Slack", area: "slack", status: "ready", implemented: true, enabled: true },
  ]
}

function state(currentStep: SetupState["currentStep"]): SetupState {
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
    for (const item of node) visitNode(item, visit)
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
      if (props && "children" in props) walk(props.children)
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

describe("task006 security and channel visualization", () => {
  it("projects security as a boundary map with explicit safe and restricted zones", () => {
    const registry = buildSetupVisualizationRegistry({
      draft: draft(),
      checks: checks(),
      shell: shell(),
      capabilities: capabilities(),
      state: state("security"),
      language: "ko",
    })
    const scene = registry.scenesById["scene:security"]!

    expect(scene.nodes.find((node) => node.id === "node:security:safe_zone")).toEqual(expect.objectContaining({
      status: "warning",
      badges: expect.arrayContaining(["off", "fallback:allow"]),
    }))
    expect(scene.nodes.find((node) => node.id === "node:security:approval_gate")).toEqual(expect.objectContaining({
      status: "disabled",
      badges: expect.arrayContaining(["off", "timeout:12s"]),
    }))
    expect(scene.nodes.find((node) => node.id === "node:security:delegation_limit")).toEqual(expect.objectContaining({
      status: "warning",
      badges: expect.arrayContaining(["unlimited", "unguarded"]),
    }))
    expect(scene.nodes.find((node) => node.id === "node:security:restricted_zone")).toEqual(expect.objectContaining({
      status: "error",
      badges: expect.arrayContaining(["direct-run", "unlimited"]),
    }))
    expect(scene.alerts?.map((alert) => alert.message)).toEqual(expect.arrayContaining([
      "승인 요청이 꺼져 있어 고위험 작업이 바로 실행될 수 있습니다.",
      "타임아웃 후 기본 동작이 허용으로 설정되어 있어 승인 응답이 없어도 작업이 계속될 수 있습니다.",
      "자동 후속 처리가 무제한이라 같은 작업이 길게 반복될 수 있습니다.",
    ]))

    const canvas = SetupVisualizationCanvas({
      scene,
      language: "ko",
      selectedNodeId: "node:security:restricted_zone",
      onSelectNode: () => undefined,
    })

    expect(findDataValues(canvas, "data-setup-visual-canvas")).toContain("scene:security")
    expect(collectText(canvas)).toEqual(expect.arrayContaining(["안전 구역", "제한 구역", "승인 게이트"]))
  })

  it("projects channels as a delivery map with separate policy and runtime signals", () => {
    const registry = buildSetupVisualizationRegistry({
      draft: draft(),
      checks: checks(),
      shell: shell(),
      capabilities: capabilities(),
      state: state("channels"),
      language: "ko",
    })
    const scene = registry.scenesById["scene:channels"]!

    expect(scene.nodes.find((node) => node.id === "node:channels:webui")).toEqual(expect.objectContaining({
      badges: expect.arrayContaining(["builtin", "runtime:ready", "external:1"]),
    }))
    expect(scene.nodes.find((node) => node.id === "node:channels:telegram")).toEqual(expect.objectContaining({
      status: "warning",
      badges: expect.arrayContaining(["enabled", "token:ready", "policy:open", "runtime:stopped"]),
    }))
    expect(scene.nodes.find((node) => node.id === "node:channels:slack")).toEqual(expect.objectContaining({
      status: "ready",
      badges: expect.arrayContaining(["enabled", "bot:ready", "app:ready", "policy:scoped", "runtime:ready"]),
    }))
    expect(scene.alerts?.map((alert) => alert.message)).toEqual(expect.arrayContaining([
      "Telegram 정보는 저장되었지만 런타임이 아직 시작되지 않았습니다.",
      "Telegram 허용 ID가 비어 있어 정책 범위가 넓습니다.",
    ]))

    const canvas = SetupVisualizationCanvas({
      scene,
      language: "ko",
      selectedNodeId: "node:channels:telegram",
      onSelectNode: () => undefined,
    })

    expect(findDataValues(canvas, "data-setup-visual-canvas")).toContain("scene:channels")
    expect(collectText(canvas)).toEqual(expect.arrayContaining(["WebUI", "Telegram", "Slack"]))
  })

  it("decorates channel scenes with preflight and runtime restart overlays without mutating the base scene", () => {
    const registry = buildSetupVisualizationRegistry({
      draft: draft(),
      checks: checks(),
      shell: shell(),
      capabilities: capabilities(),
      state: state("channels"),
      language: "ko",
    })
    const baseScene = registry.scenesById["scene:channels"]!
    const decorated = decorateSetupScene(baseScene, {
      stepContextId: "channels",
      saving: false,
      lastError: "restart failed",
      language: "ko",
      telegramCheckResult: { ok: true, message: "telegram ok" },
      slackCheckResult: { ok: false, message: "socket mode denied" },
    })

    expect(baseScene.nodes.find((node) => node.id === "node:channels:slack")?.badges).not.toContain("preflight:error")
    expect(decorated?.nodes.find((node) => node.id === "node:channels:telegram")).toEqual(expect.objectContaining({
      badges: expect.arrayContaining(["preflight:ok", "runtime:retry"]),
    }))
    expect(decorated?.nodes.find((node) => node.id === "node:channels:slack")).toEqual(expect.objectContaining({
      status: "warning",
      badges: expect.arrayContaining(["preflight:error", "runtime:retry"]),
    }))
    expect(decorated?.alerts?.map((alert) => alert.message)).toEqual(expect.arrayContaining([
      "Telegram preflight: telegram ok",
      "Slack preflight: socket mode denied",
      "채널 런타임 재시작 실패: restart failed",
    ]))
  })

  it("keeps security and channel slice merge and revert boundaries isolated", () => {
    const saved = draft()
    const local: SetupDraft = {
      ...saved,
      security: {
        approvalMode: "always",
        approvalTimeout: 90,
        approvalTimeoutFallback: "deny",
        maxDelegationTurns: 3,
      },
      channels: {
        ...saved.channels,
        allowedUserIds: "999999",
        telegramEnabled: false,
      },
    }

    const mergedSecurity = mergeSetupStepDraft(saved, local, "security")
    expect(mergedSecurity.security).toEqual(local.security)
    expect(mergedSecurity.channels).toEqual(saved.channels)

    const revertedChannels = revertSetupStepDraft(local, saved, "channels")
    expect(revertedChannels.channels).toEqual(saved.channels)
    expect(revertedChannels.security).toEqual(local.security)
  })
})
