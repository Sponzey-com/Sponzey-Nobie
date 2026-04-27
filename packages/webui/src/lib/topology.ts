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
import type { RootRun } from "../contracts/runs"

export interface TopologyFlowNodeData extends Record<string, unknown> {
  kind: AgentTopologyNodeKind
  entityId: string
  label: string
  status?: string
  working?: boolean
  group?: boolean
  groupMemberCount?: number
  teamGroupId?: string
  teamGroupRole?: "lead" | "member"
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

export interface TopologyFlowOptions {
  workingAgentIds?: ReadonlySet<string>
}

export type TopologyWorkingRunSource = Pick<
  RootRun,
  "status" | "targetId" | "subSessionsSnapshot"
>

export type TopologyNodeDragDropIntent =
  | {
      kind: "activate_team_membership"
      teamId: string
      agentId: string
    }
  | {
      kind: "deactivate_team_membership"
      teamId: string
      agentId: string
    }
  | {
      kind: "none"
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

export interface TopologyCompositionItem {
  id: string
  label: string
  status?: string
}

export interface TopologyAgentComposition {
  parent?: TopologyCompositionItem
  children: TopologyCompositionItem[]
  ownedTeams: TopologyCompositionItem[]
  activeTeams: TopologyCompositionItem[]
  referenceTeams: TopologyCompositionItem[]
}

export interface TopologyTeamCompositionSummary {
  owner: TopologyCompositionItem
  directChildCount: number
  candidateCount: number
  activeMemberCount: number
  referenceMemberCount: number
  blockedCandidateCount: number
  executionCandidate: boolean
}

export type TopologyCreateNodeKind = "agent" | "team"

export interface TopologyNodeCreateDraft {
  kind: TopologyCreateNodeKind
  name: string
  detail: string
  parentAgentId?: string
  leadAgentId?: string
  memberAgentIds?: string[]
  now?: number
}

export interface TopologyAgentCreatePayload {
  agent: Record<string, unknown>
}

export interface TopologyTeamCreatePayload {
  team: Record<string, unknown>
}

export type TopologyConnectionIntent =
  | {
      kind: "parent_child"
      parentAgentId: string
      childAgentId: string
    }
  | {
      kind: "team_membership"
      teamId: string
      agentId: string
    }
  | {
      kind: "invalid"
      reasonCode: string
    }

const TOPOLOGY_CONTRACT_SCHEMA_VERSION = 1
const WORKING_RUN_STATUSES = new Set(["queued", "running", "awaiting_approval", "awaiting_user"])
const WORKING_SUB_SESSION_STATUSES = new Set([
  "created",
  "queued",
  "running",
  "waiting_for_input",
  "awaiting_approval",
  "needs_revision",
])

function uniqueTopologyIds(values: Array<string | undefined>): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value?.trim())))]
}

function recordString(value: Record<string, unknown>, key: string): string | undefined {
  const raw = value[key]
  return typeof raw === "string" && raw.trim() ? raw.trim() : undefined
}

export function buildTopologyWorkingAgentIds(
  runs: TopologyWorkingRunSource[],
  rootAgentId: string,
): Set<string> {
  const agentIds = new Set<string>()
  for (const run of runs) {
    if (!WORKING_RUN_STATUSES.has(run.status)) continue
    if (rootAgentId) agentIds.add(rootAgentId)
    if (run.targetId?.startsWith("agent:")) agentIds.add(run.targetId)
    for (const subSession of run.subSessionsSnapshot ?? []) {
      const status = recordString(subSession, "status")
      if (!status || !WORKING_SUB_SESSION_STATUSES.has(status)) continue
      const agentId = recordString(subSession, "agentId")
      if (agentId?.startsWith("agent:")) agentIds.add(agentId)
    }
  }
  return agentIds
}

export function normalizeTopologyEntitySlug(value: string, fallbackPrefix: string): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
  return normalized || `${fallbackPrefix}-${Date.now()}`
}

export function buildTopologyAgentCreatePayload(
  draft: TopologyNodeCreateDraft,
): TopologyAgentCreatePayload {
  const now = draft.now ?? Date.now()
  const displayName = draft.name.trim()
  const role = draft.detail.trim() || "assistant"
  const slug = normalizeTopologyEntitySlug(displayName, "agent")
  const agentId = `agent:${slug}`
  const owner = { ownerType: "sub_agent", ownerId: agentId }
  return {
    agent: {
      schemaVersion: TOPOLOGY_CONTRACT_SCHEMA_VERSION,
      agentType: "sub_agent",
      agentId,
      displayName,
      nickname: displayName,
      status: "enabled",
      role,
      personality: "Focused sub-agent managed from the topology editor.",
      specialtyTags: [role],
      avoidTasks: [],
      memoryPolicy: {
        owner,
        visibility: "private",
        readScopes: [owner],
        writeScope: owner,
        retentionPolicy: "short_term",
        writebackReviewRequired: true,
      },
      capabilityPolicy: {
        permissionProfile: {
          profileId: `profile:${slug}:safe`,
          riskCeiling: "moderate",
          approvalRequiredFrom: "moderate",
          allowExternalNetwork: false,
          allowFilesystemWrite: false,
          allowShellExecution: false,
          allowScreenControl: false,
          allowedPaths: [],
        },
        skillMcpAllowlist: {
          enabledSkillIds: [],
          enabledMcpServerIds: [],
          enabledToolNames: [],
          disabledToolNames: [],
          secretScopeId: agentId,
        },
        rateLimit: { maxConcurrentCalls: 2 },
      },
      delegationPolicy: {
        enabled: true,
        maxParallelSessions: 2,
        retryBudget: 2,
      },
      teamIds: ["team:unassigned"],
      delegation: {
        enabled: true,
        maxParallelSessions: 2,
        retryBudget: 2,
      },
      profileVersion: 1,
      createdAt: now,
      updatedAt: now,
    },
  }
}

export function buildTopologyTeamCreatePayload(
  draft: TopologyNodeCreateDraft,
): TopologyTeamCreatePayload {
  const now = draft.now ?? Date.now()
  const displayName = draft.name.trim()
  const purpose = draft.detail.trim() || "Coordinate selected sub-agents."
  const slug = normalizeTopologyEntitySlug(displayName, "team")
  const teamId = `team:${slug}`
  const ownerAgentId = draft.parentAgentId?.trim() || draft.leadAgentId?.trim() || ""
  const explicitLeadAgentId = draft.leadAgentId?.trim()
  const leadAgentId = explicitLeadAgentId || ownerAgentId
  const explicitMemberAgentIds = draft.memberAgentIds ?? []
  const memberAgentIds = uniqueTopologyIds(
    explicitMemberAgentIds.filter((agentId) => agentId !== leadAgentId),
  )
  const hasExplicitComposition = explicitMemberAgentIds.length > 0
  const memberships = memberAgentIds.map((agentId, index) => {
    const primaryRole = "member"
    return {
      membershipId: `${teamId}:membership:${agentId}:${index}`,
      teamId,
      agentId,
      ownerAgentIdSnapshot: ownerAgentId,
      teamRoles: [primaryRole],
      primaryRole,
      required: true,
      sortOrder: index,
      status: hasExplicitComposition ? "active" : "inactive",
    }
  })
  return {
    team: {
      schemaVersion: TOPOLOGY_CONTRACT_SCHEMA_VERSION,
      teamId,
      displayName,
      nickname: displayName,
      status: "enabled",
      purpose,
      ownerAgentId,
      leadAgentId,
      memberCountMin: 0,
      memberCountMax: 8,
      requiredTeamRoles: ["member"],
      requiredCapabilityTags: [],
      resultPolicy: "lead_synthesis",
      conflictPolicy: "lead_decides",
      memberships,
      memberAgentIds,
      roleHints: memberships.map((membership) => membership.primaryRole),
      profileVersion: 1,
      createdAt: now,
      updatedAt: now,
    },
  }
}

export function canArchiveTopologySelection(selection: TopologySelection | null): boolean {
  return selection?.kind === "sub_agent" || selection?.kind === "team"
}

function topologyNodeRawString(node: TopologyFlowNodeData | undefined, key: string): string {
  const value = node?.raw.data[key]
  return typeof value === "string" && value.trim().length > 0 ? value : ""
}

export function resolveTopologyConnectionIntent(
  source?: TopologyFlowNodeData,
  target?: TopologyFlowNodeData,
): TopologyConnectionIntent {
  const sourceAgentId =
    source?.kind === "nobie" || source?.kind === "sub_agent" ? source.entityId : ""
  const targetSubAgentId = target?.kind === "sub_agent" ? target.entityId : ""
  if (sourceAgentId && targetSubAgentId) {
    return { kind: "parent_child", parentAgentId: sourceAgentId, childAgentId: targetSubAgentId }
  }

  const sourceTeamId = source?.kind === "team" ? source.entityId : ""
  const targetTeamId = target?.kind === "team" ? target.entityId : ""
  const sourceSubAgentId = source?.kind === "sub_agent" ? source.entityId : ""
  if (sourceTeamId && targetSubAgentId) {
    const parentAgentId =
      topologyNodeRawString(source, "ownerAgentId") || topologyNodeRawString(source, "leadAgentId")
    return parentAgentId
      ? { kind: "parent_child", parentAgentId, childAgentId: targetSubAgentId }
      : { kind: "invalid", reasonCode: "team_owner_missing" }
  }
  if (targetTeamId && sourceSubAgentId) {
    return { kind: "invalid", reasonCode: "team_lead_managed_from_node_settings" }
  }

  return { kind: "invalid", reasonCode: "unsupported_topology_connection" }
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
  if (status === "degraded" || status === "reference" || status === "unassigned") return "amber"
  if (kind === "team") return "sky"
  if (kind === "team_lead") return "blue"
  if (kind === "team_role") return "teal"
  if (kind === "nobie") return "stone"
  return "emerald"
}

const AGENT_NODE_WIDTH = 220
const AGENT_NODE_HEIGHT = 112
const TEAM_GROUP_PADDING_X = 52
const TEAM_GROUP_PADDING_TOP = 62
const TEAM_GROUP_PADDING_BOTTOM = 38
const TEAM_GROUP_GAP_X = 34
const TEAM_GROUP_GAP_Y = 34

function teamGroupParticipants(
  team: AgentTopologyTeamInspector,
  availableAgentIds: Set<string>,
): Array<{ agentId: string; role: "lead" | "member" }> {
  const leadAgentId = team.leadAgentId || team.ownerAgentId
  const configuredActiveMemberAgentIds = team.builder.candidates
    .filter((candidate) => candidate.configuredMember && candidate.active)
    .map((candidate) => candidate.agentId)
  const memberAgentIds = uniqueTopologyIds([
    ...configuredActiveMemberAgentIds,
    ...team.activeMemberAgentIds,
    ...team.members.filter((member) => member.active).map((member) => member.agentId),
  ])
    .filter((agentId) => agentId !== leadAgentId)
    .filter((agentId) => availableAgentIds.has(agentId))
  return [
    ...(leadAgentId && availableAgentIds.has(leadAgentId)
      ? [{ agentId: leadAgentId, role: "lead" as const }]
      : []),
    ...memberAgentIds.map((agentId) => ({ agentId, role: "member" as const })),
  ]
}

function teamGroupColumnCount(memberCount: number): number {
  if (memberCount <= 0) return 0
  if (memberCount <= 3) return memberCount
  return Math.min(3, Math.ceil(Math.sqrt(memberCount)))
}

function teamGroupLayout(
  team: AgentTopologyTeamInspector,
  teamNode: AgentTopologyNode,
  availableAgentIds: Set<string>,
): {
  x: number
  y: number
  width: number
  height: number
  memberCount: number
  memberPositions: Map<string, AgentTopologyPosition>
  memberRoles: Map<string, "lead" | "member">
} | null {
  const participants = teamGroupParticipants(team, availableAgentIds)
  if (participants.length === 0) return null
  const columns = teamGroupColumnCount(participants.length)
  const rows = Math.ceil(participants.length / columns)
  const width =
    TEAM_GROUP_PADDING_X * 2 +
    columns * AGENT_NODE_WIDTH +
    Math.max(0, columns - 1) * TEAM_GROUP_GAP_X
  const height =
    TEAM_GROUP_PADDING_TOP +
    rows * AGENT_NODE_HEIGHT +
    Math.max(0, rows - 1) * TEAM_GROUP_GAP_Y +
    TEAM_GROUP_PADDING_BOTTOM
  const memberPositions = new Map<string, AgentTopologyPosition>()
  const memberRoles = new Map<string, "lead" | "member">()
  participants.forEach(({ agentId, role }, index) => {
    const column = index % columns
    const row = Math.floor(index / columns)
    memberPositions.set(agentId, {
      x: teamNode.position.x + TEAM_GROUP_PADDING_X + column * (AGENT_NODE_WIDTH + TEAM_GROUP_GAP_X),
      y: teamNode.position.y + TEAM_GROUP_PADDING_TOP + row * (AGENT_NODE_HEIGHT + TEAM_GROUP_GAP_Y),
    })
    memberRoles.set(agentId, role)
  })
  return {
    x: teamNode.position.x,
    y: teamNode.position.y,
    width,
    height,
    memberCount: participants.filter((participant) => participant.role === "member").length,
    memberPositions,
    memberRoles,
  }
}

function topologyTeamLayouts(
  projection: AgentTopologyProjection,
): {
  groupsByTeamId: Map<string, ReturnType<typeof teamGroupLayout>>
  memberPositionsByAgentId: Map<string, AgentTopologyPosition>
  memberTeamIdsByAgentId: Map<string, string>
  memberRolesByAgentId: Map<string, "lead" | "member">
} {
  const groupsByTeamId = new Map<string, ReturnType<typeof teamGroupLayout>>()
  const memberPositionsByAgentId = new Map<string, AgentTopologyPosition>()
  const memberTeamIdsByAgentId = new Map<string, string>()
  const memberRolesByAgentId = new Map<string, "lead" | "member">()
  const availableAgentIds = new Set(
    projection.nodes
      .filter((node) => node.kind === "nobie" || node.kind === "sub_agent")
      .map((node) => node.entityId),
  )
  for (const node of projection.nodes) {
    if (node.kind !== "team") continue
    const team = projection.inspectors.teams[node.entityId]
    if (!team) continue
    const group = teamGroupLayout(team, node, availableAgentIds)
    groupsByTeamId.set(node.entityId, group)
    if (!group) continue
    for (const [agentId, position] of group.memberPositions.entries()) {
      if (!memberPositionsByAgentId.has(agentId)) memberPositionsByAgentId.set(agentId, position)
      if (!memberTeamIdsByAgentId.has(agentId)) memberTeamIdsByAgentId.set(agentId, node.entityId)
      if (!memberRolesByAgentId.has(agentId)) {
        memberRolesByAgentId.set(agentId, group.memberRoles.get(agentId) ?? "member")
      }
    }
  }
  return { groupsByTeamId, memberPositionsByAgentId, memberTeamIdsByAgentId, memberRolesByAgentId }
}

function teamMemberPosition(
  node: AgentTopologyNode,
  memberPositionsByAgentId: Map<string, AgentTopologyPosition>,
): AgentTopologyPosition {
  const teamPosition = memberPositionsByAgentId.get(node.entityId)
  if (teamPosition) return teamPosition
  return { x: node.position.x, y: node.position.y }
}

function agentIdFromTopologyNodeId(nodeId: string): string | null {
  return nodeId.startsWith("agent:") ? nodeId.slice("agent:".length) : null
}

function visualEdgeEndpoint(
  nodeId: string,
  memberTeamIdsByAgentId: Map<string, string>,
): string {
  const agentId = agentIdFromTopologyNodeId(nodeId)
  if (!agentId) return nodeId
  const teamId = memberTeamIdsByAgentId.get(agentId)
  return teamId ? `team:${teamId}` : nodeId
}

export function buildTopologyFlowElements(
  projection: AgentTopologyProjection | null,
  options: TopologyFlowOptions = {},
): TopologyFlowElements {
  if (!projection) return { nodes: [], edges: [] }
  const workingAgentIds = options.workingAgentIds ?? new Set<string>()
  const {
    groupsByTeamId,
    memberPositionsByAgentId,
    memberTeamIdsByAgentId,
    memberRolesByAgentId,
  } = topologyTeamLayouts(projection)
  const visualEdges: Array<Edge<TopologyFlowEdgeData>> = []
  const visualEdgeKeys = new Set<string>()
  for (const edge of projection.edges) {
    if (edge.kind === "team_membership") continue
    const source = visualEdgeEndpoint(edge.source, memberTeamIdsByAgentId)
    const target = visualEdgeEndpoint(edge.target, memberTeamIdsByAgentId)
    if (source === target) continue
    const key = `${edge.kind}:${edge.style}:${source}->${target}`
    if (visualEdgeKeys.has(key)) continue
    visualEdgeKeys.add(key)
    visualEdges.push({
      id: edge.id,
      source,
      target,
      type: "smoothstep",
      animated: false,
      label: edge.label,
      style: topologyEdgeVisualStyle(edge.valid ? edge.style : "invalid"),
      data: {
        kind: edge.kind,
        style: edge.valid ? edge.style : "invalid",
        valid: edge.valid,
        diagnostics: edge.diagnostics.map((diagnostic) => diagnostic.reasonCode),
        raw: edge,
      },
    })
  }
  return {
    nodes: projection.nodes
      .filter((node) => node.kind !== "team_role" && node.kind !== "team_lead")
      .map((node) => {
        const group = node.kind === "team" ? (groupsByTeamId.get(node.entityId) ?? null) : null
        const teamGroupId = memberTeamIdsByAgentId.get(node.entityId)
        const teamGroupRole = memberRolesByAgentId.get(node.entityId) ?? "member"
        const agentWorking = workingAgentIds.has(node.entityId)
        const groupWorking = group
          ? [...group.memberRoles.keys()].some((agentId) => workingAgentIds.has(agentId))
          : false
        const badges = teamGroupId
          ? node.badges.filter((badge) => badge.toLowerCase() !== "candidate")
          : node.badges
        const position = group
          ? { x: group.x, y: group.y }
          : teamMemberPosition(node, memberPositionsByAgentId)
        return {
          id: node.id,
          type: "topologyNode",
          position,
          draggable: memberTeamIdsByAgentId.has(node.entityId)
            ? memberRolesByAgentId.get(node.entityId) !== "lead"
            : true,
          selectable: true,
          zIndex: node.kind === "team" ? 0 : 2,
          ...(group
            ? { style: { width: group.width, height: group.height } }
            : teamGroupId
              ? { style: { width: AGENT_NODE_WIDTH, minHeight: AGENT_NODE_HEIGHT } }
              : {}),
          data: {
            kind: node.kind,
            entityId: node.entityId,
            label: node.label,
            ...(node.status ? { status: node.status } : {}),
            ...(agentWorking || groupWorking ? { working: true } : {}),
            ...(group ? { group: true, groupMemberCount: group.memberCount } : {}),
            ...(teamGroupId
              ? {
                  teamGroupId,
                  teamGroupRole,
                }
              : {}),
            badges: [
              ...badges,
              ...(teamGroupId ? [teamGroupRole] : []),
            ],
            diagnostics: node.diagnostics.map((diagnostic) => diagnostic.reasonCode),
            raw: node,
          },
        }
      }),
    edges: visualEdges,
  }
}

export function mergeTopologyFlowNodesWithCurrentPositions(
  nextNodes: Array<Node<TopologyFlowNodeData>>,
  currentNodes: Array<Node<TopologyFlowNodeData>>,
): Array<Node<TopologyFlowNodeData>> {
  if (currentNodes.length === 0) return nextNodes
  const currentById = new Map(currentNodes.map((node) => [node.id, node]))
  const teamOffsets = new Map<string, { x: number; y: number }>()
  for (const nextNode of nextNodes) {
    if (nextNode.data.kind !== "team") continue
    const currentNode = currentById.get(nextNode.id)
    if (!currentNode) continue
    const offset = {
      x: currentNode.position.x - nextNode.position.x,
      y: currentNode.position.y - nextNode.position.y,
    }
    if (offset.x !== 0 || offset.y !== 0) teamOffsets.set(nextNode.data.entityId, offset)
  }

  return nextNodes.map((nextNode) => {
    const currentNode = currentById.get(nextNode.id)
    if (nextNode.data.teamGroupId) {
      const offset = teamOffsets.get(nextNode.data.teamGroupId)
      return {
        ...nextNode,
        position: offset
          ? {
              x: nextNode.position.x + offset.x,
              y: nextNode.position.y + offset.y,
            }
          : nextNode.position,
        ...(currentNode?.selected === undefined ? {} : { selected: currentNode.selected }),
      }
    }
    return currentNode
      ? {
          ...nextNode,
          position: currentNode.position,
          ...(currentNode.selected === undefined ? {} : { selected: currentNode.selected }),
        }
      : nextNode
  })
}

function numberFromNodeStyleValue(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value
  if (typeof value === "string") {
    const parsed = Number.parseFloat(value)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

function topologyFlowNodeSize(node: Node<TopologyFlowNodeData>): { width: number; height: number } {
  const measured = (node as Node<TopologyFlowNodeData> & {
    measured?: { width?: number; height?: number }
    width?: number
    height?: number
  }).measured
  const width =
    (node as Node<TopologyFlowNodeData> & { width?: number }).width ??
    measured?.width ??
    numberFromNodeStyleValue(node.style?.width) ??
    numberFromNodeStyleValue(node.style?.minWidth) ??
    AGENT_NODE_WIDTH
  const height =
    (node as Node<TopologyFlowNodeData> & { height?: number }).height ??
    measured?.height ??
    numberFromNodeStyleValue(node.style?.height) ??
    numberFromNodeStyleValue(node.style?.minHeight) ??
    AGENT_NODE_HEIGHT
  return { width, height }
}

function topologyNodeOverlapRatio(
  leftNode: Node<TopologyFlowNodeData>,
  rightNode: Node<TopologyFlowNodeData>,
): number {
  const leftSize = topologyFlowNodeSize(leftNode)
  const rightSize = topologyFlowNodeSize(rightNode)
  const leftRight = leftNode.position.x + leftSize.width
  const leftBottom = leftNode.position.y + leftSize.height
  const rightRight = rightNode.position.x + rightSize.width
  const rightBottom = rightNode.position.y + rightSize.height
  const overlapWidth = Math.max(
    0,
    Math.min(leftRight, rightRight) - Math.max(leftNode.position.x, rightNode.position.x),
  )
  const overlapHeight = Math.max(
    0,
    Math.min(leftBottom, rightBottom) - Math.max(leftNode.position.y, rightNode.position.y),
  )
  const leftArea = leftSize.width * leftSize.height
  return leftArea > 0 ? (overlapWidth * overlapHeight) / leftArea : 0
}

function topologyNodeOverlapsNode(
  leftNode: Node<TopologyFlowNodeData>,
  rightNode: Node<TopologyFlowNodeData>,
): boolean {
  return topologyNodeOverlapRatio(leftNode, rightNode) >= 0.25
}

function topologyNodeCenterInsideNode(
  innerNode: Node<TopologyFlowNodeData>,
  outerNode: Node<TopologyFlowNodeData>,
): boolean {
  const innerSize = topologyFlowNodeSize(innerNode)
  const outerSize = topologyFlowNodeSize(outerNode)
  const center = {
    x: innerNode.position.x + innerSize.width / 2,
    y: innerNode.position.y + innerSize.height / 2,
  }
  return (
    center.x >= outerNode.position.x &&
    center.x <= outerNode.position.x + outerSize.width &&
    center.y >= outerNode.position.y &&
    center.y <= outerNode.position.y + outerSize.height
  )
}

function topologyNodeFullyInsideNode(
  innerNode: Node<TopologyFlowNodeData>,
  outerNode: Node<TopologyFlowNodeData>,
): boolean {
  const innerSize = topologyFlowNodeSize(innerNode)
  const outerSize = topologyFlowNodeSize(outerNode)
  const tolerance = 2
  return (
    innerNode.position.x >= outerNode.position.x - tolerance &&
    innerNode.position.y >= outerNode.position.y - tolerance &&
    innerNode.position.x + innerSize.width <= outerNode.position.x + outerSize.width + tolerance &&
    innerNode.position.y + innerSize.height <= outerNode.position.y + outerSize.height + tolerance
  )
}

export function resolveTopologyNodeDragDropIntent(
  draggedNode: Node<TopologyFlowNodeData>,
  nodes: Array<Node<TopologyFlowNodeData>>,
): TopologyNodeDragDropIntent {
  if (draggedNode.data.kind !== "sub_agent") return { kind: "none" }
  if (draggedNode.data.teamGroupId) {
    if (draggedNode.data.teamGroupRole === "lead") return { kind: "none" }
    const teamNode = nodes.find(
      (node) => node.data.kind === "team" && node.data.entityId === draggedNode.data.teamGroupId,
    )
    if (!teamNode || topologyNodeFullyInsideNode(draggedNode, teamNode)) return { kind: "none" }
    return {
      kind: "deactivate_team_membership",
      teamId: draggedNode.data.teamGroupId,
      agentId: draggedNode.data.entityId,
    }
  }

  const memberTarget = nodes.find(
    (node) =>
      node.id !== draggedNode.id &&
      Boolean(node.data.teamGroupId) &&
      topologyNodeOverlapsNode(draggedNode, node),
  )
  const targetTeamId =
    memberTarget?.data.teamGroupId ??
    nodes.find(
      (node) =>
        node.id !== draggedNode.id &&
        node.data.kind === "team" &&
        (topologyNodeCenterInsideNode(draggedNode, node) ||
          topologyNodeOverlapsNode(draggedNode, node)),
    )?.data.entityId
  return targetTeamId
    ? {
        kind: "activate_team_membership",
        teamId: targetTeamId,
        agentId: draggedNode.data.entityId,
      }
    : { kind: "none" }
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

function compositionItemFromNode(node: AgentTopologyNode): TopologyCompositionItem {
  return {
    id: node.entityId,
    label: node.label,
    ...(node.status ? { status: node.status } : {}),
  }
}

function compositionItemFromTeam(team: AgentTopologyTeamInspector): TopologyCompositionItem {
  return {
    id: team.teamId,
    label: team.nickname ?? team.displayName,
    status: team.status,
  }
}

function sortCompositionItems(items: TopologyCompositionItem[]): TopologyCompositionItem[] {
  return [...items].sort((left, right) => left.label.localeCompare(right.label))
}

export function buildTopologyAgentComposition(
  projection: AgentTopologyProjection,
  agentId: string,
): TopologyAgentComposition {
  const nodeById = new Map(projection.nodes.map((node) => [node.id, node]))
  const selectedNode = projection.nodes.find(
    (node) => (node.kind === "nobie" || node.kind === "sub_agent") && node.entityId === agentId,
  )
  const selectedNodeId = selectedNode?.id ?? ""
  const hierarchyEdges = projection.edges.filter((edge) => edge.kind === "parent_child")
  const parentEdge = hierarchyEdges.find((edge) => edge.target === selectedNodeId)
  const parentNodeFromHierarchy = parentEdge ? nodeById.get(parentEdge.source) : undefined
  const teams = Object.values(projection.inspectors.teams)
  const parentTeam = teams.find((team) =>
    team.activeMemberAgentIds.includes(agentId) || team.memberAgentIds.includes(agentId),
  )
  const parentNode =
    parentNodeFromHierarchy ??
    (parentTeam
      ? projection.nodes.find(
          (node) =>
            (node.kind === "nobie" || node.kind === "sub_agent") &&
            node.entityId === parentTeam.ownerAgentId,
        )
      : undefined)
  const hierarchyChildren = hierarchyEdges
    .filter((edge) => edge.source === selectedNodeId)
    .map((edge) => nodeById.get(edge.target))
    .filter((node): node is AgentTopologyNode => Boolean(node))
    .map(compositionItemFromNode)
  const ownedTeamChildIds = teams
    .filter((team) => team.ownerAgentId === agentId)
    .flatMap((team) => team.builder.directChildAgentIds)
  const teamChildren = ownedTeamChildIds
    .map((childAgentId) =>
      projection.nodes.find(
        (node) =>
          (node.kind === "nobie" || node.kind === "sub_agent") &&
          node.entityId === childAgentId,
      ),
    )
    .filter((node): node is AgentTopologyNode => Boolean(node))
    .map(compositionItemFromNode)
  const childrenById = new Map(
    [...hierarchyChildren, ...teamChildren].map((child) => [child.id, child]),
  )

  return {
    ...(parentNode ? { parent: compositionItemFromNode(parentNode) } : {}),
    children: sortCompositionItems([...childrenById.values()]),
    ownedTeams: sortCompositionItems(
      teams.filter((team) => team.ownerAgentId === agentId).map(compositionItemFromTeam),
    ),
    activeTeams: sortCompositionItems(
      teams
        .filter((team) => team.activeMemberAgentIds.includes(agentId))
        .map(compositionItemFromTeam),
    ),
    referenceTeams: sortCompositionItems(
      teams
        .filter(
          (team) =>
            team.memberAgentIds.includes(agentId) && !team.activeMemberAgentIds.includes(agentId),
        )
        .map(compositionItemFromTeam),
    ),
  }
}

export function buildTopologyAgentTeamAssignments(
  composition: TopologyAgentComposition,
): TopologyCompositionItem[] {
  const byId = new Map<string, TopologyCompositionItem>()
  for (const team of [
    ...composition.ownedTeams,
    ...composition.activeTeams,
    ...composition.referenceTeams,
  ]) {
    byId.set(team.id, team)
  }
  return sortCompositionItems([...byId.values()])
}

export function buildTopologyTeamCompositionSummary(
  projection: AgentTopologyProjection,
  team: AgentTopologyTeamInspector,
): TopologyTeamCompositionSummary {
  const ownerNode = projection.nodes.find(
    (node) =>
      (node.kind === "nobie" || node.kind === "sub_agent") && node.entityId === team.ownerAgentId,
  )
  const referenceMemberCount = team.members.filter((member) => !member.active).length
  const blockedCandidateCount = team.builder.candidates.filter(
    (candidate) => !candidate.canActivate,
  ).length
  return {
    owner: ownerNode
      ? compositionItemFromNode(ownerNode)
      : { id: team.ownerAgentId, label: team.ownerAgentId },
    directChildCount: team.builder.directChildAgentIds.length,
    candidateCount: team.builder.candidates.length,
    activeMemberCount: team.health.activeMemberCount,
    referenceMemberCount,
    blockedCandidateCount,
    executionCandidate: team.health.executionCandidate,
  }
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

export function updateTeamBuilderDraftRole(
  draft: AgentTopologyTeamMembershipDraft[],
  candidate: AgentTopologyTeamBuilderCandidate,
  primaryRole: string,
): AgentTopologyTeamMembershipDraft[] {
  const normalizedRole = primaryRole.trim() || "member"
  const existing = draft.find((item) => item.agentId === candidate.agentId)
  if (!existing) {
    return [
      ...draft,
      {
        agentId: candidate.agentId,
        active: candidate.active,
        primaryRole: normalizedRole,
        teamRoles: [normalizedRole],
        required: true,
      },
    ]
  }
  return draft.map((item) =>
    item.agentId === candidate.agentId
      ? { ...item, primaryRole: normalizedRole, teamRoles: [normalizedRole] }
      : item,
  )
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

export function buildTeamMembershipDraftForAgent(
  team: AgentTopologyTeamInspector,
  agentId: string,
  active: boolean,
): AgentTopologyTeamMembershipDraft[] {
  const draft = buildTeamBuilderDraft(team)
  const candidate = team.builder.candidates.find((item) => item.agentId === agentId)
  const existing = draft.find((item) => item.agentId === agentId)
  if (!active && !existing) return draft
  const primaryRole = existing?.primaryRole ?? candidate?.primaryRole ?? "member"
  const teamRoles =
    existing?.teamRoles ??
    (candidate && candidate.teamRoles.length > 0 ? candidate.teamRoles : [primaryRole])
  if (!existing) {
    return [...draft, { agentId, active, primaryRole, teamRoles, required: true }]
  }
  return draft.map((item) =>
    item.agentId === agentId ? { ...item, active, primaryRole, teamRoles } : item,
  )
}

export function buildTeamLeadershipDraft(
  team: AgentTopologyTeamInspector,
  leadAgentId: string,
  activeMemberAgentIds: string[],
): { draft: AgentTopologyTeamMembershipDraft[]; blockedReason?: string } {
  const activeIds = new Set(
    uniqueTopologyIds(activeMemberAgentIds.filter((agentId) => agentId !== leadAgentId)),
  )
  const configuredIds = new Set(
    uniqueTopologyIds([...team.memberAgentIds, ...activeIds].filter((agentId) => agentId !== leadAgentId)),
  )
  const candidatesById = new Map(
    team.builder.candidates.map((candidate) => [candidate.agentId, candidate]),
  )
  for (const agentId of activeIds) {
    const candidate = candidatesById.get(agentId)
    if (!candidate)
      return {
        draft: buildTeamBuilderDraft(team),
        blockedReason: "team_member_candidate_not_found",
      }
    if (!canActivateTeamCandidate(candidate))
      return { draft: buildTeamBuilderDraft(team), blockedReason: "owner_direct_child_required" }
  }
  return {
    draft: [...configuredIds]
      .map((agentId) => {
        const candidate = candidatesById.get(agentId)
        if (!candidate) return null
        const active = activeIds.has(agentId)
        const primaryRole = "member"
        return {
          agentId,
          active,
          primaryRole,
          teamRoles: [primaryRole],
          required: true,
        } satisfies AgentTopologyTeamMembershipDraft
      })
      .filter((item): item is AgentTopologyTeamMembershipDraft => Boolean(item)),
  }
}

export function buildTeamMembershipDraftWithCandidate(
  team: AgentTopologyTeamInspector,
  agentId: string,
  active: boolean,
): { draft: AgentTopologyTeamMembershipDraft[]; blockedReason?: string } {
  const draft = buildTeamBuilderDraft(team)
  const candidate = team.builder.candidates.find((item) => item.agentId === agentId)
  if (!candidate) return { draft, blockedReason: "team_member_candidate_not_found" }
  return updateTeamBuilderDraft(draft, candidate, active)
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
