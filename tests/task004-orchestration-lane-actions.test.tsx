import { createElement } from "../packages/webui/node_modules/react/index.js"
import { renderToStaticMarkup } from "../packages/webui/node_modules/react-dom/server.js"
import { describe, expect, it } from "vitest"
import { OrchestrationBoardLane } from "../packages/webui/src/components/orchestration/OrchestrationBoardLane.tsx"

describe("task004 orchestration lane actions", () => {
  it("shows explicit team lane actions for add, edit, and archive in studio mode", () => {
    const html = renderToStaticMarkup(createElement(OrchestrationBoardLane, {
      language: "en",
      showLaneActions: true,
      lane: {
        id: "lane:team:team-research-r1",
        kind: "team",
        tone: "ready",
        displayName: "Research",
        description: "Collect and verify evidence.",
        status: "ready",
        cards: [],
        badges: ["enabled", "0 agents"],
        diagnostics: [],
        selected: false,
        teamId: "team-research-r1",
      },
      onCreateAgentInTeam: () => undefined,
      onSelectTeam: () => undefined,
      onArchiveTeam: () => undefined,
    }))

    expect(html).toContain('data-orchestration-board-lane-actions="lane:team:team-research-r1"')
    expect(html).toContain("Add agent here")
    expect(html).toContain("Edit team")
    expect(html).toContain("Archive team")
  })

  it("renders teamless agents as loose cards without a grouped lane header or action bar", () => {
    const html = renderToStaticMarkup(createElement(OrchestrationBoardLane, {
      language: "en",
      showLaneActions: true,
      hasDrag: true,
      canDrop: true,
      lane: {
        id: "lane:unassigned",
        kind: "unassigned",
        tone: "neutral",
        displayName: "Independent Agents",
        description: "No team yet.",
        status: "ready",
        cards: [{
          id: "agent:agent-solo-a1",
          agentId: "agent-solo-a1",
          displayName: "Solo Agent",
          role: "Independent worker",
          status: "enabled",
          tone: "ready",
          configBadges: ["enabled"],
          runtimeBadges: [],
          detailBadges: [],
          badges: ["enabled"],
          diagnostics: [],
          teamIds: [],
          selected: false,
        }],
        badges: ["1 agents"],
        diagnostics: [],
        selected: false,
      },
      onCreateAgentInTeam: () => undefined,
      onCreateTeam: () => undefined,
    }))

    expect(html).toContain('data-orchestration-board-loose-agents=""')
    expect(html).toContain("Solo Agent")
    expect(html).not.toContain('data-orchestration-board-lane-actions="lane:unassigned"')
    expect(html).not.toContain("Independent Agents")
    expect(html).not.toContain("rounded-[1.6rem] border border-dashed")
  })

  it("does not show an unavailable drop warning for no-op or blocked lane hovers", () => {
    const html = renderToStaticMarkup(createElement(OrchestrationBoardLane, {
      language: "ko",
      hasDrag: true,
      canDrop: false,
      lane: {
        id: "lane:team:team-research-r1",
        kind: "team",
        tone: "ready",
        displayName: "리서치 팀",
        description: "근거 수집",
        status: "ready",
        cards: [],
        badges: [],
        diagnostics: [],
        selected: false,
        teamId: "team-research-r1",
      },
    }))

    expect(html).not.toContain("이 대상에는 놓을 수 없음")
    expect(html).not.toContain("이 lane에는 놓을 수 없음")
    expect(html).not.toContain("This target is not available")
    expect(html).not.toContain("This lane is not available")
  })
})
