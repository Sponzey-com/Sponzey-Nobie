import { describe, expect, it } from "vitest"
import type {
  OrchestrationAgentRegistryEntry,
  OrchestrationGraphResponse,
  OrchestrationRegistrySnapshot,
  OrchestrationTeamRegistryEntry,
} from "../packages/webui/src/contracts/orchestration-api.ts"
import type { RelationshipGraphEdge, RelationshipGraphNode, SubAgentConfig, TeamConfig } from "../packages/webui/src/contracts/sub-agent-orchestration.ts"
import { SetupVisualizationCanvas } from "../packages/webui/src/components/setup/SetupVisualizationCanvas.tsx"
import {
  buildOrchestrationSummary,
  buildOrchestrationTopologyScene,
  createSubAgentConfig,
  createTeamConfig,
} from "../packages/webui/src/lib/orchestration-ui.ts"

const now = Date.UTC(2026, 3, 21, 0, 0, 0)

function visitNode(node: unknown, visit: (candidate: Record<string, unknown>) => void) {
  if (node == null || typeof node === "boolean") return
  if (Array.isArray(node)) {
    for (const item of node) visitNode(item, visit)
    return
  }
  if (typeof node === "object" && "props" in node) {
    const candidate = node as Record<string, unknown>
    const type = candidate.type
    if (typeof type === "function") {
      visitNode(type(candidate.props as never), visit)
      return
    }
    visit(candidate)
    const props = candidate.props
    if (props && typeof props === "object" && "children" in props) {
      visitNode((props as Record<string, unknown>).children, visit)
    }
  }
}

function findDataValues(node: unknown, key: string): string[] {
  const values: string[] = []
  visitNode(node, (candidate) => {
    const props = candidate.props
    if (!props || typeof props !== "object") return
    const value = (props as Record<string, unknown>)[key]
    if (typeof value === "string") values.push(value)
  })
  return values
}

function subAgent(agentId: string, status: SubAgentConfig["status"], overrides: Partial<SubAgentConfig> = {}): SubAgentConfig {
  return {
    ...createSubAgentConfig({
      agentId,
      displayName: `Agent ${agentId}`,
      nickname: agentId.replace("agent:", ""),
      role: "Research worker",
      personality: "Precise and bounded.",
      specialtyTags: ["research"],
      avoidTasks: ["unapproved shell"],
      teamIds: ["team:research"],
      riskCeiling: "moderate",
      enabledSkillIds: ["web-search"],
      enabledMcpServerIds: ["browser"],
      enabledToolNames: ["web_search"],
      now,
    }),
    status,
    ...overrides,
  }
}

function teamConfig(memberAgentIds: string[]): TeamConfig {
  return {
    ...createTeamConfig({
      teamId: "team:research",
      displayName: "Research Team",
      nickname: "research",
      purpose: "Collect and verify external evidence.",
      memberAgentIds,
      roleHints: ["primary researcher"],
      now,
    }),
    status: "enabled",
  }
}

function agentEntry(config: SubAgentConfig): OrchestrationAgentRegistryEntry {
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
      failedSubSessions: 0,
      completedSubSessions: 0,
      maxParallelSessions: 2,
      utilization: 0,
    },
    failureRate: {
      windowMs: 86_400_000,
      consideredSubSessions: 0,
      failedSubSessions: 0,
      value: 0,
    },
  }
}

function teamEntry(config: TeamConfig, unresolvedMemberAgentIds: string[] = []): OrchestrationTeamRegistryEntry {
  return {
    teamId: config.teamId,
    displayName: config.displayName,
    nickname: config.nickname,
    status: config.status,
    purpose: config.purpose,
    roleHints: config.roleHints,
    memberAgentIds: config.memberAgentIds,
    activeMemberAgentIds: config.memberAgentIds.filter((agentId) => !unresolvedMemberAgentIds.includes(agentId)),
    unresolvedMemberAgentIds,
    source: "db",
    config,
  }
}

function graph(nodes: RelationshipGraphNode[], edges: RelationshipGraphEdge[]): OrchestrationGraphResponse {
  return {
    graph: { nodes, edges },
    diagnostics: [],
  }
}

describe("task009 orchestration topology projection", () => {
  it("keeps single Nobie mode readable by adding planned expansion nodes", () => {
    const snapshot: OrchestrationRegistrySnapshot = {
      generatedAt: now,
      agents: [],
      teams: [],
      membershipEdges: [],
      diagnostics: [],
    }
    const summary = buildOrchestrationSummary({ snapshot, language: "ko" })
    const scene = buildOrchestrationTopologyScene({
      snapshot,
      graph: graph([], []),
      agents: [],
      teams: [],
      language: "ko",
      mode: "beginner",
    })

    expect(summary.find((item) => item.id === "mode")?.value).toBe("단일 노비")
    expect(scene.nodes.map((node) => node.id)).toEqual(expect.arrayContaining([
      "node:orchestration:coordinator",
      "node:orchestration:team:placeholder",
      "node:orchestration:agent:placeholder",
      "node:orchestration:capability:placeholder",
    ]))
    expect(scene.alerts?.map((alert) => alert.message)).toEqual(expect.arrayContaining([
      "현재는 단일 노비 모드입니다. 아래 구조는 확장될 때의 topology 예시를 함께 보여줍니다.",
    ]))
  })

  it("marks unresolved memberships, disabled agents, and risky capability nodes distinctly", () => {
    const alphaConfig = subAgent("agent:alpha", "enabled", {
      delegation: { enabled: true, maxParallelSessions: 2, retryBudget: 2 },
      capabilityPolicy: {
        ...subAgent("agent:alpha", "enabled").capabilityPolicy,
        permissionProfile: {
          ...subAgent("agent:alpha", "enabled").capabilityPolicy.permissionProfile,
          riskCeiling: "dangerous",
          allowShellExecution: true,
        },
      },
    })
    const betaConfig = subAgent("agent:beta", "disabled", {
      teamIds: [],
      delegation: { enabled: false, maxParallelSessions: 1, retryBudget: 0 },
    })
    const team = teamConfig(["agent:alpha", "agent:ghost"])
    const snapshot: OrchestrationRegistrySnapshot = {
      generatedAt: now,
      agents: [agentEntry(alphaConfig), agentEntry(betaConfig)],
      teams: [teamEntry(team, ["agent:ghost"])],
      membershipEdges: [
        { teamId: "team:research", agentId: "agent:alpha", status: "active", roleHint: "primary" },
        { teamId: "team:research", agentId: "agent:ghost", status: "unresolved", roleHint: "missing reviewer" },
      ],
      diagnostics: [],
    }
    const scene = buildOrchestrationTopologyScene({
      snapshot,
      graph: graph(
        [
          { nodeId: "agent:agent:alpha", entityType: "sub_agent", entityId: "agent:alpha", label: "alpha", status: "enabled" },
          { nodeId: "agent:agent:beta", entityType: "sub_agent", entityId: "agent:beta", label: "beta", status: "disabled" },
          { nodeId: "team:team:research", entityType: "team", entityId: "team:research", label: "research", status: "enabled" },
        ],
        [{ edgeId: "team_membership:team:research:agent:alpha", edgeType: "team_membership", fromNodeId: "team:team:research", toNodeId: "agent:agent:alpha", label: "primary" }],
      ),
      agents: snapshot.agents,
      teams: snapshot.teams,
      language: "en",
      mode: "advanced",
    })

    expect(scene.nodes.find((node) => node.id === "node:orchestration:team:team:research")?.status).toBe("warning")
    expect(scene.nodes.find((node) => node.id === "node:orchestration:agent:agent:beta")?.status).toBe("disabled")
    expect(scene.nodes.find((node) => node.id === "node:orchestration:capability:agent:alpha")?.status).toBe("warning")
    expect(scene.nodes.find((node) => node.id === "node:orchestration:unresolved:team:research:agent:ghost")?.status).toBe("error")
    expect(scene.edges.find((edge) => edge.id === "edge:orchestration:unresolved:team:research:agent:ghost")?.status).toBe("error")
    expect(scene.alerts?.map((alert) => alert.message)).toEqual(expect.arrayContaining([
      "1 unresolved team links",
      "1 agents with high-risk permissions",
    ]))
  })

  it("feeds the same topology semantics into the preview card and visualization canvas", () => {
    const alpha = agentEntry({
      ...subAgent("agent:alpha", "enabled"),
      delegation: { enabled: true, maxParallelSessions: 2, retryBudget: 2 },
    })
    const snapshot: OrchestrationRegistrySnapshot = {
      generatedAt: now,
      agents: [alpha],
      teams: [],
      membershipEdges: [],
      diagnostics: [],
    }
    const summary = buildOrchestrationSummary({ snapshot, language: "en" })
    const scene = buildOrchestrationTopologyScene({
      snapshot,
      graph: graph([{ nodeId: "agent:agent:alpha", entityType: "sub_agent", entityId: "agent:alpha", label: "alpha", status: "enabled" }], []),
      agents: [alpha],
      teams: [],
      language: "en",
      mode: "advanced",
    })

    const canvasTree = SetupVisualizationCanvas({
      scene,
      language: "en",
      selectedNodeId: "node:orchestration:agent:agent:alpha",
      onSelectNode: () => undefined,
    })
    expect(summary.find((item) => item.id === "mode")?.value).toBe("Orchestration")
    expect(scene.nodes.find((node) => node.id === "node:orchestration:coordinator")?.badges).toEqual(expect.arrayContaining([
      "Orchestration",
    ]))
    expect(findDataValues(canvasTree, "data-setup-visual-canvas")).toContain("scene:orchestration_topology")
    expect(findDataValues(canvasTree, "data-setup-visual-node")).toEqual(expect.arrayContaining([
      "node:orchestration:coordinator",
      "node:orchestration:agent:agent:alpha",
      "node:orchestration:capability:agent:alpha",
    ]))
  })
})
