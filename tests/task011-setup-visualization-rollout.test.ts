import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import type { UiShellResponse } from "../packages/webui/src/api/client.ts"
import type { FeatureCapability } from "../packages/webui/src/contracts/capabilities.ts"
import type { SetupDraft, SetupState } from "../packages/webui/src/contracts/setup.ts"
import type { OrchestrationAgentRegistryEntry, OrchestrationRegistrySnapshot } from "../packages/webui/src/contracts/orchestration-api.ts"
import type { SubAgentConfig } from "../packages/webui/src/contracts/sub-agent-orchestration.ts"
import { buildOrchestrationTopologyScene, createSubAgentConfig } from "../packages/webui/src/lib/orchestration-ui.ts"
import {
  buildSetupVisualizationRolloutGate,
  getSetupVisualizationBaselineScreens,
  getSetupVisualizationFallbackModes,
  getSetupVisualizationQaChecklist,
  getSetupVisualizationReleaseChecklist,
  getSetupVisualizationRolloutStages,
  getSetupVisualizationViewportMatrix,
} from "../packages/webui/src/lib/setup-visualization-rollout.ts"
import { buildSetupVisualizationRegistry } from "../packages/webui/src/lib/setup-visualization-scenes.ts"
import { buildYeonjangCapabilityProjection } from "../packages/webui/src/lib/setup-visualization-topology.ts"

const now = Date.UTC(2026, 3, 21, 0, 0, 0)

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
          id: "browser",
          name: "Browser MCP",
          transport: "stdio",
          command: "browser",
          argsText: "",
          cwd: "",
          url: "",
          required: true,
          enabled: true,
          status: "ready",
          reason: "",
          tools: ["navigate"],
        },
      ],
    },
    skills: {
      items: [
        {
          id: "skill:summary",
          label: "Summary",
          source: "builtin",
          enabled: true,
          status: "ready",
          description: "Summarize content",
          path: "",
        },
      ],
    },
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

function shell(): UiShellResponse {
  return {
    generatedAt: now,
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
    { key: "mqtt.broker", label: "MQTT Broker", area: "mqtt", status: "ready", implemented: true, enabled: true },
  ]
}

function state(): SetupState {
  return {
    version: 1,
    completed: false,
    currentStep: "review",
    skipped: {
      telegram: false,
      remoteAccess: false,
    },
  }
}

function subAgent(agentId: string): SubAgentConfig {
  const base = createSubAgentConfig({
    agentId,
    displayName: `Agent ${agentId}`,
    nickname: agentId.replace("agent:", ""),
    role: "Research worker",
    personality: "Precise and bounded.",
    specialtyTags: ["research"],
    avoidTasks: [],
    teamIds: ["team:research"],
    riskCeiling: "dangerous",
    enabledSkillIds: ["web-search"],
    enabledMcpServerIds: ["browser"],
    enabledToolNames: ["web_search"],
    allowScreenControl: true,
    now,
  })
  return {
    ...base,
    status: "enabled",
    delegation: {
      ...base.delegation,
      enabled: true,
    },
    capabilityPolicy: {
      ...base.capabilityPolicy,
      permissionProfile: {
        ...base.capabilityPolicy.permissionProfile,
        allowScreenControl: true,
        riskCeiling: "dangerous",
        approvalRequiredFrom: "moderate",
      },
    },
  }
}

function agentEntry(config: SubAgentConfig): OrchestrationAgentRegistryEntry {
  return {
    agentId: config.agentId,
    displayName: config.displayName,
    nickname: config.nickname,
    status: config.status,
    role: config.role,
    specialtyTags: config.specialtyTags,
    avoidTasks: config.avoidTasks,
    teamIds: config.teamIds,
    delegationEnabled: config.delegation.enabled,
    retryBudget: config.delegation.retryBudget,
    source: "db",
    config,
    permissionProfile: config.capabilityPolicy.permissionProfile,
    capabilityPolicy: config.capabilityPolicy,
    skillMcpSummary: config.capabilityPolicy.skillMcpAllowlist,
    currentLoad: {
      activeSubSessions: 0,
      queuedSubSessions: 0,
      failedSubSessions: 0,
      completedSubSessions: 0,
      maxParallelSessions: 2,
      utilization: 0,
    },
    failureRate: {
      windowMs: 86_400_000,
      consideredSubSessions: 0,
      failedSubSessions: 0,
      value: 0,
    },
  }
}

describe("task011 setup visualization rollout gate", () => {
  it("pins the seven baseline screens against the current setup registry and orchestration topology", () => {
    const registry = buildSetupVisualizationRegistry({
      draft: draft(),
      checks: {
        stateDir: "/tmp/nobie-task011",
        configFile: "/tmp/config.json",
        setupStateFile: "/tmp/setup.json",
        setupCompleted: false,
        telegramConfigured: true,
        authEnabled: true,
        schedulerEnabled: false,
      },
      shell: shell(),
      capabilities: capabilities(),
      state: state(),
      language: "en",
    })
    const topologyAgents = [agentEntry(subAgent("agent:alpha"))]
    const snapshot: OrchestrationRegistrySnapshot = {
      generatedAt: now,
      agents: topologyAgents,
      teams: [],
      membershipEdges: [],
      diagnostics: [],
    }
    const topologyScene = buildOrchestrationTopologyScene({
      snapshot,
      graph: { graph: { nodes: [], edges: [] }, diagnostics: [] },
      agents: topologyAgents,
      teams: [],
      language: "en",
      mode: "advanced",
      yeonjang: buildYeonjangCapabilityProjection({
        agents: topologyAgents,
        mqttCapability: capabilities().find((item) => item.key === "mqtt.broker"),
        shell: shell(),
        language: "en",
      }),
    })

    const baselineScenes = getSetupVisualizationBaselineScreens("en")
    const viewportIds = new Set(getSetupVisualizationViewportMatrix("en").map((item) => item.id))

    expect(baselineScenes.map((item) => item.sceneId)).toEqual([
      "scene:welcome",
      "scene:ai_backends",
      "scene:mcp",
      "scene:skills",
      "scene:channels",
      "scene:review",
      "scene:orchestration_topology",
    ])
    expect(registry.scenesById["scene:welcome"]).toBeDefined()
    expect(registry.scenesById["scene:ai_backends"]).toBeDefined()
    expect(registry.scenesById["scene:mcp"]).toBeDefined()
    expect(registry.scenesById["scene:skills"]).toBeDefined()
    expect(registry.scenesById["scene:channels"]).toBeDefined()
    expect(registry.scenesById["scene:review"]).toBeDefined()
    expect(topologyScene.id).toBe("scene:orchestration_topology")
    expect(baselineScenes.every((item) => item.requiredViewportIds.every((id) => viewportIds.has(id)))).toBe(true)
    expect(baselineScenes.find((item) => item.sceneId === "scene:orchestration_topology")?.captureStates).toEqual(expect.arrayContaining([
      "selected_node",
      "yeonjang_relation_selected",
      "inspector_open",
    ]))
  })

  it("defines viewport, QA, fallback, and release checklist source-of-truth entries", () => {
    const viewports = getSetupVisualizationViewportMatrix("en")
    const qa = getSetupVisualizationQaChecklist("en")
    const fallbackModes = getSetupVisualizationFallbackModes("en")
    const checklist = getSetupVisualizationReleaseChecklist("en")

    expect(viewports.map((item) => item.id)).toEqual(["desktop_wide", "laptop_1280", "tablet_mobile_fallback"])
    expect(viewports.find((item) => item.id === "tablet_mobile_fallback")?.requiredShellFeatures).toEqual(expect.arrayContaining([
      "mobile_steps_toggle",
      "inspector_drawer",
      "inspector_sheet",
    ]))
    expect(qa.map((item) => item.id)).toEqual([
      "save_cancel_revert",
      "validation_next_lock",
      "review_done_completion",
      "keyboard_and_accessibility",
      "topology_feature_modes",
    ])
    expect(qa.find((item) => item.id === "topology_feature_modes")?.featureModes).toEqual([
      "topology_off",
      "topology_read_only",
      "topology_editable_experimental",
    ])
    expect(fallbackModes.find((item) => item.mode === "topology_off")?.fallbackSurfaces).toEqual(expect.arrayContaining([
      "SetupPage form flow",
      "SettingsPage agents tab preview",
      "RelationshipGraphPanel",
      "AdvancedEditor",
    ]))
    expect(checklist.map((item) => item.id)).toEqual([
      "layout_stability",
      "accessibility",
      "performance",
      "feature_gate_consistency",
      "automated_regressions",
    ])
  })

  it("blocks rollout until stage prerequisites are complete and passes once task docs and baselines are aligned", () => {
    const stages = getSetupVisualizationRolloutStages("en")
    const partial = buildSetupVisualizationRolloutGate({
      completedTaskIds: ["task001", "task002", "task003", "task004", "task005", "task006", "task007", "task008", "task009", "task010"],
      availableTestBaselines: [
        "task001-setup-visualization",
        "task003-setup-welcome-personal",
        "task004-ai-visualization-topology",
        "task005-mcp-skills-capability-map",
        "task006-security-channels-visualization",
        "task007-remote-review-done",
        "task002-setup-visualization-projection",
        "task006-beginner-setup",
        "task007-advanced-ui",
        "task015-ui-route-migration",
        "task009-orchestration-topology-projection",
        "task010-yeonjang-shared-capability",
        "task012-webui-orchestration",
      ],
      language: "en",
    })

    expect(stages.map((item) => item.id)).toEqual(["foundation", "step_coverage", "parity", "topology", "review_qa"])
    expect(partial.status).toBe("blocked")
    expect(partial.blockedStages.find((item) => item.stageId === "review_qa")).toEqual(expect.objectContaining({
      missingTaskIds: ["task011"],
      missingTestBaselines: ["task011-setup-visualization-rollout", "task016-ui-performance-accessibility"],
    }))

    const completedTaskIds = Array.from({ length: 11 }, (_, index) => `task${String(index + 1).padStart(3, "0")}`)
      .filter((taskId) => taskDocStatus(taskId) === "done")
    const ready = buildSetupVisualizationRolloutGate({
      completedTaskIds,
      availableTestBaselines: [
        "task001-setup-visualization",
        "task002-setup-visualization-projection",
        "task003-setup-welcome-personal",
        "task004-ai-visualization-topology",
        "task005-mcp-skills-capability-map",
        "task006-security-channels-visualization",
        "task006-beginner-setup",
        "task007-advanced-ui",
        "task007-remote-review-done",
        "task008-setup-ux-accessibility",
        "task009-orchestration-topology-projection",
        "task010-yeonjang-shared-capability",
        "task011-setup-visualization-rollout",
        "task012-webui-orchestration",
        "task015-ui-route-migration",
        "task016-ui-performance-accessibility",
      ],
      language: "en",
    })

    expect(ready.status).toBe("ready")
    expect(ready.completedStageIds).toEqual(["foundation", "step_coverage", "parity", "topology", "review_qa"])
  })
})

function taskDocStatus(taskId: string): string {
  const text = readFileSync(`.tasks/${taskId}.md`, "utf-8")
  const match = text.match(/^상태:\s*(.+)$/m)
  return match?.[1]?.trim() ?? "unknown"
}
