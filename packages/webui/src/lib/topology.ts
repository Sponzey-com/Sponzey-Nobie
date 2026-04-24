import type { Edge, Node } from "@xyflow/react"
import type {
  AgentTopologyEdge,
  AgentTopologyEdgeStyle,
  AgentTopologyNode,
  AgentTopologyNodeKind,
  AgentTopologyProjection,
  AgentTopologyTeamBuilderCandidate,
  AgentTopologyTeamInspector,
  AgentTopologyTeamMembersPayload,
  AgentTopologyTeamMembershipDraft,
} from "../contracts/topology"

export interface TopologyFlowNodeData extends Record<string, unknown> {
  kind: AgentTopologyNodeKind
  entityId: string
  label: string
  status?: string
  badges: string[]
  diagnostics: string[]
  raw: AgentTopologyNode
}

export interface TopologyFlowEdgeData extends Record<string, unknown> {
  kind: AgentTopologyEdge["kind"]
  style: AgentTopologyEdgeStyle
  valid: boolean
  diagnostics: string[]
  raw: AgentTopologyEdge
}

export interface TopologyFlowElements {
  nodes: Array<Node<TopologyFlowNodeData>>
  edges: Array<Edge<TopologyFlowEdgeData>>
}

export interface TopologySelection {
  nodeId: string
  kind: AgentTopologyNodeKind
  entityId: string
  teamId?: string
  agentId?: string
}

export interface TopologySummaryCard {
  id: string
  label: string
  value: string
  tone: "stone" | "emerald" | "amber" | "red" | "sky"
}

export function topologyEdgeVisualStyle(style: AgentTopologyEdgeStyle): {
  stroke: string
  strokeWidth: number
  strokeDasharray?: string
} {
  switch (style) {
    case "hierarchy":
      return { stroke: "#44403c", strokeWidth: 2.2 }
    case "membership":
      return { stroke: "#0f766e", strokeWidth: 1.8, strokeDasharray: "7 5" }
    case "membership_reference":
      return { stroke: "#b45309", strokeWidth: 1.8, strokeDasharray: "3 5" }
    case "lead":
      return { stroke: "#2563eb", strokeWidth: 1.9, strokeDasharray: "8 4" }
    case "invalid":
      return { stroke: "#dc2626", strokeWidth: 2.4, strokeDasharray: "4 4" }
  }
}

export function topologyNodeTone(kind: AgentTopologyNodeKind, status?: string): string {
  if (status === "invalid" || status === "disabled" || status === "archived") return "rose"
  if (status === "degraded" || status === "reference") return "amber"
  if (kind === "team") return "sky"
  if (kind === "team_lead") return "blue"
  if (kind === "team_role") return "teal"
  if (kind === "nobie") return "stone"
  return "emerald"
}

export function buildTopologyFlowElements(
  projection: AgentTopologyProjection | null,
): TopologyFlowElements {
  if (!projection) return { nodes: [], edges: [] }
  return {
    nodes: projection.nodes.map((node) => ({
      id: node.id,
      type: "topologyNode",
      position: { x: node.position.x, y: node.position.y },
      draggable: true,
      data: {
        kind: node.kind,
        entityId: node.entityId,
        label: node.label,
        ...(node.status ? { status: node.status } : {}),
        badges: node.badges,
        diagnostics: node.diagnostics.map((diagnostic) => diagnostic.reasonCode),
        raw: node,
      },
    })),
    edges: projection.edges.map((edge) => ({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      type: "smoothstep",
      animated: edge.kind === "team_membership" && edge.style !== "lead",
      label: edge.label,
      style: topologyEdgeVisualStyle(edge.valid ? edge.style : "invalid"),
      data: {
        kind: edge.kind,
        style: edge.valid ? edge.style : "invalid",
        valid: edge.valid,
        diagnostics: edge.diagnostics.map((diagnostic) => diagnostic.reasonCode),
        raw: edge,
      },
    })),
  }
}

export function selectionFromTopologyNode(node: Node<TopologyFlowNodeData>): TopologySelection {
  const raw = node.data.raw
  return {
    nodeId: node.id,
    kind: node.data.kind,
    entityId: node.data.entityId,
    ...(typeof raw.data.teamId === "string" ? { teamId: raw.data.teamId } : {}),
    ...(typeof raw.data.agentId === "string" ? { agentId: raw.data.agentId } : {}),
  }
}

export function buildTopologySummaryCards(
  projection: AgentTopologyProjection | null,
  text: (ko: string, en: string) => string,
): TopologySummaryCard[] {
  if (!projection) {
    return [
      { id: "agents", label: text("에이전트", "Agents"), value: "-", tone: "stone" },
      { id: "teams", label: text("팀", "Teams"), value: "-", tone: "stone" },
      { id: "issues", label: text("진단", "Diagnostics"), value: "-", tone: "stone" },
    ]
  }
  const agents = projection.nodes.filter(
    (node) => node.kind === "nobie" || node.kind === "sub_agent",
  )
  const teams = projection.nodes.filter((node) => node.kind === "team")
  const blocked = projection.diagnostics.filter(
    (diagnostic) => diagnostic.severity === "blocked" || diagnostic.severity === "invalid",
  )
  return [
    {
      id: "agents",
      label: text("에이전트", "Agents"),
      value: String(agents.length),
      tone: agents.length > 0 ? "emerald" : "stone",
    },
    {
      id: "teams",
      label: text("팀", "Teams"),
      value: String(teams.length),
      tone: teams.length > 0 ? "sky" : "stone",
    },
    {
      id: "issues",
      label: text("차단", "Blocked"),
      value: String(blocked.length),
      tone: blocked.length > 0 ? "red" : "emerald",
    },
    {
      id: "memberships",
      label: text("멤버십", "Memberships"),
      value: String(projection.edges.filter((edge) => edge.kind === "team_membership").length),
      tone: "amber",
    },
  ]
}

export function buildTeamBuilderDraft(
  team: AgentTopologyTeamInspector,
): AgentTopologyTeamMembershipDraft[] {
  return team.builder.candidates
    .filter((candidate) => candidate.configuredMember || candidate.active)
    .map((candidate) => ({
      agentId: candidate.agentId,
      active: candidate.active,
      primaryRole: candidate.primaryRole ?? "member",
      teamRoles:
        candidate.teamRoles.length > 0 ? candidate.teamRoles : [candidate.primaryRole ?? "member"],
      required: true,
    }))
}

export function canActivateTeamCandidate(candidate: AgentTopologyTeamBuilderCandidate): boolean {
  return candidate.canActivate && candidate.directChild
}

export function updateTeamBuilderDraft(
  draft: AgentTopologyTeamMembershipDraft[],
  candidate: AgentTopologyTeamBuilderCandidate,
  active: boolean,
): { draft: AgentTopologyTeamMembershipDraft[]; blockedReason?: string } {
  if (active && !canActivateTeamCandidate(candidate)) {
    return { draft, blockedReason: "owner_direct_child_required" }
  }
  const existing = draft.find((item) => item.agentId === candidate.agentId)
  const primaryRole = existing?.primaryRole ?? candidate.primaryRole ?? "member"
  const teamRoles =
    existing?.teamRoles ?? (candidate.teamRoles.length > 0 ? candidate.teamRoles : [primaryRole])
  if (!existing) {
    return {
      draft: [
        ...draft,
        { agentId: candidate.agentId, active, primaryRole, teamRoles, required: true },
      ],
    }
  }
  return {
    draft: draft.map((item) =>
      item.agentId === candidate.agentId ? { ...item, active, primaryRole, teamRoles } : item,
    ),
  }
}

export function buildTeamMembersPayload(
  team: AgentTopologyTeamInspector,
  draft: AgentTopologyTeamMembershipDraft[],
): AgentTopologyTeamMembersPayload {
  const included = draft.filter((item) => item.active || team.memberAgentIds.includes(item.agentId))
  return {
    memberAgentIds: included.map((item) => item.agentId),
    roleHints: included.map((item) => item.primaryRole),
    memberships: included.map((item, index) => ({
      membershipId: `${team.teamId}:membership:${item.agentId}:${index}`,
      teamId: team.teamId,
      agentId: item.agentId,
      ownerAgentIdSnapshot: team.ownerAgentId,
      teamRoles: item.teamRoles.length > 0 ? item.teamRoles : [item.primaryRole],
      primaryRole: item.primaryRole,
      required: item.required,
      sortOrder: index,
      status: item.active ? "active" : "inactive",
    })),
  }
}
