import { describe, expect, it } from "vitest"
import { createOrchestrationBoardDraft } from "../packages/webui/src/lib/orchestration-board.ts"
import { reduceOrchestrationBoardDraft, resolveReducerActionFromPendingDrop } from "../packages/webui/src/lib/orchestration-board-reducer.ts"
import { buildPendingDropAction } from "../packages/webui/src/lib/orchestration-drop-actions.ts"
import { createSubAgentConfig, createTeamConfig } from "../packages/webui/src/lib/orchestration-ui.ts"

const now = Date.UTC(2026, 3, 21, 0, 0, 0)

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

describe("task003 orchestration membership reducer", () => {
  it("adds and moves memberships while keeping agent/team arrays in sync", () => {
    const alpha = subAgent("agent-alpha-a1", "Alpha", ["team-research-r1"])
    const beta = subAgent("agent-beta-b2", "Beta", [])
    const research = team("team-research-r1", "Research", ["agent-alpha-a1"])
    const ops = team("team-ops-o2", "Ops", [])
    const draft = createOrchestrationBoardDraft({
      agents: [alpha, beta],
      teams: [research, ops],
    })

    const added = reduceOrchestrationBoardDraft(draft, {
      type: "add_to_team",
      agentId: "agent-beta-b2",
      targetTeamId: "team-ops-o2",
    })
    const moved = reduceOrchestrationBoardDraft(added, {
      type: "move_to_team",
      agentId: "agent-alpha-a1",
      sourceTeamId: "team-research-r1",
      targetTeamId: "team-ops-o2",
    })

    expect(added.agents.find((agent) => agent.agentId === "agent-beta-b2")?.config.teamIds).toEqual(["team-ops-o2"])
    expect(added.teams.find((entry) => entry.teamId === "team-ops-o2")?.config.memberAgentIds).toEqual(["agent-beta-b2"])
    expect(moved.agents.find((agent) => agent.agentId === "agent-alpha-a1")?.config.teamIds).toEqual(["team-ops-o2"])
    expect(moved.teams.find((entry) => entry.teamId === "team-research-r1")?.config.memberAgentIds).toEqual([])
    expect(moved.teams.find((entry) => entry.teamId === "team-ops-o2")?.config.memberAgentIds).toEqual(["agent-beta-b2", "agent-alpha-a1"])
    expect(moved.pendingDrop).toBeNull()
    expect(moved.dragState).toBeNull()
    expect(moved.dirty).toBe(true)
  })

  it("removes memberships when dropped into the unassigned lane", () => {
    const alpha = subAgent("agent-alpha-a1", "Alpha", ["team-research-r1"])
    const research = team("team-research-r1", "Research", ["agent-alpha-a1"])
    const draft = createOrchestrationBoardDraft({
      agents: [alpha],
      teams: [research],
    })

    const reduced = reduceOrchestrationBoardDraft(draft, {
      type: "unassign",
      agentId: "agent-alpha-a1",
      sourceTeamId: "team-research-r1",
    })

    expect(reduced.agents.find((agent) => agent.agentId === "agent-alpha-a1")?.config.teamIds).toEqual([])
    expect(reduced.teams.find((entry) => entry.teamId === "team-research-r1")?.config.memberAgentIds).toEqual([])
    expect(reduced.memberships).toEqual([])
  })

  it("creates clone and new-team variants through the same pending-drop reducer path", () => {
    const alpha = subAgent("agent-alpha-a1", "Alpha", ["team-research-r1"])
    const research = team("team-research-r1", "Research", ["agent-alpha-a1"])
    const review = team("team-review-v2", "Review", [])
    const draft = createOrchestrationBoardDraft({
      agents: [alpha],
      teams: [research, review],
    })
    const clonePending = buildPendingDropAction({
      draft,
      agentId: "agent-alpha-a1",
      sourceLaneId: "lane:team:team-research-r1",
      targetLaneId: "lane:team:team-review-v2",
      language: "en",
      now,
    })
    const cloneAction = resolveReducerActionFromPendingDrop({
      pendingDrop: clonePending!,
      optionId: "clone_to_team",
      language: "en",
      now,
      randomSuffix: () => "c1a9",
    })
    const cloned = reduceOrchestrationBoardDraft(draft, cloneAction)
    const clone = cloned.agents.find((agent) => agent.agentId !== "agent-alpha-a1")

    expect(clone?.agentId).toBe("agent-alpha-copy-c1a9")
    expect(clone?.config.teamIds).toEqual(["team-review-v2"])
    expect(clone?.persisted).toBe(false)
    expect(clone?.config.status).toBe("disabled")

    const createTeamPending = buildPendingDropAction({
      draft,
      agentId: "agent-alpha-a1",
      sourceLaneId: "lane:team:team-research-r1",
      targetLaneId: "lane:canvas",
      language: "en",
      now,
    })
    const createTeamAction = resolveReducerActionFromPendingDrop({
      pendingDrop: createTeamPending!,
      optionId: "create_team_and_add",
      language: "en",
      now,
      randomSuffix: () => "n7q2",
    })
    const withNewTeam = reduceOrchestrationBoardDraft(draft, createTeamAction)
    const createdTeam = withNewTeam.teams.find((entry) => entry.teamId !== "team-research-r1" && entry.teamId !== "team-review-v2")

    expect(createdTeam?.teamId).toBe("team-alpha-team-n7q2")
    expect(createdTeam?.config.memberAgentIds).toEqual(["agent-alpha-a1"])
    expect(createdTeam?.persisted).toBe(false)
  })
})
