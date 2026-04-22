import { createElement } from "../packages/webui/node_modules/react/index.js"
import { renderToStaticMarkup } from "../packages/webui/node_modules/react-dom/server.js"
import { describe, expect, it } from "vitest"
import { OrchestrationGenerateBar } from "../packages/webui/src/components/orchestration/OrchestrationGenerateBar.tsx"
import { OrchestrationGenerateReviewPopup } from "../packages/webui/src/components/orchestration/OrchestrationGenerateReviewPopup.tsx"
import { buildOrchestrationStarterPlan } from "../packages/webui/src/lib/orchestration-starter-kits.ts"

describe("task005 orchestration generate review", () => {
  it("renders constrained command grammar, chips, and parser feedback in the generate bar", () => {
    const html = renderToStaticMarkup(createElement(OrchestrationGenerateBar, {
      language: "en",
      value: "review",
      feedback: {
        tone: "warning",
        title: "Review required",
        message: "The role is clear, but the formation is not.",
      },
      onChange: () => undefined,
      onGenerate: () => undefined,
      onChooseExample: () => undefined,
      onOpenAgentPresets: () => undefined,
      onOpenTeamPresets: () => undefined,
    }))

    expect(html).toContain('data-orchestration-generate-bar=""')
    expect(html).toContain('data-orchestration-create-command=""')
    expect(html).toContain('data-orchestration-create-command-chips=""')
    expect(html).toContain('data-orchestration-create-command-grammar=""')
    expect(html).toContain('data-orchestration-create-command-feedback="warning"')
    expect(html).toContain("research team 3")
    expect(html).toContain("workspace operator pair")
  })

  it("renders ambiguity review with placement preview and short accept-adjust-cancel actions", () => {
    const review = {
      mode: "ambiguous" as const,
      title: "Review the recommended starter",
      summary: "The command was not specific enough.",
      notes: ["A role was detected, but team shape was missing."],
      plan: buildOrchestrationStarterPlan({
        starterKitId: "review_squad",
        command: "review",
      }),
    }
    const html = renderToStaticMarkup(createElement(OrchestrationGenerateReviewPopup, {
      language: "en",
      review,
      onAccept: () => undefined,
      onAdjust: () => undefined,
      onCancel: () => undefined,
    }))

    expect(html).toContain('data-orchestration-generate-review="ambiguous"')
    expect(html).toContain('data-orchestration-generate-preview=""')
    expect(html).toContain('data-orchestration-generate-preview-agent="Review Agent 1"')
    expect(html).toContain(">Accept<")
    expect(html).toContain(">Adjust<")
    expect(html).toContain(">Cancel<")
    expect(html).toContain("Review Squad")
  })
})
