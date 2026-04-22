import { createElement } from "../packages/webui/node_modules/react/index.js"
import { renderToStaticMarkup } from "../packages/webui/node_modules/react-dom/server.js"
import { describe, expect, it } from "vitest"
import { OrchestrationSaveResultToast } from "../packages/webui/src/components/orchestration/OrchestrationSaveResultToast.tsx"

describe("task007 orchestration partial recovery", () => {
  it("shows retry context and remaining instructions after a partial persist", () => {
    const html = renderToStaticMarkup(createElement(OrchestrationSaveResultToast, {
      language: "en",
      result: {
        status: "partial",
        summary: "Only part of the board was stored.",
        effects: ["validated team:team-draft-team-t9k3", "stored team:team-draft-team-t9k3"],
        entities: [
          {
            key: "team:team-draft-team-t9k3",
            targetType: "team",
            targetId: "team-draft-team-t9k3",
            phase: "preflight",
            status: "succeeded",
            message: "validated",
          },
          {
            key: "team:team-draft-team-t9k3",
            targetType: "team",
            targetId: "team-draft-team-t9k3",
            phase: "persist",
            status: "succeeded",
            message: "stored",
          },
          {
            key: "agent:agent-draft-agent-a1b2",
            targetType: "agent",
            targetId: "agent-draft-agent-a1b2",
            phase: "persist",
            status: "failed",
            message: "409 Conflict",
          },
        ],
        remainingInstructionKeys: ["team:team-follow-up-x1"],
        recommendedActions: ["Retry save draft", "Review failed items", "Keep merged draft"],
      },
    }))

    expect(html).toContain('data-orchestration-save-toast="partial"')
    expect(html).toContain('data-orchestration-save-phases=""')
    expect(html).toContain("preflight 1")
    expect(html).toContain("persist 2")
    expect(html).toContain("retry 1")
    expect(html).toContain('data-orchestration-save-recovery=""')
    expect(html).toContain("Retry save draft")
    expect(html).toContain("[persist] team:team-follow-up-x1 - skipped - pending retry")
  })
})
