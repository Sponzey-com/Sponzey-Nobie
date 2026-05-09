import type {
  EnterpriseMetadata,
  EnterpriseMetadataValue,
  EnterpriseRelation,
  EnterpriseTopology,
  NodeContract,
} from "../contracts/enterprise-topology.js"
import { ENTERPRISE_TOPOLOGY_SCHEMA_VERSION } from "../contracts/enterprise-topology.js"
import {
  EXECUTOR_PROFILE_METADATA_KEY,
  buildExecutorProfileFromNode,
} from "./executor-profile.js"
import type {
  EnterpriseTopologyRegistryStore,
  TopologyExportEnvelope,
} from "./registry.js"

export const EXECUTOR_TOPOLOGY_V2_SCHEMA_VERSION = 2 as const
export const NOBIE_ROOT_AGENT_ID = "agent:nobie" as const

export type ExecutorTopologyV2SchemaVersion = typeof EXECUTOR_TOPOLOGY_V2_SCHEMA_VERSION
export type ExecutorTopologyV2Status = "draft" | "active" | "archived"
export type ExecutorNodeV2Status = "active" | "archived"
export type ExecutorEdgeV2Status = "active" | "archived"
export type ExecutorTopologyV2Timestamp = number | string
export type ExecutorTopologyV2MetadataValue =
  | string
  | number
  | boolean
  | null
  | ExecutorTopologyV2MetadataValue[]
  | { [key: string]: ExecutorTopologyV2MetadataValue | undefined }
export type ExecutorTopologyV2Metadata = { [key: string]: ExecutorTopologyV2MetadataValue | undefined }

export interface ExecutorNodeV2 {
  id: string
  name: string
  roleName?: string
  description: string
  instruction?: string
  position: {
    x: number
    y: number
  }
  status: ExecutorNodeV2Status
  profile?: ExecutorTopologyV2Metadata
  metadata?: ExecutorTopologyV2Metadata
}

export interface ExecutorEdgeV2 {
  id: string
  sourceNodeId: string
  targetNodeId: string
  type: "delegates_to"
  label?: string
  status: ExecutorEdgeV2Status
}

export interface ExecutorTopologyV2 {
  schemaVersion: ExecutorTopologyV2SchemaVersion
  id: string
  name: string
  status: ExecutorTopologyV2Status
  activeVersion?: number
  nodes: ExecutorNodeV2[]
  edges: ExecutorEdgeV2[]
  metadata?: ExecutorTopologyV2Metadata
  createdAt: ExecutorTopologyV2Timestamp
  updatedAt: ExecutorTopologyV2Timestamp
}

export interface ExecutorRuntimeGraphSnapshotV2 {
  topologyId: string
  schemaVersion: ExecutorTopologyV2SchemaVersion
  rootAgentId: typeof NOBIE_ROOT_AGENT_ID
  nodes: ExecutorNodeV2[]
  edges: ExecutorEdgeV2[]
  rootDirectChildIds: string[]
  directChildrenByNodeId: Record<string, string[]>
}

export type ExecutorTopologyV2MigrationIssueSeverity = "info" | "warning" | "invalid"

export interface ExecutorTopologyV2MigrationIssue {
  code: string
  severity: ExecutorTopologyV2MigrationIssueSeverity
  message: string
  topologyId: string
  nodeId?: string
  edgeId?: string
  relationId?: string
}

export interface ExecutorTopologyV2MigrationResult {
  topology: ExecutorTopologyV2
  issues: ExecutorTopologyV2MigrationIssue[]
}

export interface ExecutorTopologyV2PersistenceRepairResult {
  topology: ExecutorTopologyV2
  issues: ExecutorTopologyV2MigrationIssue[]
}

export interface ExecutorTopologyV2RegistryReadModelResult {
  ok: boolean
  topology?: ExecutorTopologyV2
  envelope?: TopologyExportEnvelope
  issues: ExecutorTopologyV2MigrationIssue[]
  reasonCode?:
    | "topology_not_found"
    | "active_topology_not_found"
    | "multiple_active_topologies_without_selection_policy"
    | "topology_export_failed"
}

export interface ExecutorTopologyV2RegistryMigrationPreview {
  ok: boolean
  dryRun: true
  reasonCode?: ExecutorTopologyV2RegistryReadModelResult["reasonCode"] | "v2_validation_failed"
  topologyId?: string
  sourceVersion?: number
  sourceVersionId?: string
  sourceImportSource?: string
  runtimeReadModel?: ExecutorTopologyV2
  materializedTopology?: EnterpriseTopology
  issues: ExecutorTopologyV2MigrationIssue[]
  validation: ExecutorTopologyV2ValidationResult
  staleIssueCount: number
  invalidIssueCount: number
  historyPreserved: boolean
}

export interface ExecutorTopologyV2RegistryMaterializationResult {
  ok: boolean
  preview: ExecutorTopologyV2RegistryMigrationPreview
  appendResult?: ReturnType<EnterpriseTopologyRegistryStore["appendTopologyVersion"]>
  activationResult?: ReturnType<EnterpriseTopologyRegistryStore["activateTopologyVersion"]>
}

export type ExecutorTopologyV2ValidationSeverity = "error" | "warning"

export interface ExecutorTopologyV2ValidationIssue {
  code: string
  severity: ExecutorTopologyV2ValidationSeverity
  path: string
  message: string
  nodeId?: string
  edgeId?: string
}

export interface ExecutorTopologyV2ValidationResult {
  ok: boolean
  issues: ExecutorTopologyV2ValidationIssue[]
}

const TOPOLOGY_STATUSES = new Set<ExecutorTopologyV2Status>(["draft", "active", "archived"])
const NODE_STATUSES = new Set<ExecutorNodeV2Status>(["active", "archived"])
const EDGE_STATUSES = new Set<ExecutorEdgeV2Status>(["active", "archived"])
const STALE_TOPOLOGY_FIELDS = [
  "relations",
  "teams",
  "orgUnits",
  "positions",
  "persons",
  "memberships",
  "authorityRules",
  "responsibilities",
  "systems",
  "tools",
  "processes",
  "children",
  "allowedToolIds",
  "allowedSystemIds",
] as const
const STALE_NODE_FIELDS = ["children", "allowedToolIds", "allowedSystemIds"] as const
const STALE_METADATA_KEYS = new Set([
  "active_default_workflow_candidate",
  "advancedMapping",
  "allowedSystemIds",
  "allowedToolIds",
  "children",
  "confirmedUnderstandingVersion",
  "inferenceEvidence",
  "inferredOutputs",
  "inferredRuntimeMode",
  "inferredSuccessCriteria",
  "inferredTools",
  "lastSelectedNodeId",
  "recommendedEntry",
  "selectedId",
  "selectedNodeId",
  "workspace",
])

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value))
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0
}

function maybeString(value: unknown): string | undefined {
  return nonEmptyString(value) ? value.trim() : undefined
}

function recordFromUnknown(value: unknown): Record<string, unknown> | undefined {
  return isRecord(value) ? value : undefined
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined
}

function timestampFromEnterprise(value: unknown, fallback: number): ExecutorTopologyV2Timestamp {
  return validTimestamp(value) ? value as ExecutorTopologyV2Timestamp : fallback
}

function toExecutorNodeStatus(status: NodeContract["status"]): ExecutorNodeV2Status {
  return status === "archived" || status === "inactive" ? "archived" : "active"
}

function toExecutorEdgeStatus(status: EnterpriseRelation["status"]): ExecutorEdgeV2Status {
  return status === "archived" || status === "inactive" ? "archived" : "active"
}

function nodeDescription(node: NodeContract): string {
  return node.description?.trim() || node.instruction?.trim() || node.displayName?.trim() || node.name.trim() || node.id
}

function nodeDisplayNameV2(node: NodeContract): string {
  return node.displayName?.trim() || node.name.trim() || node.id
}

function nodePosition(node: NodeContract, index: number): ExecutorNodeV2["position"] {
  const metadata = recordFromUnknown(node.metadata)
  const graphMetadata = recordFromUnknown(metadata?.executorGraph)
  const templateMetadata = recordFromUnknown(node.template?.metadata)
  const candidates = [
    metadata?.position,
    graphMetadata?.position,
    templateMetadata?.position,
  ]
  for (const candidate of candidates) {
    const position = recordFromUnknown(candidate)
    const x = finiteNumber(position?.x)
    const y = finiteNumber(position?.y)
    if (x !== undefined && y !== undefined) return { x, y }
  }
  return { x: 80 + (index % 4) * 260, y: 80 + Math.floor(index / 4) * 180 }
}

function cloneMetadataValue(value: unknown): ExecutorTopologyV2MetadataValue | undefined {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value
  }
  if (Array.isArray(value)) {
    return value
      .map((item) => cloneMetadataValue(item))
      .filter((item): item is ExecutorTopologyV2MetadataValue => item !== undefined)
  }
  if (!isRecord(value)) return undefined
  const entries = Object.entries(value)
    .map(([key, item]) => [key, cloneMetadataValue(item)] as const)
    .filter((entry): entry is readonly [string, ExecutorTopologyV2MetadataValue] => entry[1] !== undefined)
  return Object.fromEntries(entries)
}

function auditRefsFromMetadata(metadata: unknown): ExecutorTopologyV2MetadataValue[] {
  const record = recordFromUnknown(metadata)
  if (!record) return []
  const refs: ExecutorTopologyV2MetadataValue[] = []
  const aiSuggestionState = recordFromUnknown(record.aiSuggestionState)
  const directRunId = maybeString(aiSuggestionState?.suggestionRunId)
  if (directRunId) {
    refs.push({
      kind: "node_definition_suggestion",
      suggestionRunId: directRunId,
      ...(maybeString(aiSuggestionState?.selectedAlternativeId)
        ? { selectedAlternativeId: maybeString(aiSuggestionState?.selectedAlternativeId) }
        : {}),
    })
  }
  const history = Array.isArray(record.suggestionHistory) ? record.suggestionHistory : []
  for (const item of history) {
    const itemRecord = recordFromUnknown(item)
    const suggestionRunId = maybeString(itemRecord?.suggestionRunId)
    if (!suggestionRunId) continue
    refs.push({
      kind: "node_definition_suggestion",
      suggestionRunId,
      ...(maybeString(itemRecord?.selectedAlternativeId)
        ? { selectedAlternativeId: maybeString(itemRecord?.selectedAlternativeId) }
        : {}),
    })
  }
  return refs
}

function sanitizeMetadataForV2(
  value: unknown,
  input: {
    topologyId: string
    nodeId?: string
    issues: ExecutorTopologyV2MigrationIssue[]
    path: string
  },
): ExecutorTopologyV2Metadata | undefined {
  const record = recordFromUnknown(value)
  if (!record) return undefined
  const result: ExecutorTopologyV2Metadata = {}
  const auditRefs = auditRefsFromMetadata(record)
  for (const [key, item] of Object.entries(record)) {
    if (STALE_METADATA_KEYS.has(key) || key === "suggestionHistory" || key === "aiSuggestionState") {
      input.issues.push({
        code: "executor_topology_v2_stale_metadata_removed",
        severity: "warning",
        message: `Removed stale metadata ${input.path}.${key} from ExecutorTopologyV2 read model.`,
        topologyId: input.topologyId,
        ...(input.nodeId ? { nodeId: input.nodeId } : {}),
      })
      continue
    }
    if (key === "executorGraph") {
      const sanitizedGraph = sanitizeMetadataForV2(item, {
        ...input,
        path: `${input.path}.executorGraph`,
      })
      if (sanitizedGraph && Object.keys(sanitizedGraph).length > 0) {
        result.executorGraph = sanitizedGraph
      }
      continue
    }
    const cloned = cloneMetadataValue(item)
    if (cloned !== undefined) result[key] = cloned
  }
  if (auditRefs.length > 0) result.aiSuggestionAuditRefs = auditRefs
  return Object.keys(result).length > 0 ? result : undefined
}

function enterpriseRelationNodeId(
  relation: EnterpriseRelation,
  endpoint: "from" | "to",
): string | undefined {
  const ref = relation[endpoint]
  return ref.entityType === "node" && ref.id.trim() ? ref.id : undefined
}

function relationEdgeId(relation: EnterpriseRelation): string {
  return relation.id.startsWith("edge:") ? relation.id : `edge:${relation.id}`
}

function legacyChildEdgeId(sourceNodeId: string, targetNodeId: string): string {
  return `edge:legacy-child:${sourceNodeId}:${targetNodeId}`
}

function validTimestamp(value: unknown): boolean {
  if (typeof value === "string") return value.trim().length > 0
  return typeof value === "number" && Number.isFinite(value)
}

function issue(
  issues: ExecutorTopologyV2ValidationIssue[],
  input: Omit<ExecutorTopologyV2ValidationIssue, "severity"> & {
    severity?: ExecutorTopologyV2ValidationSeverity
  },
): void {
  issues.push({
    severity: input.severity ?? "error",
    code: input.code,
    path: input.path,
    message: input.message,
    ...(input.nodeId ? { nodeId: input.nodeId } : {}),
    ...(input.edgeId ? { edgeId: input.edgeId } : {}),
  })
}

function validatePosition(
  issues: ExecutorTopologyV2ValidationIssue[],
  value: unknown,
  path: string,
  nodeId?: string,
): void {
  if (!isRecord(value)) {
    issue(issues, {
      code: "invalid_node_position",
      path,
      message: "Node position must be an object with finite x and y numbers.",
      ...(nodeId ? { nodeId } : {}),
    })
    return
  }
  if (typeof value.x !== "number" || !Number.isFinite(value.x)) {
    issue(issues, {
      code: "invalid_node_position_x",
      path: `${path}.x`,
      message: "Node position.x must be a finite number.",
      ...(nodeId ? { nodeId } : {}),
    })
  }
  if (typeof value.y !== "number" || !Number.isFinite(value.y)) {
    issue(issues, {
      code: "invalid_node_position_y",
      path: `${path}.y`,
      message: "Node position.y must be a finite number.",
      ...(nodeId ? { nodeId } : {}),
    })
  }
}

export function migrateEnterpriseTopologyToExecutorTopologyV2(
  topology: EnterpriseTopology,
): ExecutorTopologyV2MigrationResult {
  const issues: ExecutorTopologyV2MigrationIssue[] = []
  const activeNodeIds = new Set(
    topology.nodes
      .filter((node) => toExecutorNodeStatus(node.status) === "active")
      .map((node) => node.id),
  )
  const nodes: ExecutorNodeV2[] = topology.nodes.map((node, index) => {
    const profile = buildExecutorProfileFromNode(node)
    const metadata = sanitizeMetadataForV2(node.metadata, {
      topologyId: topology.id,
      nodeId: node.id,
      issues,
      path: `node(${node.id}).metadata`,
    })
    const compatibility: ExecutorTopologyV2Metadata = {
      sourceSchemaVersion: topology.schemaVersion,
      sourceEntityType: node.entityType,
      sourceNodeType: node.nodeType,
      sourceStatus: node.status,
      ...(node.template?.templateId ? { sourceTemplateId: node.template.templateId } : {}),
      ...(node.metadata?.importedFromAgentConfigId
        ? { importedFromAgentConfigId: node.metadata.importedFromAgentConfigId }
        : {}),
    }
    return {
      id: node.id,
      name: nodeDisplayNameV2(node),
      roleName: profile.roleName,
      description: nodeDescription(node),
      ...(node.instruction?.trim() ? { instruction: node.instruction.trim() } : {}),
      position: nodePosition(node, index),
      status: toExecutorNodeStatus(node.status),
      profile: profile as unknown as ExecutorTopologyV2Metadata,
      metadata: {
        ...(metadata ?? {}),
        compatibility,
      },
    }
  })

  const edges: ExecutorEdgeV2[] = []
  const seenEdgeIds = new Set<string>()
  const hasDelegatesToRelations = topology.relations.some((relation) => relation.relationType === "delegates_to")
  for (const relation of topology.relations) {
    if (relation.relationType !== "delegates_to") continue
    const sourceNodeId = enterpriseRelationNodeId(relation, "from")
    const targetNodeId = enterpriseRelationNodeId(relation, "to")
    if (!sourceNodeId || !targetNodeId || !activeNodeIds.has(sourceNodeId) || !activeNodeIds.has(targetNodeId)) {
      issues.push({
        code: "executor_topology_v2_relation_skipped",
        severity: "warning",
        message: `Relation ${relation.id} was skipped because it is not a valid delegates_to edge between active nodes.`,
        topologyId: topology.id,
        relationId: relation.id,
      })
      continue
    }
    const edgeId = relationEdgeId(relation)
    if (seenEdgeIds.has(edgeId)) {
      issues.push({
        code: "executor_topology_v2_duplicate_edge_skipped",
        severity: "warning",
        message: `Duplicate V2 edge id ${edgeId} was skipped.`,
        topologyId: topology.id,
        relationId: relation.id,
        edgeId,
      })
      continue
    }
    seenEdgeIds.add(edgeId)
    edges.push({
      id: edgeId,
      sourceNodeId,
      targetNodeId,
      type: "delegates_to",
      ...(relation.label?.trim() ? { label: relation.label.trim() } : {}),
      status: toExecutorEdgeStatus(relation.status),
    })
  }

  if (!hasDelegatesToRelations) {
    for (const node of topology.nodes) {
      if (toExecutorNodeStatus(node.status) !== "active") continue
      for (const targetNodeId of [...new Set(node.children ?? [])]) {
        if (!activeNodeIds.has(targetNodeId)) {
          issues.push({
            code: "executor_topology_v2_legacy_child_skipped",
            severity: "warning",
            message: `Legacy child ${targetNodeId} on node ${node.id} was skipped because the target is not active.`,
            topologyId: topology.id,
            nodeId: node.id,
          })
          continue
        }
        const edgeId = legacyChildEdgeId(node.id, targetNodeId)
        if (seenEdgeIds.has(edgeId)) continue
        seenEdgeIds.add(edgeId)
        edges.push({
          id: edgeId,
          sourceNodeId: node.id,
          targetNodeId,
          type: "delegates_to",
          status: "active",
        })
      }
    }
  } else {
    const hasLegacyChildren = topology.nodes.some((node) => (node.children ?? []).length > 0)
    if (hasLegacyChildren) {
      issues.push({
        code: "executor_topology_v2_legacy_children_ignored",
        severity: "info",
        message: "Legacy node.children values were ignored because delegates_to relations are the source of truth.",
        topologyId: topology.id,
      })
    }
  }

  const migrated: ExecutorTopologyV2 = {
    schemaVersion: EXECUTOR_TOPOLOGY_V2_SCHEMA_VERSION,
    id: topology.id,
    name: topology.displayName?.trim() || topology.name.trim() || topology.id,
    status: topology.status === "archived" ? "archived" : topology.status === "active" ? "active" : "draft",
    nodes,
    edges,
    metadata: {
      ...(sanitizeMetadataForV2(topology.metadata, {
        topologyId: topology.id,
        issues,
        path: "topology.metadata",
      }) ?? {}),
      compatibility: {
        sourceSchemaVersion: topology.schemaVersion,
        sourceEntityType: topology.entityType,
        sourceStatus: topology.status,
        enterpriseExtensionDataRemoved: true,
      },
    },
    createdAt: timestampFromEnterprise(topology.createdAt, Date.now()),
    updatedAt: timestampFromEnterprise(topology.updatedAt, Date.now()),
  }
  if (Object.keys(migrated.metadata ?? {}).length === 0) {
    delete migrated.metadata
  }
  const validation = validateExecutorTopologyV2(migrated)
  for (const validationIssue of validation.issues) {
    issues.push({
      code: `executor_topology_v2_validation_${validationIssue.code}`,
      severity: validationIssue.severity === "error" ? "invalid" : "warning",
      message: validationIssue.message,
      topologyId: topology.id,
      ...(validationIssue.nodeId ? { nodeId: validationIssue.nodeId } : {}),
      ...(validationIssue.edgeId ? { edgeId: validationIssue.edgeId } : {}),
    })
  }
  return {
    topology: migrated,
    issues,
  }
}

export function repairExecutorTopologyV2ForPersistence(
  topology: ExecutorTopologyV2,
): ExecutorTopologyV2PersistenceRepairResult {
  const issues: ExecutorTopologyV2MigrationIssue[] = []
  const repaired = structuredClone(topology) as ExecutorTopologyV2
  const topologyRecord = repaired as unknown as Record<string, unknown>
  for (const field of STALE_TOPOLOGY_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(topologyRecord, field)) continue
    delete topologyRecord[field]
    issues.push({
      code: "executor_topology_v2_stale_topology_field_removed",
      severity: "warning",
      message: `Removed stale topology field ${field} from ExecutorTopologyV2 persistence payload.`,
      topologyId: repaired.id,
    })
  }
  const topologyMetadata = sanitizeMetadataForV2(repaired.metadata, {
    topologyId: repaired.id,
    issues,
    path: "topology.metadata",
  })
  if (topologyMetadata) repaired.metadata = topologyMetadata
  else delete repaired.metadata

  const nodeIds = new Set(repaired.nodes.map((node) => node.id))
  repaired.nodes = repaired.nodes.map((node) => {
    const nodeRecord = node as unknown as Record<string, unknown>
    for (const field of STALE_NODE_FIELDS) {
      if (!Object.prototype.hasOwnProperty.call(nodeRecord, field)) continue
      delete nodeRecord[field]
      issues.push({
        code: "executor_topology_v2_stale_node_field_removed",
        severity: "warning",
        message: `Removed stale node field ${field} from ExecutorTopologyV2 persistence payload.`,
        topologyId: repaired.id,
        nodeId: node.id,
      })
    }
    const metadata = sanitizeMetadataForV2(node.metadata, {
      topologyId: repaired.id,
      nodeId: node.id,
      issues,
      path: `node(${node.id}).metadata`,
    })
    const nextNode = { ...node }
    if (metadata) nextNode.metadata = metadata
    else delete nextNode.metadata
    return nextNode
  })

  repaired.edges = repaired.edges.filter((edge) => {
    const keep = edge.type === "delegates_to" && nodeIds.has(edge.sourceNodeId) && nodeIds.has(edge.targetNodeId)
    if (!keep) {
      issues.push({
        code: "executor_topology_v2_invalid_edge_removed",
        severity: "warning",
        message: `Removed invalid edge ${edge.id} from ExecutorTopologyV2 persistence payload.`,
        topologyId: repaired.id,
        edgeId: edge.id,
      })
    }
    return keep
  })

  return { topology: repaired, issues }
}

export function buildExecutorTopologyV2RuntimeReadModelFromEnterpriseTopology(
  topology: EnterpriseTopology,
): ExecutorTopologyV2MigrationResult {
  const migration = migrateEnterpriseTopologyToExecutorTopologyV2(topology)
  const repair = repairExecutorTopologyV2ForPersistence(migration.topology)
  return {
    topology: repair.topology,
    issues: [...migration.issues, ...repair.issues],
  }
}

function enterpriseEntityStatusFromExecutorStatus(status: ExecutorTopologyV2Status | ExecutorNodeV2Status): "draft" | "active" | "archived" {
  if (status === "archived") return "archived"
  if (status === "draft") return "draft"
  return "active"
}

function enterpriseNodeMetadataFromExecutorNodeV2(node: ExecutorNodeV2): EnterpriseMetadata {
  const metadata: EnterpriseMetadata = {
    roleName: node.roleName ?? "실행자",
    executorTopologyV2: {
      schemaVersion: EXECUTOR_TOPOLOGY_V2_SCHEMA_VERSION,
      nodeId: node.id,
    },
    executorGraph: {
      position: node.position as unknown as EnterpriseMetadataValue,
    },
  }
  const profile = cloneMetadataValue(node.profile)
  if (profile !== undefined) metadata.executorProfile = profile as EnterpriseMetadataValue
  const understanding = recordFromUnknown(node.metadata?.understanding)
  if (understanding) metadata.understanding = cloneMetadataValue(understanding) as EnterpriseMetadataValue
  const auditRefs = cloneMetadataValue(node.metadata?.aiSuggestionAuditRefs)
  if (auditRefs !== undefined) metadata.aiSuggestionAuditRefs = auditRefs as EnterpriseMetadataValue
  return metadata
}

function enterpriseNodeFromExecutorNodeV2(node: ExecutorNodeV2, timestamp: ExecutorTopologyV2Timestamp): NodeContract {
  const name = node.name.trim() || node.id
  const description = node.description.trim() || node.instruction?.trim() || name
  return {
    schemaVersion: ENTERPRISE_TOPOLOGY_SCHEMA_VERSION,
    entityType: "node",
    id: node.id,
    name,
    displayName: name,
    status: enterpriseEntityStatusFromExecutorStatus(node.status),
    createdAt: timestamp,
    updatedAt: timestamp,
    nodeType: "function",
    description,
    instruction: node.instruction?.trim() || description,
    tags: [],
    children: [],
    allowedToolIds: [],
    allowedSystemIds: [],
    failurePolicy: {
      failureReportRequired: true,
      allowPartialSuccess: true,
      fallbackNodeIds: [],
    },
    recoveryPolicy: {
      retryAllowed: true,
      redelegationAllowed: true,
      fallbackAllowed: true,
      partialSuccessAllowed: true,
    },
    metadata: enterpriseNodeMetadataFromExecutorNodeV2(node),
  }
}

export function enterpriseTopologyFromExecutorTopologyV2(
  topology: ExecutorTopologyV2,
  options: {
    migrationSource?: string
    sourceTopologyVersion?: number
    sourceVersionId?: string
    materializedAt?: ExecutorTopologyV2Timestamp
  } = {},
): EnterpriseTopology {
  const repair = repairExecutorTopologyV2ForPersistence(topology)
  const repaired = repair.topology
  const timestamp = options.materializedAt ?? repaired.updatedAt
  const activeNodeIds = new Set(repaired.nodes.filter((node) => node.status === "active").map((node) => node.id))
  const relations: EnterpriseRelation[] = repaired.edges
    .filter((edge) =>
      edge.status === "active" &&
      activeNodeIds.has(edge.sourceNodeId) &&
      activeNodeIds.has(edge.targetNodeId)
    )
    .map((edge) => {
      const label = edge.label?.trim() || "delegates_to"
      return {
        schemaVersion: ENTERPRISE_TOPOLOGY_SCHEMA_VERSION,
        entityType: "relation",
        id: edge.id,
        name: label,
        displayName: label,
        status: "active",
        createdAt: timestamp,
        updatedAt: timestamp,
        relationType: "delegates_to",
        from: { entityType: "node", id: edge.sourceNodeId },
        to: { entityType: "node", id: edge.targetNodeId },
        label,
        metadata: {
          executorTopologyV2: {
            schemaVersion: EXECUTOR_TOPOLOGY_V2_SCHEMA_VERSION,
            edgeId: edge.id,
            ...(options.migrationSource ? { migrationSource: options.migrationSource } : {}),
          },
        },
      }
    })

  return {
    schemaVersion: ENTERPRISE_TOPOLOGY_SCHEMA_VERSION,
    entityType: "topology",
    id: repaired.id,
    name: repaired.name.trim() || repaired.id,
    displayName: repaired.name.trim() || repaired.id,
    status: enterpriseEntityStatusFromExecutorStatus(repaired.status),
    createdAt: repaired.createdAt,
    updatedAt: timestamp,
    description: "ExecutorTopologyV2 materialized persistence projection.",
    nodes: repaired.nodes.map((node) => enterpriseNodeFromExecutorNodeV2(node, timestamp)),
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
    relations,
    metadata: {
      executorTopologyV2: {
        schemaVersion: EXECUTOR_TOPOLOGY_V2_SCHEMA_VERSION,
        sourceOfTruth: "executor_topology_v2",
        migrationSource: options.migrationSource ?? "executor_topology_v2_materialized_read_model",
        ...(options.sourceTopologyVersion !== undefined ? { sourceTopologyVersion: options.sourceTopologyVersion } : {}),
        ...(options.sourceVersionId ? { sourceVersionId: options.sourceVersionId } : {}),
      },
    },
  }
}

export function loadExecutorTopologyV2ReadModelFromRegistry(input: {
  registry: EnterpriseTopologyRegistryStore
  topologyId?: string
  version?: number
}): ExecutorTopologyV2RegistryReadModelResult {
  const issues: ExecutorTopologyV2MigrationIssue[] = []
  let topologyId = input.topologyId
  let version = input.version
  if (!topologyId) {
    const activeRecords = input.registry.listTopologies()
      .filter((record) => record.status === "active" && record.activeVersion !== undefined)
      .sort((left, right) => left.topologyId.localeCompare(right.topologyId))
    if (activeRecords.length === 0) {
      return {
        ok: false,
        reasonCode: "active_topology_not_found",
        issues,
      }
    }
    if (activeRecords.length > 1) {
      return {
        ok: false,
        reasonCode: "multiple_active_topologies_without_selection_policy",
        issues,
      }
    }
    topologyId = activeRecords[0]?.topologyId
    version = activeRecords[0]?.activeVersion
  }

  if (!topologyId) {
    return {
      ok: false,
      reasonCode: "topology_not_found",
      issues,
    }
  }
  const envelope = input.registry.exportTopology(topologyId, version)
  if (!envelope) {
    return {
      ok: false,
      reasonCode: "topology_export_failed",
      issues,
    }
  }
  const readModel = buildExecutorTopologyV2RuntimeReadModelFromEnterpriseTopology(envelope.version.topology)
  return {
    ok: true,
    topology: readModel.topology,
    envelope,
    issues: [...issues, ...readModel.issues],
  }
}

export function previewExecutorTopologyV2RegistryMigration(input: {
  registry: EnterpriseTopologyRegistryStore
  topologyId?: string
  version?: number
  migrationSource?: string
  materializedAt?: ExecutorTopologyV2Timestamp
}): ExecutorTopologyV2RegistryMigrationPreview {
  const loaded = loadExecutorTopologyV2ReadModelFromRegistry(input)
  if (!loaded.ok || !loaded.topology) {
    return {
      ok: false,
      dryRun: true,
      reasonCode: loaded.reasonCode,
      issues: loaded.issues,
      validation: { ok: false, issues: [] },
      staleIssueCount: loaded.issues.filter((issue) => issue.code.includes("stale")).length,
      invalidIssueCount: loaded.issues.filter((issue) => issue.severity === "invalid").length,
      historyPreserved: true,
    }
  }

  const validation = validateExecutorTopologyV2(loaded.topology)
  const materializedTopology = validation.ok
    ? enterpriseTopologyFromExecutorTopologyV2(loaded.topology, {
        migrationSource: input.migrationSource ?? "executor_topology_v2_materialized_read_model",
        ...(loaded.envelope?.version.version !== undefined
          ? { sourceTopologyVersion: loaded.envelope.version.version }
          : {}),
        ...(loaded.envelope?.version.versionId !== undefined
          ? { sourceVersionId: loaded.envelope.version.versionId }
          : {}),
        ...(input.materializedAt !== undefined ? { materializedAt: input.materializedAt } : {}),
      })
    : undefined
  return {
    ok: validation.ok,
    dryRun: true,
    ...(validation.ok ? {} : { reasonCode: "v2_validation_failed" as const }),
    ...(loaded.envelope?.version.topologyId ?? loaded.topology.id
      ? { topologyId: loaded.envelope?.version.topologyId ?? loaded.topology.id }
      : {}),
    ...(loaded.envelope?.version.version !== undefined ? { sourceVersion: loaded.envelope.version.version } : {}),
    ...(loaded.envelope?.version.versionId !== undefined ? { sourceVersionId: loaded.envelope.version.versionId } : {}),
    ...(loaded.envelope?.version.importSource !== undefined
      ? { sourceImportSource: loaded.envelope.version.importSource }
      : {}),
    runtimeReadModel: loaded.topology,
    ...(materializedTopology ? { materializedTopology } : {}),
    issues: loaded.issues,
    validation,
    staleIssueCount: loaded.issues.filter((issue) => issue.code.includes("stale")).length,
    invalidIssueCount: loaded.issues.filter((issue) => issue.severity === "invalid").length,
    historyPreserved: true,
  }
}

export function materializeExecutorTopologyV2ReadModelInRegistry(input: {
  registry: EnterpriseTopologyRegistryStore
  topologyId?: string
  version?: number
  createdBy?: string
  importSource?: string
  migrationSource?: string
  materializedAt?: ExecutorTopologyV2Timestamp
}): ExecutorTopologyV2RegistryMaterializationResult {
  const preview = previewExecutorTopologyV2RegistryMigration(input)
  if (!preview.ok || !preview.materializedTopology || !preview.topologyId) {
    return { ok: false, preview }
  }
  const appendResult = input.registry.appendTopologyVersion({
    topology: preview.materializedTopology,
    ...(input.createdBy ? { createdBy: input.createdBy } : {}),
    importSource: input.importSource ?? "executor_topology_v2_materialize",
  })
  const activationResult = input.registry.activateTopologyVersion(
    preview.topologyId,
    appendResult.version.version,
  )
  return {
    ok: activationResult.ok,
    preview,
    appendResult,
    activationResult,
  }
}

export function validateExecutorTopologyV2(input: unknown): ExecutorTopologyV2ValidationResult {
  const issues: ExecutorTopologyV2ValidationIssue[] = []
  if (!isRecord(input)) {
    issue(issues, {
      code: "invalid_topology_shape",
      path: "$",
      message: "ExecutorTopologyV2 must be an object.",
    })
    return { ok: false, issues }
  }

  if (input.schemaVersion !== EXECUTOR_TOPOLOGY_V2_SCHEMA_VERSION) {
    issue(issues, {
      code: "invalid_schema_version",
      path: "$.schemaVersion",
      message: "ExecutorTopologyV2 schemaVersion must be 2.",
    })
  }
  if (!nonEmptyString(input.id)) {
    issue(issues, { code: "invalid_topology_id", path: "$.id", message: "Topology id is required." })
  }
  if (!nonEmptyString(input.name)) {
    issue(issues, { code: "invalid_topology_name", path: "$.name", message: "Topology name is required." })
  }
  if (!TOPOLOGY_STATUSES.has(input.status as ExecutorTopologyV2Status)) {
    issue(issues, {
      code: "invalid_topology_status",
      path: "$.status",
      message: "Topology status must be draft, active, or archived.",
    })
  }
  if (!validTimestamp(input.createdAt)) {
    issue(issues, {
      code: "invalid_created_at",
      path: "$.createdAt",
      message: "createdAt must be a non-empty string or finite number.",
    })
  }
  if (!validTimestamp(input.updatedAt)) {
    issue(issues, {
      code: "invalid_updated_at",
      path: "$.updatedAt",
      message: "updatedAt must be a non-empty string or finite number.",
    })
  }
  if (input.activeVersion !== undefined && (typeof input.activeVersion !== "number" || !Number.isInteger(input.activeVersion) || input.activeVersion < 0)) {
    issue(issues, {
      code: "invalid_active_version",
      path: "$.activeVersion",
      message: "activeVersion must be a non-negative integer when provided.",
    })
  }
  for (const field of STALE_TOPOLOGY_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(input, field)) {
      issue(issues, {
        code: "stale_topology_field",
        path: `$.${field}`,
        message: `${field} is not part of the ExecutorTopologyV2 source model.`,
      })
    }
  }

  const nodes = Array.isArray(input.nodes) ? input.nodes : undefined
  const edges = Array.isArray(input.edges) ? input.edges : undefined
  if (!nodes) {
    issue(issues, { code: "invalid_nodes", path: "$.nodes", message: "nodes must be an array." })
  }
  if (!edges) {
    issue(issues, { code: "invalid_edges", path: "$.edges", message: "edges must be an array." })
  }

  const nodeIds = new Set<string>()
  if (nodes) {
    nodes.forEach((node, index) => {
      const path = `$.nodes[${index}]`
      if (!isRecord(node)) {
        issue(issues, { code: "invalid_node_shape", path, message: "Node must be an object." })
        return
      }
      const nodeId = nonEmptyString(node.id) ? node.id : undefined
      if (!nodeId) {
        issue(issues, { code: "invalid_node_id", path: `${path}.id`, message: "Node id is required." })
      } else if (nodeIds.has(nodeId)) {
        issue(issues, {
          code: "duplicate_node_id",
          path: `${path}.id`,
          message: `Duplicate node id ${nodeId}.`,
          nodeId,
        })
      } else {
        nodeIds.add(nodeId)
      }
      if (!nonEmptyString(node.name)) {
        issue(issues, {
          code: "invalid_node_name",
          path: `${path}.name`,
          message: "Node name is required.",
          ...(nodeId ? { nodeId } : {}),
        })
      }
      if (!nonEmptyString(node.description)) {
        issue(issues, {
          code: "invalid_node_description",
          path: `${path}.description`,
          message: "Node description is required.",
          ...(nodeId ? { nodeId } : {}),
        })
      }
      if (!NODE_STATUSES.has(node.status as ExecutorNodeV2Status)) {
        issue(issues, {
          code: "invalid_node_status",
          path: `${path}.status`,
          message: "Node status must be active or archived.",
          ...(nodeId ? { nodeId } : {}),
        })
      }
      validatePosition(issues, node.position, `${path}.position`, nodeId)
      for (const field of STALE_NODE_FIELDS) {
        if (Object.prototype.hasOwnProperty.call(node, field)) {
          issue(issues, {
            code: "stale_node_field",
            path: `${path}.${field}`,
            message: `${field} is not part of the ExecutorNodeV2 source model.`,
            ...(nodeId ? { nodeId } : {}),
          })
        }
      }
    })
  }

  const edgeIds = new Set<string>()
  if (edges) {
    edges.forEach((edge, index) => {
      const path = `$.edges[${index}]`
      if (!isRecord(edge)) {
        issue(issues, { code: "invalid_edge_shape", path, message: "Edge must be an object." })
        return
      }
      const edgeId = nonEmptyString(edge.id) ? edge.id : undefined
      if (!edgeId) {
        issue(issues, { code: "invalid_edge_id", path: `${path}.id`, message: "Edge id is required." })
      } else if (edgeIds.has(edgeId)) {
        issue(issues, {
          code: "duplicate_edge_id",
          path: `${path}.id`,
          message: `Duplicate edge id ${edgeId}.`,
          edgeId,
        })
      } else {
        edgeIds.add(edgeId)
      }
      if (edge.type !== "delegates_to") {
        issue(issues, {
          code: "invalid_edge_type",
          path: `${path}.type`,
          message: "ExecutorEdgeV2 type must be delegates_to.",
          ...(edgeId ? { edgeId } : {}),
        })
      }
      if (!EDGE_STATUSES.has(edge.status as ExecutorEdgeV2Status)) {
        issue(issues, {
          code: "invalid_edge_status",
          path: `${path}.status`,
          message: "Edge status must be active or archived.",
          ...(edgeId ? { edgeId } : {}),
        })
      }
      if (!nonEmptyString(edge.sourceNodeId) || !nodeIds.has(edge.sourceNodeId)) {
        issue(issues, {
          code: "invalid_edge_source",
          path: `${path}.sourceNodeId`,
          message: "Edge sourceNodeId must reference an existing node.",
          ...(edgeId ? { edgeId } : {}),
        })
      }
      if (!nonEmptyString(edge.targetNodeId) || !nodeIds.has(edge.targetNodeId)) {
        issue(issues, {
          code: "invalid_edge_target",
          path: `${path}.targetNodeId`,
          message: "Edge targetNodeId must reference an existing node.",
          ...(edgeId ? { edgeId } : {}),
        })
      }
    })
  }

  return { ok: issues.every((item) => item.severity !== "error"), issues }
}

export function isExecutorTopologyV2(input: unknown): input is ExecutorTopologyV2 {
  return validateExecutorTopologyV2(input).ok
}

export function buildExecutorRuntimeGraphSnapshotV2(
  topology: ExecutorTopologyV2,
): ExecutorRuntimeGraphSnapshotV2 {
  const activeNodes = topology.nodes.filter((node) => node.status === "active")
  const activeNodeIds = new Set(activeNodes.map((node) => node.id))
  const activeEdges = topology.edges.filter((edge) =>
    edge.status === "active" &&
    edge.type === "delegates_to" &&
    activeNodeIds.has(edge.sourceNodeId) &&
    activeNodeIds.has(edge.targetNodeId)
  )

  const incoming = new Set(activeEdges.map((edge) => edge.targetNodeId))
  const rootDirectChildIds = activeNodes
    .filter((node) => !incoming.has(node.id))
    .map((node) => node.id)
  const directChildrenByNodeId: Record<string, string[]> = Object.fromEntries(
    activeNodes.map((node) => [node.id, []]),
  )
  for (const edge of activeEdges) {
    directChildrenByNodeId[edge.sourceNodeId]?.push(edge.targetNodeId)
  }

  return {
    topologyId: topology.id,
    schemaVersion: EXECUTOR_TOPOLOGY_V2_SCHEMA_VERSION,
    rootAgentId: NOBIE_ROOT_AGENT_ID,
    nodes: activeNodes,
    edges: activeEdges,
    rootDirectChildIds,
    directChildrenByNodeId,
  }
}
