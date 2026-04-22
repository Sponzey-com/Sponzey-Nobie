import { createElement } from "../packages/webui/node_modules/react/index.js"
import { renderToStaticMarkup } from "../packages/webui/node_modules/react-dom/server.js"
import { describe, expect, it } from "vitest"
import { OrchestrationBoardEditor } from "../packages/webui/src/components/orchestration/OrchestrationBoardEditor.tsx"
import type { FeatureCapability } from "../packages/webui/src/contracts/capabilities.ts"
import type {
  OrchestrationAgentRegistryEntry,
  OrchestrationRegistrySnapshot,
  OrchestrationTeamRegistryEntry,
} from "../packages/webui/src/contracts/orchestration-api.ts"
import type { SubAgentConfig, TeamConfig } from "../packages/webui/src/contracts/sub-agent-orchestration.ts"
import { buildOrchestrationBoardProjection } from "../packages/webui/src/lib/orchestration-board-projection.ts"
import { createSubAgentConfig, createTeamConfig } from "../packages/webui/src/lib/orchestration-ui.ts"
import { resolveTopologyEditorGate } from "../packages/webui/src/lib/setup-visualization-topology.ts"

const now = Date.UTC(2026, 3, 21, 0, 0, 0)

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

function projection() {
  const alpha = agentEntry(subAgent("agent-alpha-a1", ["team-research-r1"]))
  const beta = agentEntry(subAgent("agent-beta-b2", []))
  const research = teamEntry(team("team-research-r1", ["agent-alpha-a1"]))
  const snapshot: OrchestrationRegistrySnapshot = {
    generatedAt: now,
    agents: [alpha, beta],
    teams: [research],
    membershipEdges: [{ teamId: "team-research-r1", agentId: "agent-alpha-a1", status: "active", roleHint: "lead" }],
    diagnostics: [],
  }
  return buildOrchestrationBoardProjection({
    snapshot,
    agents: snapshot.agents,
    teams: snapshot.teams,
    language: "en",
    selectedEntityId: "agent:agent-alpha-a1",
  })
}

describe("task002 orchestration board surface gate", () => {
  it("uses the same board lanes for page and settings surfaces while settings stays preview-only", () => {
    const board = projection()
    const settingsGate = resolveTopologyEditorGate({
      surface: "settings",
      settingsCapability: capability("settings.control", "ready"),
      mqttCapability: capability("mqtt.broker", "ready"),
      language: "en",
    })
    const pageGate = resolveTopologyEditorGate({
      surface: "page",
      settingsCapability: capability("settings.control", "ready"),
      mqttCapability: capability("mqtt.broker", "ready"),
      language: "en",
    })

    const settingsHtml = renderToStaticMarkup(createElement(OrchestrationBoardEditor, {
      projection: board,
      gate: settingsGate,
      language: "en",
      surface: "settings",
      entryHref: "/advanced/agents",
    }))
    const pageHtml = renderToStaticMarkup(createElement(OrchestrationBoardEditor, {
      projection: board,
      gate: pageGate,
      language: "en",
      surface: "page",
      entryHref: "/advanced/agents",
      onCreateAgent: () => undefined,
      onCreateTeam: () => undefined,
    }))

    for (const lane of board.lanes) {
      expect(settingsHtml).toContain(`data-orchestration-board-lane="${lane.id}"`)
      expect(pageHtml).toContain(`data-orchestration-board-lane="${lane.id}"`)
    }
    expect(settingsHtml).toContain('data-orchestration-board-surface="settings"')
    expect(settingsHtml).toContain('data-orchestration-board-gate="preview_only"')
    expect(settingsHtml).toContain('href="/advanced/agents"')
    expect(settingsHtml).toContain("Open full editor")
    expect(pageHtml).toContain('data-orchestration-board-surface="page"')
    expect(pageHtml).toContain('data-orchestration-board-actions=""')
    expect(pageHtml).toContain("New team")
    expect(pageHtml).toContain("New agent")
  })

  it("keeps the board visible while disabling write actions when the edit gate is locked", () => {
    const board = projection()
    const disabledGate = resolveTopologyEditorGate({
      surface: "page",
      settingsCapability: capability("settings.control", "planned"),
      mqttCapability: capability("mqtt.broker", "ready"),
      language: "en",
    })

    const html = renderToStaticMarkup(createElement(OrchestrationBoardEditor, {
      projection: board,
      gate: disabledGate,
      language: "en",
      surface: "page",
      entryHref: "/advanced/agents",
      onCreateAgent: () => undefined,
      onCreateTeam: () => undefined,
    }))

    expect(html).toContain('data-orchestration-board-gate="disabled"')
    expect(html).toContain("Topology editing locked")
    expect(html).toContain(`data-orchestration-board-lane="lane:unassigned"`)
    expect(html).toContain(`data-orchestration-board-lane="lane:team:team-research-r1"`)
    expect(html).toContain("disabled")
  })
})
