import { createElement } from "../packages/webui/node_modules/react/index.js"
import { renderToStaticMarkup } from "../packages/webui/node_modules/react-dom/server.js"
import { describe, expect, it } from "vitest"
import type { FeatureCapability } from "../packages/webui/src/contracts/capabilities.ts"
import type {
  OrchestrationAgentRegistryEntry,
  OrchestrationRegistrySnapshot,
  OrchestrationTeamRegistryEntry,
} from "../packages/webui/src/contracts/orchestration-api.ts"
import type { SubAgentConfig, TeamConfig } from "../packages/webui/src/contracts/sub-agent-orchestration.ts"
import { OrchestrationStudioPreview } from "../packages/webui/src/components/orchestration/OrchestrationStudioPreview.tsx"
import { buildOrchestrationBoardProjection } from "../packages/webui/src/lib/orchestration-board-projection.ts"
import { createSubAgentConfig, createTeamConfig } from "../packages/webui/src/lib/orchestration-ui.ts"
import { resolveTopologyEditorGate } from "../packages/webui/src/lib/setup-visualization-topology.ts"

const now = Date.UTC(2026, 3, 22, 0, 0, 0)

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

function subAgent(agentId: string, teamIds: string[]): SubAgentConfig {
  return createSubAgentConfig({
    agentId,
    displayName: `Agent ${agentId}`,
    nickname: agentId.replace(/^agent-/, ""),
    role: "Structured worker",
    personality: "Precise and bounded.",
    specialtyTags: ["research"],
    avoidTasks: ["unguarded shell"],
    teamIds,
    riskCeiling: "moderate",
    enabledSkillIds: ["web-search"],
    enabledMcpServerIds: ["browser"],
    enabledToolNames: ["web_search"],
    now,
  })
}

function team(teamId: string, memberAgentIds: string[]): TeamConfig {
  return createTeamConfig({
    teamId,
    displayName: `Team ${teamId}`,
    nickname: teamId.replace(/^team-/, ""),
    purpose: "Collect evidence and review the result.",
    memberAgentIds,
    roleHints: memberAgentIds.map((_, index) => index === 0 ? "lead" : "member"),
    now,
  })
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

function teamEntry(config: TeamConfig): OrchestrationTeamRegistryEntry {
  return {
    teamId: config.teamId,
    displayName: config.displayName,
    nickname: config.nickname,
    status: config.status,
    purpose: config.purpose,
    roleHints: config.roleHints,
    memberAgentIds: config.memberAgentIds,
    activeMemberAgentIds: config.memberAgentIds,
    unresolvedMemberAgentIds: [],
    source: "db",
    config,
  }
}

describe("task003 orchestration settings preview", () => {
  it("keeps the settings agents tab preview-only while reusing the same map projection and open-editor CTA", () => {
    const alpha = agentEntry(subAgent("agent-alpha-a1", ["team-research-r1"]))
    const research = teamEntry(team("team-research-r1", ["agent-alpha-a1"]))
    const snapshot: OrchestrationRegistrySnapshot = {
      generatedAt: now,
      agents: [alpha],
      teams: [research],
      membershipEdges: [{ teamId: "team-research-r1", agentId: "agent-alpha-a1", status: "active", roleHint: "lead" }],
      diagnostics: [],
    }
    const projection = buildOrchestrationBoardProjection({
      snapshot,
      agents: snapshot.agents,
      teams: snapshot.teams,
      language: "en",
      selectedEntityId: "agent:agent-alpha-a1",
    })
    const gate = resolveTopologyEditorGate({
      surface: "settings",
      settingsCapability: capability("settings.control", "ready"),
      mqttCapability: capability("mqtt.broker", "ready"),
      language: "en",
    })

    const html = renderToStaticMarkup(createElement(OrchestrationStudioPreview, {
      language: "en",
      projection,
      gate,
      entryHref: "/advanced/agents",
      selectedTitle: "Agent Alpha",
      onSelectAgent: () => undefined,
      onSelectTeam: () => undefined,
    }))

    expect(html).toContain('data-orchestration-studio-preview=""')
    expect(html).toContain('href="/advanced/agents"')
    expect(html).toContain("Open Editor")
    expect(html).toContain('data-orchestration-board-layout="dashboard"')
    expect(html).toContain('data-orchestration-board-surface="settings"')
    expect(html).not.toContain('data-orchestration-board-actions=""')
    expect(html).not.toContain("Save")
    expect(html).not.toContain("Validate")
  })
})
