import { describe, expect, it } from "vitest"
import type { FeatureCapability } from "../packages/webui/src/contracts/capabilities.ts"
import type {
  OrchestrationAgentRegistryEntry,
  OrchestrationRegistrySnapshot,
} from "../packages/webui/src/contracts/orchestration-api.ts"
import type { RelationshipGraphView } from "../packages/webui/src/lib/orchestration-ui.ts"
import type { SubAgentConfig } from "../packages/webui/src/contracts/sub-agent-orchestration.ts"
import { buildOrchestrationBoardProjection } from "../packages/webui/src/lib/orchestration-board-projection.ts"
import {
  buildOrchestrationDashboardActivityItems,
  buildOrchestrationDashboardFallback,
  filterOrchestrationDashboardActivityItems,
} from "../packages/webui/src/lib/orchestration-dashboard-projection.ts"
import { buildOrchestrationSummary, createSubAgentConfig } from "../packages/webui/src/lib/orchestration-ui.ts"
import { buildYeonjangCapabilityProjection } from "../packages/webui/src/lib/setup-visualization-topology.ts"

const now = Date.UTC(2026, 3, 22, 1, 0, 0)

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

function subAgent(agentId: string): SubAgentConfig {
  const base = createSubAgentConfig({
    agentId,
    displayName: `Agent ${agentId}`,
    nickname: agentId.replace(/^agent-/, ""),
    role: "Structured worker",
    personality: "Precise and bounded.",
    specialtyTags: ["research"],
    avoidTasks: ["unguarded shell"],
    teamIds: [],
    riskCeiling: "moderate",
    enabledSkillIds: ["web-search"],
    enabledMcpServerIds: ["browser"],
    enabledToolNames: ["web_search"],
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
        riskCeiling: "sensitive",
        allowScreenControl: true,
        approvalRequiredFrom: "safe",
      },
    },
  }
}

function agentEntry(config: SubAgentConfig, load: Partial<OrchestrationAgentRegistryEntry["currentLoad"]> = {}): OrchestrationAgentRegistryEntry {
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
      ...load,
    },
    failureRate: {
      windowMs: 86_400_000,
      consideredSubSessions: 0,
      failedSubSessions: 0,
      value: 0,
    },
  }
}

function snapshot(agents: OrchestrationAgentRegistryEntry[]): OrchestrationRegistrySnapshot {
  return {
    generatedAt: now,
    agents,
    teams: [],
    membershipEdges: [],
    diagnostics: [],
  }
}

const emptyGraphView: RelationshipGraphView = {
  singleNobieMode: false,
  nodes: [],
  edges: [],
  edgeCounts: {
    delegation: 0,
    data_exchange: 0,
    permission: 0,
    capability_delegation: 0,
    team_membership: 0,
  },
  diagnostics: [],
}

describe("task002 orchestration dashboard fallbacks", () => {
  it("classifies ready, registry-only, and graph-only fallback states from existing sources", () => {
    const readySnapshot = snapshot([agentEntry(subAgent("agent-alpha-a1"))])
    const summary = buildOrchestrationSummary({ snapshot: readySnapshot, language: "en" })

    expect(buildOrchestrationDashboardFallback({
      snapshot: readySnapshot,
      graphView: {
        ...emptyGraphView,
        nodes: [{
          nodeId: "node:alpha",
          entityType: "sub_agent",
          entityId: "agent-alpha-a1",
          label: "Alpha",
          uiTone: "agent",
          metadata: {},
        }],
      },
      summary,
      language: "en",
    }).state).toBe("ready")

    expect(buildOrchestrationDashboardFallback({
      snapshot: readySnapshot,
      graphView: emptyGraphView,
      summary,
      language: "en",
    }).state).toBe("registry_only")

    expect(buildOrchestrationDashboardFallback({
      snapshot: null,
      graphView: {
        ...emptyGraphView,
        nodes: [{
          nodeId: "node:alpha",
          entityType: "sub_agent",
          entityId: "agent-alpha-a1",
          label: "Alpha",
          uiTone: "agent",
          metadata: {},
        }],
      },
      summary,
      language: "en",
    }).state).toBe("graph_only")
  })

  it("separates runtime activity items from approval items", () => {
    const alpha = agentEntry(subAgent("agent-alpha-a1"), { failedSubSessions: 1 })
    const currentSnapshot = snapshot([alpha])
    const summary = buildOrchestrationSummary({ snapshot: currentSnapshot, language: "en" })
    const boardProjection = buildOrchestrationBoardProjection({
      snapshot: currentSnapshot,
      agents: currentSnapshot.agents,
      teams: currentSnapshot.teams,
      language: "en",
    })
    const yeonjang = buildYeonjangCapabilityProjection({
      agents: currentSnapshot.agents,
      mqttCapability: capability("mqtt.broker", "ready"),
      shell: null,
      language: "en",
    })

    const items = buildOrchestrationDashboardActivityItems({
      agents: currentSnapshot.agents,
      summary,
      boardProjection,
      graphView: emptyGraphView,
      yeonjangProjection: yeonjang,
      language: "en",
    })

    expect(filterOrchestrationDashboardActivityItems(items, "activity").some((item) => item.badge === "failed")).toBe(true)
    expect(filterOrchestrationDashboardActivityItems(items, "approvals").some((item) => item.id.startsWith("approval:"))).toBe(true)
  })
})
