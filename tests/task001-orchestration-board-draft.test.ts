import { describe, expect, it } from "vitest"
import { createOrchestrationBoardDraft, materializeOrchestrationBoardDraft } from "../packages/webui/src/lib/orchestration-board.ts"
import { createSubAgentConfig, createTeamConfig } from "../packages/webui/src/lib/orchestration-ui.ts"

const now = Date.UTC(2026, 3, 21, 0, 0, 0)

function subAgent(input: {
  agentId: string
  displayName: string
  teamIds?: string[]
}) {
  return createSubAgentConfig({
    agentId: input.agentId,
    displayName: input.displayName,
    role: "Structured worker",
    personality: "Precise and bounded.",
    specialtyTags: ["research"],
    avoidTasks: ["unguarded changes"],
    teamIds: input.teamIds ?? [],
    riskCeiling: "moderate",
    enabledSkillIds: ["web-search"],
    enabledMcpServerIds: ["browser"],
    enabledToolNames: ["web_search"],
    now,
  })
}

function team(input: {
  teamId: string
  displayName: string
  memberAgentIds: string[]
  roleHints?: string[]
}) {
  return createTeamConfig({
    teamId: input.teamId,
    displayName: input.displayName,
    purpose: "Collect evidence and review findings.",
    memberAgentIds: input.memberAgentIds,
    roleHints: input.roleHints ?? input.memberAgentIds.map(() => "member"),
    now,
  })
}

describe("task001 orchestration board draft foundation", () => {
  it("captures board ui state and flags desynced or unresolved memberships in one draft object", () => {
    const alpha = subAgent({ agentId: "agent-alpha-a1", displayName: "Alpha", teamIds: ["team-research-t1"] })
    const beta = subAgent({ agentId: "agent-beta-b2", displayName: "Beta", teamIds: ["team-research-t1"] })
    const research = team({
      teamId: "team-research-t1",
      displayName: "Research",
      memberAgentIds: ["agent-alpha-a1", "agent-ghost-x9"],
      roleHints: ["lead", "missing reviewer"],
    })

    const draft = createOrchestrationBoardDraft({
      agents: [alpha, beta],
      teams: [research],
      selectedNodeId: "agent-beta-b2",
      dirty: true,
      dragState: {
        entityType: "agent",
        entityId: "agent-beta-b2",
        sourceLaneId: "lane:unassigned",
        overLaneId: "lane:team-research-t1",
        phase: "pending_drop",
      },
      pendingDrop: {
        entityType: "agent",
        entityId: "agent-beta-b2",
        title: "Choose drop action",
        summary: "Choose how to handle Beta from unassigned to Research.",
        sourceKind: "unassigned",
        targetKind: "team",
        targetTeamId: "team-research-t1",
        fromLaneId: "lane:unassigned",
        toLaneId: "lane:team-research-t1",
        options: [
          { id: "add_to_team", label: "Add to team", description: "Place Beta into Research.", tone: "safe", recommended: true },
          { id: "cancel", label: "Cancel", description: "Keep the current layout unchanged.", tone: "neutral" },
        ],
        openedAt: now,
      },
    })

    expect(draft.selectedNodeId).toBe("agent-beta-b2")
    expect(draft.dirty).toBe(true)
    expect(draft.pendingDrop?.options.map((option) => option.id)).toEqual(["add_to_team", "cancel"])
    expect(draft.memberships.find((link) => link.agentId === "agent-alpha-a1" && link.teamId === "team-research-t1")?.status).toBe("active")
    expect(draft.memberships.find((link) => link.agentId === "agent-beta-b2" && link.teamId === "team-research-t1")?.status).toBe("desynced")
    expect(draft.memberships.find((link) => link.agentId === "agent-ghost-x9" && link.teamId === "team-research-t1")?.status).toBe("unresolved")
    expect(draft.persistMeta.allowPartialWrite).toBe(false)
    expect(draft.persistMeta.saveOrder).toEqual([
      { targetType: "team", targetId: "team-research-t1" },
      { targetType: "agent", targetId: "agent-alpha-a1" },
      { targetType: "agent", targetId: "agent-beta-b2" },
    ])
  })

  it("uses memberships as the single source of truth when rebuilding agent and team configs for save", () => {
    const alpha = subAgent({ agentId: "agent-alpha-a1", displayName: "Alpha", teamIds: ["team-research-t1"] })
    const beta = subAgent({ agentId: "agent-beta-b2", displayName: "Beta", teamIds: [] })
    const research = team({
      teamId: "team-research-t1",
      displayName: "Research",
      memberAgentIds: ["agent-alpha-a1"],
      roleHints: ["lead"],
    })
    const draft = createOrchestrationBoardDraft({
      agents: [alpha, beta],
      teams: [research],
    })
    const materialized = materializeOrchestrationBoardDraft({
      draft: {
        ...draft,
        memberships: [
          {
            id: "membership:team-research-t1:agent-alpha-a1",
            teamId: "team-research-t1",
            agentId: "agent-alpha-a1",
            status: "active",
            source: "draft",
            roleHint: "lead",
          },
          {
            id: "membership:team-research-t1:agent-beta-b2",
            teamId: "team-research-t1",
            agentId: "agent-beta-b2",
            status: "active",
            source: "draft",
            roleHint: "member",
          },
        ],
      },
    })

    expect(materialized.agents.find((agent) => agent.agentId === "agent-beta-b2")?.teamIds).toEqual(["team-research-t1"])
    expect(materialized.teams.find((entry) => entry.teamId === "team-research-t1")?.memberAgentIds).toEqual([
      "agent-alpha-a1",
      "agent-beta-b2",
    ])
    expect(materialized.membership.byAgentId["agent-beta-b2"]).toEqual(["team-research-t1"])
    expect(materialized.membership.byTeamId["team-research-t1"]).toEqual([
      "agent-alpha-a1",
      "agent-beta-b2",
    ])
  })
})
