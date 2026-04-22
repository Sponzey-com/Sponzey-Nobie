import { createElement } from "../packages/webui/node_modules/react/index.js"
import { renderToStaticMarkup } from "../packages/webui/node_modules/react-dom/server.js"
import { describe, expect, it } from "vitest"
import { OrchestrationQuickEditSheet } from "../packages/webui/src/components/orchestration/OrchestrationQuickEditSheet.tsx"
import { createOrchestrationBoardDraft } from "../packages/webui/src/lib/orchestration-board.ts"
import { createBoardAgentDraft, createBoardTeamDraft } from "../packages/webui/src/lib/orchestration-board-editing.ts"

describe("task004 orchestration quick edit sheet", () => {
  it("renders the compact agent sheet with advanced controls hidden behind a disclosure", () => {
    const draft = createBoardAgentDraft({
      draft: createOrchestrationBoardDraft({ agents: [], teams: [] }),
      displayName: "Agent draft",
      randomSuffix: () => "a1b2",
    })
    const agent = draft.agents[0]!
    const html = renderToStaticMarkup(createElement(OrchestrationQuickEditSheet, {
      language: "en",
      selection: {
        kind: "agent",
        agent,
        issues: [{ severity: "warning", message: "This agent is still unassigned." }],
        onPatch: () => undefined,
      },
    }))

    expect(html).toContain('data-orchestration-quick-edit="agent"')
    expect(html).toContain('data-orchestration-id-field="agent"')
    expect(html).toContain("Role")
    expect(html).toContain("Description")
    expect(html).toContain('data-orchestration-quick-edit-other-issues=""')
    expect(html).toContain("Archive")
    expect(html).toContain("Advanced")
    expect(html).toContain("Enabled skills")
    expect(html).not.toContain("teamIds")
  })

  it("renders the team sheet without exposing raw memberAgentIds editing", () => {
    const draft = createBoardTeamDraft({
      draft: createOrchestrationBoardDraft({ agents: [], teams: [] }),
      displayName: "Team draft",
      randomSuffix: () => "t9k3",
    })
    const team = draft.teams[0]!
    const html = renderToStaticMarkup(createElement(OrchestrationQuickEditSheet, {
      language: "en",
      selection: {
        kind: "team",
        team,
        issues: [{ severity: "warning", message: "This lane does not contain members yet." }],
        onPatch: () => undefined,
      },
    }))

    expect(html).toContain('data-orchestration-quick-edit="team"')
    expect(html).toContain('data-orchestration-id-field="team"')
    expect(html).toContain("Add agent here")
    expect(html).toContain("Description")
    expect(html).toContain("Role hints")
    expect(html).toContain('data-orchestration-quick-edit-other-issues=""')
    expect(html).not.toContain("memberAgentIds")
  })

  it("renders the empty sheet with explicit studio instructions instead of only a passive placeholder", () => {
    const html = renderToStaticMarkup(createElement(OrchestrationQuickEditSheet, {
      language: "en",
      selection: null,
    }))

    expect(html).toContain('data-orchestration-quick-edit="empty"')
    expect(html).toContain("Select a card or lane to edit name, status, and purpose here.")
  })

  it("highlights required fields and advanced ids inline instead of using a separate issue disclosure", () => {
    const draft = createBoardAgentDraft({
      draft: createOrchestrationBoardDraft({ agents: [], teams: [] }),
      displayName: "Agent draft",
      randomSuffix: () => "a1b2",
    })
    const agent = draft.agents[0]!
    const html = renderToStaticMarkup(createElement(OrchestrationQuickEditSheet, {
      language: "en",
      selection: {
        kind: "agent",
        agent,
        issues: [
          { severity: "error", field: "displayName", message: "Agent display name cannot be empty." },
          { severity: "error", field: "role", message: "Agent role cannot be empty." },
          { severity: "error", field: "agentId", message: "Agent IDs must use the `agent-...` format." },
        ],
        onPatch: () => undefined,
      },
    }))

    expect(html).toContain('data-orchestration-field-state="error"')
    expect(html).toContain("Agent display name cannot be empty.")
    expect(html).toContain("Agent role cannot be empty.")
    expect(html).toContain("Agent IDs must use the `agent-...` format.")
    expect(html).not.toContain("Expand issue details")
  })
})
