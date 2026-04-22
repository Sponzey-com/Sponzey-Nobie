import { createElement } from "../packages/webui/node_modules/react/index.js"
import { renderToStaticMarkup } from "../packages/webui/node_modules/react-dom/server.js"
import { describe, expect, it } from "vitest"
import { OrchestrationTopologyPanel } from "../packages/webui/src/components/orchestration/OrchestrationTopologyPanel.tsx"
import type { FeatureCapability } from "../packages/webui/src/contracts/capabilities.ts"
import type {
  OrchestrationAgentRegistryEntry,
  OrchestrationGraphResponse,
  OrchestrationRegistrySnapshot,
} from "../packages/webui/src/contracts/orchestration-api.ts"
import type {
  RelationshipGraphEdge,
  RelationshipGraphNode,
  SubAgentConfig,
} from "../packages/webui/src/contracts/sub-agent-orchestration.ts"
import type { UiShellResponse } from "../packages/webui/src/api/client.ts"
import { buildOrchestrationSummary, buildOrchestrationTopologyScene, createSubAgentConfig } from "../packages/webui/src/lib/orchestration-ui.ts"
import {
  buildOrchestrationTopologyInspector,
  buildYeonjangCapabilityProjection,
  resolveTopologyEditorGate,
} from "../packages/webui/src/lib/setup-visualization-topology.ts"

const now = Date.UTC(2026, 3, 21, 0, 0, 0)

function subAgent(
  agentId: string,
  overrides: Partial<SubAgentConfig> & {
    allowScreenControl?: boolean
    approvalRequiredFrom?: SubAgentConfig["capabilityPolicy"]["permissionProfile"]["approvalRequiredFrom"]
    riskCeiling?: SubAgentConfig["capabilityPolicy"]["permissionProfile"]["riskCeiling"]
    delegationEnabled?: boolean
  } = {},
): SubAgentConfig {
  const base = createSubAgentConfig({
    agentId,
    displayName: `Agent ${agentId}`,
    nickname: agentId.replace("agent:", ""),
    role: "Research worker",
    personality: "Precise and bounded.",
    specialtyTags: ["research"],
    avoidTasks: ["unapproved shell"],
    teamIds: ["team:research"],
    riskCeiling: overrides.riskCeiling ?? "dangerous",
    enabledSkillIds: ["web-search"],
    enabledMcpServerIds: ["browser"],
    enabledToolNames: ["web_search"],
    allowScreenControl: overrides.allowScreenControl ?? false,
    now,
  })
  return {
    ...base,
    status: overrides.status ?? "enabled",
    delegation: {
      ...base.delegation,
      enabled: overrides.delegationEnabled ?? true,
    },
    capabilityPolicy: {
      ...base.capabilityPolicy,
      permissionProfile: {
        ...base.capabilityPolicy.permissionProfile,
        riskCeiling: overrides.riskCeiling ?? base.capabilityPolicy.permissionProfile.riskCeiling,
        approvalRequiredFrom: overrides.approvalRequiredFrom ?? base.capabilityPolicy.permissionProfile.approvalRequiredFrom,
        allowScreenControl: overrides.allowScreenControl ?? base.capabilityPolicy.permissionProfile.allowScreenControl,
      },
    },
    ...overrides,
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

function graph(nodes: RelationshipGraphNode[], edges: RelationshipGraphEdge[]): OrchestrationGraphResponse {
  return {
    graph: { nodes, edges },
    diagnostics: [],
  }
}

function shell(overrides: Partial<UiShellResponse["runtimeHealth"]["yeonjang"]> = {}): UiShellResponse {
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
      channels: { webui: true, telegramConfigured: false, telegramEnabled: false, slackConfigured: false, slackEnabled: false },
      yeonjang: {
        mqttEnabled: true,
        connectedExtensions: 0,
        ...overrides,
      },
    },
    activeRuns: { total: 0, pendingApprovals: 0 },
    viewModel: {} as UiShellResponse["viewModel"],
  }
}

function capability(key: string, status: FeatureCapability["status"]): FeatureCapability {
  return {
    key,
    label: key,
    area: key === "mqtt.broker" ? "mqtt" : "security",
    status,
    enabled: status === "ready",
    implemented: true,
  }
}

describe("task010 Yeonjang shared capability topology", () => {
  it("projects Yeonjang as a shared hub with approved, approval-required, and blocked agent edges", () => {
    const approved = agentEntry(subAgent("agent:approved", {
      allowScreenControl: true,
      approvalRequiredFrom: "dangerous",
      riskCeiling: "dangerous",
    }))
    const approvalRequired = agentEntry(subAgent("agent:approval", {
      allowScreenControl: true,
      approvalRequiredFrom: "moderate",
      riskCeiling: "dangerous",
    }))
    const blocked = agentEntry(subAgent("agent:blocked", {
      allowScreenControl: false,
      approvalRequiredFrom: "moderate",
      riskCeiling: "moderate",
    }))
    const agents = [approved, approvalRequired, blocked]
    const snapshot: OrchestrationRegistrySnapshot = {
      generatedAt: now,
      agents,
      teams: [],
      membershipEdges: [],
      diagnostics: [],
    }
    const yeonjang = buildYeonjangCapabilityProjection({
      agents,
      mqttCapability: capability("mqtt.broker", "ready"),
      shell: shell({ mqttEnabled: true, connectedExtensions: 0 }),
      language: "en",
    })
    const scene = buildOrchestrationTopologyScene({
      snapshot,
      graph: graph([], []),
      agents,
      teams: [],
      language: "en",
      mode: "advanced",
      yeonjang,
    })

    expect(scene.nodes.map((node) => node.id)).toContain("node:orchestration:yeonjang_hub")
    expect(yeonjang.relations.map((item) => [item.agentId, item.state])).toEqual(expect.arrayContaining([
      ["agent:approved", "approved_to_control"],
      ["agent:approval", "approval_required"],
      ["agent:blocked", "blocked"],
    ]))
    expect(scene.edges.filter((edge) => edge.to === "node:orchestration:yeonjang_hub").map((edge) => edge.id)).toEqual(expect.arrayContaining([
      "edge:orchestration:yeonjang:agent:approved",
      "edge:orchestration:yeonjang:agent:approval",
      "edge:orchestration:yeonjang:agent:blocked",
    ]))
    expect(scene.edges.some((edge) => edge.id.includes("membership") && edge.to === "node:orchestration:yeonjang_hub")).toBe(false)
    expect(scene.alerts?.map((alert) => alert.message)).toEqual(expect.arrayContaining([
      "Yeonjang is a shared capability hub, and team membership alone does not grant access.",
      "The MQTT broker is enabled, but there are no connected Yeonjang extensions yet.",
      "1 blocked Yeonjang agents",
      "1 Yeonjang agents require approval",
    ]))
  })

  it("derives a soft gate from settings.control and mqtt.broker without removing the route", () => {
    const gate = resolveTopologyEditorGate({
      surface: "page",
      settingsCapability: capability("settings.control", "ready"),
      mqttCapability: capability("mqtt.broker", "planned"),
      language: "en",
    })

    expect(gate.status).toBe("preview_only")
    expect(gate.canEdit).toBe(false)
    expect(gate.message).toContain("mqtt.broker")
  })

  it("renders an inspector that explains why an agent can or cannot use Yeonjang", () => {
    const approvalAgent = agentEntry(subAgent("agent:approval", {
      allowScreenControl: true,
      approvalRequiredFrom: "moderate",
      riskCeiling: "dangerous",
    }))
    const blockedAgent = agentEntry(subAgent("agent:blocked", {
      allowScreenControl: false,
      approvalRequiredFrom: "moderate",
      riskCeiling: "moderate",
    }))
    const agents = [approvalAgent, blockedAgent]
    const snapshot: OrchestrationRegistrySnapshot = {
      generatedAt: now,
      agents,
      teams: [],
      membershipEdges: [],
      diagnostics: [],
    }
    const summary = buildOrchestrationSummary({ snapshot, language: "en" })
    const yeonjang = buildYeonjangCapabilityProjection({
      agents,
      mqttCapability: capability("mqtt.broker", "ready"),
      shell: shell({ mqttEnabled: true, connectedExtensions: 2 }),
      language: "en",
    })
    const scene = buildOrchestrationTopologyScene({
      snapshot,
      graph: graph([], []),
      agents,
      teams: [],
      language: "en",
      mode: "advanced",
      yeonjang,
    })
    const gate = resolveTopologyEditorGate({
      surface: "page",
      settingsCapability: capability("settings.control", "ready"),
      mqttCapability: capability("mqtt.broker", "ready"),
      language: "en",
    })
    const inspector = buildOrchestrationTopologyInspector({
      selectedEdgeId: "edge:orchestration:yeonjang:agent:approval",
      relations: yeonjang.relations,
      runtime: yeonjang.runtime,
      gate,
      language: "en",
    })

    const html = renderToStaticMarkup(createElement(OrchestrationTopologyPanel, {
      scene,
      summary,
      language: "en",
      selectedNodeId: "node:orchestration:agent:agent:approval",
      selectedEdgeId: "edge:orchestration:yeonjang:agent:approval",
      yeonjangRelations: yeonjang.relations,
      inspector,
      editorGate: gate,
      onSelectNode: () => undefined,
      onSelectEdge: () => undefined,
    }))

    expect(html).toContain("Permission inspector")
    expect(html).toContain("approval - Yeonjang")
    expect(html).toContain("Control after approval")
    expect(html).toContain("Approval policy")
    expect(html).toContain("Team membership is structural only")
    expect(html).toContain("live 2")
  })
})
