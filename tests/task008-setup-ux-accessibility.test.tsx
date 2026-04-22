import { createElement } from "../packages/webui/node_modules/react/index.js"
import { describe, expect, it, vi } from "vitest"
vi.mock("../packages/webui/src/components/UiLanguageSwitcher.tsx", () => ({
  UiLanguageSwitcher: () => null,
}))
import type { SetupChecksResponse } from "../packages/webui/src/api/adapters/types.ts"
import type { UiShellResponse } from "../packages/webui/src/api/client.ts"
import { SetupStepShell } from "../packages/webui/src/components/setup/SetupStepShell.tsx"
import { SetupVisualizationCanvas } from "../packages/webui/src/components/setup/SetupVisualizationCanvas.tsx"
import type { FeatureCapability } from "../packages/webui/src/contracts/capabilities.ts"
import type { SetupDraft, SetupState, SetupStepMeta } from "../packages/webui/src/contracts/setup.ts"
import { validateSetupStep } from "../packages/webui/src/lib/setupFlow.ts"
import { applyValidationOverlaysToScene, type VisualizationScene } from "../packages/webui/src/lib/setup-visualization.ts"
import { buildSetupVisualizationRegistry } from "../packages/webui/src/lib/setup-visualization-scenes.ts"

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

function findNodeProps(node: unknown, key: string, value: string): Record<string, unknown> | null {
  let match: Record<string, unknown> | null = null
  visitNode(node, (candidate) => {
    const props = candidate.props
    if (!props || typeof props !== "object") return
    if ((props as Record<string, unknown>)[key] === value) {
      match = props as Record<string, unknown>
    }
  })
  return match
}

function findClassNames(node: unknown): string[] {
  const classNames: string[] = []
  visitNode(node, (candidate) => {
    const props = candidate.props
    if (!props || typeof props !== "object") return
    const className = (props as Record<string, unknown>).className
    if (typeof className === "string") {
      classNames.push(className)
    }
  })
  return classNames
}

function mcpDraft(): SetupDraft {
  return {
    personal: { profileName: "dongwoo", displayName: "Dongwoo", language: "ko", timezone: "Asia/Seoul", workspace: "/Users/dongwoo/work" },
    aiBackends: [
      {
        id: "provider:openai",
        label: "OpenAI",
        kind: "provider",
        providerType: "openai",
        authMode: "api_key",
        credentials: { apiKey: "sk-test" },
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
    routingProfiles: [{ id: "default", label: "Default", targets: ["provider:openai"] }],
    mcp: {
      servers: [
        {
          id: "stdio_a",
          name: "",
          transport: "stdio",
          command: "",
          argsText: "",
          cwd: "",
          url: "",
          required: true,
          enabled: true,
          status: "disabled",
          reason: "",
          tools: [],
        },
      ],
    },
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
    mqtt: { enabled: true, host: "127.0.0.1", port: 1883, username: "u", password: "p" },
    remoteAccess: { authEnabled: true, authToken: "secret", host: "127.0.0.1", port: 18888 },
  }
}

function checks(): SetupChecksResponse {
  return {
    stateDir: "/tmp/nobie-task008",
    configFile: "/tmp/config.json",
    setupStateFile: "/tmp/setup.json",
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
      channels: { webui: true, telegramConfigured: true, telegramEnabled: false, slackConfigured: false, slackEnabled: false },
      yeonjang: { mqttEnabled: true, connectedExtensions: 0 },
    },
    activeRuns: { total: 0, pendingApprovals: 0 },
    viewModel: {} as UiShellResponse["viewModel"],
  }
}

function capabilities(): FeatureCapability[] {
  return [
    { key: "ai.backends", label: "AI Backends", area: "ai", status: "ready", implemented: true, enabled: true },
    { key: "mcp.client", label: "MCP Client", area: "mcp", status: "ready", implemented: true, enabled: true },
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

function steps(): SetupStepMeta[] {
  return [
    {
      id: "welcome",
      label: "Welcome",
      description: "Start here",
      status: "ready",
      required: false,
      highlights: [],
      completed: true,
      locked: false,
    },
    {
      id: "mcp",
      label: "MCP",
      description: "External tools",
      status: "error",
      required: false,
      highlights: [],
      completed: false,
      locked: false,
    },
  ]
}

describe("task008 setup visualization usability floor", () => {
  it("maps validation onto nodes, edges, and clusters without changing scene ownership", () => {
    const registry = buildSetupVisualizationRegistry({
      draft: mcpDraft(),
      checks: checks(),
      shell: shell(),
      capabilities: capabilities(),
      state: state("mcp"),
      language: "ko",
    })
    const scene = registry.scenesById["scene:mcp"]!
    const validation = validateSetupStep("mcp", mcpDraft())
    const decorated = applyValidationOverlaysToScene(scene, {
      stepId: "mcp",
      validation,
      showValidation: true,
      isDraftDirty: true,
      nextStepBlocked: true,
      language: "ko",
    })!

    expect(scene.nodes.find((node) => node.id === "node:mcp:stdio_a")?.overlayTones).toBeUndefined()
    expect(decorated.nodes.find((node) => node.id === "node:mcp:stdio_a")).toEqual(expect.objectContaining({
      overlayTones: expect.arrayContaining(["required", "warning", "draft-changed", "blocked-next-step"]),
    }))
    expect(decorated.edges.find((edge) => edge.id === "edge:mcp:node:mcp:stdio_a")).toEqual(expect.objectContaining({
      overlayTones: expect.arrayContaining(["required", "warning"]),
    }))
    expect(decorated.clusters?.find((cluster) => cluster.id === "cluster:mcp:stdio")).toEqual(expect.objectContaining({
      overlayTones: expect.arrayContaining(["required", "warning"]),
    }))
    expect(decorated.alerts?.map((alert) => alert.message)).toEqual(expect.arrayContaining([
      "현재 단계의 필수 입력을 마치기 전에는 다음 단계로 이동할 수 없습니다.",
      "'새 MCP 서버' 설정을 다시 확인해야 합니다.",
    ]))
  })

  it("switches navigator and inspector into responsive panels outside xl", () => {
    const tree = SetupStepShell({
      title: "Initial Setup",
      description: "Configure Nobie",
      steps: steps(),
      currentStep: "mcp",
      onSelectStep: () => undefined,
      language: "ko",
      legend: createElement("div", null, "Legend"),
      canvas: createElement("div", null, "Canvas"),
      inspector: createElement("div", null, "Inspector"),
      mobileInspector: createElement("div", null, "Inspector mobile"),
      inspectorTitle: "MCP",
      inspectorDescription: "External tools",
      inspectorOpen: true,
      onInspectorOpen: () => undefined,
      onInspectorClose: () => undefined,
      mobileNavigatorOpen: true,
      onMobileNavigatorOpen: () => undefined,
      onMobileNavigatorClose: () => undefined,
      assistPanel: createElement("div", null, "Assist"),
      footer: createElement("div", null, "Footer"),
      children: createElement("div", null, "Body"),
    })

    expect(findDataValues(tree, "data-setup-inspector-mode")).toEqual(expect.arrayContaining(["drawer", "sheet"]))
    expect(findDataValues(tree, "data-setup-mobile-panel")).toContain("steps")
    expect(findDataValues(tree, "data-setup-slot")).toContain("inspector-mobile")
    expect(findClassNames(tree).some((value) => value.includes("md:left-[260px]"))).toBe(true)
  })

  it("adds aria labels, text outline, and keyboard navigation to visualization nodes", () => {
    const selected: string[] = []
    const dismissed = vi.fn()
    const scene: VisualizationScene = {
      id: "scene:test",
      label: "Test Scene",
      mode: "shared",
      semanticStepIds: ["personal"],
      nodes: [
        {
          id: "node:a",
          kind: "profile",
          label: "Node A",
          status: "required",
          badges: ["profile"],
          overlayTones: ["required", "draft-changed"],
          overlayMessages: ["이름을 입력해야 합니다."],
          semanticStepIds: ["personal"],
        },
        {
          id: "node:b",
          kind: "profile",
          label: "Node B",
          status: "ready",
          badges: ["workspace"],
          semanticStepIds: ["personal"],
        },
      ],
      edges: [
        {
          id: "edge:a:b",
          from: "node:a",
          to: "node:b",
          kind: "flow",
          status: "warning",
          semanticStepIds: ["personal"],
        },
      ],
      alerts: [
        {
          id: "alert:test",
          tone: "warning",
          message: "입력 흐름을 다시 확인해야 합니다.",
          semanticStepIds: ["personal"],
        },
      ],
    }

    const tree = SetupVisualizationCanvas({
      scene,
      language: "ko",
      selectedNodeId: "node:a",
      onSelectNode: (nodeId) => selected.push(nodeId),
      onDismissSelection: dismissed,
    })

    const firstNodeProps = findNodeProps(tree, "data-setup-visual-node", "node:a")
    expect(firstNodeProps?.["aria-label"]).toContain("Node A")
    expect(firstNodeProps?.["aria-label"]).toContain("필수 overlay")
    expect(firstNodeProps?.["aria-pressed"]).toBe(true)
    expect(findDataValues(tree, "data-setup-visual-outline")).toContain("scene:test")
    expect(findDataValues(tree, "data-setup-visual-flows")).toContain("scene:test")

    ;(firstNodeProps?.onKeyDown as ((event: {
      key: string
      preventDefault: () => void
      currentTarget: { ownerDocument: { querySelectorAll: () => Array<{ getAttribute: (key: string) => string | null; focus: () => void }> } }
    }) => void))({
      key: "ArrowRight",
      preventDefault: () => undefined,
      currentTarget: {
        ownerDocument: {
          querySelectorAll: () => [
            { getAttribute: () => "node:a", focus: () => undefined },
            { getAttribute: () => "node:b", focus: () => undefined },
          ],
        },
      },
    })

    const canvasProps = findNodeProps(tree, "data-setup-visual-canvas", "scene:test")
    ;(canvasProps?.onKeyDown as ((event: { key: string }) => void))({ key: "Escape" })

    expect(selected).toContain("node:b")
    expect(dismissed).toHaveBeenCalledTimes(1)
  })
})
