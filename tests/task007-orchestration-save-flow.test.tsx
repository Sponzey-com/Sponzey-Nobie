import { createElement } from "../packages/webui/node_modules/react/index.js"
import { renderToStaticMarkup } from "../packages/webui/node_modules/react-dom/server.js"
import { describe, expect, it } from "vitest"
import { OrchestrationSaveFooter } from "../packages/webui/src/components/orchestration/OrchestrationSaveFooter.tsx"
import { createOrchestrationBoardDraft } from "../packages/webui/src/lib/orchestration-board.ts"
import { createBoardAgentDraft, createBoardTeamDraft } from "../packages/webui/src/lib/orchestration-board-editing.ts"
import { buildOrchestrationSavePlan } from "../packages/webui/src/lib/orchestration-save-plan.ts"
import { validateOrchestrationBoard } from "../packages/webui/src/lib/orchestration-board-validation.ts"

describe("task007 orchestration save flow", () => {
  it("keeps validate, save draft, and publish placeholder semantics visible in the footer", () => {
    const initial = createOrchestrationBoardDraft({ agents: [], teams: [] })
    const withTeam = createBoardTeamDraft({
      draft: initial,
      displayName: "Draft team",
      randomSuffix: () => "t9k3",
    })
    const withAgent = createBoardAgentDraft({
      draft: withTeam,
      displayName: "Draft agent",
      randomSuffix: () => "a1b2",
    })
    const plan = buildOrchestrationSavePlan({ draft: withAgent })
    const validation = validateOrchestrationBoard({
      draft: withAgent,
      gate: {
        status: "ready",
        canEdit: true,
        canPersist: true,
        message: "",
        reasons: [],
      },
      language: "en",
    })

    const html = renderToStaticMarkup(createElement(OrchestrationSaveFooter, {
      language: "en",
      canEdit: true,
      dirty: true,
      running: false,
      validationSnapshot: validation.snapshot,
      validationSummary: {
        errorCount: validation.summary.errorCount,
        warningCount: validation.summary.warningCount,
      },
      savePlan: plan,
      result: {
        status: "validated",
        summary: "Board preflight validation passed.",
        effects: [],
        entities: [],
        recommendedActions: ["Save draft"],
      },
      onValidate: () => undefined,
      onSave: () => undefined,
      onRevert: () => undefined,
    }))

    expect(html).toContain('data-orchestration-save-footer=""')
    expect(html).toContain('data-orchestration-save-stage-semantics=""')
    expect(html).toContain("Validate")
    expect(html).toContain("Save draft")
    expect(html).toContain("Publish placeholder")
    expect(html).toContain('data-orchestration-save-plan-preview=""')
    expect(html).toContain('data-orchestration-save-plan-item="team:team-draft-team-t9k3"')
    expect(html).toContain('data-orchestration-save-plan-item="agent:agent-draft-agent-a1b2"')
  })
})
