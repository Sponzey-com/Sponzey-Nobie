import { describe, expect, it } from "vitest"
import { createOrchestrationBoardDraft } from "../packages/webui/src/lib/orchestration-board.ts"
import { applyOrchestrationStarterPlanToDraft, buildOrchestrationStarterPlan } from "../packages/webui/src/lib/orchestration-starter-kits.ts"
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

describe("task005 orchestration starter kits", () => {
  it("builds starter plans from the shared preset taxonomy", () => {
    const plan = buildOrchestrationStarterPlan({
      starterKitId: "review_squad",
    })

    expect(plan.team).toEqual({
      displayName: "Review Squad",
      purposePresetId: "research_pod",
    })
    expect(plan.agents).toHaveLength(3)
    expect(plan.agents[0]).toMatchObject({
      rolePresetId: "reviewer",
      riskPresetId: "safe_read",
      capabilityPresetId: "review_only",
    })
  })

  it("applies starter plans as disabled unsaved drafts with generated ids and synced memberships", () => {
    const alpha = subAgent("agent-alpha-a1", "Alpha", [])
    const research = team("team-research-r1", "Research", [])
    const draft = createOrchestrationBoardDraft({
      agents: [alpha],
      teams: [research],
    })
    const plan = buildOrchestrationStarterPlan({
      starterKitId: "workspace_operator_pair",
    })
    const suffixes = ["k101", "a201", "a202"]
    let index = 0
    const next = () => suffixes[index++]!
    const reduced = applyOrchestrationStarterPlanToDraft({
      draft,
      plan,
      now,
      randomSuffix: next,
    })

    expect(reduced.selectedNodeId).toBe("team:team-workspace-operators-k101")
    expect(reduced.teams.find((entry) => entry.teamId === "team-workspace-operators-k101")).toMatchObject({
      persisted: false,
      status: "disabled",
    })
    expect(reduced.agents.find((entry) => entry.agentId === "agent-workspace-operator-1-a201")).toMatchObject({
      persisted: false,
      status: "disabled",
      rolePresetId: "operator",
      riskPresetId: "workspace_write",
      capabilityPresetId: "workspace_tools",
    })
    expect(reduced.agents.find((entry) => entry.agentId === "agent-workspace-operator-2-a202")?.config.teamIds).toEqual([
      "team-workspace-operators-k101",
    ])
    expect(reduced.teams.find((entry) => entry.teamId === "team-workspace-operators-k101")?.config.memberAgentIds).toEqual([
      "agent-workspace-operator-1-a201",
      "agent-workspace-operator-2-a202",
    ])
    expect(reduced.agents.find((entry) => entry.agentId === "agent-workspace-operator-1-a201")?.status).toBe("disabled")
  })
})
