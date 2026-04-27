import { describe, expect, it } from "vitest"
import type {
  AgentTopologyProjection,
  AgentTopologyTeamInspector,
} from "../packages/webui/src/contracts/topology.ts"
import {
  buildTeamLeadershipDraft,
  buildTeamMembershipDraftWithCandidate,
  buildTeamBuilderDraft,
  buildTeamMembersPayload,
  buildTopologyAgentCreatePayload,
  buildTopologyAgentComposition,
  buildTopologyAgentTeamAssignments,
  buildTopologyFlowElements,
  buildTopologySummaryCards,
  buildTopologyTeamCreatePayload,
  buildTopologyTeamCompositionSummary,
  buildTopologyWorkingAgentIds,
  canArchiveTopologySelection,
  mergeTopologyFlowNodesWithCurrentPositions,
  resolveTopologyConnectionIntent,
  resolveTopologyNodeDragDropIntent,
  topologyEdgeVisualStyle,
  updateTeamBuilderDraft,
  updateTeamBuilderDraftRole,
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
    leadAgentId: "agent:alpha",
    memberAgentIds: ["agent:beta", "agent:gamma"],
    activeMemberAgentIds: ["agent:beta"],
    roleHints: ["member", "reviewer"],
    requiredTeamRoles: ["member", "reviewer"],
    requiredCapabilityTags: ["research"],
    members: [
      {
        agentId: "agent:beta",
        label: "Beta",
        membershipId: "team:topology:membership:0",
        primaryRole: "member",
        teamRoles: ["member"],
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
      required: ["member", "reviewer"],
      covered: ["member"],
      missing: ["reviewer"],
      providers: { member: ["agent:beta"], reviewer: [] },
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
          primaryRole: "member",
          teamRoles: ["member"],
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
        id: "agent:agent:beta",
        kind: "sub_agent",
        entityId: "agent:beta",
        label: "Beta",
        status: "enabled",
        position: { x: 620, y: 80 },
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
        data: { ownerAgentId: "agent:alpha", leadAgentId: "agent:alpha" },
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
        id: "membership:agent:agent:alpha->team:topology:lead",
        kind: "team_membership",
        source: "agent:agent:alpha",
        target: "team:team:topology",
        label: "lead",
        valid: true,
        style: "lead",
        data: { teamId: "team:topology", agentId: "agent:alpha", role: "lead" },
        diagnostics: [],
      },
      {
        id: "membership:team:topology->agent:agent:beta:member",
        kind: "team_membership",
        source: "team:team:topology",
        target: "agent:agent:beta",
        label: "member",
        valid: true,
        style: "membership",
        data: { teamId: "team:topology", agentId: "agent:beta" },
        diagnostics: [],
      },
      {
        id: "membership:team:topology->agent:agent:gamma:reviewer",
        kind: "team_membership",
        source: "team:team:topology",
        target: "agent:agent:gamma",
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
          teamIds: ["team:unassigned"],
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
    const teamNode = elements.nodes.find((node) => node.id === "team:team:topology")
    const alphaNode = elements.nodes.find((node) => node.id === "agent:agent:alpha")
    const betaNode = elements.nodes.find((node) => node.id === "agent:agent:beta")

    expect(teamNode?.type).toBe("topologyNode")
    expect(teamNode?.data.group).toBe(true)
    expect(teamNode?.draggable).toBe(true)
    expect(teamNode?.style).toEqual(expect.objectContaining({ width: 578, height: 212 }))
    expect(alphaNode?.position).toEqual({ x: 132, y: 422 })
    expect(alphaNode?.data.teamGroupId).toBe("team:topology")
    expect(alphaNode?.data.teamGroupRole).toBe("lead")
    expect(alphaNode?.draggable).toBe(false)
    expect(alphaNode?.style).toEqual(expect.objectContaining({ width: 220, minHeight: 112 }))
    expect(betaNode?.position).toEqual({ x: 386, y: 422 })
    expect(betaNode?.data.teamGroupId).toBe("team:topology")
    expect(betaNode?.data.teamGroupRole).toBe("member")
    expect(betaNode?.draggable).toBe(true)
    expect(betaNode?.style).toEqual(expect.objectContaining({ width: 220, minHeight: 112 }))
    expect(elements.nodes.some((node) => node.data.kind === "team_role")).toBe(false)
    expect(elements.edges.some((edge) => edge.data?.kind === "team_membership")).toBe(false)
    expect(hierarchy?.target).toBe("team:team:topology")
    expect(hierarchy?.style).not.toHaveProperty("strokeDasharray")
    expect(topologyEdgeVisualStyle("invalid").stroke).toBe("#dc2626")
  })

  it("sizes team group nodes from the team lead and members and lays them out inside the team", () => {
    const runtime = projection()
    const team = runtime.inspectors.teams["team:topology"]
    team.activeMemberAgentIds = ["agent:beta", "agent:gamma"]
    team.memberAgentIds = ["agent:beta", "agent:gamma"]
    team.members = team.members.map((member) => ({
      ...member,
      active: true,
      directChild: true,
      executionState: "active",
      reasonCodes: [],
    }))
    team.health = {
      ...team.health,
      activeMemberCount: 2,
      referenceMemberCount: 0,
    }
    runtime.nodes.push({
      id: "agent:agent:gamma",
      kind: "sub_agent",
      entityId: "agent:gamma",
      label: "Gamma",
      status: "enabled",
      position: { x: 880, y: 80 },
      badges: ["SubAgent"],
      data: {},
      diagnostics: [],
    })

    const elements = buildTopologyFlowElements(runtime)
    const teamNode = elements.nodes.find((node) => node.id === "team:team:topology")
    const alphaNode = elements.nodes.find((node) => node.id === "agent:agent:alpha")
    const betaNode = elements.nodes.find((node) => node.id === "agent:agent:beta")
    const gammaNode = elements.nodes.find((node) => node.id === "agent:agent:gamma")

    expect(teamNode?.style).toEqual(expect.objectContaining({ width: 832, height: 212 }))
    expect(alphaNode?.position).toEqual({ x: 132, y: 422 })
    expect(betaNode?.position).toEqual({ x: 386, y: 422 })
    expect(gammaNode?.position).toEqual({ x: 640, y: 422 })
    expect(gammaNode?.data.teamGroupId).toBe("team:topology")
  })

  it("groups configured active members even when execution coverage excludes them", () => {
    const runtime = projection()
    const team = runtime.inspectors.teams["team:topology"]
    team.activeMemberAgentIds = []
    team.health = {
      ...team.health,
      activeMemberCount: 0,
      excludedMemberCount: 2,
    }
    team.members = team.members.map((member) => ({
      ...member,
      directChild: true,
      executionState: "excluded",
      active: false,
      reasonCodes: ["member_model_unavailable"],
      modelAvailability: "unavailable",
    }))
    team.builder.directChildAgentIds = ["agent:beta", "agent:gamma"]
    team.builder.candidates = team.builder.candidates.map((candidate) => ({
      ...candidate,
      directChild: true,
      active: true,
      canActivate: true,
      membershipStatus: "active",
      reasonCodes: ["member_model_unavailable"],
    }))
    const betaRuntimeNode = runtime.nodes.find((node) => node.entityId === "agent:beta")
    if (betaRuntimeNode) betaRuntimeNode.badges = ["SubAgent", "candidate"]
    runtime.nodes.push({
      id: "agent:agent:gamma",
      kind: "sub_agent",
      entityId: "agent:gamma",
      label: "Gamma",
      status: "enabled",
      position: { x: 880, y: 80 },
      badges: ["SubAgent"],
      data: {},
      diagnostics: [],
    })

    const elements = buildTopologyFlowElements(runtime)
    const teamNode = elements.nodes.find((node) => node.id === "team:team:topology")
    const betaNode = elements.nodes.find((node) => node.id === "agent:agent:beta")
    const gammaNode = elements.nodes.find((node) => node.id === "agent:agent:gamma")

    expect(teamNode?.data.groupMemberCount).toBe(2)
    expect(teamNode?.style).toEqual(expect.objectContaining({ width: 832, height: 212 }))
    expect(betaNode?.data.teamGroupId).toBe("team:topology")
    expect(gammaNode?.data.teamGroupId).toBe("team:topology")
    expect(betaNode?.data.badges).toContain("member")
    expect(betaNode?.data.badges).not.toContain("candidate")
    expect(betaNode?.position).toEqual({ x: 386, y: 422 })
    expect(gammaNode?.position).toEqual({ x: 640, y: 422 })
  })

  it("marks active run agents and their teams as working", () => {
    const workingAgentIds = buildTopologyWorkingAgentIds(
      [
        {
          status: "running",
          targetId: "agent:beta",
          subSessionsSnapshot: [
            { agentId: "agent:gamma", status: "running" },
            { agentId: "agent:delta", status: "completed" },
          ],
        },
      ],
      "agent:nobie",
    )
    expect([...workingAgentIds].sort()).toEqual(["agent:beta", "agent:gamma", "agent:nobie"])

    const runtime = projection()
    runtime.nodes.push({
      id: "agent:agent:gamma",
      kind: "sub_agent",
      entityId: "agent:gamma",
      label: "Gamma",
      status: "enabled",
      position: { x: 880, y: 80 },
      badges: ["SubAgent"],
      data: {},
      diagnostics: [],
    })
    runtime.inspectors.teams["team:topology"].builder.directChildAgentIds = [
      "agent:beta",
      "agent:gamma",
    ]
    runtime.inspectors.teams["team:topology"].builder.candidates = runtime.inspectors.teams[
      "team:topology"
    ].builder.candidates.map((candidate) => ({
      ...candidate,
      directChild: true,
      canActivate: true,
      active: true,
      membershipStatus: "active",
    }))

    const elements = buildTopologyFlowElements(runtime, { workingAgentIds })
    const teamNode = elements.nodes.find((node) => node.id === "team:team:topology")
    const betaNode = elements.nodes.find((node) => node.id === "agent:agent:beta")
    const gammaNode = elements.nodes.find((node) => node.id === "agent:agent:gamma")
    const alphaNode = elements.nodes.find((node) => node.id === "agent:agent:alpha")

    expect(teamNode?.data.working).toBe(true)
    expect(betaNode?.data.working).toBe(true)
    expect(gammaNode?.data.working).toBe(true)
    expect(alphaNode?.data.working).toBeUndefined()
  })

  it("keeps grouped members anchored to the current team position across reload merges", () => {
    const elements = buildTopologyFlowElements(projection())
    const currentNodes = elements.nodes.map((node) =>
      node.id === "team:team:topology"
        ? { ...node, position: { x: 200, y: 500 }, selected: true }
        : node,
    )

    const merged = mergeTopologyFlowNodesWithCurrentPositions(elements.nodes, currentNodes)
    const teamNode = merged.find((node) => node.id === "team:team:topology")
    const alphaNode = merged.find((node) => node.id === "agent:agent:alpha")
    const betaNode = merged.find((node) => node.id === "agent:agent:beta")

    expect(teamNode?.position).toEqual({ x: 200, y: 500 })
    expect(teamNode?.selected).toBe(true)
    expect(alphaNode?.position).toEqual({ x: 252, y: 562 })
    expect(betaNode?.position).toEqual({ x: 506, y: 562 })
  })

  it("resolves node drag drops into team membership activation and deactivation", () => {
    const runtime = projection()
    runtime.nodes.push({
      id: "agent:agent:delta",
      kind: "sub_agent",
      entityId: "agent:delta",
      label: "Delta",
      status: "enabled",
      position: { x: 900, y: 120 },
      badges: ["SubAgent"],
      data: {},
      diagnostics: [],
    })
    runtime.nodes.push({
      id: "agent:agent:gamma",
      kind: "sub_agent",
      entityId: "agent:gamma",
      label: "Gamma",
      status: "enabled",
      position: { x: 900, y: 280 },
      badges: ["SubAgent"],
      data: {},
      diagnostics: [],
    })
    const elements = buildTopologyFlowElements(runtime)
    const deltaNode = elements.nodes.find((node) => node.id === "agent:agent:delta")
    const betaNode = elements.nodes.find((node) => node.id === "agent:agent:beta")
    const gammaNode = elements.nodes.find((node) => node.id === "agent:agent:gamma")
    if (!deltaNode || !betaNode || !gammaNode) throw new Error("drag test nodes missing")
    expect(gammaNode.data.teamGroupId).toBeUndefined()

    const droppedDelta = { ...deltaNode, position: { x: betaNode.position.x, y: betaNode.position.y } }
    expect(resolveTopologyNodeDragDropIntent(droppedDelta, elements.nodes)).toEqual({
      kind: "activate_team_membership",
      teamId: "team:topology",
      agentId: "agent:delta",
    })
    const droppedDeltaPartlyInTeam = { ...deltaNode, position: { x: -50, y: 422 } }
    expect(resolveTopologyNodeDragDropIntent(droppedDeltaPartlyInTeam, elements.nodes)).toEqual({
      kind: "activate_team_membership",
      teamId: "team:topology",
      agentId: "agent:delta",
    })

    const draggedBetaPartlyOut = { ...betaNode, position: { x: 500, y: betaNode.position.y } }
    expect(resolveTopologyNodeDragDropIntent(draggedBetaPartlyOut, elements.nodes)).toEqual({
      kind: "deactivate_team_membership",
      teamId: "team:topology",
      agentId: "agent:beta",
    })

    const draggedBetaOut = { ...betaNode, position: { x: 1000, y: 1000 } }
    expect(resolveTopologyNodeDragDropIntent(draggedBetaOut, elements.nodes)).toEqual({
      kind: "deactivate_team_membership",
      teamId: "team:topology",
      agentId: "agent:beta",
    })
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

    const leadership = buildTeamLeadershipDraft(team, "agent:alpha", ["agent:beta"])
    expect(leadership.blockedReason).toBeUndefined()
    expect(leadership.draft).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ agentId: "agent:beta", primaryRole: "member", active: true }),
        expect.objectContaining({ agentId: "agent:gamma", primaryRole: "member", active: false }),
      ]),
    )
    expect(leadership.draft.some((item) => item.agentId === "agent:alpha")).toBe(false)
  })

  it("derives composition state from topology connections", () => {
    const runtime = projection()
    const alpha = buildTopologyAgentComposition(runtime, "agent:alpha")
    const team = teamInspector()
    const summary = buildTopologyTeamCompositionSummary(runtime, team)

    expect(alpha.parent?.id).toBe("agent:nobie")
    expect(alpha.children.map((child) => child.id)).toEqual(["agent:beta"])
    expect(alpha.ownedTeams.map((ownedTeam) => ownedTeam.id)).toEqual(["team:topology"])
    expect(buildTopologyAgentTeamAssignments(alpha).map((team) => team.id)).toEqual([
      "team:topology",
    ])
    expect(summary.owner.id).toBe("agent:alpha")
    expect(summary.directChildCount).toBe(1)
    expect(summary.activeMemberCount).toBe(1)
    expect(summary.referenceMemberCount).toBe(1)
  })

  it("resolves canvas connections into hierarchy intents", () => {
    const elements = buildTopologyFlowElements(projection())
    const alpha = elements.nodes.find((node) => node.id === "agent:agent:alpha")
    const beta = elements.nodes.find((node) => node.id === "agent:agent:beta")
    const team = elements.nodes.find((node) => node.id === "team:team:topology")
    if (!alpha || !beta || !team) throw new Error("topology nodes missing")

    expect(resolveTopologyConnectionIntent(alpha.data, beta.data)).toEqual({
      kind: "parent_child",
      parentAgentId: "agent:alpha",
      childAgentId: "agent:beta",
    })
    expect(resolveTopologyConnectionIntent(team.data, beta.data)).toEqual({
      kind: "parent_child",
      parentAgentId: "agent:alpha",
      childAgentId: "agent:beta",
    })
    expect(resolveTopologyConnectionIntent(alpha.data, team.data)).toEqual({
      kind: "invalid",
      reasonCode: "team_lead_managed_from_node_settings",
    })
  })

  it("builds membership drafts from canvas membership actions and role edits", () => {
    const team = teamInspector()
    const draft = buildTeamBuilderDraft(team)
    const beta = team.builder.candidates.find((candidate) => candidate.agentId === "agent:beta")
    if (!beta) throw new Error("beta candidate missing")

    const roleEdited = updateTeamBuilderDraftRole(draft, beta, "verifier")
    expect(roleEdited.find((item) => item.agentId === "agent:beta")?.primaryRole).toBe("verifier")

    const activated = buildTeamMembershipDraftWithCandidate(team, "agent:beta", true)
    expect(activated.blockedReason).toBeUndefined()
    expect(activated.draft.find((item) => item.agentId === "agent:beta")?.active).toBe(true)

    const blocked = buildTeamMembershipDraftWithCandidate(team, "agent:gamma", true)
    expect(blocked.blockedReason).toBe("owner_direct_child_required")
  })

  it("summarizes diagnostics and keeps redacted inspector data free of raw secrets", () => {
    const runtime = projection()
    const cards = buildTopologySummaryCards(runtime, text)
    expect(cards.find((card) => card.id === "issues")?.tone).toBe("emerald")
    expect(runtime.inspectors.agents["agent:alpha"].skillMcp.secretScope).toBe("configured")
    expect(JSON.stringify(runtime)).not.toMatch(/sk-task025-secret|private raw memory|rawPayload/i)
  })

  it("builds create payloads for topology agent and team nodes", () => {
    const agent = buildTopologyAgentCreatePayload({
      kind: "agent",
      name: "Delta",
      detail: "researcher",
      now,
    })
    const team = buildTopologyTeamCreatePayload({
      kind: "team",
      name: "Review Team",
      detail: "Review sub-agent outputs.",
      parentAgentId: "agent:alpha",
      leadAgentId: "agent:alpha",
      memberAgentIds: ["agent:beta"],
      now,
    })

    expect(agent.agent).toEqual(
      expect.objectContaining({
        agentId: "agent:delta",
        agentType: "sub_agent",
        displayName: "Delta",
        status: "enabled",
      }),
    )
    expect("relationship" in agent).toBe(false)
    expect(team.team).toEqual(
      expect.objectContaining({
        teamId: "team:review-team",
        ownerAgentId: "agent:alpha",
        leadAgentId: "agent:alpha",
        purpose: "Review sub-agent outputs.",
      }),
    )
    expect(team.team).toEqual(expect.objectContaining({ memberAgentIds: ["agent:beta"] }))
  })

  it("allows archive actions only for concrete agent and team nodes", () => {
    expect(
      canArchiveTopologySelection({
        nodeId: "agent:agent:alpha",
        kind: "sub_agent",
        entityId: "agent:alpha",
      }),
    ).toBe(true)
    expect(
      canArchiveTopologySelection({
        nodeId: "team:team:topology",
        kind: "team",
        entityId: "team:topology",
      }),
    ).toBe(true)
    expect(
      canArchiveTopologySelection({
        nodeId: "agent:agent:nobie",
        kind: "nobie",
        entityId: "agent:nobie",
      }),
    ).toBe(false)
  })
})
