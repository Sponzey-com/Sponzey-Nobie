import { describe, expect, it } from "vitest"
import type { SetupChecksResponse } from "../packages/webui/src/api/adapters/types.ts"
import type { UiShellResponse } from "../packages/webui/src/api/client.ts"
import type { FeatureCapability } from "../packages/webui/src/contracts/capabilities.ts"
import type { SetupDraft, SetupState } from "../packages/webui/src/contracts/setup.ts"
import { SetupVisualizationCanvas } from "../packages/webui/src/components/setup/SetupVisualizationCanvas.tsx"
import { mergeSetupStepDraft, revertSetupStepDraft } from "../packages/webui/src/lib/setupFlow.ts"
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
    ],
    routingProfiles: [{ id: "default", label: "Default", targets: ["provider:openai"] }],
    mcp: {
      servers: [
        {
          id: "mcp_stdio",
          name: "file-tools",
          transport: "stdio",
          command: "node",
          argsText: "./mcp-file-tools.js",
          cwd: "/Users/dongwoo/work",
          url: "",
          required: true,
          enabled: true,
          status: "ready",
          reason: "3 tools discovered",
          tools: ["read_file", "write_file", "list_dir"],
        },
        {
          id: "mcp_http",
          name: "remote-docs",
          transport: "http",
          command: "",
          argsText: "",
          cwd: "",
          url: "http://127.0.0.1:3001",
          required: false,
          enabled: true,
          status: "error",
          reason: "transport not supported yet",
          tools: [],
        },
      ],
    },
    skills: {
      items: [
        {
          id: "skill_builtin",
          label: "Release checklist",
          description: "Built-in deployment guardrails",
          source: "builtin",
          path: "",
          enabled: true,
          required: false,
          status: "ready",
          reason: "Shown as a built-in skill.",
        },
        {
          id: "skill_local",
          label: "Repo diff guide",
          description: "",
          source: "local",
          path: "./skills/repo-diff",
          enabled: true,
          required: true,
          status: "error",
          reason: "missing SKILL.md",
        },
      ],
    },
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
    stateDir: "/tmp/nobie-task005",
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
    { key: "mcp.client", label: "MCP Client", area: "mcp", status: "ready", implemented: true, enabled: true },
    { key: "settings.control", label: "Settings Control", area: "security", status: "ready", implemented: true, enabled: true },
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

describe("task005 MCP and skill capability maps", () => {
  it("projects mcp servers as a capability map with transport clusters and tool count badges", () => {
    const registry = buildSetupVisualizationRegistry({
      draft: draft(),
      checks: checks(),
      shell: shell(),
      capabilities: capabilities(),
      state: state("mcp"),
      language: "ko",
    })
    const scene = registry.scenesById["scene:mcp"]!

    expect(scene.nodes.find((node) => node.id === "node:mcp:hub")).toEqual(expect.objectContaining({
      badges: expect.arrayContaining(["servers:2", "required:1", "ready:1", "enabled:2"]),
    }))
    expect(scene.nodes.find((node) => node.id === "node:mcp:mcp_stdio")).toEqual(expect.objectContaining({
      status: "ready",
      badges: expect.arrayContaining(["stdio", "required", "enabled", "tools:3"]),
      clusterId: "cluster:mcp:stdio",
    }))
    expect(scene.nodes.find((node) => node.id === "node:mcp:mcp_http")).toEqual(expect.objectContaining({
      status: "error",
      badges: expect.arrayContaining(["http", "optional", "enabled", "tools:0"]),
      clusterId: "cluster:mcp:http",
    }))
    expect(scene.clusters?.map((cluster) => cluster.id)).toEqual(["cluster:mcp:stdio", "cluster:mcp:http"])
    expect(scene.alerts?.map((alert) => alert.message)).toContain("remote-docs: transport not supported yet")
  })

  it("projects skills by source cluster without leaking local paths into the main graph", () => {
    const registry = buildSetupVisualizationRegistry({
      draft: draft(),
      checks: checks(),
      shell: shell(),
      capabilities: capabilities(),
      state: state("skills"),
      language: "ko",
    })
    const scene = registry.scenesById["scene:skills"]!

    expect(scene.nodes.find((node) => node.id === "node:skills:hub")).toEqual(expect.objectContaining({
      badges: expect.arrayContaining(["skills:2", "required:1", "ready:1", "enabled:2"]),
    }))
    expect(scene.nodes.find((node) => node.id === "node:skills:skill_builtin")).toEqual(expect.objectContaining({
      status: "ready",
      badges: expect.arrayContaining(["builtin", "optional", "enabled"]),
      clusterId: "cluster:skills:builtin",
    }))
    expect(scene.nodes.find((node) => node.id === "node:skills:skill_local")).toEqual(expect.objectContaining({
      status: "error",
      badges: expect.arrayContaining(["local", "required", "enabled"]),
      clusterId: "cluster:skills:local",
      description: "missing SKILL.md",
    }))
    expect(JSON.stringify(scene)).not.toContain("./skills/repo-diff")
    expect(scene.clusters?.map((cluster) => cluster.id)).toEqual(["cluster:skills:builtin", "cluster:skills:local"])
  })

  it("renders dedicated cluster layouts for mcp and skills scenes", () => {
    const registry = buildSetupVisualizationRegistry({
      draft: draft(),
      checks: checks(),
      shell: shell(),
      capabilities: capabilities(),
      state: state("mcp"),
      language: "ko",
    })

    const mcpCanvas = SetupVisualizationCanvas({
      scene: registry.scenesById["scene:mcp"]!,
      language: "ko",
      selectedNodeId: "node:mcp:mcp_stdio",
      onSelectNode: () => undefined,
    })
    const skillsCanvas = SetupVisualizationCanvas({
      scene: buildSetupVisualizationRegistry({
        draft: draft(),
        checks: checks(),
        shell: shell(),
        capabilities: capabilities(),
        state: state("skills"),
        language: "ko",
      }).scenesById["scene:skills"]!,
      language: "ko",
      selectedNodeId: "node:skills:skill_local",
      onSelectNode: () => undefined,
    })

    expect(findDataValues(mcpCanvas, "data-setup-visual-node")).toEqual(expect.arrayContaining([
      "node:mcp:hub",
      "node:mcp:mcp_stdio",
      "node:mcp:mcp_http",
    ]))
    expect(collectText(mcpCanvas)).toEqual(expect.arrayContaining([
      "MCP Capability Hub",
      "stdio",
      "http",
      "도구 이름 목록은 graph가 아니라 Inspector에서 상세하게 확인합니다.",
    ]))

    expect(findDataValues(skillsCanvas, "data-setup-visual-node")).toEqual(expect.arrayContaining([
      "node:skills:hub",
      "node:skills:skill_builtin",
      "node:skills:skill_local",
    ]))
    expect(collectText(skillsCanvas)).toEqual(expect.arrayContaining([
      "Skill Capability Map",
      "기본 Skill",
      "로컬 Skill",
      "로컬 path와 상세 설명은 graph가 아니라 Inspector에서만 노출합니다.",
    ]))
  })

  it("keeps add/remove/revert semantics stable for mcp and skills", () => {
    const saved = draft()
    const local = structuredClone(saved)
    local.mcp.servers = local.mcp.servers.filter((server) => server.id !== "mcp_http")
    local.mcp.servers.push({
      id: "mcp_new",
      name: "browser-tools",
      transport: "stdio",
      command: "uvx",
      argsText: "browser-tools",
      cwd: "",
      url: "",
      required: false,
      enabled: true,
      status: "disabled",
      reason: undefined,
      tools: [],
    })
    local.skills.items = local.skills.items.filter((item) => item.id !== "skill_builtin")
    local.skills.items.push({
      id: "skill_new",
      label: "CLI helper",
      description: "",
      source: "local",
      path: "./skills/cli-helper",
      enabled: true,
      required: false,
      status: "disabled",
      reason: undefined,
    })

    const mergedMcp = mergeSetupStepDraft(saved, local, "mcp")
    expect(mergedMcp.mcp.servers.map((server) => server.id)).toEqual(["mcp_stdio", "mcp_new"])

    const revertedMcp = revertSetupStepDraft(local, saved, "mcp")
    expect(revertedMcp.mcp.servers.map((server) => server.id)).toEqual(["mcp_stdio", "mcp_http"])

    const mergedSkills = mergeSetupStepDraft(saved, local, "skills")
    expect(mergedSkills.skills.items.map((item) => item.id)).toEqual(["skill_local", "skill_new"])

    const revertedSkills = revertSetupStepDraft(local, saved, "skills")
    expect(revertedSkills.skills.items.map((item) => item.id)).toEqual(["skill_builtin", "skill_local"])
  })
})
