import { createElement } from "../packages/webui/node_modules/react/index.js"
import { renderToStaticMarkup } from "../packages/webui/node_modules/react-dom/server.js"
import { describe, expect, it } from "vitest"
import { OrchestrationValidationRibbon } from "../packages/webui/src/components/orchestration/OrchestrationValidationRibbon.tsx"
import { createOrchestrationBoardDraft } from "../packages/webui/src/lib/orchestration-board.ts"
import { buildOrchestrationBoardProjection } from "../packages/webui/src/lib/orchestration-board-projection.ts"
import { validateOrchestrationBoard } from "../packages/webui/src/lib/orchestration-board-validation.ts"
import { buildBoardViewStateFromDraft } from "../packages/webui/src/lib/orchestration-board-reducer.ts"
import { createSubAgentConfig, createTeamConfig } from "../packages/webui/src/lib/orchestration-ui.ts"

const now = Date.UTC(2026, 3, 22, 0, 0, 0)

function agentConfig() {
  const config = createSubAgentConfig({
    agentId: "bad id",
    displayName: "",
    role: "Research worker",
    personality: "Precise and bounded.",
    specialtyTags: ["research"],
    avoidTasks: ["unguarded shell"],
    teamIds: [],
    riskCeiling: "dangerous",
    enabledSkillIds: ["web-search"],
    enabledMcpServerIds: ["browser"],
    enabledToolNames: ["web_search"],
    allowShellExecution: true,
    now,
  })
  return config
}

function teamConfig() {
  return createTeamConfig({
    teamId: "team-empty-t1",
    displayName: "Team Empty",
    purpose: "Collect and review evidence.",
    memberAgentIds: [],
    roleHints: [],
    now,
  })
}

describe("task007 orchestration validation overlay", () => {
  it("projects validation categories onto cards, lanes, board diagnostics, and the ribbon", () => {
    const draft = createOrchestrationBoardDraft({
      agents: [agentConfig()],
      teams: [teamConfig()],
    })
    const validation = validateOrchestrationBoard({
      draft,
      gate: {
        status: "disabled",
        canEdit: false,
        canPersist: false,
        message: "Topology editing locked",
        reasons: ["settings.control is not ready"],
      },
      language: "en",
      now,
    })
    const boardView = buildBoardViewStateFromDraft({
      draft,
      baseAgents: [],
      baseTeams: [],
      generatedAt: now,
    })
    const projection = buildOrchestrationBoardProjection({
      snapshot: boardView.snapshot,
      agents: boardView.agents,
      teams: boardView.teams,
      language: "en",
      validationSnapshot: validation.snapshot,
      selectedEntityId: "agent:bad id",
    })

    expect(projection.lanes[0]?.cards[0]?.detailBadges).toEqual(expect.arrayContaining(["field 2", "policy 1"]))
    expect(projection.lanes[0]?.cards[0]?.tone).toBe("danger")
    expect(projection.lanes.find((lane) => lane.teamId === "team-empty-t1")?.badges).toEqual(expect.arrayContaining(["membership 1"]))
    expect(projection.diagnostics.find((item) => item.label === "Board validation")?.message).toContain("runtime prerequisite 2")
    expect(projection.selectedEntity?.details).toEqual(expect.arrayContaining([
      expect.stringContaining("Validation / field"),
      expect.stringContaining("Validation / policy"),
    ]))

    const html = renderToStaticMarkup(createElement(OrchestrationValidationRibbon, {
      language: "en",
      validationSnapshot: validation.snapshot,
      validationSummary: {
        errorCount: validation.summary.errorCount,
        warningCount: validation.summary.warningCount,
      },
      saveResult: {
        status: "blocked",
        summary: "Blocking issues found.",
        effects: [],
        entities: [],
      },
      savePlanCount: 2,
    }))

    expect(html).toBe("")
  })
})
