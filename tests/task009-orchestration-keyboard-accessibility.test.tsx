import { createElement } from "../packages/webui/node_modules/react/index.js"
import { renderToStaticMarkup } from "../packages/webui/node_modules/react-dom/server.js"
import { describe, expect, it } from "vitest"
import { OrchestrationDropMenu } from "../packages/webui/src/components/orchestration/OrchestrationDropMenu.tsx"
import { OrchestrationKeyboardMoveDialog } from "../packages/webui/src/components/orchestration/OrchestrationKeyboardMoveDialog.tsx"
import { OrchestrationQuickEditSheet } from "../packages/webui/src/components/orchestration/OrchestrationQuickEditSheet.tsx"
import type { PendingDropAction } from "../packages/webui/src/lib/orchestration-board.ts"
import { createOrchestrationBoardDraft } from "../packages/webui/src/lib/orchestration-board.ts"
import { createSubAgentConfig } from "../packages/webui/src/lib/orchestration-ui.ts"

const now = Date.UTC(2026, 3, 22, 0, 0, 0)

describe("task009 orchestration keyboard accessibility", () => {
  it("renders a keyboard move dialog with focus trap markers and lane choices", () => {
    const html = renderToStaticMarkup(createElement(OrchestrationKeyboardMoveDialog, {
      language: "en",
      open: true,
      agentLabel: "Agent Alpha",
      sourceLaneId: "lane:team:team-research-r1",
      targetLaneId: "lane:archive",
      sourceOptions: [
        { laneId: "lane:team:team-research-r1", label: "Research Team", description: "Primary research lane." },
      ],
      targetOptions: [
        { laneId: "lane:unassigned", label: "Unassigned", description: "Remove the team membership." },
        { laneId: "lane:archive", label: "Archive", description: "Archive the agent." },
      ],
      onSourceChange: () => undefined,
      onTargetChange: () => undefined,
      onConfirm: () => undefined,
      onClose: () => undefined,
    }))

    expect(html).toContain('data-orchestration-keyboard-move="Agent Alpha"')
    expect(html).toContain('data-orchestration-focus-trap="keyboard-move"')
    expect(html).toContain('data-orchestration-keyboard-move-option="lane:team:team-research-r1"')
    expect(html).toContain('data-orchestration-keyboard-move-option="lane:archive"')
    expect(html).toContain('data-orchestration-shortcut="save_draft"')
    expect(html).toContain("Cmd/Ctrl+S")
  })

  it("adds dialog semantics and escape hints to the drop action popup", () => {
    const pendingDrop: PendingDropAction = {
      entityType: "agent",
      entityId: "agent-alpha-a1",
      title: "Move Agent Alpha",
      summary: "Choose how to handle the drop result.",
      sourceKind: "team",
      targetKind: "team",
      sourceTeamId: "team-research-r1",
      targetTeamId: "team-review-r2",
      fromLaneId: "lane:team:team-research-r1",
      toLaneId: "lane:team:team-review-r2",
      openedAt: now,
      options: [
        { id: "move_to_team", label: "Move", description: "Move to the target team.", tone: "neutral", recommended: true },
        { id: "cancel", label: "Cancel", description: "Keep the current membership.", tone: "warning" },
      ],
    }

    const html = renderToStaticMarkup(createElement(OrchestrationDropMenu, {
      pendingDrop,
      language: "en",
      onChoose: () => undefined,
      onCancel: () => undefined,
    }))

    expect(html).toContain('role="dialog"')
    expect(html).toContain('aria-modal="true"')
    expect(html).toContain('data-orchestration-focus-trap="drop-menu"')
    expect(html).toContain('data-orchestration-drop-menu-hints=""')
    expect(html).toContain("Esc to close")
  })

  it("exposes a keyboard move trigger from the agent quick sheet", () => {
    const draft = createOrchestrationBoardDraft({
      agents: [createSubAgentConfig({
        agentId: "agent-alpha-a1",
        displayName: "Agent Alpha",
        nickname: "alpha",
        role: "Structured worker",
        personality: "Precise.",
        specialtyTags: ["research"],
        avoidTasks: ["unguarded shell"],
        teamIds: ["team-research-r1"],
        riskCeiling: "moderate",
        enabledSkillIds: ["web-search"],
        enabledMcpServerIds: ["browser"],
        enabledToolNames: ["web_search"],
        now,
      })],
      teams: [],
    })
    const boardAgent = draft.agents[0]

    const html = renderToStaticMarkup(createElement(OrchestrationQuickEditSheet, {
      language: "en",
      editingLocked: false,
      onRequestKeyboardMove: () => undefined,
      selection: {
        kind: "agent",
        agent: boardAgent,
        runtimeAgent: null,
        teamLabels: ["Research Team"],
        issues: [],
        onPatch: () => undefined,
      },
    }))

    expect(html).toContain('data-orchestration-keyboard-move-trigger=""')
    expect(html).toContain("Move membership with keyboard")
  })
})
