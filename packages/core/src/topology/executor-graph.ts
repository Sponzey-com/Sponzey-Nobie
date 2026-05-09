import type {
  EnterpriseMetadata,
  EnterpriseMetadataValue,
  EnterpriseRelation,
  EnterpriseRelationType,
  EnterpriseTimestamp,
  EnterpriseTopology,
  NodeContract,
  NodeType,
} from "../contracts/enterprise-topology.js"
import {
  ENTERPRISE_TOPOLOGY_SCHEMA_VERSION,
} from "../contracts/enterprise-topology.js"
import {
  applyEnterpriseTopologyGuiCommands,
  createEnterpriseTopologyGuiDraft,
  ENTERPRISE_TOPOLOGY_GUI_DRAFT_SCHEMA_VERSION,
  type EnterpriseTopologyGuiOperation,
} from "./gui-operations.js"
import {
  enterpriseRelationTypeToExecutorConnectionRelation,
  executorConnectionLabel,
  executorConnectionToSafeEnterpriseRelationType,
} from "./executor-relation-inference.js"
import {
  EXECUTOR_PROFILE_METADATA_KEY,
  buildExecutorProfileFromNode,
  normalizeExecutorProfile,
  type ExecutorProfile,
} from "./executor-profile.js"

export const EXECUTOR_GRAPH_SCHEMA_VERSION = 1 as const
export const EXECUTOR_GRAPH_METADATA_KEY = "executorGraph" as const

export type ExecutorGraphSchemaVersion = typeof EXECUTOR_GRAPH_SCHEMA_VERSION
export type ExecutorGraphMode = "simple" | "advanced"
export type ExecutorRuntimeMode =
  | "auto"
  | "human_check"
  | "approval"
  | "tool_execution"
  | "external"
  | "unknown"
export type ExecutorConnectionRelation =
  | "handoff"
  | "approval_request"
  | "report"
  | "collaboration"
  | "exception"
  | "reference"

export interface ExecutorGraphSourceOfTruth {
  editableProjection: "executor_graph"
  runtimeSourceOfTruth: "enterprise_topology"
  nodeContractBoundary: "node_contract"
  workOrderBoundary: "work_order"
  agentConfigRole: "runtime_option"
  projectionOnly: true
}

export interface ExecutorAdvancedMapping {
  nodeType: NodeType
  executorKind: "nobie" | "agent" | "team" | "tool" | "manual_approval" | "external"
  executorId?: string
  allowedToolIds?: string[]
  allowedSystemIds?: string[]
}

export interface ExecutorInferenceEvidence {
  schemaVersion: 1
  evidenceId: string
  executorId: string
  sourceNodeId?: string
  userDescription: {
    name: string
    description: string
  }
  normalizedUnderstanding: {
    runtimeMode: ExecutorRuntimeMode
    capabilities: string[]
    tools: string[]
    outputs: string[]
    successCriteria: string[]
  }
  confidence: number
  inferenceRuleIds: string[]
  understandingState: "draft" | "confirmed"
  understandingVersionBeforeConfirmation: string
  confirmedUnderstandingVersion?: string
  generatedAt?: EnterpriseTimestamp
}

export interface ExecutorDraft {
  id: string
  name: string
  description: string
  definitionQuickChips?: string[]
  position?: {
    x: number
    y: number
  }
  inferredRuntimeMode: ExecutorRuntimeMode
  inferredCapabilities: string[]
  inferredTools: string[]
  inferredOutputs: string[]
  inferredSuccessCriteria: string[]
  executorProfile?: ExecutorProfile
  confidence: number
  userConfirmed?: boolean
  confirmedUnderstandingVersion?: string
  sourceNodeId?: string
  advancedMapping?: ExecutorAdvancedMapping
  inferenceEvidence?: ExecutorInferenceEvidence
}

export interface ExecutorConnectionDraft {
  id: string
  fromExecutorId: string
  toExecutorId: string
  inferredRelation: ExecutorConnectionRelation
  label: "넘김" | "승인 요청" | "보고" | "협업" | "예외 처리" | "참고 요청"
  confidence: number
  userConfirmed: boolean
  sourceRelationId?: string
  advancedRelationType?: EnterpriseRelationType
}

export interface ExecutorSectionDraft {
  id: string
  name: string
  description: string
  executorIds: string[]
  sourceTeamId?: string
  collapsed?: boolean
}

export interface ExecutorGraphInferenceSummary {
  source: "enterprise_topology_projection" | "executor_graph_compile"
  confidence: number
  executorCount: number
  connectionCount: number
  issueCount: number
  generatedAt?: EnterpriseTimestamp
}

export interface ExecutorGraphIssue {
  severity: "error" | "warning"
  code:
    | "duplicate_executor_id"
    | "blank_executor_name"
    | "missing_connection_endpoint"
    | "duplicate_connection_id"
  message: string
  targetId?: string
}

export interface ExecutorGraphWorkspace {
  schemaVersion: ExecutorGraphSchemaVersion
  graphId: string
  topologyId: string
  name: string
  mode: ExecutorGraphMode
  executors: ExecutorDraft[]
  sections: ExecutorSectionDraft[]
  connections: ExecutorConnectionDraft[]
  selectedId: string | null
  inference: ExecutorGraphInferenceSummary
  compiledPreview: EnterpriseTopology | null
  latestRun: unknown | null
  issues: ExecutorGraphIssue[]
  sourceOfTruth: ExecutorGraphSourceOfTruth
}

export interface ExecutorGraphTopologyMetadata {
  schemaVersion: ExecutorGraphSchemaVersion
  graphId: string
  topologyId: string
  mode: ExecutorGraphMode
  source: "executor_graph"
  sourceOfTruth: "enterprise_topology"
  projectionOnly: true
  executorIds: string[]
  connectionIds: string[]
  sectionIds: string[]
  confirmedExecutorIds: string[]
  confidence: number
  updatedAt: EnterpriseTimestamp
  workspace: {
    executors: Array<Pick<
      ExecutorDraft,
      | "id"
      | "name"
      | "description"
      | "definitionQuickChips"
      | "position"
      | "inferredRuntimeMode"
      | "inferredCapabilities"
      | "inferredTools"
      | "inferredOutputs"
      | "inferredSuccessCriteria"
      | "executorProfile"
      | "confidence"
      | "userConfirmed"
      | "confirmedUnderstandingVersion"
      | "sourceNodeId"
      | "inferenceEvidence"
    >>
    connections: Array<Pick<
      ExecutorConnectionDraft,
      | "id"
      | "fromExecutorId"
      | "toExecutorId"
      | "inferredRelation"
      | "label"
      | "confidence"
      | "userConfirmed"
      | "sourceRelationId"
      | "advancedRelationType"
    >>
    sections: ExecutorSectionDraft[]
  }
}

export interface ExecutorGraphRollbackEvidence {
  kind: "nobie.executor_graph.rollback_projection"
  status: "passed" | "failed"
  topologyId: string
  expectedTopologyId?: string
  expectedTopologyVersion?: number
  expectedTopologyVersionId?: string
  actualTopologyVersion?: number
  actualTopologyVersionId?: string
  metadataProjectionRestored: boolean
  executorIdsMatch: boolean
  connectionIdsMatch: boolean
  confirmedUnderstandingRestored: boolean
  sourceOfTruthPreserved: boolean
  blockingFailures: string[]
}

export type ExecutorGraphCompileResult =
  | {
      ok: true
      topology: EnterpriseTopology
      operations: EnterpriseTopologyGuiOperation[]
      metadata: ExecutorGraphTopologyMetadata
      issues: []
    }
  | {
      ok: false
      topology: EnterpriseTopology
      operations: []
      metadata: null
      issues: ExecutorGraphIssue[]
    }

export interface CompileExecutorGraphOptions {
  baseTopology?: EnterpriseTopology | null
  now?: EnterpriseTimestamp
}

export const EXECUTOR_GRAPH_SOURCE_OF_TRUTH: ExecutorGraphSourceOfTruth = {
  editableProjection: "executor_graph",
  runtimeSourceOfTruth: "enterprise_topology",
  nodeContractBoundary: "node_contract",
  workOrderBoundary: "work_order",
  agentConfigRole: "runtime_option",
  projectionOnly: true,
}

function cloneTopology(topology: EnterpriseTopology): EnterpriseTopology {
  return structuredClone(topology)
}

function compactStrings(values: readonly string[] | undefined): string[] {
  return [...new Set((values ?? []).map((value) => value.trim()).filter(Boolean))]
}

function metadataStringArray(value: EnterpriseMetadataValue | undefined): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
}

function metadataNumber(value: EnterpriseMetadataValue | undefined, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback
}

function metadataBoolean(value: EnterpriseMetadataValue | undefined, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback
}

function metadataString(value: EnterpriseMetadataValue | undefined): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined
}

function metadataPosition(value: EnterpriseMetadataValue | undefined): ExecutorDraft["position"] | undefined {
  const record = metadataRecord(value)
  if (!record) return undefined
  const x = record.x
  const y = record.y
  return typeof x === "number" && Number.isFinite(x) && typeof y === "number" && Number.isFinite(y)
    ? { x, y }
    : undefined
}

function metadataRecord(value: EnterpriseMetadataValue | undefined): Record<string, EnterpriseMetadataValue | undefined> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  return value
}

function sourceNodeMetadata(node: NodeContract): Record<string, EnterpriseMetadataValue | undefined> | null {
  return metadataRecord(node.metadata?.[EXECUTOR_GRAPH_METADATA_KEY])
}

function sourceRelationMetadata(relation: EnterpriseRelation): Record<string, EnterpriseMetadataValue | undefined> | null {
  return metadataRecord(relation.metadata?.[EXECUTOR_GRAPH_METADATA_KEY])
}

function metadataInferenceEvidence(value: EnterpriseMetadataValue | undefined): ExecutorInferenceEvidence | undefined {
  const record = metadataRecord(value)
  if (!record || record.schemaVersion !== 1) return undefined
  if (typeof record.evidenceId !== "string" || typeof record.executorId !== "string") return undefined
  if (record.understandingState !== "draft" && record.understandingState !== "confirmed") return undefined
  return record as unknown as ExecutorInferenceEvidence
}

function averageConfidence(executors: readonly ExecutorDraft[], connections: readonly ExecutorConnectionDraft[]): number {
  const values = [
    ...executors.map((executor) => executor.confidence),
    ...connections.map((connection) => connection.confidence),
  ].filter((value) => Number.isFinite(value))
  if (values.length === 0) return 0
  return Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(3))
}

function runtimeModeForNode(node: NodeContract): ExecutorRuntimeMode {
  const metadata = sourceNodeMetadata(node)
  const metadataMode = metadataString(metadata?.inferredRuntimeMode)
  if (metadataMode && isExecutorRuntimeMode(metadataMode)) return metadataMode
  if (node.nodeType === "approval_node") return "approval"
  if (node.nodeType === "review_node" || node.nodeType === "decision_node") return "human_check"
  if (node.nodeType === "automation_node" || node.nodeType === "system_interface_node") return "tool_execution"
  if (node.nodeType === "external_node") return "external"
  return "auto"
}

function nodeTypeForRuntimeMode(executor: ExecutorDraft): NodeType {
  if (executor.advancedMapping?.nodeType) return executor.advancedMapping.nodeType
  if (executor.inferredRuntimeMode === "approval") return "approval_node"
  if (executor.inferredRuntimeMode === "human_check") return "review_node"
  if (executor.inferredRuntimeMode === "tool_execution") return "automation_node"
  if (executor.inferredRuntimeMode === "external") return "external_node"
  return "function"
}

function executorKindForRuntimeMode(mode: ExecutorRuntimeMode): ExecutorAdvancedMapping["executorKind"] {
  if (mode === "approval" || mode === "human_check") return "manual_approval"
  if (mode === "tool_execution") return "tool"
  if (mode === "external") return "external"
  return "nobie"
}

function successCriteriaForNode(node: NodeContract): string[] {
  const criteria = metadataStringArray(node.template?.metadata?.successCriteria)
  if (criteria.length > 0) return criteria
  return compactStrings(node.tags.length > 0 ? node.tags.map((tag) => `${tag} 처리`) : ["결과 요약"])
}

function outputsForNode(node: NodeContract): string[] {
  const outputs = metadataStringArray(node.template?.metadata?.outputs)
  if (outputs.length > 0) return outputs
  const outputPreset = metadataString(node.template?.metadata?.outputPreset)
  return outputPreset ? [outputPreset] : ["처리 결과"]
}

function executorProfileForExecutor(executor: ExecutorDraft): ExecutorProfile {
  return normalizeExecutorProfile(executor.executorProfile, {
    executorId: executor.id,
    displayName: executor.name,
    roleName: executor.executorProfile?.roleName ?? executor.advancedMapping?.executorKind ?? "executor",
    definition: executor.description,
    does: executor.definitionQuickChips?.length ? executor.definitionQuickChips : [executor.description],
    delegationScope: executor.inferredCapabilities,
    expectedOutputs: executor.inferredOutputs,
    handoffStyle: executor.executorProfile?.handoffStyle ?? "structured_handoff",
    declineCriteria: executor.executorProfile?.declineCriteria ?? [],
    riskBoundary: executor.executorProfile?.riskBoundary ?? [],
  })
}

function executorForNode(node: NodeContract): ExecutorDraft {
  const metadata = sourceNodeMetadata(node)
  const mode = runtimeModeForNode(node)
  const confidence = metadataNumber(metadata?.confidence, node.metadata?.importedFromAgentConfigId ? 0.55 : 0.72)
  const userConfirmed = metadataBoolean(metadata?.userConfirmed, false)
  const confirmedUnderstandingVersion = metadataString(metadata?.confirmedUnderstandingVersion)
  const executorResourceId = metadataString(metadata?.executorResourceId)
  const inferenceEvidence = metadataInferenceEvidence(metadata?.inferenceEvidence)
  const position = metadataPosition(metadata?.position)
  const definitionQuickChips = metadataStringArray(metadata?.definitionQuickChips)
  const name = node.displayName?.trim() || node.name
  const executorProfile = buildExecutorProfileFromNode(node, { executorId: node.id, displayName: name })
  return {
    id: metadataString(metadata?.executorId) ?? node.id,
    name,
    description: node.description !== undefined
      ? node.description
      : node.instruction?.trim() || node.nodeType,
    ...(definitionQuickChips.length > 0 ? { definitionQuickChips } : {}),
    ...(position ? { position } : {}),
    inferredRuntimeMode: mode,
    inferredCapabilities: compactStrings([...node.tags, ...metadataStringArray(metadata?.inferredCapabilities)]),
    inferredTools: compactStrings([...node.allowedToolIds, ...metadataStringArray(metadata?.inferredTools)]),
    inferredOutputs: outputsForNode(node),
    inferredSuccessCriteria: successCriteriaForNode(node),
    executorProfile,
    confidence,
    ...(userConfirmed ? { userConfirmed } : {}),
    ...(confirmedUnderstandingVersion ? { confirmedUnderstandingVersion } : {}),
    sourceNodeId: node.id,
    ...(inferenceEvidence ? { inferenceEvidence } : {}),
    advancedMapping: {
      nodeType: node.nodeType,
      executorKind: executorKindForRuntimeMode(mode),
      ...(executorResourceId ? { executorId: executorResourceId } : {}),
      allowedToolIds: [...node.allowedToolIds],
      allowedSystemIds: [...node.allowedSystemIds],
    },
  }
}

function inferredRelationForEnterpriseRelation(
  relation: EnterpriseRelation,
  targetNode?: NodeContract,
): ExecutorConnectionRelation | null {
  const metadata = sourceRelationMetadata(relation)
  const metadataRelation = metadataString(metadata?.inferredRelation)
  if (metadataRelation && isExecutorConnectionRelation(metadataRelation)) return metadataRelation
  if (relation.relationType === "delegates_to") {
    return targetNode?.nodeType === "approval_node" ? "approval_request" : "handoff"
  }
  return enterpriseRelationTypeToExecutorConnectionRelation(relation.relationType)
}

function connectionForRelation(
  relation: EnterpriseRelation,
  nodeById: Map<string, NodeContract>,
): ExecutorConnectionDraft | null {
  if (relation.status === "archived") return null
  if (relation.from.entityType !== "node" || relation.to.entityType !== "node") return null
  const targetNode = nodeById.get(relation.to.id)
  const inferredRelation = inferredRelationForEnterpriseRelation(relation, targetNode)
  if (!inferredRelation) return null
  const metadata = sourceRelationMetadata(relation)
  const confidence = metadataNumber(metadata?.confidence, 0.72)
  const userConfirmed = metadataBoolean(metadata?.userConfirmed, false)
  return {
    id: metadataString(metadata?.connectionId) ?? relation.id,
    fromExecutorId: relation.from.id,
    toExecutorId: relation.to.id,
    inferredRelation,
    label: executorConnectionLabel(inferredRelation),
    confidence,
    userConfirmed,
    sourceRelationId: relation.id,
    advancedRelationType: relation.relationType,
  }
}

function sectionForTeam(team: EnterpriseTopology["teams"][number]): ExecutorSectionDraft {
  return {
    id: team.id,
    name: team.displayName?.trim() || team.name,
    description: team.purpose ?? "실행자 영역",
    executorIds: [...team.nodeIds],
    sourceTeamId: team.id,
    collapsed: Boolean(team.metadata?.collapsed),
  }
}

function defaultGraphId(topologyId: string): string {
  return `executor-graph:${topologyId}`
}

export function buildExecutorGraphFromEnterpriseTopology(
  topology: EnterpriseTopology,
  options: { mode?: ExecutorGraphMode; now?: EnterpriseTimestamp } = {},
): ExecutorGraphWorkspace {
  const metadata = readExecutorGraphMetadata(topology)
  const activeNodes = topology.nodes.filter((node) => node.status !== "archived")
  const nodeById = new Map(activeNodes.map((node) => [node.id, node]))
  const executors = activeNodes.map((node) => executorForNode(node))
  const sections = topology.teams
    .filter((team) => team.status !== "archived")
    .map((team) => sectionForTeam(team))
  const connections = topology.relations
    .map((relation) => connectionForRelation(relation, nodeById))
    .filter((connection): connection is ExecutorConnectionDraft => Boolean(connection))
  const issues = validateExecutorGraphDraft({ executors, connections })
  const confidence = averageConfidence(executors, connections)

  return {
    schemaVersion: EXECUTOR_GRAPH_SCHEMA_VERSION,
    graphId: metadata?.graphId ?? defaultGraphId(topology.id),
    topologyId: topology.id,
    name: topology.name,
    mode: options.mode ?? metadata?.mode ?? "simple",
    executors,
    sections,
    connections,
    selectedId: null,
    inference: {
      source: "enterprise_topology_projection",
      confidence,
      executorCount: executors.length,
      connectionCount: connections.length,
      issueCount: issues.length,
      ...(options.now ? { generatedAt: options.now } : {}),
    },
    compiledPreview: null,
    latestRun: null,
    issues,
    sourceOfTruth: EXECUTOR_GRAPH_SOURCE_OF_TRUTH,
  }
}

function isExecutorRuntimeMode(value: string): value is ExecutorRuntimeMode {
  return value === "auto" ||
    value === "human_check" ||
    value === "approval" ||
    value === "tool_execution" ||
    value === "external" ||
    value === "unknown"
}

function isExecutorConnectionRelation(value: string): value is ExecutorConnectionRelation {
  return value === "handoff" ||
    value === "approval_request" ||
    value === "report" ||
    value === "collaboration" ||
    value === "exception" ||
    value === "reference"
}

function relationIdForConnection(connection: ExecutorConnectionDraft): string {
  if (connection.sourceRelationId) return connection.sourceRelationId
  if (connection.id.startsWith("relation:")) return connection.id
  return `relation:${connection.id}`
}

function defaultTopologyForGraph(graph: ExecutorGraphWorkspace, now: EnterpriseTimestamp): EnterpriseTopology {
  return {
    schemaVersion: ENTERPRISE_TOPOLOGY_SCHEMA_VERSION,
    entityType: "topology",
    id: graph.topologyId || graph.graphId.replace(/^executor-graph:/, "topology:"),
    name: graph.name || "Executor graph topology",
    status: "draft",
    createdAt: now,
    updatedAt: now,
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
}

function operationId(prefix: string, id: string, at: EnterpriseTimestamp): string {
  return `executor-graph:${prefix}:${id}:${String(at)}`
}

function declaredResourceIds(topology: EnterpriseTopology | null | undefined): {
  toolIds: ReadonlySet<string>
  systemIds: ReadonlySet<string>
} {
  return {
    toolIds: new Set(topology?.tools.filter((tool) => tool.status !== "archived").map((tool) => tool.id) ?? []),
    systemIds: new Set(topology?.systems.filter((system) => system.status !== "archived").map((system) => system.id) ?? []),
  }
}

export function buildExecutorGraphGuiOperations(
  graph: ExecutorGraphWorkspace,
  baseTopology?: EnterpriseTopology | null,
  options: { now?: EnterpriseTimestamp } = {},
): EnterpriseTopologyGuiOperation[] {
  const at = options.now ?? Date.now()
  const existingNodeIds = new Set(baseTopology?.nodes.map((node) => node.id) ?? [])
  const existingRelationIds = new Set(baseTopology?.relations.map((relation) => relation.id) ?? [])
  const executorById = new Map(graph.executors.map((executor) => [executor.id, executor]))
  const { toolIds, systemIds } = declaredResourceIds(baseTopology)
  const operations: EnterpriseTopologyGuiOperation[] = []

  for (const executor of graph.executors) {
    const nodeId = executor.sourceNodeId ?? executor.id
    const nodeType = nodeTypeForRuntimeMode(executor)
    const executorProfile = executorProfileForExecutor(executor)
    const allowedToolIds = compactStrings([
      ...(executor.advancedMapping?.allowedToolIds ?? []),
      ...executor.inferredTools.filter((toolId) => toolId.startsWith("tool:")),
    ]).filter((toolId) => toolIds.has(toolId))
    const allowedSystemIds = compactStrings(executor.advancedMapping?.allowedSystemIds ?? [])
      .filter((systemId) => systemIds.has(systemId))
    const template = {
      templateId: `executor-graph:${executor.id}`,
      source: "user_preset" as const,
      fixedRoleCatalog: false as const,
      metadata: {
        successCriteria: executor.inferredSuccessCriteria,
        outputs: executor.inferredOutputs,
        roleName: executorProfile.roleName,
        definition: executorProfile.definition,
        does: executorProfile.does,
        delegationScope: executorProfile.delegationScope,
        expectedOutputs: executorProfile.expectedOutputs,
        handoffStyle: executorProfile.handoffStyle,
        declineCriteria: executorProfile.declineCriteria,
        riskBoundary: executorProfile.riskBoundary,
        [EXECUTOR_PROFILE_METADATA_KEY]: executorProfile as unknown as EnterpriseMetadataValue,
        executorGraphId: graph.graphId,
      },
    }

    if (!existingNodeIds.has(nodeId)) {
      operations.push({
        schemaVersion: ENTERPRISE_TOPOLOGY_GUI_DRAFT_SCHEMA_VERSION,
        operationId: operationId("create-node", nodeId, at),
        op: "createNode",
        at,
        nodeId,
        name: executor.name,
        nodeType,
        templateId: template.templateId,
        label: `Create executor ${executor.name}`,
      })
    }

    operations.push({
      schemaVersion: ENTERPRISE_TOPOLOGY_GUI_DRAFT_SCHEMA_VERSION,
      operationId: operationId("update-node", nodeId, at),
      op: "updateNode",
      at,
      nodeId,
      label: `Update executor ${executor.name}`,
      patch: {
        name: executor.name,
        description: executor.description,
        nodeType,
        tags: executor.inferredCapabilities,
        template,
        allowedToolIds,
        allowedSystemIds,
      },
    })
  }

  for (const connection of graph.connections) {
    const relationId = relationIdForConnection(connection)
    const relationType = executorConnectionToSafeEnterpriseRelationType({
      connection,
      source: executorById.get(connection.fromExecutorId) ?? null,
      target: executorById.get(connection.toExecutorId) ?? null,
    })
    const from = { entityType: "node" as const, id: connection.fromExecutorId }
    const to = { entityType: "node" as const, id: connection.toExecutorId }
    if (!existingRelationIds.has(relationId)) {
      operations.push({
        schemaVersion: ENTERPRISE_TOPOLOGY_GUI_DRAFT_SCHEMA_VERSION,
        operationId: operationId("create-relation", relationId, at),
        op: "createRelation",
        at,
        relationId,
        relationType,
        from,
        to,
        label: connection.label,
        name: `${connection.fromExecutorId} ${connection.label} ${connection.toExecutorId}`,
      })
      continue
    }
    operations.push({
      schemaVersion: ENTERPRISE_TOPOLOGY_GUI_DRAFT_SCHEMA_VERSION,
      operationId: operationId("update-relation", relationId, at),
      op: "updateRelation",
      at,
      relationId,
      label: `Update executor connection ${relationId}`,
      patch: {
        relationType,
        from,
        to,
        label: connection.label,
      },
    })
  }

  return operations
}

function validateExecutorGraphDraft(input: {
  executors: readonly ExecutorDraft[]
  connections: readonly ExecutorConnectionDraft[]
}): ExecutorGraphIssue[] {
  const issues: ExecutorGraphIssue[] = []
  const executorIds = new Set<string>()
  const connectionIds = new Set<string>()

  for (const executor of input.executors) {
    if (executorIds.has(executor.id)) {
      issues.push({
        severity: "error",
        code: "duplicate_executor_id",
        message: `Duplicate executor id: ${executor.id}`,
        targetId: executor.id,
      })
    }
    executorIds.add(executor.id)
    if (!executor.name.trim()) {
      issues.push({
        severity: "warning",
        code: "blank_executor_name",
        message: `Executor requires a name: ${executor.id}`,
        targetId: executor.id,
      })
    }
  }

  for (const connection of input.connections) {
    if (connectionIds.has(connection.id)) {
      issues.push({
        severity: "error",
        code: "duplicate_connection_id",
        message: `Duplicate connection id: ${connection.id}`,
        targetId: connection.id,
      })
    }
    connectionIds.add(connection.id)
    if (!executorIds.has(connection.fromExecutorId) || !executorIds.has(connection.toExecutorId)) {
      issues.push({
        severity: "error",
        code: "missing_connection_endpoint",
        message: `Connection endpoint is missing: ${connection.id}`,
        targetId: connection.id,
      })
    }
  }

  return issues
}

function executorNodeMetadata(graph: ExecutorGraphWorkspace, executor: ExecutorDraft): EnterpriseMetadata {
  const executorProfile = executorProfileForExecutor(executor)
  return {
    executorId: executor.id,
    graphId: graph.graphId,
    inferredRuntimeMode: executor.inferredRuntimeMode,
    inferredCapabilities: executor.inferredCapabilities,
    inferredTools: executor.inferredTools,
    inferredOutputs: executor.inferredOutputs,
    [EXECUTOR_PROFILE_METADATA_KEY]: executorProfile as unknown as EnterpriseMetadataValue,
    ...(executor.definitionQuickChips?.length
      ? { definitionQuickChips: [...executor.definitionQuickChips] }
      : {}),
    confidence: executor.confidence,
    userConfirmed: executor.userConfirmed ?? false,
    ...(executor.confirmedUnderstandingVersion
      ? { confirmedUnderstandingVersion: executor.confirmedUnderstandingVersion }
      : {}),
    ...(executor.position ? { position: { x: executor.position.x, y: executor.position.y } } : {}),
    ...(executor.inferenceEvidence
      ? { inferenceEvidence: executor.inferenceEvidence as unknown as EnterpriseMetadataValue }
      : {}),
    sourceOfTruth: "enterprise_topology",
    projectionOnly: true,
  }
}

function connectionRelationMetadata(graph: ExecutorGraphWorkspace, connection: ExecutorConnectionDraft): EnterpriseMetadata {
  return {
    connectionId: connection.id,
    graphId: graph.graphId,
    inferredRelation: connection.inferredRelation,
    confidence: connection.confidence,
    userConfirmed: connection.userConfirmed,
    sourceOfTruth: "enterprise_topology",
    projectionOnly: true,
  }
}

function attachNodeAndRelationMetadata(topology: EnterpriseTopology, graph: ExecutorGraphWorkspace): EnterpriseTopology {
  const executorByNodeId = new Map(graph.executors.map((executor) => [executor.sourceNodeId ?? executor.id, executor]))
  const connectionByRelationId = new Map(graph.connections.map((connection) => [relationIdForConnection(connection), connection]))
  return {
    ...topology,
    nodes: topology.nodes.map((node) => {
      const executor = executorByNodeId.get(node.id)
      if (!executor) return node
      return {
        ...node,
        metadata: {
          ...(node.metadata ?? {}),
          [EXECUTOR_GRAPH_METADATA_KEY]: executorNodeMetadata(graph, executor),
        },
      }
    }),
    relations: topology.relations.map((relation) => {
      const connection = connectionByRelationId.get(relation.id)
      if (!connection) return relation
      return {
        ...relation,
        metadata: {
          ...(relation.metadata ?? {}),
          [EXECUTOR_GRAPH_METADATA_KEY]: connectionRelationMetadata(graph, connection),
        },
      }
    }),
  }
}

export function buildExecutorGraphTopologyMetadata(
  graph: ExecutorGraphWorkspace,
  options: { now?: EnterpriseTimestamp } = {},
): ExecutorGraphTopologyMetadata {
  const updatedAt = options.now ?? Date.now()
  return {
    schemaVersion: EXECUTOR_GRAPH_SCHEMA_VERSION,
    graphId: graph.graphId,
    topologyId: graph.topologyId,
    mode: graph.mode,
    source: "executor_graph",
    sourceOfTruth: "enterprise_topology",
    projectionOnly: true,
    executorIds: graph.executors.map((executor) => executor.id),
    connectionIds: graph.connections.map((connection) => connection.id),
    sectionIds: graph.sections.map((section) => section.id),
    confirmedExecutorIds: graph.executors.filter((executor) => executor.userConfirmed).map((executor) => executor.id),
    confidence: averageConfidence(graph.executors, graph.connections),
    updatedAt,
    workspace: {
      executors: graph.executors.map((executor) => ({
        id: executor.id,
        name: executor.name,
        description: executor.description,
        ...(executor.definitionQuickChips?.length
          ? { definitionQuickChips: [...executor.definitionQuickChips] }
          : {}),
        inferredRuntimeMode: executor.inferredRuntimeMode,
        inferredCapabilities: [...executor.inferredCapabilities],
        inferredTools: [...executor.inferredTools],
        inferredOutputs: [...executor.inferredOutputs],
        inferredSuccessCriteria: [...executor.inferredSuccessCriteria],
        executorProfile: executorProfileForExecutor(executor),
        confidence: executor.confidence,
        ...(executor.userConfirmed !== undefined ? { userConfirmed: executor.userConfirmed } : {}),
        ...(executor.confirmedUnderstandingVersion
          ? { confirmedUnderstandingVersion: executor.confirmedUnderstandingVersion }
          : {}),
        ...(executor.position ? { position: { x: executor.position.x, y: executor.position.y } } : {}),
        ...(executor.sourceNodeId ? { sourceNodeId: executor.sourceNodeId } : {}),
        ...(executor.inferenceEvidence ? { inferenceEvidence: structuredClone(executor.inferenceEvidence) } : {}),
      })),
      connections: graph.connections.map((connection) => ({
        id: connection.id,
        fromExecutorId: connection.fromExecutorId,
        toExecutorId: connection.toExecutorId,
        inferredRelation: connection.inferredRelation,
        label: connection.label,
        confidence: connection.confidence,
        userConfirmed: connection.userConfirmed,
        ...(connection.sourceRelationId ? { sourceRelationId: connection.sourceRelationId } : {}),
        ...(connection.advancedRelationType ? { advancedRelationType: connection.advancedRelationType } : {}),
      })),
      sections: graph.sections.map((section) => ({ ...section, executorIds: [...section.executorIds] })),
    },
  }
}

export function attachExecutorGraphMetadata(
  topology: EnterpriseTopology,
  graph: ExecutorGraphWorkspace,
  options: { now?: EnterpriseTimestamp } = {},
): EnterpriseTopology {
  const metadata = buildExecutorGraphTopologyMetadata(graph, options)
  return {
    ...cloneTopology(topology),
    metadata: {
      ...(topology.metadata ?? {}),
      [EXECUTOR_GRAPH_METADATA_KEY]: metadata as unknown as EnterpriseMetadataValue,
    },
  }
}

export function readExecutorGraphMetadata(topology: EnterpriseTopology): ExecutorGraphTopologyMetadata | null {
  const value = topology.metadata?.[EXECUTOR_GRAPH_METADATA_KEY]
  const record = metadataRecord(value)
  if (!record || record.schemaVersion !== EXECUTOR_GRAPH_SCHEMA_VERSION) return null
  if (typeof record.graphId !== "string" || typeof record.topologyId !== "string") return null
  if (record.mode !== "simple" && record.mode !== "advanced") return null
  if (record.source !== "executor_graph" || record.sourceOfTruth !== "enterprise_topology") return null
  if (record.projectionOnly !== true) return null
  const workspace = metadataRecord(record.workspace)
  if (!workspace) return null
  return record as unknown as ExecutorGraphTopologyMetadata
}

export function compileExecutorGraphToEnterpriseTopology(
  graph: ExecutorGraphWorkspace,
  options: CompileExecutorGraphOptions = {},
): ExecutorGraphCompileResult {
  const now = options.now ?? Date.now()
  const baseTopology = options.baseTopology
    ? cloneTopology(options.baseTopology)
    : defaultTopologyForGraph(graph, now)
  const issues = validateExecutorGraphDraft(graph)
  if (issues.some((issue) => issue.severity === "error")) {
    return {
      ok: false,
      topology: baseTopology,
      operations: [],
      metadata: null,
      issues,
    }
  }

  const operations = buildExecutorGraphGuiOperations(graph, baseTopology, { now })
  const draft = createEnterpriseTopologyGuiDraft({ topology: baseTopology, now })
  const applied = applyEnterpriseTopologyGuiCommands(draft, operations, { now })
  const withNodeMetadata = attachNodeAndRelationMetadata(applied.draft.topology, graph)
  const metadata = buildExecutorGraphTopologyMetadata(graph, { now })
  const topology = {
    ...withNodeMetadata,
    metadata: {
      ...(withNodeMetadata.metadata ?? {}),
      [EXECUTOR_GRAPH_METADATA_KEY]: metadata as unknown as EnterpriseMetadataValue,
    },
    updatedAt: now,
  }

  return {
    ok: true,
    topology,
    operations,
    metadata,
    issues: [],
  }
}

export function buildExecutorGraphRollbackEvidence(input: {
  restoredTopology: EnterpriseTopology
  expectedTopologyId?: string
  expectedTopologyVersion?: number
  expectedTopologyVersionId?: string
  actualTopologyVersion?: number
  actualTopologyVersionId?: string
}): ExecutorGraphRollbackEvidence {
  const metadata = readExecutorGraphMetadata(input.restoredTopology)
  const projection = buildExecutorGraphFromEnterpriseTopology(input.restoredTopology, { mode: "simple" })
  const metadataExecutorIds = sorted(metadata?.executorIds ?? [])
  const projectionExecutorIds = sorted(projection.executors.map((executor) => executor.id))
  const metadataConnectionIds = sorted(metadata?.connectionIds ?? [])
  const projectionConnectionIds = sorted(projection.connections.map((connection) => connection.id))
  const expectedConfirmedIds = sorted(metadata?.confirmedExecutorIds ?? [])
  const projectionConfirmedIds = sorted(projection.executors.filter((executor) => executor.userConfirmed).map((executor) => executor.id))
  const blockingFailures: string[] = []
  const expectedTopologyId = input.expectedTopologyId ?? input.restoredTopology.id

  if (!metadata) blockingFailures.push("executor_graph_metadata_missing")
  if (input.restoredTopology.id !== expectedTopologyId) blockingFailures.push("topology_id_mismatch")
  if (input.expectedTopologyVersion !== undefined && input.actualTopologyVersion !== input.expectedTopologyVersion) {
    blockingFailures.push("topology_version_mismatch")
  }
  if (input.expectedTopologyVersionId !== undefined && input.actualTopologyVersionId !== input.expectedTopologyVersionId) {
    blockingFailures.push("topology_version_id_mismatch")
  }
  if (!sameStrings(metadataExecutorIds, projectionExecutorIds)) blockingFailures.push("executor_projection_mismatch")
  if (!sameStrings(metadataConnectionIds, projectionConnectionIds)) blockingFailures.push("connection_projection_mismatch")
  if (!sameStrings(expectedConfirmedIds, projectionConfirmedIds)) blockingFailures.push("confirmed_understanding_mismatch")
  if (
    metadata?.sourceOfTruth !== "enterprise_topology" ||
    metadata?.projectionOnly !== true ||
    projection.sourceOfTruth.runtimeSourceOfTruth !== "enterprise_topology" ||
    projection.sourceOfTruth.projectionOnly !== true
  ) {
    blockingFailures.push("source_of_truth_boundary_mismatch")
  }

  return {
    kind: "nobie.executor_graph.rollback_projection",
    status: blockingFailures.length === 0 ? "passed" : "failed",
    topologyId: input.restoredTopology.id,
    expectedTopologyId,
    ...(input.expectedTopologyVersion !== undefined ? { expectedTopologyVersion: input.expectedTopologyVersion } : {}),
    ...(input.expectedTopologyVersionId !== undefined ? { expectedTopologyVersionId: input.expectedTopologyVersionId } : {}),
    ...(input.actualTopologyVersion !== undefined ? { actualTopologyVersion: input.actualTopologyVersion } : {}),
    ...(input.actualTopologyVersionId !== undefined ? { actualTopologyVersionId: input.actualTopologyVersionId } : {}),
    metadataProjectionRestored: metadata !== null,
    executorIdsMatch: sameStrings(metadataExecutorIds, projectionExecutorIds),
    connectionIdsMatch: sameStrings(metadataConnectionIds, projectionConnectionIds),
    confirmedUnderstandingRestored: sameStrings(expectedConfirmedIds, projectionConfirmedIds),
    sourceOfTruthPreserved: !blockingFailures.includes("source_of_truth_boundary_mismatch"),
    blockingFailures,
  }
}

function sorted(values: readonly string[]): string[] {
  return [...values].sort((left, right) => left.localeCompare(right))
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) return false
  return left.every((value, index) => value === right[index])
}
