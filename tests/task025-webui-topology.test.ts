import { describe, expect, it } from "vitest"
import type {
  AgentTopologyProjection,
  AgentTopologyTeamInspector,
} from "../packages/webui/src/contracts/topology.ts"
import {
  buildTeamBuilderDraft,
  buildTeamMembersPayload,
  buildTopologyFlowElements,
  buildTopologySummaryCards,
  topologyEdgeVisualStyle,
  updateTeamBuilderDraft,
} from "../packages/webui/src/lib/topology.js"

const text = (ko: string, _en: string) => ko
const now = Date.UTC(2026, 3, 24, 0, 0, 0)

function teamInspector(): AgentTopologyTeamInspector {
  return {
    teamId: "team:topology",
    nodeId: "team:team:topology",
    displayName: "Topology Team",
    status: "enabled",
    purpose: "Coverage check",
    ownerAgentId: "agent:alpha",
    leadAgentId: "agent:beta",
    memberAgentIds: ["agent:beta", "agent:gamma"],
    activeMemberAgentIds: ["agent:beta"],
    roleHints: ["lead", "reviewer"],
    requiredTeamRoles: ["lead", "reviewer"],
    requiredCapabilityTags: ["research"],
    members: [
      {
        agentId: "agent:beta",
        label: "Beta",
        membershipId: "team:topology:membership:0",
        primaryRole: "lead",
        teamRoles: ["lead"],
        required: true,
        executionState: "active",
        directChild: true,
        active: true,
        reasonCodes: [],
        specialtyTags: ["research"],
        capabilityIds: ["research"],
        modelAvailability: "available",
        capabilityAvailability: "available",
      },
      {
        agentId: "agent:gamma",
        label: "Gamma",
        membershipId: "team:topology:membership:1",
        primaryRole: "reviewer",
        teamRoles: ["reviewer"],
        required: true,
        executionState: "reference",
        directChild: false,
        active: false,
        reasonCodes: ["owner_direct_child_required"],
        specialtyTags: ["research"],
        capabilityIds: ["research"],
      },
    ],
    roleCoverage: {
      required: ["lead", "reviewer"],
      covered: ["lead"],
      missing: ["reviewer"],
      providers: { lead: ["agent:beta"], reviewer: [] },
    },
    capabilityCoverage: {
      required: ["research"],
      covered: ["research"],
      missing: [],
      providers: { research: ["agent:beta"] },
    },
    health: {
      status: "degraded",
      executionCandidate: false,
      activeMemberCount: 1,
      referenceMemberCount: 1,
      unresolvedMemberCount: 0,
      excludedMemberCount: 0,
      degradedReasonCodes: ["owner_direct_child_required"],
    },
    builder: {
      ownerAgentId: "agent:alpha",
      directChildAgentIds: ["agent:beta"],
      candidates: [
        {
          agentId: "agent:beta",
          label: "Beta",
          directChild: true,
          configuredMember: true,
          active: true,
          canActivate: true,
          membershipStatus: "active",
          primaryRole: "lead",
          teamRoles: ["lead"],
          reasonCodes: [],
        },
        {
          agentId: "agent:gamma",
          label: "Gamma",
          directChild: false,
          configuredMember: true,
          active: false,
          canActivate: false,
          membershipStatus: "inactive",
          primaryRole: "reviewer",
          teamRoles: ["reviewer"],
          reasonCodes: ["owner_direct_child_required"],
        },
      ],
    },
    diagnostics: [
      {
        reasonCode: "owner_direct_child_required",
        severity: "warning",
        message: "Gamma is a reference member.",
        teamId: "team:topology",
        agentId: "agent:gamma",
      },
    ],
  }
}

function projection(): AgentTopologyProjection {
  const team = teamInspector()
  return {
    schemaVersion: 1,
    generatedAt: now,
    rootAgentId: "agent:nobie",
    nodes: [
      {
        id: "agent:agent:nobie",
        kind: "nobie",
        entityId: "agent:nobie",
        label: "Nobie",
        status: "enabled",
        position: { x: 80, y: 80 },
        badges: ["Nobie"],
        data: {},
        diagnostics: [],
      },
      {
        id: "agent:agent:alpha",
        kind: "sub_agent",
        entityId: "agent:alpha",
        label: "Alpha",
        status: "enabled",
        position: { x: 360, y: 80 },
        badges: ["SubAgent"],
        data: {},
        diagnostics: [],
      },
      {
        id: "team:team:topology",
        kind: "team",
        entityId: "team:topology",
        label: "Topology Team",
        status: "enabled",
        position: { x: 80, y: 360 },
        badges: ["Team", "degraded"],
        data: {},
        diagnostics: team.diagnostics,
      },
      {
        id: "team-role:team:topology:agent:gamma:reviewer",
        kind: "team_role",
        entityId: "team:topology:agent:gamma:reviewer",
        label: "reviewer",
        status: "reference",
        position: { x: 360, y: 430 },
        badges: ["TeamRole", "reference"],
        data: { teamId: "team:topology", agentId: "agent:gamma" },
        diagnostics: team.diagnostics,
      },
    ],
    edges: [
      {
        id: "relationship:agent:nobie->agent:alpha",
        kind: "parent_child",
        source: "agent:agent:nobie",
        target: "agent:agent:alpha",
        label: "parent child",
        valid: true,
        style: "hierarchy",
        data: {},
        diagnostics: [],
      },
      {
        id: "membership:team:topology->team-role:team:topology:agent:gamma:reviewer",
        kind: "team_membership",
        source: "team:team:topology",
        target: "team-role:team:topology:agent:gamma:reviewer",
        label: "reviewer",
        valid: true,
        style: "membership_reference",
        data: { teamId: "team:topology", agentId: "agent:gamma" },
        diagnostics: team.diagnostics,
      },
    ],
    inspectors: {
      agents: {
        "agent:alpha": {
          agentId: "agent:alpha",
          nodeId: "agent:agent:alpha",
          kind: "sub_agent",
          displayName: "Alpha",
          status: "enabled",
          role: "researcher",
          specialtyTags: ["research"],
          teamIds: ["team:topology"],
          source: "db",
          model: { providerId: "openai", modelId: "gpt-5.4-mini", reasonCodes: [] },
          skillMcp: {
            enabledSkillIds: ["research"],
            enabledMcpServerIds: ["browser"],
            enabledToolNames: ["web_search"],
            disabledToolNames: [],
            secretScope: "configured",
          },
          tools: {
            enabledCount: 1,
            disabledCount: 0,
            enabledToolNames: ["web_search"],
            disabledToolNames: [],
          },
          memory: {
            owner: "sub_agent:agent:alpha",
            visibility: "private",
            readScopeCount: 1,
            readScopes: ["sub_agent:agent:alpha"],
            writeScope: "sub_agent:agent:alpha",
            retentionPolicy: "short_term",
            writebackReviewRequired: true,
          },
          capability: {
            allowExternalNetwork: true,
            allowFilesystemWrite: false,
            allowShellExecution: false,
            allowScreenControl: false,
            allowedPathCount: 0,
            reasonCodes: [],
          },
          delegation: { enabled: true, maxParallelSessions: 2, retryBudget: 2 },
          diagnostics: [],
        },
      },
      teams: { "team:topology": team },
    },
    layout: {
      schemaVersion: 1,
      layout: "tree",
      nodes: {},
      updatedAt: null,
    },
    diagnostics: team.diagnostics,
    validation: {
      hierarchy: { maxDepth: 5, maxChildCount: 10 },
      teamActiveMembershipRule: "owner_direct_child_required",
    },
  }
}

describe("task025 webui topology helpers", () => {
  it("converts topology projection into React Flow nodes and visually distinct edges", () => {
    const elements = buildTopologyFlowElements(projection())
    const hierarchy = elements.edges.find((edge) => edge.data?.style === "hierarchy")
    const membership = elements.edges.find((edge) => edge.data?.style === "membership_reference")

    expect(elements.nodes.find((node) => node.id === "team:team:topology")?.type).toBe(
      "topologyNode",
    )
    expect(hierarchy?.style).not.toHaveProperty("strokeDasharray")
    expect(membership?.style).toEqual(expect.objectContaining({ strokeDasharray: "3 5" }))
    expect(topologyEdgeVisualStyle("invalid").stroke).toBe("#dc2626")
  })

  it("blocks non-direct-child Team Builder activation and builds safe member payloads", () => {
    const team = teamInspector()
    const draft = buildTeamBuilderDraft(team)
    const gamma = team.builder.candidates.find((candidate) => candidate.agentId === "agent:gamma")
    if (!gamma) throw new Error("gamma candidate missing")

    const blocked = updateTeamBuilderDraft(draft, gamma, true)
    expect(blocked.blockedReason).toBe("owner_direct_child_required")
    expect(blocked.draft.find((item) => item.agentId === "agent:gamma")?.active).toBe(false)

    const payload = buildTeamMembersPayload(team, draft)
    expect(payload.memberships).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ agentId: "agent:beta", status: "active" }),
        expect.objectContaining({ agentId: "agent:gamma", status: "inactive" }),
      ]),
    )
  })

  it("summarizes diagnostics and keeps redacted inspector data free of raw secrets", () => {
    const runtime = projection()
    const cards = buildTopologySummaryCards(runtime, text)
    expect(cards.find((card) => card.id === "issues")?.tone).toBe("emerald")
    expect(runtime.inspectors.agents["agent:alpha"].skillMcp.secretScope).toBe("configured")
    expect(JSON.stringify(runtime)).not.toMatch(/sk-task025-secret|private raw memory|rawPayload/i)
  })
})
