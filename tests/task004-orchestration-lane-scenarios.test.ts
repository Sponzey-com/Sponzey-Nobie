import { describe, expect, it } from "vitest"
import { createOrchestrationBoardDraft } from "../packages/webui/src/lib/orchestration-board.ts"
import { buildPendingDropAction } from "../packages/webui/src/lib/orchestration-drop-actions.ts"
import { buildBoardViewStateFromDraft, reduceOrchestrationBoardDraft, resolveReducerActionFromPendingDrop } from "../packages/webui/src/lib/orchestration-board-reducer.ts"
import { createSubAgentConfig, createTeamConfig } from "../packages/webui/src/lib/orchestration-ui.ts"

const now = Date.UTC(2026, 3, 22, 0, 0, 0)

function subAgent(agentId: string, displayName: string, teamIds: string[]) {
  return createSubAgentConfig({
    agentId,
    displayName,
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

function team(teamId: string, displayName: string, memberAgentIds: string[]) {
  return createTeamConfig({
    teamId,
    displayName,
    purpose: "Collect evidence and review the result.",
    memberAgentIds,
    roleHints: memberAgentIds.map((_, index) => index === 0 ? "lead" : "member"),
    now,
  })
}

describe("task004 orchestration lane scenarios", () => {
  it("creates a new disabled team lane from the canvas drop flow without discarding existing memberships", () => {
    const alpha = subAgent("agent-alpha-a1", "Alpha", ["team-research-r1"])
    const research = team("team-research-r1", "Research", ["agent-alpha-a1"])
    const draft = createOrchestrationBoardDraft({
      agents: [alpha],
      teams: [research],
    })
    const pending = buildPendingDropAction({
      draft,
      agentId: "agent-alpha-a1",
      sourceLaneId: "lane:team:team-research-r1",
      targetLaneId: "lane:canvas",
      language: "en",
      now,
    })
    const action = resolveReducerActionFromPendingDrop({
      pendingDrop: pending!,
      optionId: "create_team_and_add",
      language: "en",
      now,
      randomSuffix: () => "n7q2",
    })
    const reduced = reduceOrchestrationBoardDraft(draft, action)
    const createdTeam = reduced.teams.find((entry) => entry.teamId === "team-alpha-team-n7q2")
    const materialized = buildBoardViewStateFromDraft({
      draft: reduced,
      baseAgents: [],
      baseTeams: [],
      generatedAt: now,
    })

    expect(createdTeam?.config.status).toBe("disabled")
    expect(reduced.agents.find((agent) => agent.agentId === "agent-alpha-a1")?.config.teamIds).toEqual([
      "team-research-r1",
      "team-alpha-team-n7q2",
    ])
    expect(materialized.teams.find((entry) => entry.teamId === "team-alpha-team-n7q2")?.config.memberAgentIds).toEqual(["agent-alpha-a1"])
  })

  it("keeps unassign and archive as separate outcomes", () => {
    const alpha = subAgent("agent-alpha-a1", "Alpha", ["team-research-r1"])
    const research = team("team-research-r1", "Research", ["agent-alpha-a1"])
    const draft = createOrchestrationBoardDraft({
      agents: [alpha],
      teams: [research],
    })

    const unassigned = reduceOrchestrationBoardDraft(draft, {
      type: "unassign",
      agentId: "agent-alpha-a1",
      sourceTeamId: "team-research-r1",
    })
    const archived = reduceOrchestrationBoardDraft(draft, {
      type: "archive_agent",
      agentId: "agent-alpha-a1",
    })

    expect(unassigned.agents.find((agent) => agent.agentId === "agent-alpha-a1")?.config.status).toBe("disabled")
    expect(unassigned.agents.find((agent) => agent.agentId === "agent-alpha-a1")?.config.teamIds).toEqual([])
    expect(archived.agents.find((agent) => agent.agentId === "agent-alpha-a1")?.config.status).toBe("archived")
    expect(archived.agents.find((agent) => agent.agentId === "agent-alpha-a1")?.config.teamIds).toEqual([])
  })
})
