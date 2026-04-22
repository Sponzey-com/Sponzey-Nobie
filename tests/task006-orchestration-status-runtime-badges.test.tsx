import { createElement } from "../packages/webui/node_modules/react/index.js"
import { renderToStaticMarkup } from "../packages/webui/node_modules/react-dom/server.js"
import { describe, expect, it } from "vitest"
import { OrchestrationFloatingInspector } from "../packages/webui/src/components/orchestration/OrchestrationFloatingInspector.tsx"
import type {
  OrchestrationAgentRegistryEntry,
  OrchestrationRegistrySnapshot,
} from "../packages/webui/src/contracts/orchestration-api.ts"
import { buildOrchestrationBoardProjection } from "../packages/webui/src/lib/orchestration-board-projection.ts"
import { buildOrchestrationDashboardInspector } from "../packages/webui/src/lib/orchestration-dashboard-projection.ts"
import { createSubAgentConfig } from "../packages/webui/src/lib/orchestration-ui.ts"

const now = Date.UTC(2026, 3, 22, 0, 0, 0)

function degradedAgent(): OrchestrationAgentRegistryEntry {
  const config = createSubAgentConfig({
    agentId: "agent-alpha-a1",
    displayName: "Agent Alpha",
    role: "Structured worker",
    personality: "Precise",
    specialtyTags: ["research"],
    avoidTasks: ["unguarded shell"],
    teamIds: [],
    riskCeiling: "moderate",
    enabledSkillIds: ["web-search"],
    enabledMcpServerIds: ["browser"],
    enabledToolNames: ["web_search"],
    now,
  })

  config.status = "degraded"

  return {
    agentId: config.agentId,
    displayName: config.displayName,
    nickname: config.nickname,
    status: config.status,
    role: config.role,
    specialtyTags: config.specialtyTags,
    avoidTasks: config.avoidTasks,
    teamIds: config.teamIds,
    delegationEnabled: config.delegation.enabled,
    retryBudget: config.delegation.retryBudget,
    source: "db",
    config,
    permissionProfile: config.capabilityPolicy.permissionProfile,
    capabilityPolicy: config.capabilityPolicy,
    skillMcpSummary: config.capabilityPolicy.skillMcpAllowlist,
    currentLoad: {
      activeSubSessions: 0,
      queuedSubSessions: 0,
      failedSubSessions: 1,
      completedSubSessions: 0,
      maxParallelSessions: config.delegation.maxParallelSessions,
      utilization: 0,
    },
    failureRate: {
      windowMs: 86_400_000,
      consideredSubSessions: 4,
      failedSubSessions: 1,
      value: 0.25,
    },
  }
}

describe("task006 orchestration status and runtime badges", () => {
  it("keeps config badges separate from runtime badges for degraded agents", () => {
    const agent = degradedAgent()
    const snapshot: OrchestrationRegistrySnapshot = {
      generatedAt: now,
      agents: [agent],
      teams: [],
      membershipEdges: [],
      diagnostics: [],
    }

    const projection = buildOrchestrationBoardProjection({
      snapshot,
      agents: snapshot.agents,
      teams: snapshot.teams,
      language: "en",
      selectedEntityId: `agent:${agent.agentId}`,
    })
    const card = projection.lanes[0]!.cards[0]!

    expect(card.configBadges).toEqual(expect.arrayContaining(["degraded"]))
    expect(card.runtimeBadges).toEqual(["Failed"])
    expect(card.detailBadges).toEqual(expect.arrayContaining(["Recovery needed"]))

    const inspector = buildOrchestrationDashboardInspector({
      selectedAgent: agent,
      selectedTeam: null,
      boardProjection: projection,
      summary: [],
      language: "en",
    })

    expect(inspector.configBadges).toEqual(expect.arrayContaining(["degraded"]))
    expect(inspector.runtimeBadges).toEqual(["Failed"])

    const html = renderToStaticMarkup(createElement(OrchestrationFloatingInspector, {
      language: "en",
      inspector,
    }))

    expect(html).toContain('data-orchestration-floating-inspector-config=""')
    expect(html).toContain('data-orchestration-floating-inspector-runtime=""')
  })
})
