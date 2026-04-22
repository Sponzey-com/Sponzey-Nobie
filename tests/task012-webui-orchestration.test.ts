import { describe, expect, it } from "vitest"
import { CONTRACT_SCHEMA_VERSION } from "../packages/core/src/contracts/index.js"
import type { OrchestrationAgentRegistryEntry, OrchestrationRegistrySnapshot, OrchestrationTeamRegistryEntry } from "../packages/webui/src/contracts/orchestration-api.ts"
import type { RelationshipGraphEdge, RelationshipGraphNode, SubAgentConfig, TeamConfig } from "../packages/webui/src/contracts/sub-agent-orchestration.ts"
import { buildAdvancedSettingsTabs } from "../packages/webui/src/lib/advanced-settings.js"
import { BEGINNER_CHAT_COMPOSER_CLASS } from "../packages/webui/src/lib/beginner-workspace.js"
import {
  beginnerAgentTemplates,
  buildOrchestrationSummary,
  buildProfilePreviewWarnings,
  buildRelationshipGraphView,
  createSubAgentConfig,
  createTeamConfig,
} from "../packages/webui/src/lib/orchestration-ui.js"
import { getUiNavigation } from "../packages/webui/src/lib/ui-mode.js"

const now = Date.UTC(2026, 3, 20, 0, 0, 0)

function subAgent(agentId: string, status: SubAgentConfig["status"] = "enabled"): SubAgentConfig {
  return createSubAgentConfig({
    agentId,
    displayName: `Agent ${agentId}`,
    nickname: agentId.replace("agent:", ""),
    role: "Research worker",
    personality: "Precise and evidence-first.",
    specialtyTags: ["research"],
    avoidTasks: ["unapproved shell"],
    teamIds: ["team:research"],
    riskCeiling: "external",
    enabledSkillIds: ["web-search"],
    enabledMcpServerIds: ["browser"],
    enabledToolNames: ["web_search"],
    now,
  }) satisfies SubAgentConfig
}

function team(): TeamConfig {
  return createTeamConfig({
    teamId: "team:research",
    displayName: "Research Team",
    nickname: "research",
    purpose: "Collect and verify external evidence.",
    memberAgentIds: ["agent:alpha"],
    roleHints: ["primary researcher"],
    now,
  }) satisfies TeamConfig
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

function teamEntry(config: TeamConfig): OrchestrationTeamRegistryEntry {
  return {
    teamId: config.teamId,
    displayName: config.displayName,
    nickname: config.nickname,
    status: config.status,
    purpose: config.purpose,
    roleHints: config.roleHints,
    memberAgentIds: config.memberAgentIds,
    activeMemberAgentIds: config.memberAgentIds,
    unresolvedMemberAgentIds: [],
    source: "db",
    config,
  }
}

describe("task012 WebUI orchestration configuration", () => {
  it("exposes beginner and advanced navigation without admin leakage", () => {
    const beginnerNav = getUiNavigation("beginner", false)
    const advancedNav = getUiNavigation("advanced", false)
    const tabs = buildAdvancedSettingsTabs("ko")

    expect(beginnerNav.some((item) => item.path === "/agents")).toBe(true)
    expect(beginnerNav.some((item) => item.path === "/admin")).toBe(false)
    expect(advancedNav.some((item) => item.path === "/advanced/agents")).toBe(true)
    expect(tabs.some((item) => item.id === "agents" && item.savesDraft === false)).toBe(true)
  })

  it("keeps beginner chat input anchored to the bottom", () => {
    expect(BEGINNER_CHAT_COMPOSER_CLASS).toContain("sticky")
    expect(BEGINNER_CHAT_COMPOSER_CLASS).toContain("bottom-0")
    expect(BEGINNER_CHAT_COMPOSER_CLASS).toContain("z-10")
  })

  it("summarizes single Nobie mode and beginner templates clearly", () => {
    const snapshot: OrchestrationRegistrySnapshot = {
      generatedAt: now,
      agents: [],
      teams: [],
      membershipEdges: [],
      diagnostics: [],
    }
    const summary = buildOrchestrationSummary({ snapshot, language: "ko" })
    const templates = beginnerAgentTemplates("ko")

    expect(summary.find((item) => item.id === "mode")?.value).toBe("단일 노비")
    expect(summary.find((item) => item.id === "agents")?.value).toBe("0/0")
    expect(templates.map((item) => item.id)).toEqual(["researcher", "operator", "reviewer"])
    expect(templates.find((item) => item.id === "operator")?.risk).toBe("high")
  })

  it("builds strict profile warnings from policy fields rather than semantic labels", () => {
    const config = subAgent("agent:alpha")
    const warnings = buildProfilePreviewWarnings({
      ...config,
      capabilityPolicy: {
        ...config.capabilityPolicy,
        permissionProfile: {
          ...config.capabilityPolicy.permissionProfile,
          riskCeiling: "dangerous",
          allowFilesystemWrite: true,
          allowShellExecution: true,
          allowScreenControl: true,
        },
      },
    }, "ko")

    expect(config.schemaVersion).toBe(CONTRACT_SCHEMA_VERSION)
    expect(warnings.some((item) => item.includes("위험 한도"))).toBe(true)
    expect(warnings.some((item) => item.includes("파일 쓰기"))).toBe(true)
    expect(warnings.some((item) => item.includes("쉘 실행"))).toBe(true)
    expect(warnings.some((item) => item.includes("화면 제어"))).toBe(true)
  })

  it("renders relationship graph state with coordinator, team, and edge counts", () => {
    const alpha = agentEntry(subAgent("agent:alpha"))
    const researchTeam = teamEntry(team())
    const nodes: RelationshipGraphNode[] = [
      { nodeId: "agent:agent:alpha", entityType: "sub_agent", entityId: "agent:alpha", label: "alpha", status: "enabled" },
      { nodeId: "team:team:research", entityType: "team", entityId: "team:research", label: "research", status: "enabled" },
    ]
    const edges: RelationshipGraphEdge[] = [
      { edgeId: "team_membership:team:research:agent:alpha", edgeType: "team_membership", fromNodeId: "team:team:research", toNodeId: "agent:agent:alpha", label: "primary" },
      { edgeId: "capability:agent:alpha:web_search", edgeType: "capability_delegation", fromNodeId: "agent:agent:alpha", toNodeId: "nobie:coordinator", label: "web_search" },
    ]

    const view = buildRelationshipGraphView({
      graph: { graph: { nodes, edges }, diagnostics: [] },
      agents: [alpha],
      teams: [researchTeam],
      language: "en",
    })

    expect(view.singleNobieMode).toBe(false)
    expect(view.nodes[0]?.nodeId).toBe("nobie:coordinator")
    expect(view.edgeCounts.team_membership).toBe(1)
    expect(view.edgeCounts.capability_delegation).toBe(1)
    expect(view.edges.map((edge) => edge.tone)).toEqual(["team", "capability"])
  })
})
