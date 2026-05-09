import {
  validateEnterpriseTopology,
  type AuthorityRule,
  type EnterpriseEntityRef,
  type EnterpriseEntityType,
  type EnterpriseRelation,
  type EnterpriseRelationType,
  type EnterpriseTopology,
  type EnterpriseTimestamp,
  type EnterpriseTopologyValidationCode,
  type EnterpriseTopologyValidationIssue,
  type Membership,
  type NodeContract,
  type OrgUnit,
  type Position,
  type ResponsibilityMatrixEntry,
} from "../contracts/enterprise-topology.js"
import {
  DEFAULT_TOPOLOGY_MAX_DELEGATION_DEPTH,
  isEnterpriseRelationEndpointAllowed,
  TOPOLOGY_VALIDATOR_BLOCKING_SEVERITIES,
} from "./schema.js"

export type TopologyValidatorSeverity = "info" | "warning" | "blocked" | "invalid"

export type TopologyValidatorIssueCode =
  | EnterpriseTopologyValidationCode
  | "duplicate_entity_id"
  | "missing_entity_reference"
  | "delegation_cycle"
  | "max_delegation_depth_exceeded"
  | "empty_team_nodes"
  | "empty_process_steps"
  | "authority_rule_conflict"
  | "invalid_authority_rule_action"
  | "approval_authority_missing"
  | "tool_permission_missing"
  | "system_permission_missing"
  | "declared_tool_relation_missing"
  | "declared_system_relation_missing"
  | "process_owner_missing"
  | "process_step_owner_missing"
  | "process_transition_reference_invalid"
  | "responsibility_matrix_missing"
  | "raci_accountable_missing"
  | "failure_policy_missing"
  | "recovery_policy_missing"
  | "invalid_failure_policy"
  | "invalid_recovery_policy"
  | "org_unit_hierarchy_cycle"
  | "position_reports_to_cycle"
  | "position_reports_to_invalid_org_scope"
  | "membership_validity_invalid"
  | "membership_allocation_invalid"
  | "person_membership_allocation_exceeded"
  | "approval_limit_missing"
  | "approval_limit_exceeded"
  | "authority_delegation_invalid"
  | "process_sla_missing"
  | "process_sla_invalid"
  | "critical_system_access_missing"
  | "data_domain_access_missing"

export interface TopologyValidatorIssue {
  path: string
  code: TopologyValidatorIssueCode
  reasonCode: TopologyValidatorIssueCode
  severity: TopologyValidatorSeverity
  message: string
  entityId?: string
  entityType?: EnterpriseEntityType
  relationId?: string
  refId?: string
  refType?: EnterpriseEntityType
  sourceEntityId?: string
  targetEntityId?: string
}

export interface TopologyValidatorIssueInput {
  path: string
  code: TopologyValidatorIssueCode
  severity: TopologyValidatorSeverity
  message: string
  reasonCode?: TopologyValidatorIssueCode
  entityId?: string
  entityType?: EnterpriseEntityType
  relationId?: string
  refId?: string
  refType?: EnterpriseEntityType
  sourceEntityId?: string
  targetEntityId?: string
}

export interface TopologyValidationIssueCounts {
  info: number
  warning: number
  blocked: number
  invalid: number
}

export interface TopologyValidationResult {
  ok: boolean
  executable: boolean
  issues: TopologyValidatorIssue[]
  issueCounts: TopologyValidationIssueCounts
}

export interface TopologyValidatorOptions {
  maxDelegationDepth?: number
  asOf?: EnterpriseTimestamp
}

interface EntityCollectionDefinition {
  key:
    | "nodes"
    | "teams"
    | "orgUnits"
    | "positions"
    | "persons"
    | "memberships"
    | "authorityRules"
    | "responsibilities"
    | "systems"
    | "tools"
    | "processes"
    | "relations"
  entityType: EnterpriseEntityType
}

interface IndexedTopologyEntity {
  id: string
  entityType: EnterpriseEntityType
  path: string
}

interface TopologyEntityIndexes {
  byId: Map<string, IndexedTopologyEntity[]>
  byType: Map<EnterpriseEntityType, Map<string, IndexedTopologyEntity>>
}

interface ReferenceOwner {
  entityId: string
  entityType: EnterpriseEntityType
  relationId?: string
}

interface DelegationEdge {
  from: string
  to: string
  path: string
  relationId?: string
}

const TOPOLOGY_ENTITY_TYPES: readonly EnterpriseEntityType[] = [
  "topology",
  "topology_version",
  "node",
  "team",
  "org_unit",
  "position",
  "person",
  "membership",
  "authority_rule",
  "responsibility_matrix_entry",
  "enterprise_system",
  "enterprise_tool",
  "process_definition",
  "relation",
]

const TOPOLOGY_ENTITY_COLLECTIONS: readonly EntityCollectionDefinition[] = [
  { key: "nodes", entityType: "node" },
  { key: "teams", entityType: "team" },
  { key: "orgUnits", entityType: "org_unit" },
  { key: "positions", entityType: "position" },
  { key: "persons", entityType: "person" },
  { key: "memberships", entityType: "membership" },
  { key: "authorityRules", entityType: "authority_rule" },
  { key: "responsibilities", entityType: "responsibility_matrix_entry" },
  { key: "systems", entityType: "enterprise_system" },
  { key: "tools", entityType: "enterprise_tool" },
  { key: "processes", entityType: "process_definition" },
  { key: "relations", entityType: "relation" },
]

const COLLECTION_ENTITY_TYPE_BY_KEY: Record<EntityCollectionDefinition["key"], EnterpriseEntityType> = {
  nodes: "node",
  teams: "team",
  orgUnits: "org_unit",
  positions: "position",
  persons: "person",
  memberships: "membership",
  authorityRules: "authority_rule",
  responsibilities: "responsibility_matrix_entry",
  systems: "enterprise_system",
  tools: "enterprise_tool",
  processes: "process_definition",
  relations: "relation",
}

export const TOPOLOGY_VALIDATOR_QUICK_FIX_CODES = [
  "missing_entity_reference",
  "duplicate_entity_id",
] as const satisfies readonly TopologyValidatorIssueCode[]

export const ENTERPRISE_TOPOLOGY_COMPATIBILITY_QUICK_FIX_CODES = [
  "missing_entity_reference",
  "duplicate_entity_id",
  "authority_rule_conflict",
  "invalid_authority_rule_action",
  "approval_authority_missing",
  "tool_permission_missing",
  "system_permission_missing",
  "declared_tool_relation_missing",
  "declared_system_relation_missing",
  "process_owner_missing",
  "process_step_owner_missing",
  "process_transition_reference_invalid",
  "responsibility_matrix_missing",
  "raci_accountable_missing",
  "failure_policy_missing",
  "recovery_policy_missing",
  "invalid_failure_policy",
  "invalid_recovery_policy",
  "membership_validity_invalid",
  "person_membership_allocation_exceeded",
  "approval_limit_missing",
  "approval_limit_exceeded",
  "authority_delegation_invalid",
  "critical_system_access_missing",
  "data_domain_access_missing",
] as const satisfies readonly TopologyValidatorIssueCode[]

export class TopologyValidationGateError extends Error {
  readonly issues: TopologyValidatorIssue[]

  constructor(issues: TopologyValidatorIssue[]) {
    super("Topology validation contains blocked or invalid issues.")
    this.name = "TopologyValidationGateError"
    this.issues = issues
  }
}

export function createTopologyValidatorIssue(input: TopologyValidatorIssueInput): TopologyValidatorIssue {
  return {
    path: input.path,
    code: input.code,
    reasonCode: input.reasonCode ?? input.code,
    severity: input.severity,
    message: input.message,
    ...(input.entityId !== undefined ? { entityId: input.entityId } : {}),
    ...(input.entityType !== undefined ? { entityType: input.entityType } : {}),
    ...(input.relationId !== undefined ? { relationId: input.relationId } : {}),
    ...(input.refId !== undefined ? { refId: input.refId } : {}),
    ...(input.refType !== undefined ? { refType: input.refType } : {}),
    ...(input.sourceEntityId !== undefined ? { sourceEntityId: input.sourceEntityId } : {}),
    ...(input.targetEntityId !== undefined ? { targetEntityId: input.targetEntityId } : {}),
  }
}

export function validateTopology(value: unknown, options: TopologyValidatorOptions = {}): TopologyValidationResult {
  return validateTopologyInternal(value, options, { compatibilityRules: "auto" })
}

export function validateEnterpriseTopologyCompatibility(
  value: unknown,
  options: TopologyValidatorOptions = {},
): TopologyValidationResult {
  return validateTopologyInternal(value, options, { compatibilityRules: "always" })
}

function validateTopologyInternal(
  value: unknown,
  options: TopologyValidatorOptions,
  mode: { compatibilityRules: "auto" | "always" },
): TopologyValidationResult {
  const contractValidation = validateEnterpriseTopology(value)
  if (!contractValidation.ok) {
    return buildTopologyValidationResult(contractValidation.issues.map((issue) => convertContractIssue(value, issue)))
  }

  const issues: TopologyValidatorIssue[] = []
  const topology = contractValidation.value
  const indexes = buildTopologyEntityIndexes(topology, issues)
  validateTopologyReferences(topology, indexes, issues)
  validateDelegationGraph(topology, indexes, issues, options.maxDelegationDepth ?? DEFAULT_TOPOLOGY_MAX_DELEGATION_DEPTH)
  if (mode.compatibilityRules === "always" || !isExecutorTopologyV2PersistenceProjection(topology)) {
    validateEnterpriseRules(topology, indexes, issues, options)
  }

  return buildTopologyValidationResult(issues)
}

export function isTopologyValidationExecutable(result: TopologyValidationResult): boolean {
  return result.executable
}

export function assertTopologyValidationExecutable(result: TopologyValidationResult): void {
  if (result.executable) return
  throw new TopologyValidationGateError(
    result.issues.filter((issue) => isBlockingSeverity(issue.severity)),
  )
}

function buildTopologyValidationResult(issues: TopologyValidatorIssue[]): TopologyValidationResult {
  const issueCounts: TopologyValidationIssueCounts = {
    info: 0,
    warning: 0,
    blocked: 0,
    invalid: 0,
  }

  for (const issue of issues) {
    issueCounts[issue.severity] += 1
  }

  const executable = issueCounts.blocked === 0 && issueCounts.invalid === 0
  return {
    ok: executable,
    executable,
    issues,
    issueCounts,
  }
}

function convertContractIssue(value: unknown, issue: EnterpriseTopologyValidationIssue): TopologyValidatorIssue {
  const context = inferEntityContextFromPath(value, issue.path)
  const entityId = issue.entityId ?? context.entityId
  const entityType = context.entityType
  const relationId = issue.relationId ?? context.relationId

  return createTopologyValidatorIssue({
    path: issue.path,
    code: issue.code,
    reasonCode: issue.reasonCode,
    severity: severityForContractIssue(issue.code),
    message: issue.message,
    ...(entityId !== undefined ? { entityId } : {}),
    ...(entityType !== undefined ? { entityType } : {}),
    ...(relationId !== undefined ? { relationId } : {}),
  })
}

function severityForContractIssue(_code: EnterpriseTopologyValidationCode): TopologyValidatorSeverity {
  return "invalid"
}

function isBlockingSeverity(severity: TopologyValidatorSeverity): severity is "blocked" | "invalid" {
  return TOPOLOGY_VALIDATOR_BLOCKING_SEVERITIES.some((blockingSeverity) => blockingSeverity === severity)
}

function inferEntityContextFromPath(
  value: unknown,
  path: string,
): { entityId?: string; entityType?: EnterpriseEntityType; relationId?: string } {
  const match = /^\$\.([A-Za-z]+)\[(\d+)\]/.exec(path)
  const collectionKey = match?.[1]
  const indexText = match?.[2]
  if (!isTopologyCollectionKey(collectionKey) || indexText === undefined || !isRecord(value)) return {}

  const collection = value[collectionKey]
  const index = Number.parseInt(indexText, 10)
  if (!Array.isArray(collection) || !Number.isInteger(index)) return {}

  const item = collection[index]
  if (!isRecord(item) || typeof item.id !== "string") return {}

  const entityType = COLLECTION_ENTITY_TYPE_BY_KEY[collectionKey]
  return {
    entityId: item.id,
    entityType,
    ...(entityType === "relation" ? { relationId: item.id } : {}),
  }
}

function isTopologyCollectionKey(value: unknown): value is EntityCollectionDefinition["key"] {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(COLLECTION_ENTITY_TYPE_BY_KEY, value)
}

function isExecutorTopologyV2PersistenceProjection(topology: EnterpriseTopology): boolean {
  const marker = recordFromMetadata(topology.metadata?.executorTopologyV2)
  return marker?.schemaVersion === 2 && marker.sourceOfTruth === "executor_topology_v2"
}

function recordFromMetadata(value: unknown): Record<string, unknown> | undefined {
  return isRecord(value) ? value : undefined
}

function buildTopologyEntityIndexes(topology: EnterpriseTopology, issues: TopologyValidatorIssue[]): TopologyEntityIndexes {
  const indexes: TopologyEntityIndexes = {
    byId: new Map(),
    byType: new Map(),
  }

  addIndexedEntity(indexes, issues, {
    id: topology.id,
    entityType: "topology",
    path: "$",
  })

  for (const definition of TOPOLOGY_ENTITY_COLLECTIONS) {
    const collection = topology[definition.key]
    for (let index = 0; index < collection.length; index += 1) {
      const entity = collection[index]
      if (entity === undefined) continue
      addIndexedEntity(indexes, issues, {
        id: entity.id,
        entityType: definition.entityType,
        path: `$.${definition.key}[${index}]`,
      })
    }
  }

  return indexes
}

function addIndexedEntity(
  indexes: TopologyEntityIndexes,
  issues: TopologyValidatorIssue[],
  entity: IndexedTopologyEntity,
): void {
  const existingGlobal = indexes.byId.get(entity.id)
  if (existingGlobal !== undefined && existingGlobal.length > 0) {
    const existing = existingGlobal[0]
    issues.push(createTopologyValidatorIssue({
      path: `${entity.path}.id`,
      code: "duplicate_entity_id",
      severity: "invalid",
      message: `Entity id ${entity.id} is already used at ${existing?.path ?? "another topology entity"}.`,
      entityId: entity.id,
      entityType: entity.entityType,
    }))
  }

  const byType = indexes.byType.get(entity.entityType) ?? new Map<string, IndexedTopologyEntity>()
  if (!indexes.byType.has(entity.entityType)) indexes.byType.set(entity.entityType, byType)
  if (!byType.has(entity.id)) byType.set(entity.id, entity)

  indexes.byId.set(entity.id, [...(existingGlobal ?? []), entity])
}

function validateTopologyReferences(
  topology: EnterpriseTopology,
  indexes: TopologyEntityIndexes,
  issues: TopologyValidatorIssue[],
): void {
  topology.nodes.forEach((node, index) => validateNodeReferences(node, `$.nodes[${index}]`, indexes, issues))
  topology.teams.forEach((team, index) => {
    const owner = ownerFrom("team", team.id)
    if (team.nodeIds.length === 0) {
      issues.push(createTopologyValidatorIssue({
        path: `$.teams[${index}].nodeIds`,
        code: "empty_team_nodes",
        severity: "warning",
        message: "Team has no nodes assigned.",
        entityId: team.id,
        entityType: "team",
      }))
    }
    team.nodeIds.forEach((nodeId, nodeIndex) => {
      validateTypedReference(indexes, issues, "node", nodeId, `$.teams[${index}].nodeIds[${nodeIndex}]`, owner)
    })
  })

  topology.orgUnits.forEach((orgUnit, index) => {
    const owner = ownerFrom("org_unit", orgUnit.id)
    validateOptionalTypedReference(
      indexes,
      issues,
      "org_unit",
      orgUnit.parentOrgUnitId,
      `$.orgUnits[${index}].parentOrgUnitId`,
      owner,
    )
    orgUnit.positionIds.forEach((positionId, positionIndex) => {
      validateTypedReference(indexes, issues, "position", positionId, `$.orgUnits[${index}].positionIds[${positionIndex}]`, owner)
    })
    orgUnit.personIds.forEach((personId, personIndex) => {
      validateTypedReference(indexes, issues, "person", personId, `$.orgUnits[${index}].personIds[${personIndex}]`, owner)
    })
  })

  topology.positions.forEach((position, index) => validatePositionReferences(position, `$.positions[${index}]`, indexes, issues))
  topology.persons.forEach((person, index) => {
    const owner = ownerFrom("person", person.id)
    person.positionIds.forEach((positionId, positionIndex) => {
      validateTypedReference(indexes, issues, "position", positionId, `$.persons[${index}].positionIds[${positionIndex}]`, owner)
    })
    person.orgUnitIds.forEach((orgUnitId, orgUnitIndex) => {
      validateTypedReference(indexes, issues, "org_unit", orgUnitId, `$.persons[${index}].orgUnitIds[${orgUnitIndex}]`, owner)
    })
  })

  topology.memberships.forEach((membership, index) => {
    validateMembershipReferences(membership, `$.memberships[${index}]`, indexes, issues)
  })
  topology.authorityRules.forEach((rule, index) => {
    validateAuthorityRuleReferences(rule, `$.authorityRules[${index}]`, indexes, issues)
  })
  topology.responsibilities.forEach((entry, index) => {
    validateResponsibilityReferences(entry, `$.responsibilities[${index}]`, indexes, issues)
  })
  topology.tools.forEach((tool, index) => {
    validateOptionalTypedReference(
      indexes,
      issues,
      "enterprise_system",
      tool.systemId,
      `$.tools[${index}].systemId`,
      ownerFrom("enterprise_tool", tool.id),
    )
  })
  topology.processes.forEach((process, index) => {
    const owner = ownerFrom("process_definition", process.id)
    if (process.stepNodeIds.length === 0) {
      issues.push(createTopologyValidatorIssue({
        path: `$.processes[${index}].stepNodeIds`,
        code: "empty_process_steps",
        severity: "warning",
        message: "Process definition has no step nodes.",
        entityId: process.id,
        entityType: "process_definition",
      }))
    }
    validateOptionalTypedReference(indexes, issues, "node", process.ownerNodeId, `$.processes[${index}].ownerNodeId`, owner)
    process.stepNodeIds.forEach((nodeId, nodeIndex) => {
      validateTypedReference(indexes, issues, "node", nodeId, `$.processes[${index}].stepNodeIds[${nodeIndex}]`, owner)
    })
    validateOptionalTypedReference(
      indexes,
      issues,
      "position",
      process.accountablePositionId,
      `$.processes[${index}].accountablePositionId`,
      owner,
    )
  })
  topology.relations.forEach((relation, index) => {
    validateRelationReferences(relation, `$.relations[${index}]`, indexes, issues)
  })
}

function validateNodeReferences(
  node: NodeContract,
  path: string,
  indexes: TopologyEntityIndexes,
  issues: TopologyValidatorIssue[],
): void {
  const owner = ownerFrom("node", node.id)
  if (node.owner !== undefined) validateEntityReference(indexes, issues, node.owner, `${path}.owner`, owner)
  node.children.forEach((childId, index) => {
    validateTypedReference(indexes, issues, "node", childId, `${path}.children[${index}]`, owner)
  })
  node.allowedToolIds.forEach((toolId, index) => {
    validateTypedReference(indexes, issues, "enterprise_tool", toolId, `${path}.allowedToolIds[${index}]`, owner)
  })
  node.allowedSystemIds.forEach((systemId, index) => {
    validateTypedReference(indexes, issues, "enterprise_system", systemId, `${path}.allowedSystemIds[${index}]`, owner)
  })
}

function validatePositionReferences(
  position: Position,
  path: string,
  indexes: TopologyEntityIndexes,
  issues: TopologyValidatorIssue[],
): void {
  const owner = ownerFrom("position", position.id)
  validateTypedReference(indexes, issues, "org_unit", position.orgUnitId, `${path}.orgUnitId`, owner)
  validateOptionalTypedReference(indexes, issues, "position", position.reportsToPositionId, `${path}.reportsToPositionId`, owner)
  position.personIds.forEach((personId, index) => {
    validateTypedReference(indexes, issues, "person", personId, `${path}.personIds[${index}]`, owner)
  })
  validateOptionalTypedReference(indexes, issues, "position", position.backupPositionId, `${path}.backupPositionId`, owner)
}

function validateMembershipReferences(
  membership: Membership,
  path: string,
  indexes: TopologyEntityIndexes,
  issues: TopologyValidatorIssue[],
): void {
  const owner = ownerFrom("membership", membership.id)
  validateTypedReference(indexes, issues, "person", membership.personId, `${path}.personId`, owner)
  validateOptionalTypedReference(indexes, issues, "position", membership.positionId, `${path}.positionId`, owner)
  validateOptionalTypedReference(indexes, issues, "org_unit", membership.orgUnitId, `${path}.orgUnitId`, owner)
  validateOptionalTypedReference(indexes, issues, "team", membership.teamId, `${path}.teamId`, owner)
}

function validateAuthorityRuleReferences(
  rule: AuthorityRule,
  path: string,
  indexes: TopologyEntityIndexes,
  issues: TopologyValidatorIssue[],
): void {
  const owner = ownerFrom("authority_rule", rule.id)
  validateEntityReference(indexes, issues, rule.subject, `${path}.subject`, owner)
  validateEntityReference(indexes, issues, rule.object, `${path}.object`, owner)
}

function validateResponsibilityReferences(
  entry: ResponsibilityMatrixEntry,
  path: string,
  indexes: TopologyEntityIndexes,
  issues: TopologyValidatorIssue[],
): void {
  const owner = ownerFrom("responsibility_matrix_entry", entry.id)
  validateEntityReference(indexes, issues, entry.scope, `${path}.scope`, owner)
  validateEntityReference(indexes, issues, entry.responsible, `${path}.responsible`, owner)
  if (entry.accountable !== undefined) validateEntityReference(indexes, issues, entry.accountable, `${path}.accountable`, owner)
  if (Array.isArray(entry.consulted)) {
    entry.consulted.forEach((reference, index) => validateEntityReference(indexes, issues, reference, `${path}.consulted[${index}]`, owner))
  }
  if (Array.isArray(entry.informed)) {
    entry.informed.forEach((reference, index) => validateEntityReference(indexes, issues, reference, `${path}.informed[${index}]`, owner))
  }
}

function validateRelationReferences(
  relation: EnterpriseRelation,
  path: string,
  indexes: TopologyEntityIndexes,
  issues: TopologyValidatorIssue[],
): void {
  const owner = ownerFrom("relation", relation.id, relation.id)
  validateEntityReference(indexes, issues, relation.from, `${path}.from`, owner)
  validateEntityReference(indexes, issues, relation.to, `${path}.to`, owner)

  if (!isEnterpriseRelationEndpointAllowed(relation.relationType, relation.from.entityType, relation.to.entityType)) {
    issues.push(createTopologyValidatorIssue({
      path: `${path}.to.entityType`,
      code: "invalid_relation_endpoint",
      severity: "invalid",
      message: "Relation source and target entity types are not compatible.",
      entityId: relation.id,
      entityType: "relation",
      relationId: relation.id,
      sourceEntityId: relation.from.id,
      targetEntityId: relation.to.id,
    }))
  }
}

function validateEntityReference(
  indexes: TopologyEntityIndexes,
  issues: TopologyValidatorIssue[],
  reference: EnterpriseEntityRef | unknown,
  path: string,
  owner: ReferenceOwner,
): void {
  if (!isEntityReferenceLike(reference)) {
    issues.push(createTopologyValidatorIssue({
      path,
      code: "missing_entity_reference",
      severity: "invalid",
      message: "Expected an entity reference with entityType and id.",
      entityId: owner.entityId,
      entityType: owner.entityType,
      ...(owner.relationId !== undefined ? { relationId: owner.relationId } : {}),
    }))
    return
  }

  if (!isKnownEnterpriseEntityType(reference.entityType)) {
    issues.push(createTopologyValidatorIssue({
      path: `${path}.entityType`,
      code: "missing_entity_reference",
      severity: "invalid",
      message: `Unknown entity reference type ${reference.entityType}.`,
      entityId: owner.entityId,
      entityType: owner.entityType,
      ...(owner.relationId !== undefined ? { relationId: owner.relationId } : {}),
      refId: reference.id,
    }))
    return
  }

  validateTypedReference(indexes, issues, reference.entityType, reference.id, `${path}.id`, owner)
}

function validateOptionalTypedReference(
  indexes: TopologyEntityIndexes,
  issues: TopologyValidatorIssue[],
  refType: EnterpriseEntityType,
  refId: string | undefined,
  path: string,
  owner: ReferenceOwner,
): void {
  if (refId === undefined) return
  validateTypedReference(indexes, issues, refType, refId, path, owner)
}

function validateTypedReference(
  indexes: TopologyEntityIndexes,
  issues: TopologyValidatorIssue[],
  refType: EnterpriseEntityType,
  refId: string,
  path: string,
  owner: ReferenceOwner,
): void {
  if (entityExists(indexes, refType, refId)) return

  issues.push(createTopologyValidatorIssue({
    path,
    code: "missing_entity_reference",
    severity: "invalid",
    message: `Referenced ${refType} ${refId} does not exist.`,
    entityId: owner.entityId,
    entityType: owner.entityType,
    ...(owner.relationId !== undefined ? { relationId: owner.relationId } : {}),
    refId,
    refType,
  }))
}

function validateDelegationGraph(
  topology: EnterpriseTopology,
  indexes: TopologyEntityIndexes,
  issues: TopologyValidatorIssue[],
  maxDelegationDepth: number,
): void {
  const adjacency = buildDelegationAdjacency(topology)
  const nodeIds = new Set(topology.nodes.map((node) => node.id))

  detectDelegationCycles(adjacency, nodeIds, issues)
  detectDelegationDepthOverflow(adjacency, nodeIds, issues, Math.max(0, maxDelegationDepth))

  for (const [from, edges] of adjacency.entries()) {
    if (!entityExists(indexes, "node", from)) continue
    for (const edge of edges) {
      if (entityExists(indexes, "node", edge.to)) continue
      validateTypedReference(indexes, issues, "node", edge.to, edge.path, ownerFrom("node", edge.from, edge.relationId))
    }
  }
}

function buildDelegationAdjacency(topology: EnterpriseTopology): Map<string, DelegationEdge[]> {
  const adjacency = new Map<string, DelegationEdge[]>()

  topology.nodes.forEach((node, nodeIndex) => {
    node.children.forEach((childId, childIndex) => {
      addDelegationEdge(adjacency, {
        from: node.id,
        to: childId,
        path: `$.nodes[${nodeIndex}].children[${childIndex}]`,
      })
    })
  })

  topology.relations.forEach((relation, relationIndex) => {
    if (relation.relationType !== "delegates_to") return
    if (relation.from.entityType !== "node" || relation.to.entityType !== "node") return
    addDelegationEdge(adjacency, {
      from: relation.from.id,
      to: relation.to.id,
      path: `$.relations[${relationIndex}]`,
      relationId: relation.id,
    })
  })

  return adjacency
}

function addDelegationEdge(adjacency: Map<string, DelegationEdge[]>, edge: DelegationEdge): void {
  adjacency.set(edge.from, [...(adjacency.get(edge.from) ?? []), edge])
}

function detectDelegationCycles(
  adjacency: Map<string, DelegationEdge[]>,
  nodeIds: ReadonlySet<string>,
  issues: TopologyValidatorIssue[],
): void {
  const visited = new Set<string>()
  const visiting = new Set<string>()
  const path: string[] = []
  const reported = new Set<string>()

  const visit = (nodeId: string): void => {
    if (visited.has(nodeId)) return
    visiting.add(nodeId)
    path.push(nodeId)

    for (const edge of adjacency.get(nodeId) ?? []) {
      if (!nodeIds.has(edge.to)) continue
      if (visiting.has(edge.to)) {
        const cycleStart = path.indexOf(edge.to)
        const cyclePath = [...path.slice(cycleStart >= 0 ? cycleStart : 0), edge.to]
        const cycleKey = cyclePath.join(">")
        if (!reported.has(cycleKey)) {
          reported.add(cycleKey)
          issues.push(createTopologyValidatorIssue({
            path: edge.path,
            code: "delegation_cycle",
            severity: "invalid",
            message: `Delegation graph contains a cycle: ${cyclePath.join(" -> ")}.`,
            entityId: edge.from,
            entityType: "node",
            ...(edge.relationId !== undefined ? { relationId: edge.relationId } : {}),
            sourceEntityId: edge.from,
            targetEntityId: edge.to,
          }))
        }
        continue
      }
      visit(edge.to)
    }

    path.pop()
    visiting.delete(nodeId)
    visited.add(nodeId)
  }

  for (const nodeId of nodeIds) {
    visit(nodeId)
  }
}

function detectDelegationDepthOverflow(
  adjacency: Map<string, DelegationEdge[]>,
  nodeIds: ReadonlySet<string>,
  issues: TopologyValidatorIssue[],
  maxDelegationDepth: number,
): void {
  const reported = new Set<string>()

  const visit = (nodeId: string, path: string[]): void => {
    for (const edge of adjacency.get(nodeId) ?? []) {
      if (!nodeIds.has(edge.to) || path.includes(edge.to)) continue

      const nextPath = [...path, edge.to]
      const depth = nextPath.length - 1
      if (depth > maxDelegationDepth) {
        const reportKey = `${edge.path}:${depth}`
        if (!reported.has(reportKey)) {
          reported.add(reportKey)
          issues.push(createTopologyValidatorIssue({
            path: edge.path,
            code: "max_delegation_depth_exceeded",
            severity: "blocked",
            message: `Delegation depth ${depth} exceeds max depth ${maxDelegationDepth}.`,
            entityId: edge.from,
            entityType: "node",
            ...(edge.relationId !== undefined ? { relationId: edge.relationId } : {}),
            sourceEntityId: edge.from,
            targetEntityId: edge.to,
          }))
        }
      }

      visit(edge.to, nextPath)
    }
  }

  for (const nodeId of nodeIds) {
    visit(nodeId, [nodeId])
  }
}

function validateEnterpriseRules(
  topology: EnterpriseTopology,
  indexes: TopologyEntityIndexes,
  issues: TopologyValidatorIssue[],
  options: TopologyValidatorOptions,
): void {
  validateOrgUnitHierarchy(topology, issues)
  validatePositionReporting(topology, issues)
  validateMembershipRules(topology, issues, options)
  validateAuthorityRules(topology, issues)
  validateApprovalCoverage(topology, issues)
  validatePermissionRules(topology, issues)
  validateDataDomainAccessRules(topology, issues)
  validateProcessRules(topology, issues)
  validateResponsibilityCoverage(topology, issues)
  validateNodeFailureAndRecoveryPolicies(topology, indexes, issues)
}

function validateOrgUnitHierarchy(topology: EnterpriseTopology, issues: TopologyValidatorIssue[]): void {
  const orgUnits = buildEntityMap(topology.orgUnits)
  const pathByOrgId = new Map(topology.orgUnits.map((orgUnit, index) => [orgUnit.id, `$.orgUnits[${index}].parentOrgUnitId`]))
  const reported = new Set<string>()

  const visit = (orgUnit: OrgUnit, path: string[]): void => {
    if (orgUnit.parentOrgUnitId === undefined) return
    if (!orgUnits.has(orgUnit.parentOrgUnitId)) return
    const cycleIndex = path.indexOf(orgUnit.parentOrgUnitId)
    if (cycleIndex >= 0) {
      const cycle = [...path.slice(cycleIndex), orgUnit.parentOrgUnitId]
      const key = cycle.join(">")
      if (reported.has(key)) return
      reported.add(key)
      issues.push(createTopologyValidatorIssue({
        path: pathByOrgId.get(orgUnit.id) ?? "$.orgUnits",
        code: "org_unit_hierarchy_cycle",
        severity: "invalid",
        message: `OrgUnit hierarchy contains a cycle: ${cycle.join(" -> ")}.`,
        entityId: orgUnit.id,
        entityType: "org_unit",
        refId: orgUnit.parentOrgUnitId,
        refType: "org_unit",
      }))
      return
    }
    const parent = orgUnits.get(orgUnit.parentOrgUnitId)
    if (parent !== undefined) visit(parent, [...path, orgUnit.parentOrgUnitId])
  }

  topology.orgUnits.forEach((orgUnit) => visit(orgUnit, [orgUnit.id]))
}

function validatePositionReporting(topology: EnterpriseTopology, issues: TopologyValidatorIssue[]): void {
  const positions = buildEntityMap(topology.positions)
  const pathByPositionId = new Map(topology.positions.map((position, index) => [position.id, `$.positions[${index}].reportsToPositionId`]))
  const reported = new Set<string>()

  const visit = (position: Position, path: string[]): void => {
    if (position.reportsToPositionId === undefined) return
    if (!positions.has(position.reportsToPositionId)) return
    const cycleIndex = path.indexOf(position.reportsToPositionId)
    if (cycleIndex >= 0) {
      const cycle = [...path.slice(cycleIndex), position.reportsToPositionId]
      const key = cycle.join(">")
      if (reported.has(key)) return
      reported.add(key)
      issues.push(createTopologyValidatorIssue({
        path: pathByPositionId.get(position.id) ?? "$.positions",
        code: "position_reports_to_cycle",
        severity: "invalid",
        message: `Position reports_to hierarchy contains a cycle: ${cycle.join(" -> ")}.`,
        entityId: position.id,
        entityType: "position",
        refId: position.reportsToPositionId,
        refType: "position",
      }))
      return
    }
    const manager = positions.get(position.reportsToPositionId)
    if (manager !== undefined) visit(manager, [...path, position.reportsToPositionId])
  }

  topology.positions.forEach((position, index) => {
    visit(position, [position.id])
    if (position.reportsToPositionId === undefined) return
    const manager = positions.get(position.reportsToPositionId)
    if (manager === undefined) return
    if (isSameOrAncestorOrgUnit(topology, manager.orgUnitId, position.orgUnitId)) return
    issues.push(createTopologyValidatorIssue({
      path: `$.positions[${index}].reportsToPositionId`,
      code: "position_reports_to_invalid_org_scope",
      severity: "warning",
      message: "Position reports_to target should be in the same OrgUnit or an ancestor OrgUnit.",
      entityId: position.id,
      entityType: "position",
      refId: position.reportsToPositionId,
      refType: "position",
    }))
  })
}

function validateMembershipRules(
  topology: EnterpriseTopology,
  issues: TopologyValidatorIssue[],
  options: TopologyValidatorOptions,
): void {
  const asOf = options.asOf !== undefined ? timestampToMillis(options.asOf) : undefined
  const allocationsByPerson = new Map<string, Array<{ membership: Membership; path: string; allocationPercent: number }>>()

  topology.memberships.forEach((membership, index) => {
    const path = `$.memberships[${index}]`
    const from = membership.validFrom !== undefined ? timestampToMillis(membership.validFrom) : undefined
    const to = membership.validTo !== undefined ? timestampToMillis(membership.validTo) : undefined
    if (from !== undefined && to !== undefined && to < from) {
      issues.push(createTopologyValidatorIssue({
        path: `${path}.validTo`,
        code: "membership_validity_invalid",
        severity: "invalid",
        message: "Membership validTo must be greater than or equal to validFrom.",
        entityId: membership.id,
        entityType: "membership",
      }))
    }

    if (membership.allocationPercent === undefined) return
    if (!Number.isFinite(membership.allocationPercent) || membership.allocationPercent <= 0 || membership.allocationPercent > 100) {
      issues.push(createTopologyValidatorIssue({
        path: `${path}.allocationPercent`,
        code: "membership_allocation_invalid",
        severity: "invalid",
        message: "Membership allocationPercent must be greater than 0 and less than or equal to 100.",
        entityId: membership.id,
        entityType: "membership",
      }))
      return
    }
    if (asOf !== undefined && !membershipEffectiveAt(membership, asOf)) return
    allocationsByPerson.set(membership.personId, [
      ...(allocationsByPerson.get(membership.personId) ?? []),
      { membership, path: `${path}.allocationPercent`, allocationPercent: membership.allocationPercent },
    ])
  })

  for (const [personId, allocations] of allocationsByPerson.entries()) {
    const total = allocations.reduce((sum, item) => sum + item.allocationPercent, 0)
    if (total <= 100) continue
    const first = allocations[0]
    issues.push(createTopologyValidatorIssue({
      path: first?.path ?? "$.memberships",
      code: "person_membership_allocation_exceeded",
      severity: "blocked",
      message: `Person ${personId} has ${total}% allocated membership capacity.`,
      entityId: first?.membership.id ?? personId,
      entityType: first !== undefined ? "membership" : "person",
      refId: personId,
      refType: "person",
    }))
  }
}

function validateAuthorityRules(topology: EnterpriseTopology, issues: TopologyValidatorIssue[]): void {
  const seen = new Map<string, { rule: AuthorityRule; path: string }>()
  const rulesById = buildEntityMap(topology.authorityRules)

  topology.authorityRules.forEach((rule, index) => {
    const path = `$.authorityRules[${index}]`
    const action = normalizeAction(rule.action)
    if (action === undefined) {
      issues.push(createTopologyValidatorIssue({
        path: `${path}.action`,
        code: "invalid_authority_rule_action",
        severity: "invalid",
        message: "AuthorityRule action must be a non-empty stable action string.",
        entityId: rule.id,
        entityType: "authority_rule",
      }))
      return
    }

    if (!isEntityReferenceLike(rule.subject) || !isEntityReferenceLike(rule.object)) return

    const key = [
      refKey(rule.subject),
      action,
      refKey(rule.object),
      stableConditionKey(rule.condition),
    ].join("|")
    const existing = seen.get(key)
    if (existing !== undefined) {
      const hasPolicyConflict =
        existing.rule.delegable !== rule.delegable || existing.rule.requiresAuditLog !== rule.requiresAuditLog
      if (hasPolicyConflict) {
        issues.push(createTopologyValidatorIssue({
          path,
          code: "authority_rule_conflict",
          severity: "blocked",
          message: `AuthorityRule conflicts with ${existing.rule.id} for the same subject, action, object, and condition.`,
          entityId: rule.id,
          entityType: "authority_rule",
          refId: existing.rule.id,
          refType: "authority_rule",
        }))
      }
      return
    }

    seen.set(key, { rule, path })

    validateApprovalLimit(topology, rule, path, action, issues)
    validateAuthorityDelegation(rule, path, rulesById, issues)
  })
}

function validateApprovalLimit(
  topology: EnterpriseTopology,
  rule: AuthorityRule,
  path: string,
  action: string | undefined,
  issues: TopologyValidatorIssue[],
): void {
  if (action === undefined || !isApprovalAction(action)) return
  const amount = approvalAmountFromCondition(rule.condition)
  if (amount === undefined) return
  const limit = approvalLimitForSubject(topology, rule.subject)

  if (limit === undefined) {
    issues.push(createTopologyValidatorIssue({
      path: `${path}.condition`,
      code: "approval_limit_missing",
      severity: "blocked",
      message: "Approval AuthorityRule declares an amount but the subject has no approvalLimit.",
      entityId: rule.id,
      entityType: "authority_rule",
      refId: rule.subject.id,
      refType: rule.subject.entityType,
    }))
    return
  }

  if (amount <= limit) return
  issues.push(createTopologyValidatorIssue({
    path: `${path}.condition`,
    code: "approval_limit_exceeded",
    severity: "blocked",
    message: `Approval amount ${amount} exceeds subject approvalLimit ${limit}.`,
    entityId: rule.id,
    entityType: "authority_rule",
    refId: rule.subject.id,
    refType: rule.subject.entityType,
  }))
}

function validateAuthorityDelegation(
  rule: AuthorityRule,
  path: string,
  rulesById: ReadonlyMap<string, AuthorityRule>,
  issues: TopologyValidatorIssue[],
): void {
  const delegatedFromRuleId = stringFromMetadata(rule.condition, "delegatedFromRuleId")
  if (delegatedFromRuleId === undefined) return
  const sourceRule = rulesById.get(delegatedFromRuleId)
  const delegationInvalid =
    sourceRule === undefined ||
    !sourceRule.delegable ||
    normalizeAction(sourceRule.action) !== normalizeAction(rule.action) ||
    refKey(sourceRule.object) !== refKey(rule.object)
  if (!delegationInvalid) return

  issues.push(createTopologyValidatorIssue({
    path: `${path}.condition.delegatedFromRuleId`,
    code: "authority_delegation_invalid",
    severity: "blocked",
    message: "Delegated AuthorityRule must reference a delegable source rule for the same action and object.",
    entityId: rule.id,
    entityType: "authority_rule",
    refId: delegatedFromRuleId,
    refType: "authority_rule",
  }))
}

function validateApprovalCoverage(topology: EnterpriseTopology, issues: TopologyValidatorIssue[]): void {
  const approvalTargets = buildApprovalTargetSet(topology)
  const tools = buildEntityMap(topology.tools)

  topology.nodes.forEach((node, index) => {
    if (node.nodeType !== "approval_node") return
    if (approvalTargets.has(refKey({ entityType: "node", id: node.id }))) return

    issues.push(createTopologyValidatorIssue({
      path: `$.nodes[${index}].nodeType`,
      code: "approval_authority_missing",
      severity: "blocked",
      message: "Approval node requires an approves relation or approval AuthorityRule before activation.",
      entityId: node.id,
      entityType: "node",
    }))
  })

  topology.relations.forEach((relation, index) => {
    if (relation.relationType !== "uses_tool") return
    if (relation.from.entityType !== "node" || relation.to.entityType !== "enterprise_tool") return
    const tool = tools.get(relation.to.id)
    if (tool === undefined || !toolRequiresApproval(tool.toolType)) return
    const toolCovered = approvalTargets.has(refKey({ entityType: "enterprise_tool", id: tool.id }))
    const nodeCovered = approvalTargets.has(refKey({ entityType: "node", id: relation.from.id }))
    if (toolCovered || nodeCovered) return

    issues.push(createTopologyValidatorIssue({
      path: `$.relations[${index}]`,
      code: "approval_authority_missing",
      severity: "blocked",
      message: "Write or external-action tool usage requires an approval authority relation or rule.",
      entityId: relation.from.id,
      entityType: "node",
      relationId: relation.id,
      sourceEntityId: relation.from.id,
      targetEntityId: relation.to.id,
    }))
  })
}

function validatePermissionRules(topology: EnterpriseTopology, issues: TopologyValidatorIssue[]): void {
  const nodes = buildEntityMap(topology.nodes)
  const tools = buildEntityMap(topology.tools)
  const useToolPairs = new Set<string>()
  const useSystemPairs = new Set<string>()
  const accessToolPairs = new Set<string>()
  const accessSystemPairs = new Set<string>()

  topology.relations.forEach((relation, index) => {
    const path = `$.relations[${index}]`
    if (relation.from.entityType !== "node") return
    const node = nodes.get(relation.from.id)
    if (node === undefined) return

    if (relation.relationType === "uses_tool" && relation.to.entityType === "enterprise_tool") {
      useToolPairs.add(relationPairKey(relation.from.id, relation.to.id))
      validateNodeToolPermission(node, relation.to.id, path, relation.id, issues)

      const tool = tools.get(relation.to.id)
      if (tool?.systemId !== undefined) {
        validateNodeSystemPermission(node, tool.systemId, path, relation.id, issues)
      }
      return
    }

    if (relation.relationType === "uses_system" && relation.to.entityType === "enterprise_system") {
      useSystemPairs.add(relationPairKey(relation.from.id, relation.to.id))
      validateNodeSystemPermission(node, relation.to.id, path, relation.id, issues)
      return
    }

    if (relation.relationType === "has_access_to" && relation.to.entityType === "enterprise_tool") {
      accessToolPairs.add(relationPairKey(relation.from.id, relation.to.id))
      validateNodeToolPermission(node, relation.to.id, path, relation.id, issues)
      return
    }

    if (relation.relationType === "has_access_to" && relation.to.entityType === "enterprise_system") {
      accessSystemPairs.add(relationPairKey(relation.from.id, relation.to.id))
      validateNodeSystemPermission(node, relation.to.id, path, relation.id, issues)
    }
  })

  topology.nodes.forEach((node, nodeIndex) => {
    node.allowedToolIds.forEach((toolId, toolIndex) => {
      if (!tools.has(toolId)) return
      const key = relationPairKey(node.id, toolId)
      if (useToolPairs.has(key) || accessToolPairs.has(key)) return
      issues.push(createTopologyValidatorIssue({
        path: `$.nodes[${nodeIndex}].allowedToolIds[${toolIndex}]`,
        code: "declared_tool_relation_missing",
        severity: "warning",
        message: "Node allows a tool but has no uses_tool or has_access_to relation for it.",
        entityId: node.id,
        entityType: "node",
        refId: toolId,
        refType: "enterprise_tool",
      }))
    })

    node.allowedSystemIds.forEach((systemId, systemIndex) => {
      if (!entityExistsById(topology.systems, systemId)) return
      const key = relationPairKey(node.id, systemId)
      if (useSystemPairs.has(key) || accessSystemPairs.has(key)) return
      issues.push(createTopologyValidatorIssue({
        path: `$.nodes[${nodeIndex}].allowedSystemIds[${systemIndex}]`,
        code: "declared_system_relation_missing",
        severity: "warning",
        message: "Node allows a system but has no uses_system or has_access_to relation for it.",
        entityId: node.id,
        entityType: "node",
        refId: systemId,
        refType: "enterprise_system",
      }))
    })
  })
}

function validateDataDomainAccessRules(topology: EnterpriseTopology, issues: TopologyValidatorIssue[]): void {
  const nodes = buildEntityMap(topology.nodes)
  const systems = buildEntityMap(topology.systems)
  const tools = buildEntityMap(topology.tools)
  const systemAccessByNode = new Map<string, EnterpriseRelation[]>()

  topology.relations.forEach((relation) => {
    if (relation.relationType !== "has_access_to") return
    if (relation.from.entityType !== "node" || relation.to.entityType !== "enterprise_system") return
    systemAccessByNode.set(relationPairKey(relation.from.id, relation.to.id), [
      ...(systemAccessByNode.get(relationPairKey(relation.from.id, relation.to.id)) ?? []),
      relation,
    ])
  })

  topology.relations.forEach((relation, index) => {
    if (relation.from.entityType !== "node") return
    const node = nodes.get(relation.from.id)
    if (node === undefined) return

    const systemId =
      relation.relationType === "uses_system" && relation.to.entityType === "enterprise_system"
        ? relation.to.id
        : relation.relationType === "uses_tool" && relation.to.entityType === "enterprise_tool"
          ? tools.get(relation.to.id)?.systemId
          : undefined
    if (systemId === undefined) return
    const system = systems.get(systemId)
    if (system === undefined || system.dataDomainIds.length === 0) return

    const accessRelations = systemAccessByNode.get(relationPairKey(node.id, system.id)) ?? []
    if (system.criticality === "critical" && accessRelations.length === 0) {
      issues.push(createTopologyValidatorIssue({
        path: `$.relations[${index}]`,
        code: "critical_system_access_missing",
        severity: "blocked",
        message: "Critical system usage requires an explicit has_access_to relation for the backing system.",
        entityId: node.id,
        entityType: "node",
        relationId: relation.id,
        sourceEntityId: node.id,
        targetEntityId: system.id,
        refId: system.id,
        refType: "enterprise_system",
      }))
      return
    }

    if (accessRelations.length === 0) return
    const declaredDomains = new Set(accessRelations.flatMap(dataDomainIdsFromRelation))
    if (declaredDomains.size === 0) {
      issues.push(createTopologyValidatorIssue({
        path: `$.relations[${index}]`,
        code: "data_domain_access_missing",
        severity: "blocked",
        message: `System access must declare data domains: ${system.dataDomainIds.join(", ")}.`,
        entityId: node.id,
        entityType: "node",
        relationId: relation.id,
        sourceEntityId: node.id,
        targetEntityId: system.id,
        ...(system.dataDomainIds[0] !== undefined ? { refId: system.dataDomainIds[0] } : {}),
      }))
      return
    }
    const missingDomains = system.dataDomainIds.filter((domainId) => !declaredDomains.has(domainId))
    if (missingDomains.length === 0) return
    issues.push(createTopologyValidatorIssue({
      path: `$.relations[${index}]`,
      code: "data_domain_access_missing",
      severity: "blocked",
      message: `System access is missing data domains: ${missingDomains.join(", ")}.`,
      entityId: node.id,
      entityType: "node",
      relationId: relation.id,
      sourceEntityId: node.id,
      targetEntityId: system.id,
      ...(missingDomains[0] !== undefined ? { refId: missingDomains[0] } : {}),
    }))
  })
}

function validateProcessRules(topology: EnterpriseTopology, issues: TopologyValidatorIssue[]): void {
  const nodes = buildEntityMap(topology.nodes)
  const processStepSets = new Map<string, Set<string>>()

  topology.processes.forEach((process, index) => {
    const path = `$.processes[${index}]`
    const stepIds = new Set(process.stepNodeIds)
    processStepSets.set(process.id, stepIds)

    if (process.ownerNodeId === undefined) {
      issues.push(createTopologyValidatorIssue({
        path: `${path}.ownerNodeId`,
        code: "process_owner_missing",
        severity: "blocked",
        message: "Process definition must declare an owner node before activation.",
        entityId: process.id,
        entityType: "process_definition",
      }))
    }
    if (process.stepNodeIds.length > 0 && process.slaMs === undefined) {
      issues.push(createTopologyValidatorIssue({
        path: `${path}.slaMs`,
        code: "process_sla_missing",
        severity: "warning",
        message: "Process definition should declare slaMs for operational analysis.",
        entityId: process.id,
        entityType: "process_definition",
      }))
    } else if (process.slaMs !== undefined && (!Number.isFinite(process.slaMs) || process.slaMs <= 0)) {
      issues.push(createTopologyValidatorIssue({
        path: `${path}.slaMs`,
        code: "process_sla_invalid",
        severity: "invalid",
        message: "Process slaMs must be a positive number.",
        entityId: process.id,
        entityType: "process_definition",
      }))
    }

    process.stepNodeIds.forEach((nodeId, stepIndex) => {
      const node = nodes.get(nodeId)
      if (node === undefined || node.owner !== undefined) return
      issues.push(createTopologyValidatorIssue({
        path: `${path}.stepNodeIds[${stepIndex}]`,
        code: "process_step_owner_missing",
        severity: "blocked",
        message: "Process step node must have an owner before activation.",
        entityId: process.id,
        entityType: "process_definition",
        refId: nodeId,
        refType: "node",
      }))
    })
  })

  topology.relations.forEach((relation, index) => {
    if (relation.relationType !== "depends_on") return
    validateProcessTransitionReference(relation, `$.relations[${index}]`, processStepSets, issues)
  })
}

function validateResponsibilityCoverage(topology: EnterpriseTopology, issues: TopologyValidatorIssue[]): void {
  const responsibilityScopes = new Set(
    topology.responsibilities
      .filter((entry) => isEntityReferenceLike(entry.scope))
      .map((entry) => refKey(entry.scope)),
  )

  topology.responsibilities.forEach((entry, index) => {
    if (entry.accountable !== undefined) return
    issues.push(createTopologyValidatorIssue({
      path: `$.responsibilities[${index}].accountable`,
      code: "raci_accountable_missing",
      severity: "warning",
      message: "Responsibility Matrix entry is missing an accountable owner.",
      entityId: entry.id,
      entityType: "responsibility_matrix_entry",
      refId: entry.scope.id,
      refType: entry.scope.entityType,
    }))
  })

  topology.nodes.forEach((node, index) => {
    if (responsibilityScopes.has(refKey({ entityType: "node", id: node.id }))) return
    issues.push(createTopologyValidatorIssue({
      path: `$.nodes[${index}]`,
      code: "responsibility_matrix_missing",
      severity: "warning",
      message: "Node has no Responsibility Matrix entry.",
      entityId: node.id,
      entityType: "node",
    }))
  })

  topology.processes.forEach((process, index) => {
    if (responsibilityScopes.has(refKey({ entityType: "process_definition", id: process.id }))) return
    issues.push(createTopologyValidatorIssue({
      path: `$.processes[${index}]`,
      code: "responsibility_matrix_missing",
      severity: "warning",
      message: "Process definition has no Responsibility Matrix entry.",
      entityId: process.id,
      entityType: "process_definition",
    }))
  })
}

function validateNodeFailureAndRecoveryPolicies(
  topology: EnterpriseTopology,
  indexes: TopologyEntityIndexes,
  issues: TopologyValidatorIssue[],
): void {
  topology.nodes.forEach((node, index) => {
    const path = `$.nodes[${index}]`
    if (node.failurePolicy === undefined) {
      issues.push(createTopologyValidatorIssue({
        path: `${path}.failurePolicy`,
        code: "failure_policy_missing",
        severity: "blocked",
        message: "Node must define a FailurePolicy before runtime activation.",
        entityId: node.id,
        entityType: "node",
      }))
    } else {
      node.failurePolicy.fallbackNodeIds.forEach((fallbackNodeId, fallbackIndex) => {
        validateTypedReference(
          indexes,
          issues,
          "node",
          fallbackNodeId,
          `${path}.failurePolicy.fallbackNodeIds[${fallbackIndex}]`,
          ownerFrom("node", node.id),
        )
      })
    }

    if (node.recoveryPolicy === undefined) {
      issues.push(createTopologyValidatorIssue({
        path: `${path}.recoveryPolicy`,
        code: "recovery_policy_missing",
        severity: "blocked",
        message: "Node must define a RecoveryPolicy before runtime activation.",
        entityId: node.id,
        entityType: "node",
      }))
    } else if (node.failurePolicy?.fallbackNodeIds.length && !node.recoveryPolicy.fallbackAllowed) {
      issues.push(createTopologyValidatorIssue({
        path: `${path}.recoveryPolicy.fallbackAllowed`,
        code: "invalid_recovery_policy",
        severity: "blocked",
        message: "RecoveryPolicy must allow fallback when FailurePolicy declares fallback nodes.",
        entityId: node.id,
        entityType: "node",
      }))
    }
  })
}

function buildApprovalTargetSet(topology: EnterpriseTopology): Set<string> {
  const targets = new Set<string>()
  topology.relations.forEach((relation) => {
    if (relation.relationType === "approves") targets.add(refKey(relation.to))
  })
  topology.authorityRules.forEach((rule) => {
    if (!isEntityReferenceLike(rule.object)) return
    const action = normalizeAction(rule.action)
    if (action !== undefined && isApprovalAction(action)) targets.add(refKey(rule.object))
  })
  return targets
}

function validateNodeToolPermission(
  node: NodeContract,
  toolId: string,
  path: string,
  relationId: string,
  issues: TopologyValidatorIssue[],
): void {
  if (node.allowedToolIds.includes(toolId)) return
  issues.push(createTopologyValidatorIssue({
    path,
    code: "tool_permission_missing",
    severity: "blocked",
    message: "Node uses or accesses a tool that is not included in allowedToolIds.",
    entityId: node.id,
    entityType: "node",
    relationId,
    sourceEntityId: node.id,
    targetEntityId: toolId,
    refId: toolId,
    refType: "enterprise_tool",
  }))
}

function validateNodeSystemPermission(
  node: NodeContract,
  systemId: string,
  path: string,
  relationId: string,
  issues: TopologyValidatorIssue[],
): void {
  if (node.allowedSystemIds.includes(systemId)) return
  issues.push(createTopologyValidatorIssue({
    path,
    code: "system_permission_missing",
    severity: "blocked",
    message: "Node uses or accesses a system that is not included in allowedSystemIds.",
    entityId: node.id,
    entityType: "node",
    relationId,
    sourceEntityId: node.id,
    targetEntityId: systemId,
    refId: systemId,
    refType: "enterprise_system",
  }))
}

function validateProcessTransitionReference(
  relation: EnterpriseRelation,
  path: string,
  processStepSets: ReadonlyMap<string, ReadonlySet<string>>,
  issues: TopologyValidatorIssue[],
): void {
  if (relation.from.entityType === "process_definition" && relation.to.entityType === "node") {
    validateProcessStepRelationEndpoint(relation.from.id, relation.to.id, relation, path, processStepSets, issues)
  }
  if (relation.to.entityType === "process_definition" && relation.from.entityType === "node") {
    validateProcessStepRelationEndpoint(relation.to.id, relation.from.id, relation, path, processStepSets, issues)
  }
}

function validateProcessStepRelationEndpoint(
  processId: string,
  nodeId: string,
  relation: EnterpriseRelation,
  path: string,
  processStepSets: ReadonlyMap<string, ReadonlySet<string>>,
  issues: TopologyValidatorIssue[],
): void {
  const stepIds = processStepSets.get(processId)
  if (stepIds === undefined || stepIds.has(nodeId)) return
  issues.push(createTopologyValidatorIssue({
    path,
    code: "process_transition_reference_invalid",
    severity: "blocked",
    message: "Process transition relation references a node that is not declared as a step of the process.",
    entityId: processId,
    entityType: "process_definition",
    relationId: relation.id,
    sourceEntityId: relation.from.id,
    targetEntityId: relation.to.id,
    refId: nodeId,
    refType: "node",
  }))
}

function isSameOrAncestorOrgUnit(topology: EnterpriseTopology, possibleAncestorId: string, orgUnitId: string): boolean {
  if (possibleAncestorId === orgUnitId) return true
  const orgUnits = buildEntityMap(topology.orgUnits)
  let current = orgUnits.get(orgUnitId)
  const visited = new Set<string>()
  while (current?.parentOrgUnitId !== undefined && !visited.has(current.id)) {
    visited.add(current.id)
    if (current.parentOrgUnitId === possibleAncestorId) return true
    current = orgUnits.get(current.parentOrgUnitId)
  }
  return false
}

function timestampToMillis(value: EnterpriseTimestamp): number | undefined {
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined
  const timestamp = Date.parse(value)
  return Number.isFinite(timestamp) ? timestamp : undefined
}

function membershipEffectiveAt(membership: Membership, asOf: number): boolean {
  const from = membership.validFrom !== undefined ? timestampToMillis(membership.validFrom) : undefined
  const to = membership.validTo !== undefined ? timestampToMillis(membership.validTo) : undefined
  if (from !== undefined && from > asOf) return false
  if (to !== undefined && to < asOf) return false
  return true
}

function approvalAmountFromCondition(condition: unknown): number | undefined {
  return numberFromMetadata(condition, "amount")
    ?? numberFromMetadata(condition, "approvalAmount")
    ?? numberFromMetadata(condition, "maxAmount")
    ?? numberFromMetadata(condition, "maxApprovalAmount")
}

function approvalLimitForSubject(
  topology: EnterpriseTopology,
  subject: AuthorityRule["subject"],
): number | undefined {
  if (subject.entityType === "position") {
    const limit = topology.positions.find((position) => position.id === subject.id)?.approvalLimit
    return typeof limit === "number" && Number.isFinite(limit) ? limit : undefined
  }
  if (subject.entityType === "person") {
    const person = topology.persons.find((candidate) => candidate.id === subject.id)
    if (person === undefined) return undefined
    return maxNumber(person.positionIds.map((positionId) => {
      return topology.positions.find((position) => position.id === positionId)?.approvalLimit
    }))
  }
  if (subject.entityType === "org_unit") {
    return maxNumber(topology.positions
      .filter((position) => position.orgUnitId === subject.id)
      .map((position) => position.approvalLimit))
  }
  return undefined
}

function numberFromMetadata(value: unknown, key: string): number | undefined {
  if (!isRecord(value)) return undefined
  const raw = value[key]
  return typeof raw === "number" && Number.isFinite(raw) ? raw : undefined
}

function stringFromMetadata(value: unknown, key: string): string | undefined {
  if (!isRecord(value)) return undefined
  const raw = value[key]
  return typeof raw === "string" && raw.trim().length > 0 ? raw : undefined
}

function stringArrayFromMetadata(value: unknown, key: string): string[] {
  if (!isRecord(value)) return []
  const raw = value[key]
  return Array.isArray(raw) ? raw.filter((item): item is string => typeof item === "string" && item.trim().length > 0) : []
}

function dataDomainIdsFromRelation(relation: EnterpriseRelation): string[] {
  return [
    ...stringArrayFromMetadata(relation.scope, "dataDomainIds"),
    ...stringArrayFromMetadata(relation.condition, "dataDomainIds"),
  ]
}

function maxNumber(values: Array<number | undefined>): number | undefined {
  const numeric = values.filter((value): value is number => typeof value === "number" && Number.isFinite(value))
  return numeric.length > 0 ? Math.max(...numeric) : undefined
}

function buildEntityMap<T extends { id: string }>(entities: readonly T[]): Map<string, T> {
  return new Map(entities.map((entity) => [entity.id, entity]))
}

function entityExistsById<T extends { id: string }>(entities: readonly T[], id: string): boolean {
  return entities.some((entity) => entity.id === id)
}

function relationPairKey(fromId: string, toId: string): string {
  return `${fromId}->${toId}`
}

function refKey(reference: { entityType: string; id: string }): string {
  return `${reference.entityType}:${reference.id}`
}

function normalizeAction(action: unknown): string | undefined {
  if (typeof action !== "string") return undefined
  const normalized = action.trim().toLowerCase()
  return normalized.length > 0 ? normalized : undefined
}

function isApprovalAction(action: string): boolean {
  return action.includes("approve") || action.includes("approval")
}

function toolRequiresApproval(toolType: string): boolean {
  return toolType === "write" || toolType === "external_action"
}

function stableConditionKey(value: unknown): string {
  return JSON.stringify(sortJsonValue(value ?? null))
}

function sortJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJsonValue)
  if (!isRecord(value)) return value
  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => [key, sortJsonValue(nested)]),
  )
}

function entityExists(indexes: TopologyEntityIndexes, entityType: EnterpriseEntityType, entityId: string): boolean {
  return indexes.byType.get(entityType)?.has(entityId) ?? false
}

function ownerFrom(entityType: EnterpriseEntityType, entityId: string, relationId?: string): ReferenceOwner {
  return {
    entityId,
    entityType,
    ...(relationId !== undefined ? { relationId } : {}),
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

function isEntityReferenceLike(value: unknown): value is { entityType: string; id: string } {
  return isRecord(value) && typeof value.entityType === "string" && typeof value.id === "string"
}

function isKnownEnterpriseEntityType(value: string): value is EnterpriseEntityType {
  return TOPOLOGY_ENTITY_TYPES.includes(value as EnterpriseEntityType)
}
