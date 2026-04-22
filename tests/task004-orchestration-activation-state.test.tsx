import { createElement } from "../packages/webui/node_modules/react/index.js"
import { renderToStaticMarkup } from "../packages/webui/node_modules/react-dom/server.js"
import { describe, expect, it } from "vitest"
import { OrchestrationToolbar } from "../packages/webui/src/components/orchestration/OrchestrationToolbar.tsx"
import { createOrchestrationBoardDraft } from "../packages/webui/src/lib/orchestration-board.ts"
import { createBoardAgentDraft, createBoardTeamDraft, patchBoardAgentDraft, patchBoardTeamDraft } from "../packages/webui/src/lib/orchestration-board-editing.ts"
import { buildOrchestrationBoardProjection } from "../packages/webui/src/lib/orchestration-board-projection.ts"
import { buildBoardViewStateFromDraft } from "../packages/webui/src/lib/orchestration-board-reducer.ts"

describe("task004 orchestration activation state", () => {
  it("keeps new cards disabled until explicitly enabled and hides archived entries by default", () => {
    const base = createOrchestrationBoardDraft({ agents: [], teams: [] })
    const withAgent = createBoardAgentDraft({
      draft: base,
      displayName: "Agent draft",
      randomSuffix: () => "a1b2",
    })
    const withTeam = createBoardTeamDraft({
      draft: withAgent,
      displayName: "Team draft",
      randomSuffix: () => "t9k3",
    })
    const enabledAgent = patchBoardAgentDraft({
      draft: withTeam,
      agentId: "agent-agent-draft-a1b2",
      patch: { status: "enabled" },
    })
    const archivedTeam = patchBoardTeamDraft({
      draft: enabledAgent,
      teamId: "team-team-draft-t9k3",
      patch: { status: "archived" },
    })

    expect(withTeam.agents[0]?.config.status).toBe("disabled")
    expect(enabledAgent.agents[0]?.config.status).toBe("enabled")
    expect(archivedTeam.teams[0]?.config.status).toBe("archived")

    const view = buildBoardViewStateFromDraft({
      draft: archivedTeam,
      baseAgents: [],
      baseTeams: [],
    })
    const hiddenProjection = buildOrchestrationBoardProjection({
      snapshot: view.snapshot,
      agents: view.agents,
      teams: view.teams,
      language: "en",
      showArchived: false,
    })
    const visibleProjection = buildOrchestrationBoardProjection({
      snapshot: view.snapshot,
      agents: view.agents,
      teams: view.teams,
      language: "en",
      showArchived: true,
    })

    expect(hiddenProjection.lanes.some((lane) => lane.teamId === "team-team-draft-t9k3")).toBe(false)
    expect(visibleProjection.lanes.some((lane) => lane.teamId === "team-team-draft-t9k3")).toBe(true)
    expect(hiddenProjection.diagnostics.some((item) => item.label === "Hidden archived entries")).toBe(true)
  })

  it("renders a toolbar that separates create actions from archived visibility", () => {
    const html = renderToStaticMarkup(createElement(OrchestrationToolbar, {
      language: "en",
      canEdit: true,
      dirty: true,
      showArchived: false,
      hiddenArchivedCount: 2,
      onCreateAgent: () => undefined,
      onCreateTeam: () => undefined,
      onToggleShowArchived: () => undefined,
      onValidateBoard: () => undefined,
      onSaveBoard: () => undefined,
    }))

    expect(html).toContain('data-orchestration-toolbar=""')
    expect(html).toContain("New team")
    expect(html).toContain("New agent")
    expect(html).toContain("Validate")
    expect(html).toContain("Save")
    expect(html).toContain('data-orchestration-toolbar-archived="hidden"')
    expect(html).toContain("Show archived (2)")
    expect(html).toContain("start disabled")
  })
})
