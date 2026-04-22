import { createElement } from "../packages/webui/node_modules/react/index.js"
import { renderToStaticMarkup } from "../packages/webui/node_modules/react-dom/server.js"
import { describe, expect, it } from "vitest"
import { createOrchestrationBoardDraft } from "../packages/webui/src/lib/orchestration-board.ts"
import { buildPendingDropAction } from "../packages/webui/src/lib/orchestration-drop-actions.ts"
import { createSubAgentConfig, createTeamConfig } from "../packages/webui/src/lib/orchestration-ui.ts"
import { OrchestrationDropMenu } from "../packages/webui/src/components/orchestration/OrchestrationDropMenu.tsx"

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

describe("task004 orchestration popup actions", () => {
  it("adds result-oriented descriptions and recommendations for team drops", () => {
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
    expect(pending?.options.find((option) => option.id === "add_to_team")).toMatchObject({
      recommended: true,
      tone: "safe",
    })
    expect(pending?.options.find((option) => option.id === "move_to_team")?.description).toContain("keep only Review")
    expect(html).toContain("Keep Research membership and add Review too.")
    expect(html).toContain("Recommended")
  })

  it("exposes archive as a distinct destructive action instead of unassign", () => {
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
      targetLaneId: "lane:archive",
      language: "en",
      now,
    })
    const html = renderToStaticMarkup(createElement(OrchestrationDropMenu, {
      pendingDrop: pending!,
      language: "en",
      onChoose: () => undefined,
    }))

    expect(pending?.targetKind).toBe("archive")
    expect(pending?.options.map((option) => option.id)).toEqual(["archive", "cancel"])
    expect(pending?.options[0]).toMatchObject({
      tone: "danger",
      description: "Set Alpha to archived and clear active team memberships.",
    })
    expect(html).toContain('data-orchestration-drop-option="archive"')
    expect(html).toContain("clear active team memberships")
  })
})
