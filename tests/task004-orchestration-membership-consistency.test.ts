import { describe, expect, it } from "vitest"
import { createOrchestrationBoardDraft } from "../packages/webui/src/lib/orchestration-board.ts"
import { reduceOrchestrationBoardDraft } from "../packages/webui/src/lib/orchestration-board-reducer.ts"
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

describe("task004 orchestration membership consistency", () => {
  it("removes every active membership on archive while keeping single-team unassign scoped", () => {
    const alpha = subAgent("agent-alpha-a1", "Alpha", ["team-research-r1", "team-review-v2"])
    const research = team("team-research-r1", "Research", ["agent-alpha-a1"])
    const review = team("team-review-v2", "Review", ["agent-alpha-a1"])
    const draft = createOrchestrationBoardDraft({
      agents: [alpha],
      teams: [research, review],
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

    expect(unassigned.agents.find((agent) => agent.agentId === "agent-alpha-a1")?.config.teamIds).toEqual(["team-review-v2"])
    expect(unassigned.teams.find((entry) => entry.teamId === "team-research-r1")?.config.memberAgentIds).toEqual([])
    expect(unassigned.teams.find((entry) => entry.teamId === "team-review-v2")?.config.memberAgentIds).toEqual(["agent-alpha-a1"])

    expect(archived.agents.find((agent) => agent.agentId === "agent-alpha-a1")?.config.teamIds).toEqual([])
    expect(archived.teams.find((entry) => entry.teamId === "team-research-r1")?.config.memberAgentIds).toEqual([])
    expect(archived.teams.find((entry) => entry.teamId === "team-review-v2")?.config.memberAgentIds).toEqual([])
    expect(archived.memberships).toEqual([])
  })
})
