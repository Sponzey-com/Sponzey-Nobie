import { createHash } from "node:crypto"
import { getConfig, type NobieConfig } from "../config/index.js"
import { listAgentRelationships } from "../db/index.js"
import {
  createLegacyTopologyRegistry,
  legacyTopologyEnvelopeToExecutorCompatibilityEnvelope,
  type LegacyNode,
  type LegacyRelation,
  type LegacyTopology,
  type LegacyTopologyEnvelope,
  type LegacyTopologyRegistryRecord,
  type LegacyTopologyRegistryStore,
} from "../topology/legacy-enterprise-topology-adapter.js"
import {
  buildExecutorProfileFromNode,
  buildOrchestrationRegistrySnapshot,
  normalizeExecutorProfile,
  type AgentRegistryEntry,
  type ExecutorProfile,
  type OrchestrationRegistrySnapshot,
  type RegistryServiceDependencies,
} from "./registry.js"

export const EXECUTION_GRAPH_ROOT_AGENT_ID = "agent:nobie" as const
export const WORKSPACE_DRAFT_TOPOLOGY_ID = "workspace:draft" as const

export type ExecutionGraphBuildMode = "workspace" | "active_deployment" | "db_config"
export type ExecutionGraphSource = "workspace_draft" | "active_topology" | "db_config"
export type ExecutionGraphIssueSeverity = "info" | "warning" | "invalid"
export type ExecutionGraphEdgeSource = "topology_relation" | "agent_relationship" | "unparented_root"

export interface ExecutionGraphValidationIssue {
  code: string
  severity: ExecutionGraphIssueSeverity
  message: string
  topologyId?: string
  topologyVersion?: number
  relationId?: string
  edgeId?: string
  agentId?: string
  parentAgentId?: string
  childAgentId?: string
}

export interface ExecutorRuntimeProjection {
  agentId: string
  displayName: string
  source: "topology" | "db" | "config"
  status: string
  delegationEnabled: boolean
  executionCandidate: boolean
  role: string
  specialtyTags: string[]
  topologyId?: string
  topologyVersion?: number
  executorId?: string
  executorProfile?: ExecutorProfile
  reasonCodes: string[]
}

export interface ExecutionGraphEdgeProjection {
  edgeId: string
  parentAgentId: string
  childAgentId: string
  source: ExecutionGraphEdgeSource
  executionCandidate: boolean
  reasonCodes: string[]
  relationId?: string
  relationshipStatus?: string
  topologyId?: string
  topologyVersion?: number
}

export interface ExecutionGraphTraceFields {
  execution_graph_id: string
  graph_source: ExecutionGraphSource
  current_executor_id: string
  available_executor_ids: string[]
}

export interface ExecutionGraphSnapshot {
  graphId: string
  graphSource: ExecutionGraphSource
  generatedAt: number
  rootAgentId: string
  currentExecutorId: string
  topologyId?: string
  topologyVersion?: number
  agentsById: Record<string, ExecutorRuntimeProjection>
  directChildAgentIdsByParent: Record<string, string[]>
  edgeIndex: Record<string, Record<string, ExecutionGraphEdgeProjection>>
  edges: ExecutionGraphEdgeProjection[]
  rootDirectChildAgentIds: string[]
  allRegisteredExecutorIds: string[]
  allActiveExecutorIds: string[]
  availableExecutorIds: string[]
  validationIssues: ExecutionGraphValidationIssue[]
  trace: ExecutionGraphTraceFields
}

export interface BuildExecutionGraphSnapshotInput {
  mode?: ExecutionGraphBuildMode
  currentExecutorId?: string
  rootAgentId?: string
  now?: () => number
  topologyRegistry?: LegacyTopologyRegistryStore
  registrySnapshot?: OrchestrationRegistrySnapshot
  loadRegistrySnapshot?: () => OrchestrationRegistrySnapshot
  registryDependencies?: RegistryServiceDependencies
  getConfig?: () => Pick<NobieConfig, "orchestration"> & Partial<Pick<NobieConfig, "ai">>
}

interface SelectedTopologyGraph {
  graphSource: "workspace_draft" | "active_topology"
  envelope: LegacyTopologyEnvelope
  issues: ExecutionGraphValidationIssue[]
}

function sortedUniqueStrings(values: Array<string | undefined>): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value?.trim())))]
    .sort((left, right) => left.localeCompare(right))
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`)
      .join(",")}}`
  }
  return JSON.stringify(value)
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex")
}

function rootAgentIdFromInput(input: BuildExecutionGraphSnapshotInput): string {
  if (input.rootAgentId?.trim()) return input.rootAgentId
  const cfg = input.getConfig?.() ?? getConfig()
  return cfg.orchestration.nobie?.agentId ?? EXECUTION_GRAPH_ROOT_AGENT_ID
}

function topologyAgentId(topologyId: string, nodeId: string): string {
  return `${topologyId}:${nodeId}`
}

function nodeDisplayName(node: LegacyNode): string {
  return node.displayName?.trim() || node.name.trim() || node.id
}

function metadataString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined
}

function nodeRole(node: LegacyNode): string {
  const metadata = node.metadata ?? {}
  return (
    metadataString(metadata.roleName) ??
    metadataString(metadata.role) ??
    metadataString(metadata.title) ??
    node.nodeType
  )
}

function nodeExecutionCandidate(node: LegacyNode): boolean {
  return node.status !== "archived" && node.status !== "inactive"
}

function relationExecutionCandidate(relation: LegacyRelation): boolean {
  return relation.status !== "archived" && relation.status !== "inactive"
}

function relationNodeRefId(
  relation: LegacyRelation,
  key: "from" | "to",
): string | undefined {
  const ref = (relation as unknown as Partial<Record<"from" | "to", unknown>>)[key]
  if (!ref || typeof ref !== "object" || Array.isArray(ref)) return undefined
  const record = ref as Record<string, unknown>
  return record.entityType === "node" && typeof record.id === "string" && record.id.trim()
    ? record.id
    : undefined
}

function activeTopologyRecords(records: LegacyTopologyRegistryRecord[]): LegacyTopologyRegistryRecord[] {
  return records
    .filter((record) => record.status === "active" && record.activeVersion !== undefined)
    .sort((left, right) => left.topologyId.localeCompare(right.topologyId))
}

function selectTopologyGraph(input: {
  mode: ExecutionGraphBuildMode
  registry: LegacyTopologyRegistryStore
}): SelectedTopologyGraph | undefined {
  if (input.mode === "db_config") return undefined

  const records = input.registry.listTopologies().filter((record) => record.status !== "archived")
  if (input.mode === "workspace") {
    const workspaceRecord = records.find((record) => record.topologyId === WORKSPACE_DRAFT_TOPOLOGY_ID)
    if (!workspaceRecord) return undefined
    const envelope = input.registry.exportTopology(workspaceRecord.topologyId)
    if (!envelope) {
      return {
        graphSource: "workspace_draft",
        envelope: emptyTopologyEnvelope(workspaceRecord),
        issues: [{
          code: "workspace_draft_export_failed",
          severity: "invalid",
          message: `Workspace draft topology ${WORKSPACE_DRAFT_TOPOLOGY_ID} could not be exported.`,
          topologyId: workspaceRecord.topologyId,
        }],
      }
    }
    return { graphSource: "workspace_draft", envelope, issues: [] }
  }

  const activeRecords = activeTopologyRecords(records)
  if (activeRecords.length !== 1) {
    const issue: ExecutionGraphValidationIssue = {
      code: activeRecords.length === 0 ? "active_topology_not_found" : "multiple_active_topologies_without_selection_policy",
      severity: activeRecords.length === 0 ? "invalid" : "invalid",
      message: activeRecords.length === 0
        ? "No active topology version is available for active deployment graph selection."
        : "Multiple active topologies are available, but no selection policy was provided.",
    }
    const firstActiveRecord = activeRecords[0]
    const emptyRecord = firstActiveRecord ?? {
      topologyId: "topology:active-selection",
      name: "Active topology selection",
      status: "inactive" as const,
      updatedAt: 0,
      createdAt: 0,
    }
    return {
      graphSource: "active_topology",
      envelope: emptyTopologyEnvelope(emptyRecord),
      issues: [issue],
    }
  }

  const activeRecord = activeRecords[0]
  if (!activeRecord || activeRecord.activeVersion === undefined) return undefined
  const envelope = input.registry.exportTopology(activeRecord.topologyId, activeRecord.activeVersion)
  if (!envelope) {
    return {
      graphSource: "active_topology",
      envelope: emptyTopologyEnvelope(activeRecord),
      issues: [{
        code: "active_topology_export_failed",
        severity: "invalid",
        message: `Active topology ${activeRecord.topologyId}@${activeRecord.activeVersion} could not be exported.`,
        topologyId: activeRecord.topologyId,
        topologyVersion: activeRecord.activeVersion,
      }],
    }
  }
  return { graphSource: "active_topology", envelope, issues: [] }
}

function emptyTopologyEnvelope(record: LegacyTopologyRegistryRecord): LegacyTopologyEnvelope {
  const topology: LegacyTopology = {
    schemaVersion: 1,
    entityType: "topology",
    id: record.topologyId,
    name: record.name,
    status: record.status,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    nodes: [],
    teams: [],
    orgUnits: [],
    positions: [],
    persons: [],
    memberships: [],
    authorityRules: [],
    responsibilities: [],
    systems: [],
    tools: [],
    processes: [],
    relations: [],
  }
  return {
    topologyRecord: record,
    version: {
      versionId: `${record.topologyId}@0`,
      topologyId: record.topologyId,
      version: record.activeVersion ?? 0,
      topology,
      sourceHash: "",
      validationSnapshotId: "",
      createdAt: record.updatedAt,
    },
    validationSnapshot: {
      snapshotId: "",
      topologyId: record.topologyId,
      versionId: `${record.topologyId}@0`,
      version: record.activeVersion ?? 0,
      executable: false,
      validation: {
        ok: false,
        executable: false,
        issueCounts: { info: 0, warning: 0, blocked: 0, invalid: 1 },
        issues: [],
      },
      createdAt: record.updatedAt,
    },
  }
}

function projectTopologyAgents(input: {
  envelope: LegacyTopologyEnvelope
  graphSource: "workspace_draft" | "active_topology"
}): Record<string, ExecutorRuntimeProjection> {
  const topology = input.envelope.version.topology
  const topologyVersion = input.envelope.version.version
  const agents: Record<string, ExecutorRuntimeProjection> = {}
  for (const node of topology.nodes) {
    if (node.status === "archived") continue
    const agentId = topologyAgentId(topology.id, node.id)
    const executionCandidate = nodeExecutionCandidate(node)
    const displayName = nodeDisplayName(node)
    agents[agentId] = {
      agentId,
      displayName,
      source: "topology",
      status: node.status,
      delegationEnabled: executionCandidate,
      executionCandidate,
      role: nodeRole(node),
      specialtyTags: sortedUniqueStrings([...node.tags, "topology", "executor"]),
      topologyId: topology.id,
      topologyVersion,
      executorId: node.id,
      executorProfile: buildExecutorProfileFromNode(node, { executorId: agentId, displayName }),
      reasonCodes: executionCandidate ? [] : [`node_${node.status}`],
    }
  }
  return agents
}

function projectRegistryAgent(agent: AgentRegistryEntry): ExecutorRuntimeProjection {
  const executionCandidate = agent.status === "enabled" && agent.delegationEnabled
  return {
    agentId: agent.agentId,
    displayName: agent.displayName,
    source: agent.source,
    status: agent.status,
    delegationEnabled: agent.delegationEnabled,
    executionCandidate,
    role: agent.role,
    specialtyTags: [...agent.specialtyTags],
    executorProfile: agent.executorProfile ?? normalizeExecutorProfile(undefined, {
      executorId: agent.agentId,
      displayName: agent.displayName,
      roleName: agent.role,
      definition: agent.config.personality,
      does: agent.specialtyTags,
      delegationScope: agent.specialtyTags,
      expectedOutputs: ["처리 결과"],
      declineCriteria: agent.avoidTasks,
      riskBoundary: agent.degradedReasonCodes,
    }),
    reasonCodes: executionCandidate ? [] : [
      ...(agent.status !== "enabled" ? [`agent_${agent.status}`] : []),
      ...(agent.delegationEnabled ? [] : ["delegation_disabled"]),
    ],
  }
}

function loadDbConfigRegistrySnapshot(input: BuildExecutionGraphSnapshotInput): OrchestrationRegistrySnapshot {
  if (input.registrySnapshot) return input.registrySnapshot
  if (input.loadRegistrySnapshot) return input.loadRegistrySnapshot()
  return buildOrchestrationRegistrySnapshot(input.registryDependencies)
}

function appendEdge(input: {
  edge: ExecutionGraphEdgeProjection
  agentsById: Record<string, ExecutorRuntimeProjection>
  edges: ExecutionGraphEdgeProjection[]
  directChildren: Map<string, Set<string>>
  issues: ExecutionGraphValidationIssue[]
}): void {
  input.edges.push(input.edge)
  const children = input.directChildren.get(input.edge.parentAgentId) ?? new Set<string>()
  children.add(input.edge.childAgentId)
  input.directChildren.set(input.edge.parentAgentId, children)
  if (!input.agentsById[input.edge.childAgentId]) {
    input.issues.push({
      code: "edge_child_missing",
      severity: "invalid",
      message: `Execution graph edge ${input.edge.edgeId} references missing child ${input.edge.childAgentId}.`,
      edgeId: input.edge.edgeId,
      parentAgentId: input.edge.parentAgentId,
      childAgentId: input.edge.childAgentId,
    })
  }
}

function appendValidationIssue(input: {
  issues: ExecutionGraphValidationIssue[]
  issue: ExecutionGraphValidationIssue
  legacyCode?: string
}): void {
  input.issues.push(input.issue)
  if (!input.legacyCode) return
  input.issues.push({
    ...input.issue,
    code: input.legacyCode,
  })
}

function relationChildIdsByParent(topology: LegacyTopology): Record<string, string[]> {
  const result = new Map<string, Set<string>>()
  const nodeIds = new Set(topology.nodes.filter((node) => node.status !== "archived").map((node) => node.id))
  for (const relation of topology.relations) {
    if (relation.relationType !== "delegates_to" || !relationExecutionCandidate(relation)) continue
    const fromNodeId = relationNodeRefId(relation, "from")
    const toNodeId = relationNodeRefId(relation, "to")
    if (!fromNodeId || !toNodeId || !nodeIds.has(fromNodeId) || !nodeIds.has(toNodeId)) continue
    const children = result.get(fromNodeId) ?? new Set<string>()
    children.add(toNodeId)
    result.set(fromNodeId, children)
  }
  return Object.fromEntries(
    [...result.entries()].map(([parentId, childIds]) => [
      parentId,
      [...childIds].sort((left, right) => left.localeCompare(right)),
    ]),
  )
}

function appendChildrenRelationMismatchIssues(input: {
  topology: LegacyTopology
  topologyVersion: number
  issues: ExecutionGraphValidationIssue[]
}): void {
  const relationChildren = relationChildIdsByParent(input.topology)
  for (const node of input.topology.nodes) {
    if (node.status === "archived") continue
    const metadataChildren = sortedUniqueStrings(node.children ?? [])
    const projectedChildren = relationChildren[node.id] ?? []
    if (metadataChildren.join("\u0000") === projectedChildren.join("\u0000")) continue
    input.issues.push({
      code: "children_relation_mismatch",
      severity: "warning",
      message:
        `Topology node ${node.id} children metadata differs from delegates_to relations. Relations are used as source of truth.`,
      topologyId: input.topology.id,
      topologyVersion: input.topologyVersion,
      agentId: topologyAgentId(input.topology.id, node.id),
    })
  }
}

function cycleEdgeIds(edges: ExecutionGraphEdgeProjection[]): Set<string> {
  const adjacency = new Map<string, string[]>()
  const edgeIdByPair = new Map<string, string>()
  for (const edge of edges) {
    if (edge.source !== "topology_relation" || !edge.executionCandidate) continue
    const children = adjacency.get(edge.parentAgentId) ?? []
    children.push(edge.childAgentId)
    adjacency.set(edge.parentAgentId, children)
    edgeIdByPair.set(`${edge.parentAgentId}\u0000${edge.childAgentId}`, edge.edgeId)
  }

  const result = new Set<string>()
  const visit = (nodeId: string, path: string[], pathSet: Set<string>): void => {
    if (pathSet.has(nodeId)) {
      const cycleStartIndex = path.indexOf(nodeId)
      const cyclePath = cycleStartIndex >= 0 ? path.slice(cycleStartIndex) : path
      for (let index = 0; index < cyclePath.length; index += 1) {
        const from = cyclePath[index]
        const to = cyclePath[(index + 1) % cyclePath.length]
        const edgeId = edgeIdByPair.get(`${from}\u0000${to}`)
        if (edgeId) result.add(edgeId)
      }
      return
    }
    const nextIds = adjacency.get(nodeId) ?? []
    if (nextIds.length === 0) return
    const nextPath = [...path, nodeId]
    const nextPathSet = new Set(pathSet)
    nextPathSet.add(nodeId)
    for (const nextId of nextIds) visit(nextId, nextPath, nextPathSet)
  }

  for (const nodeId of adjacency.keys()) visit(nodeId, [], new Set<string>())
  return result
}

function markCycleEdges(input: {
  topology: LegacyTopology
  topologyVersion: number
  edges: ExecutionGraphEdgeProjection[]
  issues: ExecutionGraphValidationIssue[]
}): void {
  const edgeIds = cycleEdgeIds(input.edges)
  if (edgeIds.size === 0) return
  for (const edge of input.edges) {
    if (!edgeIds.has(edge.edgeId)) continue
    edge.executionCandidate = false
    edge.reasonCodes = sortedUniqueStrings([...edge.reasonCodes, "cycle_detected"])
  }
  input.issues.push({
    code: "cycle_detected",
    severity: "invalid",
    message: "Topology relation graph contains a delegation cycle. Cycle edges are excluded from automatic execution candidates.",
    topologyId: input.topology.id,
    topologyVersion: input.topologyVersion,
  })
}

function appendTopologyEdges(input: {
  envelope: LegacyTopologyEnvelope
  agentsById: Record<string, ExecutorRuntimeProjection>
  rootAgentId: string
  edges: ExecutionGraphEdgeProjection[]
  directChildren: Map<string, Set<string>>
  issues: ExecutionGraphValidationIssue[]
}): void {
  const topology = input.envelope.version.topology
  const topologyVersion = input.envelope.version.version
  const nodeIds = new Set(topology.nodes.filter((node) => node.status !== "archived").map((node) => node.id))
  const incomingChildNodeIds = new Set<string>()
  const seenEdgeIds = new Set<string>()
  appendChildrenRelationMismatchIssues({
    topology,
    topologyVersion,
    issues: input.issues,
  })

  for (const relation of topology.relations) {
    if (relation.relationType !== "delegates_to" || !relationExecutionCandidate(relation)) continue
    const fromNodeId = relationNodeRefId(relation, "from")
    const toNodeId = relationNodeRefId(relation, "to")
    if (!fromNodeId || !toNodeId) {
      appendValidationIssue({
        issues: input.issues,
        legacyCode: "topology_relation_endpoint_missing",
        issue: {
          code: "missing_relation_endpoint",
          severity: "invalid",
          message: `Topology relation ${relation.id} is missing structured node from/to endpoints.`,
          topologyId: topology.id,
          topologyVersion,
          relationId: relation.id,
        },
      })
      continue
    }
    if (!nodeIds.has(fromNodeId) || !nodeIds.has(toNodeId)) {
      appendValidationIssue({
        issues: input.issues,
        legacyCode: "topology_relation_endpoint_missing",
        issue: {
          code: "missing_relation_endpoint",
          severity: "invalid",
          message: `Topology relation ${relation.id} references a missing node endpoint.`,
          topologyId: topology.id,
          topologyVersion,
          relationId: relation.id,
        },
      })
      continue
    }

    const parentAgentId = topologyAgentId(topology.id, fromNodeId)
    const childAgentId = topologyAgentId(topology.id, toNodeId)
    const edgeId = `topology:${topology.id}:${relation.id}`
    if (seenEdgeIds.has(edgeId)) continue
    seenEdgeIds.add(edgeId)
    incomingChildNodeIds.add(toNodeId)
    appendEdge({
      edge: {
        edgeId,
        parentAgentId,
        childAgentId,
        source: "topology_relation",
        executionCandidate: true,
        reasonCodes: [],
        relationId: relation.id,
        relationshipStatus: relation.status,
        topologyId: topology.id,
        topologyVersion,
      },
      agentsById: input.agentsById,
      edges: input.edges,
      directChildren: input.directChildren,
      issues: input.issues,
    })
  }
  markCycleEdges({
    topology,
    topologyVersion,
    edges: input.edges,
    issues: input.issues,
  })

  for (const node of topology.nodes) {
    if (node.status === "archived" || incomingChildNodeIds.has(node.id)) continue
    const childAgentId = topologyAgentId(topology.id, node.id)
    appendEdge({
      edge: {
        edgeId: `topology-root:${childAgentId}`,
        parentAgentId: input.rootAgentId,
        childAgentId,
        source: "unparented_root",
        executionCandidate: nodeExecutionCandidate(node),
        reasonCodes: nodeExecutionCandidate(node) ? [] : [`node_${node.status}`],
        topologyId: topology.id,
        topologyVersion,
      },
      agentsById: input.agentsById,
      edges: input.edges,
      directChildren: input.directChildren,
      issues: input.issues,
    })
  }
}

function appendDbConfigEdges(input: {
  agentsById: Record<string, ExecutorRuntimeProjection>
  rootAgentId: string
  edges: ExecutionGraphEdgeProjection[]
  directChildren: Map<string, Set<string>>
  issues: ExecutionGraphValidationIssue[]
}): void {
  const agentIds = new Set(Object.keys(input.agentsById))
  const linkedChildIds = new Set<string>()
  for (const relationship of listAgentRelationships({ status: "active" })) {
    const childKnown = agentIds.has(relationship.child_agent_id)
    const parentKnown = relationship.parent_agent_id === input.rootAgentId || agentIds.has(relationship.parent_agent_id)
    if (!childKnown || !parentKnown) {
      input.issues.push({
        code: "agent_relationship_endpoint_missing",
        severity: "warning",
        message: `Agent relationship ${relationship.edge_id} references an executor outside the db/config graph.`,
        edgeId: relationship.edge_id,
        parentAgentId: relationship.parent_agent_id,
        childAgentId: relationship.child_agent_id,
      })
      continue
    }
    linkedChildIds.add(relationship.child_agent_id)
    appendEdge({
      edge: {
        edgeId: relationship.edge_id,
        parentAgentId: relationship.parent_agent_id,
        childAgentId: relationship.child_agent_id,
        source: "agent_relationship",
        executionCandidate: true,
        reasonCodes: [],
        relationshipStatus: relationship.status,
      },
      agentsById: input.agentsById,
      edges: input.edges,
      directChildren: input.directChildren,
      issues: input.issues,
    })
  }

  for (const agentId of Object.keys(input.agentsById).sort((left, right) => left.localeCompare(right))) {
    if (linkedChildIds.has(agentId)) continue
    const agent = input.agentsById[agentId]
    appendEdge({
      edge: {
        edgeId: `db-config-root:${agentId}`,
        parentAgentId: input.rootAgentId,
        childAgentId: agentId,
        source: "unparented_root",
        executionCandidate: agent?.executionCandidate === true,
        reasonCodes: agent?.executionCandidate === true ? [] : ["executor_not_available"],
      },
      agentsById: input.agentsById,
      edges: input.edges,
      directChildren: input.directChildren,
      issues: input.issues,
    })
  }
}

function materializeDirectChildren(directChildren: Map<string, Set<string>>): Record<string, string[]> {
  const result: Record<string, string[]> = {}
  for (const [parentAgentId, childIds] of directChildren.entries()) {
    result[parentAgentId] = [...childIds].sort((left, right) => left.localeCompare(right))
  }
  return result
}

function materializeEdgeIndex(edges: ExecutionGraphEdgeProjection[]): Record<string, Record<string, ExecutionGraphEdgeProjection>> {
  const result: Record<string, Record<string, ExecutionGraphEdgeProjection>> = {}
  for (const edge of edges) {
    const children = result[edge.parentAgentId] ?? {}
    children[edge.childAgentId] = edge
    result[edge.parentAgentId] = children
  }
  return result
}

function buildGraphId(input: {
  graphSource: ExecutionGraphSource
  rootAgentId: string
  currentExecutorId: string
  topologyId?: string
  topologyVersion?: number
  agentsById: Record<string, ExecutorRuntimeProjection>
  edges: ExecutionGraphEdgeProjection[]
}): string {
  return `execution-graph:${sha256(stableStringify({
    graphSource: input.graphSource,
    rootAgentId: input.rootAgentId,
    currentExecutorId: input.currentExecutorId,
    topologyId: input.topologyId,
    topologyVersion: input.topologyVersion,
    agents: Object.keys(input.agentsById).sort(),
    edges: input.edges
      .map((edge) => ({
        edgeId: edge.edgeId,
        parentAgentId: edge.parentAgentId,
        childAgentId: edge.childAgentId,
        source: edge.source,
      }))
      .sort((left, right) => left.edgeId.localeCompare(right.edgeId)),
  })).slice(0, 24)}`
}

function finalizeSnapshot(input: {
  graphSource: ExecutionGraphSource
  generatedAt: number
  rootAgentId: string
  currentExecutorId: string
  topologyId?: string
  topologyVersion?: number
  agentsById: Record<string, ExecutorRuntimeProjection>
  edges: ExecutionGraphEdgeProjection[]
  directChildren: Map<string, Set<string>>
  validationIssues: ExecutionGraphValidationIssue[]
}): ExecutionGraphSnapshot {
  const directChildAgentIdsByParent = materializeDirectChildren(input.directChildren)
  const rootDirectChildAgentIds = directChildAgentIdsByParent[input.rootAgentId] ?? []
  const allRegisteredExecutorIds = Object.keys(input.agentsById).sort((left, right) => left.localeCompare(right))
  const allActiveExecutorIds = Object.values(input.agentsById)
    .filter((agent) => agent.executionCandidate)
    .map((agent) => agent.agentId)
    .sort((left, right) => left.localeCompare(right))
  const availableExecutorIds = (directChildAgentIdsByParent[input.currentExecutorId] ?? [])
    .filter((agentId) =>
      input.agentsById[agentId]?.executionCandidate === true
      && input.edges.some((edge) =>
        edge.parentAgentId === input.currentExecutorId
        && edge.childAgentId === agentId
        && edge.executionCandidate,
      )
    )
  const graphId = buildGraphId(input)
  return {
    graphId,
    graphSource: input.graphSource,
    generatedAt: input.generatedAt,
    rootAgentId: input.rootAgentId,
    currentExecutorId: input.currentExecutorId,
    ...(input.topologyId !== undefined ? { topologyId: input.topologyId } : {}),
    ...(input.topologyVersion !== undefined ? { topologyVersion: input.topologyVersion } : {}),
    agentsById: input.agentsById,
    directChildAgentIdsByParent,
    edgeIndex: materializeEdgeIndex(input.edges),
    edges: input.edges.sort(
      (left, right) =>
        left.parentAgentId.localeCompare(right.parentAgentId) ||
        left.childAgentId.localeCompare(right.childAgentId) ||
        left.edgeId.localeCompare(right.edgeId),
    ),
    rootDirectChildAgentIds,
    allRegisteredExecutorIds,
    allActiveExecutorIds,
    availableExecutorIds,
    validationIssues: input.validationIssues,
    trace: {
      execution_graph_id: graphId,
      graph_source: input.graphSource,
      current_executor_id: input.currentExecutorId,
      available_executor_ids: availableExecutorIds,
    },
  }
}

function buildTopologyExecutionGraphSnapshot(input: {
  selected: SelectedTopologyGraph
  rootAgentId: string
  currentExecutorId: string
  generatedAt: number
}): ExecutionGraphSnapshot {
  const adapted = legacyTopologyEnvelopeToExecutorCompatibilityEnvelope(input.selected.envelope)
  const selected: SelectedTopologyGraph = {
    ...input.selected,
    envelope: adapted.envelope,
    issues: [
      ...input.selected.issues,
      ...adapted.issues.map((issue): ExecutionGraphValidationIssue => ({ ...issue })),
    ],
  }
  const agentsById = projectTopologyAgents({
    envelope: selected.envelope,
    graphSource: selected.graphSource,
  })
  const edges: ExecutionGraphEdgeProjection[] = []
  const directChildren = new Map<string, Set<string>>()
  const validationIssues = [...selected.issues]
  appendTopologyEdges({
    envelope: selected.envelope,
    agentsById,
    rootAgentId: input.rootAgentId,
    edges,
    directChildren,
    issues: validationIssues,
  })
  return finalizeSnapshot({
    graphSource: selected.graphSource,
    generatedAt: input.generatedAt,
    rootAgentId: input.rootAgentId,
    currentExecutorId: input.currentExecutorId,
    topologyId: selected.envelope.version.topologyId,
    topologyVersion: selected.envelope.version.version,
    agentsById,
    edges,
    directChildren,
    validationIssues,
  })
}

function buildDbConfigExecutionGraphSnapshot(input: {
  buildInput: BuildExecutionGraphSnapshotInput
  rootAgentId: string
  currentExecutorId: string
  generatedAt: number
}): ExecutionGraphSnapshot {
  const registrySnapshot = loadDbConfigRegistrySnapshot(input.buildInput)
  const agentsById: Record<string, ExecutorRuntimeProjection> = {}
  for (const agent of registrySnapshot.agents) {
    if (agent.source === "topology") continue
    agentsById[agent.agentId] = projectRegistryAgent(agent)
  }
  const edges: ExecutionGraphEdgeProjection[] = []
  const directChildren = new Map<string, Set<string>>()
  const validationIssues = registrySnapshot.diagnostics.map((diagnostic): ExecutionGraphValidationIssue => ({
    code: diagnostic.code,
    severity: diagnostic.severity === "invalid" ? "invalid" : diagnostic.severity === "warning" ? "warning" : "info",
    message: diagnostic.message,
    ...(diagnostic.agentId !== undefined ? { agentId: diagnostic.agentId } : {}),
    ...(diagnostic.parentAgentId !== undefined ? { parentAgentId: diagnostic.parentAgentId } : {}),
    ...(diagnostic.childAgentId !== undefined ? { childAgentId: diagnostic.childAgentId } : {}),
  }))
  appendDbConfigEdges({
    agentsById,
    rootAgentId: input.rootAgentId,
    edges,
    directChildren,
    issues: validationIssues,
  })
  return finalizeSnapshot({
    graphSource: "db_config",
    generatedAt: input.generatedAt,
    rootAgentId: input.rootAgentId,
    currentExecutorId: input.currentExecutorId,
    agentsById,
    edges,
    directChildren,
    validationIssues,
  })
}

export function buildExecutionGraphSnapshot(
  input: BuildExecutionGraphSnapshotInput = {},
): ExecutionGraphSnapshot {
  const generatedAt = input.now?.() ?? Date.now()
  const rootAgentId = rootAgentIdFromInput(input)
  const currentExecutorId = input.currentExecutorId ?? rootAgentId
  const mode = input.mode ?? "workspace"
  const topologyRegistry = input.topologyRegistry ?? createLegacyTopologyRegistry(
    input.now ? { now: input.now } : {},
  )
  const selectedTopology = selectTopologyGraph({ mode, registry: topologyRegistry })
  if (selectedTopology) {
    return buildTopologyExecutionGraphSnapshot({
      selected: selectedTopology,
      rootAgentId,
      currentExecutorId,
      generatedAt,
    })
  }
  return buildDbConfigExecutionGraphSnapshot({
    buildInput: input,
    rootAgentId,
    currentExecutorId,
    generatedAt,
  })
}
