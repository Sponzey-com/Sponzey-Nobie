import { createElement } from "../packages/webui/node_modules/react/index.js"
import { renderToStaticMarkup } from "../packages/webui/node_modules/react-dom/server.js"
import { describe, expect, it } from "vitest"
import { createOrchestrationBoardDraft } from "../packages/webui/src/lib/orchestration-board.ts"
import { buildOrchestrationBoardProjection } from "../packages/webui/src/lib/orchestration-board-projection.ts"
import { buildPendingDropAction } from "../packages/webui/src/lib/orchestration-drop-actions.ts"
import { BOARD_CANVAS_LANE_ID, beginBoardDrag, beginBoardTeamDrag, canDropAgentOnLane, canDropTeamOnLane } from "../packages/webui/src/lib/orchestration-dnd.ts"
import { OrchestrationBoardEditor } from "../packages/webui/src/components/orchestration/OrchestrationBoardEditor.tsx"
import { resolveTopologyEditorGate } from "../packages/webui/src/lib/setup-visualization-topology.ts"
import type { FeatureCapability } from "../packages/webui/src/contracts/capabilities.ts"
import { createSubAgentConfig, createTeamConfig } from "../packages/webui/src/lib/orchestration-ui.ts"

const now = Date.UTC(2026, 3, 21, 0, 0, 0)

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

describe("task003 orchestration dnd actions", () => {
  it("accepts valid agent drops and rejects same-lane or unsupported targets", () => {
    const alpha = subAgent("agent-alpha-a1", "Alpha", ["team-research-r1"])
    const beta = subAgent("agent-beta-b2", "Beta", [])
    const research = team("team-research-r1", "Research", ["agent-alpha-a1"])
    const review = team("team-review-v2", "Review", [])
    const draft = createOrchestrationBoardDraft({
      agents: [alpha, beta],
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
      agentId: "agent-alpha-a1",
      sourceLaneId: "lane:team:team-research-r1",
      targetLaneId: "lane:team:team-research-r1",
    })).toBe(false)
    expect(canDropAgentOnLane({
      draft,
      agentId: "agent-beta-b2",
      sourceLaneId: "lane:unassigned",
      targetLaneId: "lane:unassigned",
    })).toBe(false)
    expect(canDropAgentOnLane({
      draft,
      agentId: "agent-alpha-a1",
      sourceLaneId: "lane:team:team-research-r1",
      targetLaneId: BOARD_CANVAS_LANE_ID,
    })).toBe(true)
    expect(canDropTeamOnLane({
      draft,
      teamId: "team-research-r1",
      sourceLaneId: "lane:team:team-research-r1",
      targetLaneId: "lane:team:team-review-v2",
    })).toBe(true)
    expect(canDropTeamOnLane({
      draft,
      teamId: "team-research-r1",
      sourceLaneId: "lane:team:team-research-r1",
      targetLaneId: "lane:team:team-research-r1",
    })).toBe(false)
    expect(canDropTeamOnLane({
      draft,
      teamId: "team-review-v2",
      sourceLaneId: "lane:team:team-review-v2",
      targetLaneId: "lane:unassigned",
    })).toBe(false)
  })

  it("renders draggable cards, active drop targets, canvas drop zone, and the pending drop menu on the board", () => {
    const alpha = subAgent("agent-alpha-a1", "Alpha", ["team-research-r1"])
    const beta = subAgent("agent-beta-b2", "Beta", [])
    const research = team("team-research-r1", "Research", ["agent-alpha-a1"])
    const review = team("team-review-v2", "Review", [])
    const draft = createOrchestrationBoardDraft({
      agents: [alpha, beta],
      teams: [research, review],
    })
    const projection = buildOrchestrationBoardProjection({
      snapshot: {
        generatedAt: now,
        agents: [],
        teams: [],
        membershipEdges: [],
        diagnostics: [],
      },
      agents: [
        {
          agentId: alpha.agentId,
          displayName: alpha.displayName,
          nickname: alpha.nickname,
          status: alpha.status,
          role: alpha.role,
          specialtyTags: alpha.specialtyTags,
          avoidTasks: alpha.avoidTasks,
          teamIds: alpha.teamIds,
          delegationEnabled: alpha.delegation.enabled,
          retryBudget: alpha.delegation.retryBudget,
          source: "db",
          config: alpha,
          permissionProfile: alpha.capabilityPolicy.permissionProfile,
          capabilityPolicy: alpha.capabilityPolicy,
          skillMcpSummary: alpha.capabilityPolicy.skillMcpAllowlist,
          currentLoad: { activeSubSessions: 0, queuedSubSessions: 0, failedSubSessions: 0, completedSubSessions: 0, maxParallelSessions: 2, utilization: 0 },
          failureRate: { windowMs: 1, consideredSubSessions: 0, failedSubSessions: 0, value: 0 },
        },
        {
          agentId: beta.agentId,
          displayName: beta.displayName,
          nickname: beta.nickname,
          status: beta.status,
          role: beta.role,
          specialtyTags: beta.specialtyTags,
          avoidTasks: beta.avoidTasks,
          teamIds: beta.teamIds,
          delegationEnabled: beta.delegation.enabled,
          retryBudget: beta.delegation.retryBudget,
          source: "db",
          config: beta,
          permissionProfile: beta.capabilityPolicy.permissionProfile,
          capabilityPolicy: beta.capabilityPolicy,
          skillMcpSummary: beta.capabilityPolicy.skillMcpAllowlist,
          currentLoad: { activeSubSessions: 0, queuedSubSessions: 0, failedSubSessions: 0, completedSubSessions: 0, maxParallelSessions: 2, utilization: 0 },
          failureRate: { windowMs: 1, consideredSubSessions: 0, failedSubSessions: 0, value: 0 },
        },
      ],
      teams: [
        {
          teamId: research.teamId,
          displayName: research.displayName,
          nickname: research.nickname,
          status: research.status,
          purpose: research.purpose,
          roleHints: research.roleHints,
          memberAgentIds: research.memberAgentIds,
          activeMemberAgentIds: research.memberAgentIds,
          unresolvedMemberAgentIds: [],
          source: "db",
          config: research,
        },
        {
          teamId: review.teamId,
          displayName: review.displayName,
          nickname: review.nickname,
          status: review.status,
          purpose: review.purpose,
          roleHints: review.roleHints,
          memberAgentIds: review.memberAgentIds,
          activeMemberAgentIds: [],
          unresolvedMemberAgentIds: [],
          source: "db",
          config: review,
        },
      ],
      language: "en",
      selectedEntityId: "agent:agent-beta-b2",
    })
    const pendingDrop = buildPendingDropAction({
      draft,
      agentId: "agent-beta-b2",
      sourceLaneId: "lane:unassigned",
      targetLaneId: "lane:team:team-review-v2",
      language: "en",
      now,
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
        overLaneId: "lane:team:team-review-v2",
      },
      pendingDrop,
      onChooseDropOption: () => undefined,
      onDragStartAgent: () => undefined,
      onDragStartTeam: () => undefined,
      onSelectAgent: () => undefined,
      onSelectTeam: () => undefined,
    }))

    expect(html).toContain('data-orchestration-board-canvas="lane:canvas"')
    expect(html).toContain('data-orchestration-board-lane="lane:team:team-review-v2"')
    expect(html).toContain('data-orchestration-board-lane-draggable="true"')
    expect(html).toContain('data-orchestration-board-drop-active="true"')
    expect(html).toContain('data-orchestration-map-node-draggable="true"')
    expect(html).toContain('data-orchestration-drop-menu="agent-beta-b2"')
    expect(html).toContain("Drop here to create a new team")
  })

  it("renders reorder copy for team lane dragging and an archive target for teams", () => {
    const alpha = subAgent("agent-alpha-a1", "Alpha", ["team-research-r1"])
    const research = team("team-research-r1", "Research", ["agent-alpha-a1"])
    const review = team("team-review-v2", "Review", [])
    const draft = createOrchestrationBoardDraft({
      agents: [alpha],
      teams: [research, review],
    })
    const projection = buildOrchestrationBoardProjection({
      snapshot: {
        generatedAt: now,
        agents: [],
        teams: [],
        membershipEdges: [],
        diagnostics: [],
      },
      agents: [],
      teams: [
        {
          teamId: research.teamId,
          displayName: research.displayName,
          nickname: research.nickname,
          status: research.status,
          purpose: research.purpose,
          roleHints: research.roleHints,
          memberAgentIds: research.memberAgentIds,
          activeMemberAgentIds: research.memberAgentIds,
          unresolvedMemberAgentIds: [],
          source: "db",
          config: research,
        },
        {
          teamId: review.teamId,
          displayName: review.displayName,
          nickname: review.nickname,
          status: review.status,
          purpose: review.purpose,
          roleHints: review.roleHints,
          memberAgentIds: review.memberAgentIds,
          activeMemberAgentIds: [],
          unresolvedMemberAgentIds: [],
          source: "db",
          config: review,
        },
      ],
      language: "en",
      selectedEntityId: "team:team-research-r1",
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
        ...beginBoardTeamDrag("team-research-r1", "lane:team:team-research-r1"),
        overLaneId: "lane:team:team-review-v2",
      },
      dropAvailability: {
        "lane:team:team-research-r1": false,
        "lane:team:team-review-v2": true,
        "lane:archive": true,
      },
      onDragStartAgent: () => undefined,
      onDragStartTeam: () => undefined,
      onSelectAgent: () => undefined,
      onSelectTeam: () => undefined,
    }))

    expect(html).toContain("Release to reorder team lane")
    expect(html).toContain("Archive team")
  })
})
