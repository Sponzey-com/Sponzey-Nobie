import { createElement } from "../packages/webui/node_modules/react/index.js"
import { renderToStaticMarkup } from "../packages/webui/node_modules/react-dom/server.js"
import { describe, expect, it } from "vitest"
import { createOrchestrationBoardDraft } from "../packages/webui/src/lib/orchestration-board.ts"
import { buildPendingDropAction } from "../packages/webui/src/lib/orchestration-drop-actions.ts"
import { createSubAgentConfig, createTeamConfig } from "../packages/webui/src/lib/orchestration-ui.ts"
import { OrchestrationDropMenu } from "../packages/webui/src/components/orchestration/OrchestrationDropMenu.tsx"

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

describe("task003 orchestration popup menu", () => {
  it("distinguishes add, move, and clone when dragging from one team lane to another", () => {
    const alpha = subAgent("agent-alpha-a1", "Alpha", ["team-research-r1"])
    const research = team("team-research-r1", "Research", ["agent-alpha-a1"])
    const review = team("team-review-v2", "Review", [])
    const draft = createOrchestrationBoardDraft({
      agents: [alpha],
      teams: [research, review],
    })
    const pending = buildPendingDropAction({
      draft,
      agentId: "agent-alpha-a1",
      sourceLaneId: "lane:team:team-research-r1",
      targetLaneId: "lane:team:team-review-v2",
      language: "en",
      now,
    })
    const html = renderToStaticMarkup(createElement(OrchestrationDropMenu, {
      pendingDrop: pending!,
      language: "en",
      onChoose: () => undefined,
    }))

    expect(pending?.options.map((option) => option.id)).toEqual(["add_to_team", "move_to_team", "clone_to_team", "cancel"])
    expect(html).toContain("Choose drop action")
    expect(html).toContain("Add to this team too")
    expect(html).toContain("Move to this team")
    expect(html).toContain("Clone and add")
  })

  it("switches option sets for unassign and create-team flows without auto-confirming the action", () => {
    const alpha = subAgent("agent-alpha-a1", "Alpha", ["team-research-r1"])
    const research = team("team-research-r1", "Research", ["agent-alpha-a1"])
    const draft = createOrchestrationBoardDraft({
      agents: [alpha],
      teams: [research],
    })

    const unassign = buildPendingDropAction({
      draft,
      agentId: "agent-alpha-a1",
      sourceLaneId: "lane:team:team-research-r1",
      targetLaneId: "lane:unassigned",
      language: "en",
      now,
    })
    const createTeam = buildPendingDropAction({
      draft,
      agentId: "agent-alpha-a1",
      sourceLaneId: "lane:team:team-research-r1",
      targetLaneId: "lane:canvas",
      language: "en",
      now,
    })

    expect(unassign?.options.map((option) => option.id)).toEqual(["unassign", "cancel"])
    expect(createTeam?.options.map((option) => option.id)).toEqual(["create_team_and_add", "cancel"])
    expect(unassign?.summary).toContain("unassigned lane")
    expect(createTeam?.summary).toContain("newly created team")
  })
})
