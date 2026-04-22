import { describe, expect, it } from "vitest"
import type {
  OrchestrationAgentRegistryEntry,
  OrchestrationRegistrySnapshot,
  OrchestrationTeamRegistryEntry,
} from "../packages/webui/src/contracts/orchestration-api.ts"
import type { SubAgentConfig, TeamConfig } from "../packages/webui/src/contracts/sub-agent-orchestration.ts"
import { buildOrchestrationBoardProjection } from "../packages/webui/src/lib/orchestration-board-projection.ts"
import { createSubAgentConfig, createTeamConfig } from "../packages/webui/src/lib/orchestration-ui.ts"

const now = Date.UTC(2026, 3, 21, 0, 0, 0)

function subAgent(agentId: string, status: SubAgentConfig["status"], teamIds: string[], overrides: Partial<SubAgentConfig> = {}): SubAgentConfig {
  const base = createSubAgentConfig({
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
  return {
    ...base,
    status,
    ...overrides,
  }
}

function teamConfig(teamId: string, memberAgentIds: string[], overrides: Partial<TeamConfig> = {}): TeamConfig {
  const base = createTeamConfig({
    teamId,
    displayName: `Team ${teamId}`,
    nickname: teamId.replace(/^team-/, ""),
    purpose: "Collect evidence and review the result.",
    memberAgentIds,
    roleHints: memberAgentIds.map((_, index) => index === 0 ? "lead" : "member"),
    now,
  })
  return {
    ...base,
    status: "enabled",
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

function teamEntry(config: TeamConfig, unresolvedMemberAgentIds: string[] = []): OrchestrationTeamRegistryEntry {
  return {
    teamId: config.teamId,
    displayName: config.displayName,
    nickname: config.nickname,
    status: config.status,
    purpose: config.purpose,
    roleHints: config.roleHints,
    memberAgentIds: config.memberAgentIds,
    activeMemberAgentIds: config.memberAgentIds.filter((agentId) => !unresolvedMemberAgentIds.includes(agentId)),
    unresolvedMemberAgentIds,
    source: "db",
    config,
  }
}

describe("task002 orchestration board projection", () => {
  it("projects team lanes, unassigned cards, and hidden diagnostics from registry data", () => {
    const alpha = agentEntry(subAgent("agent-alpha-a1", "enabled", ["team-research-r1"]))
    const beta = agentEntry(subAgent("agent-beta-b2", "enabled", []))
    const gamma = agentEntry(subAgent("agent-gamma-c3", "disabled", []))
    const research = teamEntry(teamConfig("team-research-r1", ["agent-alpha-a1", "agent-ghost-x9"]), ["agent-ghost-x9"])
    const empty = teamEntry(teamConfig("team-empty-z9", []))
    const snapshot: OrchestrationRegistrySnapshot = {
      generatedAt: now,
      agents: [alpha, beta, gamma],
      teams: [research, empty],
      membershipEdges: [
        { teamId: "team-research-r1", agentId: "agent-alpha-a1", status: "active", roleHint: "lead" },
        { teamId: "team-research-r1", agentId: "agent-ghost-x9", status: "unresolved", roleHint: "missing reviewer" },
      ],
      diagnostics: [],
    }

    const projection = buildOrchestrationBoardProjection({
      snapshot,
      agents: snapshot.agents,
      teams: snapshot.teams,
      language: "en",
      selectedEntityId: "agent:agent-beta-b2",
    })

    expect(projection.lanes.map((lane) => lane.id)).toEqual([
      "lane:unassigned",
      "lane:team:team-empty-z9",
      "lane:team:team-research-r1",
    ])
    expect(projection.counts.unassignedAgents).toBe(2)
    expect(projection.lanes[0]?.cards.map((card) => card.agentId)).toEqual(["agent-beta-b2", "agent-gamma-c3"])
    expect(projection.lanes.find((lane) => lane.teamId === "team-research-r1")?.cards.map((card) => card.agentId)).toEqual(["agent-alpha-a1"])
    expect(projection.lanes.find((lane) => lane.teamId === "team-research-r1")?.badges).toEqual(expect.arrayContaining(["enabled", "1 agents", "1 missing"]))
    expect(projection.lanes.find((lane) => lane.teamId === "team-empty-z9")?.diagnostics).toEqual(expect.arrayContaining([
      "This team currently has no assigned agents.",
    ]))
    expect(projection.diagnostics.map((item) => item.label)).toEqual(expect.arrayContaining([
      "Missing links",
      "Empty teams",
      "Independent agents",
      "Inactive cards",
    ]))
    expect(projection.selectedEntity?.title).toBe("Agent agent-beta-b2")
    expect(projection.selectedEntity?.badges).toEqual(expect.arrayContaining(["enabled", "Teams 0"]))
  })

  it("keeps lane meaning aligned with real team and agent ownership when membership arrays disagree", () => {
    const desynced = agentEntry(subAgent("agent-delta-d4", "enabled", ["team-research-r1"]))
    const research = teamEntry(teamConfig("team-research-r1", []))
    const projection = buildOrchestrationBoardProjection({
      snapshot: {
        generatedAt: now,
        agents: [desynced],
        teams: [research],
        membershipEdges: [],
        diagnostics: [],
      },
      agents: [desynced],
      teams: [research],
      language: "en",
      selectedEntityId: "team:team-research-r1",
    })

    expect(projection.lanes.find((lane) => lane.teamId === "team-research-r1")?.cards.map((card) => card.agentId)).toEqual(["agent-delta-d4"])
    expect(projection.lanes.find((lane) => lane.teamId === "team-research-r1")?.diagnostics).toEqual(expect.arrayContaining([
      "1 membership mismatches",
    ]))
    expect(projection.selectedEntity?.title).toBe("Team team-research-r1")
    expect(projection.selectedEntity?.details.some((detail) => detail.includes("Member IDs"))).toBe(true)
  })

  it("shows neutral untitled labels on the map when draft names are empty", () => {
    const unnamedAgent = agentEntry(subAgent("agent-alpha-a1", "enabled", [], {
      displayName: "",
      role: "",
    }))
    const unnamedTeam = teamEntry(teamConfig("team-research-r1", [], {
      displayName: "",
      purpose: "",
    }))

    const projection = buildOrchestrationBoardProjection({
      snapshot: {
        generatedAt: now,
        agents: [unnamedAgent],
        teams: [unnamedTeam],
        membershipEdges: [],
        diagnostics: [],
      },
      agents: [unnamedAgent],
      teams: [unnamedTeam],
      language: "en",
      selectedEntityId: "agent:agent-alpha-a1",
    })

    expect(projection.lanes[0]?.cards[0]?.displayName).toBe("Untitled agent")
    expect(projection.lanes.find((lane) => lane.teamId === "team-research-r1")?.displayName).toBe("Untitled team")
    expect(projection.selectedEntity?.title).toBe("Untitled agent")
  })
})
