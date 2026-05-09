import {
  ENTERPRISE_TOPOLOGY_SCHEMA_VERSION,
  type EnterpriseMetadata,
  type EnterpriseRelation,
  type EnterpriseTeam,
  type EnterpriseTimestamp,
  type EnterpriseTool,
  type EnterpriseTopology,
  type EnterpriseSystem,
  type NodeContract,
} from "../contracts/enterprise-topology.js"
import type {
  AgentRelationship,
  CapabilityPolicy,
  SubAgentConfig,
  TeamConfig,
} from "../contracts/sub-agent-orchestration.js"
import {
  listAgentConfigs,
  listAgentRelationships,
  listTeamConfigs,
  type DbAgentConfig,
  type DbAgentRelationship,
  type DbTeamConfig,
} from "../db/index.js"
import { validateTopology, type TopologyValidationResult } from "./validator.js"

export type AgentTeamImportMode = "team" | "skip"

export interface AgentTeamTopologyImportTransformation {
  sourceType: "AgentConfig" | "TeamConfig" | "AgentRelationship"
  sourceId: string
  targetType: "NodeContract" | "Team" | "Relation"
  targetId: string
  summary: string
}

export interface AgentTeamTopologyImportPreview {
  ok: true
  topology: EnterpriseTopology
  validation: TopologyValidationResult
  transformations: AgentTeamTopologyImportTransformation[]
  metadata: {
    agentCount: number
    teamCount: number
    relationshipCount: number
    teamImportMode: AgentTeamImportMode
    teamRequiresExplicitChoice: boolean
    sourceOfTruth: "enterprise_topology_draft"
    legacySourceRole: "migration_source_only"
  }
}

export interface BuildAgentTeamTopologyImportPreviewInput {
  topologyId?: string
  name?: string
  teamImportMode?: AgentTeamImportMode
  agents?: unknown[]
  teams?: unknown[]
  relationships?: unknown[]
  now?: number
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

function parseRecordJson(value: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(value) as unknown
    return isRecord(parsed) ? parsed : null
  } catch {
    return null
  }
}

function agentFromRow(row: DbAgentConfig): Record<string, unknown> {
  return parseRecordJson(row.config_json) ?? {
    schemaVersion: row.schema_version,
    agentType: row.agent_type,
    agentId: row.agent_id,
    displayName: row.display_name,
    status: row.status,
    role: row.role,
    personality: row.personality,
    specialtyTags: parseStringArray(row.specialty_tags_json),
    avoidTasks: parseStringArray(row.avoid_tasks_json),
    capabilityPolicy: parseRecordJson(row.capability_policy_json) ?? undefined,
    profileVersion: row.profile_version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function teamFromRow(row: DbTeamConfig): Record<string, unknown> {
  return parseRecordJson(row.config_json) ?? {
    schemaVersion: row.schema_version,
    teamId: row.team_id,
    displayName: row.display_name,
    status: row.status,
    purpose: row.purpose,
    ownerAgentId: row.owner_agent_id ?? undefined,
    leadAgentId: row.lead_agent_id ?? undefined,
    memberAgentIds: parseStringArray(row.member_agent_ids_json),
    roleHints: parseStringArray(row.role_hints_json),
    profileVersion: row.profile_version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function relationshipFromRow(row: DbAgentRelationship): Record<string, unknown> {
  return {
    edgeId: row.edge_id,
    parentAgentId: row.parent_agent_id,
    childAgentId: row.child_agent_id,
    relationshipType: row.relationship_type,
    status: row.status,
    sortOrder: row.sort_order,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function parseStringArray(value: string | null | undefined): string[] {
  if (!value) return []
  try {
    const parsed = JSON.parse(value) as unknown
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
      : []
  } catch {
    return []
  }
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    : []
}

function asTimestamp(value: unknown, fallback: number): EnterpriseTimestamp {
  return (typeof value === "number" && Number.isFinite(value)) || (typeof value === "string" && value.trim())
    ? value
    : fallback
}

function stableSegment(value: string): string {
  return value.trim().replace(/[^a-zA-Z0-9:_-]+/g, "-").replace(/^-+|-+$/g, "") || "imported"
}

function agentNodeId(agentId: string): string {
  return `node:${stableSegment(agentId)}`
}

function toolId(toolName: string): string {
  return `tool:${stableSegment(toolName)}`
}

function systemId(systemName: string): string {
  return `system:${stableSegment(systemName)}`
}

function displayName(record: Record<string, unknown>, fallback: string): string {
  return asString(record.displayName) ?? asString(record.nickname) ?? asString(record.agentId) ?? asString(record.teamId) ?? fallback
}

function capabilityPolicy(record: Record<string, unknown>): CapabilityPolicy | undefined {
  return isRecord(record.capabilityPolicy) ? record.capabilityPolicy as unknown as CapabilityPolicy : undefined
}

function collectToolNames(record: Record<string, unknown>): string[] {
  const allowlist = capabilityPolicy(record)?.skillMcpAllowlist
  return [...new Set([
    ...asStringArray(allowlist?.enabledToolNames),
    ...asStringArray(record.allowedToolIds),
  ])]
}

function collectSystemNames(record: Record<string, unknown>): string[] {
  const allowlist = capabilityPolicy(record)?.skillMcpAllowlist
  const names = [
    ...asStringArray(allowlist?.enabledMcpServerIds),
    ...asStringArray(record.allowedSystemIds),
  ]
  if (capabilityPolicy(record)?.permissionProfile.allowExternalNetwork) names.push("external-network")
  return [...new Set(names)]
}

function agentStatusToTopologyStatus(status: unknown): "draft" | "inactive" | "archived" {
  if (status === "archived") return "archived"
  if (status === "disabled") return "inactive"
  return "draft"
}

function agentRecord(value: unknown): Record<string, unknown> | null {
  if (!isRecord(value)) return null
  if (asString(value.agentId) === undefined) return null
  return value
}

function teamRecord(value: unknown): Record<string, unknown> | null {
  if (!isRecord(value)) return null
  if (asString(value.teamId) === undefined) return null
  return value
}

function relationshipRecord(value: unknown): Record<string, unknown> | null {
  if (!isRecord(value)) return null
  if (asString(value.parentAgentId) === undefined || asString(value.childAgentId) === undefined) return null
  if (value.relationshipType !== undefined && value.relationshipType !== "parent_child") return null
  return value
}

function importedNode(record: Record<string, unknown>, now: number): NodeContract {
  const agentId = asString(record.agentId) ?? "agent:imported"
  const createdAt = asTimestamp(record.createdAt, now)
  const updatedAt = asTimestamp(record.updatedAt, now)
  const allowedToolIds = collectToolNames(record).map(toolId)
  const allowedSystemIds = collectSystemNames(record).map(systemId)
  const metadata: EnterpriseMetadata = {
    imported_from_agent_config: agentId,
    importedFromAgentConfigId: agentId,
    source_role: "migration_source_only",
    source_profile_version: typeof record.profileVersion === "number" ? record.profileVersion : null,
  }
  const instruction = [asString(record.role), asString(record.personality)].filter(Boolean).join("\n\n")
  const recordDisplayName = asString(record.displayName)

  return {
    schemaVersion: ENTERPRISE_TOPOLOGY_SCHEMA_VERSION,
    entityType: "node",
    id: agentNodeId(agentId),
    name: displayName(record, agentId),
    ...(recordDisplayName ? { displayName: recordDisplayName } : {}),
    status: agentStatusToTopologyStatus(record.status),
    createdAt,
    updatedAt,
    nodeType: "function",
    ...(instruction ? { instruction } : {}),
    description: asString(record.role) ?? "Imported AgentConfig migration node.",
    tags: asStringArray(record.specialtyTags),
    children: [],
    template: {
      templateId: "template:imported-agent-config",
      source: "imported",
      fixedRoleCatalog: false,
      metadata,
    },
    allowedToolIds,
    allowedSystemIds,
    metadata,
  }
}

function importedTeam(record: Record<string, unknown>, nodeIdsByAgentId: ReadonlyMap<string, string>, now: number): EnterpriseTeam {
  const teamId = asString(record.teamId) ?? "team:imported"
  const memberNodeIds = asStringArray(record.memberAgentIds)
    .map((agentId) => nodeIdsByAgentId.get(agentId))
    .filter((nodeId): nodeId is string => nodeId !== undefined)
  const metadata: EnterpriseMetadata = {
    imported_from_team_config: teamId,
    source_role: "migration_source_only",
    import_choice: "team_not_org_unit",
  }
  return {
    schemaVersion: ENTERPRISE_TOPOLOGY_SCHEMA_VERSION,
    entityType: "team",
    id: teamId,
    name: displayName(record, teamId),
    status: agentStatusToTopologyStatus(record.status),
    createdAt: asTimestamp(record.createdAt, now),
    updatedAt: asTimestamp(record.updatedAt, now),
    purpose: asString(record.purpose) ?? "Imported TeamConfig migration group.",
    nodeIds: memberNodeIds,
    tags: asStringArray(record.roleHints),
    metadata,
  }
}

function importedTool(id: string, sourceName: string, now: number): EnterpriseTool {
  return {
    schemaVersion: ENTERPRISE_TOPOLOGY_SCHEMA_VERSION,
    entityType: "enterprise_tool",
    id,
    name: sourceName,
    status: "draft",
    createdAt: now,
    updatedAt: now,
    toolType: "unknown",
    metadata: {
      imported_from_agent_config_tool: sourceName,
      source_role: "migration_source_only",
    },
  }
}

function importedSystem(id: string, sourceName: string, now: number): EnterpriseSystem {
  return {
    schemaVersion: ENTERPRISE_TOPOLOGY_SCHEMA_VERSION,
    entityType: "enterprise_system",
    id,
    name: sourceName,
    status: "draft",
    createdAt: now,
    updatedAt: now,
    systemType: sourceName === "external-network" ? "external" : "unknown",
    dataDomainIds: [],
    criticality: "unknown",
    metadata: {
      imported_from_agent_config_system: sourceName,
      source_role: "migration_source_only",
    },
  }
}

function importedDelegationRelation(
  record: Record<string, unknown>,
  nodeIdsByAgentId: ReadonlyMap<string, string>,
  now: number,
): EnterpriseRelation | null {
  const parentAgentId = asString(record.parentAgentId)
  const childAgentId = asString(record.childAgentId)
  if (parentAgentId === undefined || childAgentId === undefined) return null
  const fromNodeId = nodeIdsByAgentId.get(parentAgentId)
  const toNodeId = nodeIdsByAgentId.get(childAgentId)
  if (fromNodeId === undefined || toNodeId === undefined) return null
  const edgeId = asString(record.edgeId) ?? `${parentAgentId}:${childAgentId}`
  return {
    schemaVersion: ENTERPRISE_TOPOLOGY_SCHEMA_VERSION,
    entityType: "relation",
    id: `relation:delegates:${stableSegment(edgeId)}`,
    name: `${parentAgentId} delegates to ${childAgentId}`,
    status: agentStatusToTopologyStatus(record.status),
    createdAt: asTimestamp(record.createdAt, now),
    updatedAt: asTimestamp(record.updatedAt, now),
    relationType: "delegates_to",
    from: { entityType: "node", id: fromNodeId },
    to: { entityType: "node", id: toNodeId },
    label: "delegates_to",
    metadata: {
      imported_from_agent_relationship: edgeId,
      source_relationship_type: "parent_child",
      source_role: "migration_source_only",
    },
  }
}

export function buildAgentTeamTopologyImportPreview(
  input: BuildAgentTeamTopologyImportPreviewInput = {},
): AgentTeamTopologyImportPreview {
  const now = input.now ?? Date.now()
  const teamImportMode = input.teamImportMode ?? "team"
  const rawAgents = input.agents ?? listAgentConfigs({ includeArchived: false }).map(agentFromRow)
  const rawTeams = input.teams ?? listTeamConfigs({ includeArchived: false }).map(teamFromRow)
  const rawRelationships = input.relationships ?? listAgentRelationships({ status: "active" }).map(relationshipFromRow)
  const agents = rawAgents.map(agentRecord).filter((record): record is Record<string, unknown> => record !== null)
  const teams = rawTeams.map(teamRecord).filter((record): record is Record<string, unknown> => record !== null)
  const relationships = rawRelationships.map(relationshipRecord).filter((record): record is Record<string, unknown> => record !== null)
  const transformations: AgentTeamTopologyImportTransformation[] = []
  const nodeIdsByAgentId = new Map<string, string>()
  const toolsById = new Map<string, EnterpriseTool>()
  const systemsById = new Map<string, EnterpriseSystem>()

  const nodes = agents.map((agent) => {
    const node = importedNode(agent, now)
    const agentId = asString(agent.agentId) ?? node.id
    nodeIdsByAgentId.set(agentId, node.id)
    transformations.push({
      sourceType: "AgentConfig",
      sourceId: agentId,
      targetType: "NodeContract",
      targetId: node.id,
      summary: "AgentConfig -> NodeContract",
    })
    for (const name of collectToolNames(agent)) toolsById.set(toolId(name), importedTool(toolId(name), name, now))
    for (const name of collectSystemNames(agent)) systemsById.set(systemId(name), importedSystem(systemId(name), name, now))
    return node
  })

  const relations = relationships
    .map((relationship) => importedDelegationRelation(relationship, nodeIdsByAgentId, now))
    .filter((relation): relation is EnterpriseRelation => relation !== null)
  for (const relation of relations) {
    const parent = nodes.find((node) => node.id === relation.from.id)
    if (parent && relation.to.entityType === "node") {
      parent.children = [...new Set([...parent.children, relation.to.id])]
    }
    transformations.push({
      sourceType: "AgentRelationship",
      sourceId: String(relation.metadata?.imported_from_agent_relationship ?? relation.id),
      targetType: "Relation",
      targetId: relation.id,
      summary: "parent_child -> delegates_to",
    })
  }

  const enterpriseTeams = teamImportMode === "team"
    ? teams.map((team) => {
        const converted = importedTeam(team, nodeIdsByAgentId, now)
        transformations.push({
          sourceType: "TeamConfig",
          sourceId: asString(team.teamId) ?? converted.id,
          targetType: "Team",
          targetId: converted.id,
          summary: "TeamConfig -> Team",
        })
        return converted
      })
    : []

  const topology: EnterpriseTopology = {
    schemaVersion: ENTERPRISE_TOPOLOGY_SCHEMA_VERSION,
    entityType: "topology",
    id: input.topologyId ?? `topology:agent-team-import:${now}`,
    name: input.name ?? "Imported Agent and Team Topology",
    description: "Legacy AgentConfig/TeamConfig migration draft. Enterprise Topology is the new source of truth.",
    status: "draft",
    createdAt: now,
    updatedAt: now,
    metadata: {
      import_source: "agent_team_topology",
      source_role: "migration_source_only",
      source_of_truth: "enterprise_topology_draft",
      team_import_mode: teamImportMode,
      team_requires_explicit_choice: teams.length > 0,
      agent_config_count: agents.length,
      team_config_count: teams.length,
      relationship_count: relationships.length,
    },
    nodes,
    teams: enterpriseTeams,
    orgUnits: [],
    positions: [],
    persons: [],
    memberships: [],
    authorityRules: [],
    responsibilities: [],
    systems: [...systemsById.values()],
    tools: [...toolsById.values()],
    processes: [],
    relations,
  }

  return {
    ok: true,
    topology,
    validation: validateTopology(topology),
    transformations,
    metadata: {
      agentCount: agents.length,
      teamCount: teams.length,
      relationshipCount: relationships.length,
      teamImportMode,
      teamRequiresExplicitChoice: teams.length > 0,
      sourceOfTruth: "enterprise_topology_draft",
      legacySourceRole: "migration_source_only",
    },
  }
}
