import { createElement } from "../packages/webui/node_modules/react/index.js"
import { renderToStaticMarkup } from "../packages/webui/node_modules/react-dom/server.js"
import { describe, expect, it } from "vitest"
import { createOrchestrationBoardDraft } from "../packages/webui/src/lib/orchestration-board.ts"
import { buildOrchestrationBoardProjection } from "../packages/webui/src/lib/orchestration-board-projection.ts"
import { buildBoardViewStateFromDraft } from "../packages/webui/src/lib/orchestration-board-reducer.ts"
import { BOARD_ARCHIVE_LANE_ID, beginBoardDrag, canDropAgentOnLane } from "../packages/webui/src/lib/orchestration-dnd.ts"
import { OrchestrationBoardEditor } from "../packages/webui/src/components/orchestration/OrchestrationBoardEditor.tsx"
import { resolveTopologyEditorGate } from "../packages/webui/src/lib/setup-visualization-topology.ts"
import type { FeatureCapability } from "../packages/webui/src/contracts/capabilities.ts"
import { createSubAgentConfig, createTeamConfig } from "../packages/webui/src/lib/orchestration-ui.ts"

const now = Date.UTC(2026, 3, 22, 0, 0, 0)

function capability(key: string, status: FeatureCapability["status"]): FeatureCapability {
  return {
    key,
    label: key,
    area: key === "mqtt.broker" ? "mqtt" : "security",
    status,
    enabled: status === "ready",
    implemented: true,
  }
}

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

describe("task004 orchestration dnd intent", () => {
  it("distinguishes archive targets from regular lane drops and blocks archived cards", () => {
    const alpha = subAgent("agent-alpha-a1", "Alpha", ["team-research-r1"])
    const beta = subAgent("agent-beta-b2", "Beta", [])
    const archived = { ...subAgent("agent-ghost-g9", "Ghost", []), status: "archived" as const }
    const research = team("team-research-r1", "Research", ["agent-alpha-a1"])
    const review = team("team-review-v2", "Review", [])
    const draft = createOrchestrationBoardDraft({
      agents: [alpha, beta, archived],
      teams: [research, review],
    })

    expect(canDropAgentOnLane({
      draft,
      agentId: "agent-beta-b2",
      sourceLaneId: "lane:unassigned",
      targetLaneId: "lane:team:team-review-v2",
    })).toBe(true)
    expect(canDropAgentOnLane({
      draft,
      agentId: "agent-beta-b2",
      sourceLaneId: "lane:unassigned",
      targetLaneId: BOARD_ARCHIVE_LANE_ID,
    })).toBe(true)
    expect(canDropAgentOnLane({
      draft,
      agentId: "agent-ghost-g9",
      sourceLaneId: "lane:unassigned",
      targetLaneId: BOARD_ARCHIVE_LANE_ID,
    })).toBe(false)
  })

  it("renders archive intent, canvas intent, and dragging-state cards on the board", () => {
    const alpha = subAgent("agent-alpha-a1", "Alpha", ["team-research-r1"])
    const beta = subAgent("agent-beta-b2", "Beta", [])
    const research = team("team-research-r1", "Research", ["agent-alpha-a1"])
    const review = team("team-review-v2", "Review", [])
    const draft = createOrchestrationBoardDraft({
      agents: [alpha, beta],
      teams: [research, review],
    })
    const viewState = buildBoardViewStateFromDraft({
      draft,
      baseAgents: [],
      baseTeams: [],
      generatedAt: now,
    })
    const projection = buildOrchestrationBoardProjection({
      snapshot: viewState.snapshot,
      agents: viewState.agents,
      teams: viewState.teams,
      language: "en",
      selectedEntityId: "agent:agent-beta-b2",
    })
    const gate = resolveTopologyEditorGate({
      surface: "page",
      settingsCapability: capability("settings.control", "ready"),
      mqttCapability: capability("mqtt.broker", "ready"),
      language: "en",
    })
    const html = renderToStaticMarkup(createElement(OrchestrationBoardEditor, {
      projection,
      gate,
      language: "en",
      surface: "page",
      entryHref: "/advanced/agents",
      dragState: {
        ...beginBoardDrag("agent-beta-b2", "lane:unassigned"),
        overLaneId: BOARD_ARCHIVE_LANE_ID,
      },
      dropAvailability: {
        "lane:unassigned": false,
        "lane:team:team-research-r1": true,
        "lane:team:team-review-v2": true,
        "lane:canvas": true,
        "lane:archive": true,
      },
      pendingDrop: null,
      onChooseDropOption: () => undefined,
      onDragStartAgent: () => undefined,
      onSelectAgent: () => undefined,
      onSelectTeam: () => undefined,
    }))

    expect(html).toContain('data-orchestration-board-canvas="lane:canvas"')
    expect(html).toContain('data-orchestration-drop-zone="lane:archive"')
    expect(html).toContain('data-orchestration-drop-active="true"')
    expect(html).toContain('data-orchestration-map-node-dragging="true"')
    expect(html).toContain("Release to open archive action")
  })
})
