import { describe, expect, it, vi } from "vitest"

vi.mock("../packages/webui/src/lib/ui-i18n.ts", () => ({
  useUiI18n: () => ({
    language: "ko",
    text: (ko: string, _en: string) => ko,
    displayText: (value: string) => value,
  }),
}))

import type { SetupChecksResponse, StatusResponse } from "../packages/webui/src/api/adapters/types.ts"
import type { UiShellResponse } from "../packages/webui/src/api/client.ts"
import { ReviewSummaryPanel } from "../packages/webui/src/components/setup/ReviewSummaryPanel.tsx"
import type { FeatureCapability } from "../packages/webui/src/contracts/capabilities.ts"
import { countCapabilities } from "../packages/webui/src/contracts/capabilities.ts"
import type { SetupDraft, SetupState } from "../packages/webui/src/contracts/setup.ts"
import { buildDoneRuntimeSummary, buildReviewReadinessBoard } from "../packages/webui/src/lib/setup-readiness.ts"
import { createSetupSteps } from "../packages/webui/src/lib/setup-step-meta.ts"
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
          argsText: "./mcp.js",
          cwd: "/Users/dongwoo/work",
          url: "",
          required: true,
          enabled: true,
          status: "ready",
          reason: "3 tools discovered",
          tools: ["read_file", "write_file", "list_dir"],
        },
      ],
    },
    skills: {
      items: [
        {
          id: "skill_builtin",
          label: "Review checklist",
          description: "Built-in setup review",
          source: "builtin",
          path: "",
          enabled: true,
          required: false,
          status: "ready",
        },
      ],
    },
    security: {
      approvalMode: "off",
      approvalTimeout: 30,
      approvalTimeoutFallback: "allow",
      maxDelegationTurns: 0,
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
      host: "0.0.0.0",
      port: 1883,
      username: "",
      password: "",
    },
    remoteAccess: {
      authEnabled: false,
      authToken: "",
      host: "10.0.0.2",
      port: 18888,
    },
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
    setupState: { completed: true },
    runtimeHealth: {
      ai: { configured: true, provider: "openai", modelConfigured: true },
      channels: { webui: true, telegramConfigured: true, telegramEnabled: false, slackConfigured: false, slackEnabled: false },
      yeonjang: { mqttEnabled: true, connectedExtensions: 2 },
    },
    activeRuns: { total: 0, pendingApprovals: 0 },
    viewModel: {} as UiShellResponse["viewModel"],
  }
}

function status(withOrchestration = true): StatusResponse {
  return {
    version: "0.1.0",
    provider: "openai",
    model: "gpt-5.4",
    uptime: 120,
    toolCount: 12,
    setupCompleted: true,
    capabilityCounts: { ready: 6, disabled: 1, planned: 0, error: 0 },
    primaryAiTarget: "provider:openai",
    orchestratorStatus: {
      status: withOrchestration ? "ready" : "disabled",
      reason: withOrchestration ? "ready" : "not enabled",
      mode: withOrchestration ? "orchestration" : "single_nobie",
      activeSubAgentCount: withOrchestration ? 2 : 0,
    },
    orchestration: withOrchestration ? {
      mode: "orchestration",
      status: "ready",
      featureFlagEnabled: true,
      requestedMode: "orchestration",
      activeSubAgentCount: 2,
      totalSubAgentCount: 3,
      disabledSubAgentCount: 1,
      activeSubAgents: [],
      reasonCode: "ok",
      reason: "ready",
      generatedAt: 1,
    } : undefined,
    startupRecovery: {
      createdAt: 1,
      totalActiveRuns: 0,
      recoveredRunCount: 0,
      interruptedRunCount: 0,
      awaitingApprovalCount: 0,
      pendingDeliveryCount: 0,
      deliveredCount: 0,
      staleCount: 0,
      interruptedScheduleRunCount: 0,
      userFacingSummary: "ok",
    },
    fast_response_health: {
      generatedAt: 1,
      status: "ok",
      reason: "ok",
      recentWindowMs: 60000,
      metrics: [],
      recentTimeouts: [],
    },
    mcp: {
      serverCount: 1,
      readyCount: 1,
      toolCount: 3,
      requiredFailures: 0,
    },
    mqtt: {
      enabled: true,
      running: true,
      host: "0.0.0.0",
      port: 1883,
      url: "mqtt://0.0.0.0:1883",
      clientCount: 2,
      authEnabled: true,
      allowAnonymous: false,
      reason: null,
    },
    paths: {
      stateDir: "/tmp/state",
      configFile: "/tmp/config.json",
      dbFile: "/tmp/db.sqlite",
      setupStateFile: "/tmp/setup.json",
    },
    webui: {
      port: 18888,
      host: "10.0.0.2",
      authEnabled: false,
    },
    update: {
      status: "latest",
      latestVersion: "0.1.0",
      checkedAt: 1,
      updateAvailable: false,
    },
  }
}

function capabilities(): FeatureCapability[] {
  return [
    { key: "ai.backends", label: "AI Backends", area: "ai", status: "ready", implemented: true, enabled: true },
    { key: "telegram.channel", label: "Telegram", area: "telegram", status: "ready", implemented: true, enabled: true },
    { key: "settings.control", label: "Settings Control", area: "security", status: "ready", implemented: true, enabled: true },
    { key: "mcp.client", label: "MCP Client", area: "mcp", status: "ready", implemented: true, enabled: true },
    { key: "mqtt.bridge", label: "MQTT Bridge", area: "mqtt", status: "ready", implemented: true, enabled: true },
  ]
}

function state(currentStep: SetupState["currentStep"]): SetupState {
  return {
    version: 1,
    completed: currentStep === "done",
    currentStep,
    completedAt: currentStep === "done" ? 1_776_489_600_000 : undefined,
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

function findClickableByDataValue(node: unknown, key: string, value: string): (() => void) | null {
  let handler: (() => void) | null = null
  visitNode(node, (candidate) => {
    const props = candidate.props
    if (!props || typeof props !== "object") return
    if ((props as Record<string, unknown>)[key] === value && typeof (props as Record<string, unknown>).onClick === "function") {
      handler = (props as Record<string, unknown>).onClick as () => void
    }
  })
  return handler
}

describe("task007 remote access, review, and done", () => {
  it("projects remote_access as a network map without turning Yeonjang into a subordinate node", () => {
    const registry = buildSetupVisualizationRegistry({
      draft: draft(),
      checks: checks(),
      shell: shell(),
      status: status(),
      capabilities: capabilities(),
      state: state("remote_access"),
      language: "ko",
    })
    const scene = registry.scenesById["scene:remote_access"]!

    expect(scene.nodes.map((node) => node.id)).toEqual(expect.arrayContaining([
      "node:remote:endpoint",
      "node:remote:auth_boundary",
      "node:remote:mqtt_bridge",
      "node:remote:external_clients",
    ]))
    expect(scene.nodes.map((node) => node.id)).not.toContain("node:remote:yeonjang")
    expect(scene.nodes.find((node) => node.id === "node:remote:auth_boundary")).toEqual(expect.objectContaining({
      status: "warning",
      badges: expect.arrayContaining(["auth:off", "token:disabled"]),
    }))
    expect(scene.nodes.find((node) => node.id === "node:remote:mqtt_bridge")).toEqual(expect.objectContaining({
      status: "error",
      badges: expect.arrayContaining(["mqtt:on", "yeonjang:2"]),
    }))
    expect(scene.alerts?.map((alert) => alert.message)).toEqual(expect.arrayContaining([
      "로컬이 아닌 host에서 WebUI 인증이 꺼져 있습니다.",
      "MQTT 브로커를 켜려면 username과 password가 모두 필요합니다.",
    ]))
  })

  it("builds a readiness board with blockers, risk paths, and per-step tiles", () => {
    const steps = createSetupSteps(capabilities(), draft(), state("review"), "ko")
    const board = buildReviewReadinessBoard({
      draft: draft(),
      steps,
      checks: checks(),
      shell: shell(),
      capabilityCounts: countCapabilities(capabilities()),
      language: "ko",
    })

    expect(board.overallTone).toBe("warning")
    expect(board.tiles.find((tile) => tile.stepId === "remote_access")).toEqual(expect.objectContaining({
      tone: "warning",
      badges: expect.arrayContaining(["auth:off", "mqtt:on"]),
    }))
    expect(board.missingLinks.map((issue) => issue.id)).toContain("missing:channel-runtime")
    expect(board.riskPaths.map((issue) => issue.id)).toEqual(expect.arrayContaining([
      "risk:approvals-off",
      "risk:fallback-allow",
      "risk:delegation-unlimited",
      "risk:remote-open",
    ]))
  })

  it("wires review issue actions back to the source step", () => {
    const steps = createSetupSteps(capabilities(), draft(), state("review"), "ko")
    const board = buildReviewReadinessBoard({
      draft: draft(),
      steps,
      checks: checks(),
      shell: shell(),
      capabilityCounts: countCapabilities(capabilities()),
      language: "ko",
    })
    const selected: string[] = []
    const tree = ReviewSummaryPanel({
      board,
      onSelectStep: (stepId) => {
        selected.push(stepId)
      },
    })

    const clickIssue = findClickableByDataValue(tree, "data-review-issue-action", "remote_access")
    const clickTile = findClickableByDataValue(tree, "data-review-step-action", "channels")

    expect(clickIssue).not.toBeNull()
    expect(clickTile).not.toBeNull()

    clickIssue?.()
    clickTile?.()

    expect(selected).toEqual(["remote_access", "channels"])
  })

  it("builds done runtime summaries that differ when orchestration detail is absent", () => {
    const withOrchestration = buildDoneRuntimeSummary({
      draft: draft(),
      checks: checks(),
      shell: shell(),
      status: status(true),
      capabilityCounts: countCapabilities(capabilities()),
      state: state("done"),
      language: "ko",
    })
    const withoutOrchestration = buildDoneRuntimeSummary({
      draft: draft(),
      checks: checks(),
      shell: shell(),
      status: status(false),
      capabilityCounts: countCapabilities(capabilities()),
      state: state("done"),
      language: "ko",
    })

    expect(withOrchestration.actions.map((action) => action.href)).toEqual([
      "/advanced/dashboard",
      "/advanced/settings",
    ])
    expect(withoutOrchestration.actions.map((action) => action.href)).toEqual([
      "/advanced/dashboard",
      "/advanced/settings",
    ])
  })
})
