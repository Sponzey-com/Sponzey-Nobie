import { createElement } from "../packages/webui/node_modules/react/index.js"
import { renderToStaticMarkup } from "../packages/webui/node_modules/react-dom/server.js"
import { describe, expect, it } from "vitest"
import { OrchestrationMapToolbar } from "../packages/webui/src/components/orchestration/OrchestrationMapToolbar.tsx"
import { OrchestrationPresetPicker } from "../packages/webui/src/components/orchestration/OrchestrationPresetPicker.tsx"
import { createOrchestrationBoardDraft } from "../packages/webui/src/lib/orchestration-board.ts"
import { createBoardAgentDraft, createBoardAgentDraftFromDescription, createBoardTeamDraft, createBoardTeamDraftFromDescription } from "../packages/webui/src/lib/orchestration-board-editing.ts"
import { createDefaultOrchestrationViewportState } from "../packages/webui/src/lib/orchestration-viewport.ts"

describe("task004 orchestration create flow", () => {
  it("creates new disabled agent and team cards directly inside the board draft", () => {
    const base = createOrchestrationBoardDraft({
      agents: [],
      teams: [],
    })

    const withAgent = createBoardAgentDraft({
      draft: base,
      displayName: "New agent",
      rolePresetId: "reviewer",
      randomSuffix: () => "a1b2",
    })
    const withTeam = createBoardTeamDraft({
      draft: withAgent,
      displayName: "New team",
      purposePresetId: "build_pod",
      randomSuffix: () => "t9k3",
    })

    expect(withAgent.agents[0]?.agentId).toBe("agent-new-agent-a1b2")
    expect(withAgent.agents[0]?.config.status).toBe("disabled")
    expect(withAgent.selectedNodeId).toBe("agent:agent-new-agent-a1b2")
    expect(withTeam.teams[0]?.teamId).toBe("team-new-team-t9k3")
    expect(withTeam.teams[0]?.config.status).toBe("disabled")
    expect(withTeam.selectedNodeId).toBe("team:team-new-team-t9k3")
    expect(withTeam.dirty).toBe(true)
  })

  it("renders preset pickers that let the board stay visual-first instead of opening a large form", () => {
    const agentHtml = renderToStaticMarkup(createElement(OrchestrationPresetPicker, {
      kind: "agent",
      language: "en",
      onChooseAgentPreset: () => undefined,
      onClose: () => undefined,
    }))
    const teamHtml = renderToStaticMarkup(createElement(OrchestrationPresetPicker, {
      kind: "team",
      language: "en",
      onChooseTeamPreset: () => undefined,
      onClose: () => undefined,
    }))

    expect(agentHtml).toContain('data-orchestration-preset-picker="agent"')
    expect(agentHtml).toContain("Pick a starting role")
    expect(agentHtml).toContain('data-orchestration-agent-preset="researcher"')
    expect(agentHtml).toContain('data-orchestration-agent-preset="reviewer"')
    expect(teamHtml).toContain('data-orchestration-preset-picker="team"')
    expect(teamHtml).toContain("Pick a team purpose")
    expect(teamHtml).toContain('data-orchestration-team-preset="research_pod"')
    expect(teamHtml).toContain('data-orchestration-team-preset="build_pod"')
  })

  it("creates team and agent drafts directly from name and description so the map can stay editable", () => {
    const withTeam = createBoardTeamDraftFromDescription({
      draft: createOrchestrationBoardDraft({ agents: [], teams: [] }),
      displayName: "Research pod",
      description: "Collect evidence and validate findings together.",
      randomSuffix: () => "t9k3",
    })

    const withAgent = createBoardAgentDraftFromDescription({
      draft: withTeam,
      displayName: "Evidence reviewer",
      description: "Review evidence carefully and respond in a precise tone.",
      teamId: "team-research-pod-t9k3",
      randomSuffix: () => "a1b2",
    })

    expect(withTeam.teams[0]?.config.purpose).toBe("Collect evidence and validate findings together.")
    expect(withAgent.agents[0]?.config.role).toBe("Review evidence carefully and respond in a precise tone")
    expect(withAgent.agents[0]?.config.personality).toBe("Review evidence carefully and respond in a precise tone.")
    expect(withAgent.agents[0]?.config.teamIds).toEqual(["team-research-pod-t9k3"])
    expect(withAgent.teams[0]?.config.memberAgentIds).toEqual(["agent-evidence-reviewer-a1b2"])
    expect(withAgent.selectedNodeId).toBe("agent:agent-evidence-reviewer-a1b2")
  })

  it("renders map-level Agent+ and Team+ actions for the visible creation flow", () => {
    const html = renderToStaticMarkup(createElement(OrchestrationMapToolbar, {
      language: "en",
      viewport: createDefaultOrchestrationViewportState(),
      nodeMode: "card",
      canEdit: true,
      onCreateAgent: () => undefined,
      onCreateTeam: () => undefined,
      onZoomIn: () => undefined,
      onZoomOut: () => undefined,
      onFitSelection: () => undefined,
      onFitAll: () => undefined,
      onReset: () => undefined,
    }))

    expect(html).toContain('data-orchestration-map-create="agent"')
    expect(html).toContain('data-orchestration-map-create="team"')
    expect(html).toContain("Agent+")
    expect(html).toContain("Team+")
  })
})
