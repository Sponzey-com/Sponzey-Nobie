import type {
  EnterpriseRelation,
  EnterpriseTopology,
  NodeContract,
} from "../contracts/enterprise-topology.js"
import {
  buildExecutorTopologyV2RuntimeReadModelFromEnterpriseTopology,
  enterpriseTopologyFromExecutorTopologyV2,
} from "./executor-topology-v2.js"
import {
  createEnterpriseTopologyRegistry,
  type CreateEnterpriseTopologyRegistryOptions,
  type EnterpriseTopologyRegistryRecord,
  type EnterpriseTopologyRegistryStore,
  type TopologyExportEnvelope,
} from "./registry.js"

export type LegacyEnterpriseRelation = EnterpriseRelation
export type LegacyEnterpriseTopology = EnterpriseTopology
export type LegacyNodeContract = NodeContract
export type LegacyEnterpriseTopologyRegistryRecord = EnterpriseTopologyRegistryRecord
export type LegacyEnterpriseTopologyRegistryStore = EnterpriseTopologyRegistryStore
export type LegacyTopologyExportEnvelope = TopologyExportEnvelope
export type LegacyRelation = LegacyEnterpriseRelation
export type LegacyTopology = LegacyEnterpriseTopology
export type LegacyNode = LegacyNodeContract
export type LegacyTopologyRegistryRecord = LegacyEnterpriseTopologyRegistryRecord
export type LegacyTopologyRegistryStore = LegacyEnterpriseTopologyRegistryStore
export type LegacyTopologyEnvelope = LegacyTopologyExportEnvelope

export type LegacyTopologyAdapterIssueSeverity = "info" | "warning" | "invalid"

export interface LegacyTopologyAdapterIssue {
  code: string
  severity: LegacyTopologyAdapterIssueSeverity
  message: string
  topologyId?: string
  topologyVersion?: number
  relationId?: string
  edgeId?: string
  agentId?: string
  parentAgentId?: string
  childAgentId?: string
}

export interface LegacyTopologyAdapterResult {
  envelope: LegacyTopologyExportEnvelope
  issues: LegacyTopologyAdapterIssue[]
}

export function createLegacyEnterpriseTopologyRegistry(
  options: CreateEnterpriseTopologyRegistryOptions = {},
): LegacyEnterpriseTopologyRegistryStore {
  return createEnterpriseTopologyRegistry(options)
}

export function createLegacyTopologyRegistry(
  options: CreateEnterpriseTopologyRegistryOptions = {},
): LegacyTopologyRegistryStore {
  return createLegacyEnterpriseTopologyRegistry(options)
}

function sortedUniqueStrings(values: Array<string | undefined>): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value?.trim())))]
    .sort((left, right) => left.localeCompare(right))
}

function topologyAgentId(topologyId: string, nodeId: string): string {
  return `${topologyId}:${nodeId}`
}

function relationExecutionCandidate(relation: LegacyEnterpriseRelation): boolean {
  return relation.status !== "archived" && relation.status !== "inactive"
}

function relationNodeRefId(
  relation: LegacyEnterpriseRelation,
  key: "from" | "to",
): string | undefined {
  const ref = (relation as unknown as Partial<Record<"from" | "to", unknown>>)[key]
  if (!ref || typeof ref !== "object" || Array.isArray(ref)) return undefined
  const record = ref as Record<string, unknown>
  return record.entityType === "node" && typeof record.id === "string" && record.id.trim()
    ? record.id
    : undefined
}

function appendIssueWithLegacyCode(input: {
  issues: LegacyTopologyAdapterIssue[]
  issue: LegacyTopologyAdapterIssue
  legacyCode?: string
}): void {
  input.issues.push(input.issue)
  if (!input.legacyCode) return
  input.issues.push({
    ...input.issue,
    code: input.legacyCode,
  })
}

function relationChildIdsByParent(topology: LegacyEnterpriseTopology): Record<string, string[]> {
  const result = new Map<string, Set<string>>()
  const activeNodeIds = new Set(
    topology.nodes
      .filter((node) => node.status !== "archived")
      .map((node) => node.id),
  )

  for (const relation of topology.relations) {
    if (relation.relationType !== "delegates_to" || !relationExecutionCandidate(relation)) continue
    const fromNodeId = relationNodeRefId(relation, "from")
    const toNodeId = relationNodeRefId(relation, "to")
    if (!fromNodeId || !toNodeId || !activeNodeIds.has(fromNodeId) || !activeNodeIds.has(toNodeId)) continue
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

function collectLegacyRelationEndpointIssues(input: {
  topology: LegacyEnterpriseTopology
  topologyVersion: number
  issues: LegacyTopologyAdapterIssue[]
}): void {
  const activeNodeIds = new Set(
    input.topology.nodes
      .filter((node) => node.status !== "archived")
      .map((node) => node.id),
  )

  for (const relation of input.topology.relations) {
    if (relation.relationType !== "delegates_to" || !relationExecutionCandidate(relation)) continue
    const fromNodeId = relationNodeRefId(relation, "from")
    const toNodeId = relationNodeRefId(relation, "to")
    if (!fromNodeId || !toNodeId) {
      appendIssueWithLegacyCode({
        issues: input.issues,
        legacyCode: "topology_relation_endpoint_missing",
        issue: {
          code: "missing_relation_endpoint",
          severity: "invalid",
          message: `Legacy topology relation ${relation.id} is missing structured node from/to endpoints.`,
          topologyId: input.topology.id,
          topologyVersion: input.topologyVersion,
          relationId: relation.id,
        },
      })
      continue
    }
    if (!activeNodeIds.has(fromNodeId) || !activeNodeIds.has(toNodeId)) {
      appendIssueWithLegacyCode({
        issues: input.issues,
        legacyCode: "topology_relation_endpoint_missing",
        issue: {
          code: "missing_relation_endpoint",
          severity: "invalid",
          message: `Legacy topology relation ${relation.id} references a missing node endpoint.`,
          topologyId: input.topology.id,
          topologyVersion: input.topologyVersion,
          relationId: relation.id,
        },
      })
    }
  }
}

function collectLegacyChildrenMismatchIssues(input: {
  topology: LegacyEnterpriseTopology
  topologyVersion: number
  issues: LegacyTopologyAdapterIssue[]
}): void {
  const hasDelegatesToRelation = input.topology.relations.some((relation) => relation.relationType === "delegates_to")
  if (!hasDelegatesToRelation) return

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
        `Legacy topology node ${node.id} children metadata differs from delegates_to relations. Relations are used as source of truth.`,
      topologyId: input.topology.id,
      topologyVersion: input.topologyVersion,
      agentId: topologyAgentId(input.topology.id, node.id),
    })
  }
}

function safeLegacyTopologyForV2Migration(topology: LegacyTopology): LegacyTopology {
  const cloned = structuredClone(topology) as LegacyTopology
  cloned.relations = cloned.relations.map((relation): LegacyRelation => {
    if (relation.relationType !== "delegates_to") return relation
    const fromNodeId = relationNodeRefId(relation, "from")
    const toNodeId = relationNodeRefId(relation, "to")
    return {
      ...relation,
      from: fromNodeId ? relation.from : { entityType: "node", id: "" },
      to: toNodeId ? relation.to : { entityType: "node", id: "" },
    } as LegacyRelation
  })
  return cloned
}

function preserveLegacyRuntimeNodeStatuses(input: {
  source: LegacyTopology
  materialized: LegacyTopology
}): LegacyTopology {
  const sourceStatusByNodeId = new Map(input.source.nodes.map((node) => [node.id, node.status]))
  return {
    ...input.materialized,
    nodes: input.materialized.nodes.map((node) => {
      const sourceStatus = sourceStatusByNodeId.get(node.id)
      if (sourceStatus === "inactive") {
        return {
          ...node,
          status: sourceStatus,
        }
      }
      return node
    }),
  }
}

export function collectLegacyTopologyCompatibilityIssues(
  envelope: LegacyTopologyExportEnvelope,
): LegacyTopologyAdapterIssue[] {
  const topology = envelope.version.topology
  const topologyVersion = envelope.version.version
  const issues: LegacyTopologyAdapterIssue[] = []
  collectLegacyRelationEndpointIssues({ topology, topologyVersion, issues })
  collectLegacyChildrenMismatchIssues({ topology, topologyVersion, issues })
  return issues
}

export function legacyTopologyEnvelopeToExecutorCompatibilityEnvelope(
  envelope: LegacyTopologyExportEnvelope,
): LegacyTopologyAdapterResult {
  const safeTopology = safeLegacyTopologyForV2Migration(envelope.version.topology)
  const readModel = buildExecutorTopologyV2RuntimeReadModelFromEnterpriseTopology(safeTopology)
  const materialized = preserveLegacyRuntimeNodeStatuses({
    source: envelope.version.topology,
    materialized: enterpriseTopologyFromExecutorTopologyV2(readModel.topology, {
      migrationSource: "legacy_enterprise_topology_adapter",
      sourceTopologyVersion: envelope.version.version,
      sourceVersionId: envelope.version.versionId,
      materializedAt: envelope.version.topology.updatedAt,
    }),
  })
  const issues: LegacyTopologyAdapterIssue[] = [
    ...collectLegacyTopologyCompatibilityIssues(envelope),
    ...readModel.issues.map((issue): LegacyTopologyAdapterIssue => ({
      code: issue.code,
      severity: issue.severity,
      message: issue.message,
      topologyId: issue.topologyId,
      ...(issue.relationId ? { relationId: issue.relationId } : {}),
      ...(issue.edgeId ? { edgeId: issue.edgeId } : {}),
      ...(issue.nodeId ? { agentId: topologyAgentId(issue.topologyId, issue.nodeId) } : {}),
    })),
  ]

  return {
    envelope: {
      ...envelope,
      version: {
        ...envelope.version,
        topology: materialized,
      },
    },
    issues,
  }
}
