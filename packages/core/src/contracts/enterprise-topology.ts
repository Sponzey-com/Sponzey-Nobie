export const ENTERPRISE_TOPOLOGY_SCHEMA_VERSION = 1 as const

export type EnterpriseTopologySchemaVersion = typeof ENTERPRISE_TOPOLOGY_SCHEMA_VERSION
export type EnterpriseEntityStatus = "draft" | "active" | "inactive" | "archived"
export type EnterpriseTimestamp = number | string
export type EnterpriseMetadataValue =
  | string
  | number
  | boolean
  | null
  | EnterpriseMetadataValue[]
  | { [key: string]: EnterpriseMetadataValue | undefined }
export type EnterpriseMetadata = { [key: string]: EnterpriseMetadataValue | undefined }

export type EnterpriseEntityType =
  | "topology"
  | "topology_version"
  | "node"
  | "team"
  | "org_unit"
  | "position"
  | "person"
  | "membership"
  | "authority_rule"
  | "responsibility_matrix_entry"
  | "enterprise_system"
  | "enterprise_tool"
  | "process_definition"
  | "relation"

export type NodeType =
  | "function"
  | "process_step"
  | "approval_node"
  | "review_node"
  | "decision_node"
  | "automation_node"
  | "data_owner_node"
  | "external_node"
  | "system_interface_node"

export type EnterpriseRelationType =
  | "reports_to"
  | "belongs_to"
  | "delegates_to"
  | "approves"
  | "owns"
  | "collaborates_with"
  | "escalates_to"
  | "informs"
  | "uses_system"
  | "uses_tool"
  | "has_access_to"
  | "depends_on"
  | "consults"
  | "accountable_for"

export const ENTERPRISE_NODE_TYPES: readonly NodeType[] = [
  "function",
  "process_step",
  "approval_node",
  "review_node",
  "decision_node",
  "automation_node",
  "data_owner_node",
  "external_node",
  "system_interface_node",
] as const

export const ENTERPRISE_RELATION_TYPES: readonly EnterpriseRelationType[] = [
  "reports_to",
  "belongs_to",
  "delegates_to",
  "approves",
  "owns",
  "collaborates_with",
  "escalates_to",
  "informs",
  "uses_system",
  "uses_tool",
  "has_access_to",
  "depends_on",
  "consults",
  "accountable_for",
] as const

const ENTITY_STATUSES = new Set<EnterpriseEntityStatus>(["draft", "active", "inactive", "archived"])
const NODE_TYPES = new Set<NodeType>(ENTERPRISE_NODE_TYPES)
const RELATION_TYPES = new Set<EnterpriseRelationType>(ENTERPRISE_RELATION_TYPES)
const FAILURE_ISSUE_KINDS = new Set<FailureIssueKind>([
  "success_criteria_unmet",
  "runtime_risk",
  "execution_incomplete",
  "permission_or_tool_blocked",
  "unknown",
])
const FAILURE_RECOVERY_ACTION_KINDS = new Set<FailureRecoveryActionKind>([
  "retry",
  "delegate_to_next_executor",
  "add_tool_permission",
  "add_fallback_path",
  "pass_partial_result",
  "return_to_parent",
  "review_trace",
  "none",
])
const FAILURE_NEXT_ACTION_KINDS = new Set<FailureNextActionKind>([
  "add_permission",
  "pass_partial",
  "add_fallback",
  "revise_description",
  "review_trace",
  "user_review",
])

export interface EnterpriseBaseEntity<TType extends EnterpriseEntityType = EnterpriseEntityType> {
  schemaVersion: EnterpriseTopologySchemaVersion
  entityType: TType
  id: string
  name: string
  displayName?: string
  status: EnterpriseEntityStatus
  createdAt: EnterpriseTimestamp
  updatedAt: EnterpriseTimestamp
  metadata?: EnterpriseMetadata
}

export interface EnterpriseEntityRef<TType extends EnterpriseEntityType = EnterpriseEntityType> {
  entityType: TType
  id: string
}

export interface NodeTemplateRef {
  templateId: string
  source: "user_preset" | "system_preset" | "imported"
  fixedRoleCatalog?: false
  metadata?: EnterpriseMetadata
}

export type NodeOwnerEntityType = "position" | "org_unit" | "person" | "enterprise_system"

export interface NodeContract extends EnterpriseBaseEntity<"node"> {
  nodeType: NodeType
  owner?: EnterpriseEntityRef<NodeOwnerEntityType>
  instruction?: string
  description?: string
  tags: string[]
  children: string[]
  template?: NodeTemplateRef
  allowedToolIds: string[]
  allowedSystemIds: string[]
  failurePolicy?: FailurePolicy
  recoveryPolicy?: RecoveryPolicy
  metadata?: EnterpriseMetadata & {
    importedFromAgentConfigId?: string
  }
}

export interface EnterpriseTeam extends EnterpriseBaseEntity<"team"> {
  purpose?: string
  nodeIds: string[]
  tags: string[]
}

export interface OrgUnit extends EnterpriseBaseEntity<"org_unit"> {
  parentOrgUnitId?: string
  positionIds: string[]
  personIds: string[]
  budget?: EnterpriseMetadata
  kpiIds: string[]
  authorityScope?: EnterpriseMetadata
  responsibilityArea?: string
}

export interface Position extends EnterpriseBaseEntity<"position"> {
  orgUnitId: string
  reportsToPositionId?: string
  personIds: string[]
  approvalLimit?: number
  responsibilityIds: string[]
  backupPositionId?: string
}

export interface Person extends EnterpriseBaseEntity<"person"> {
  positionIds: string[]
  orgUnitIds: string[]
  availability?: "available" | "limited" | "unavailable" | "unknown"
}

export interface Membership extends EnterpriseBaseEntity<"membership"> {
  personId: string
  positionId?: string
  orgUnitId?: string
  teamId?: string
  validFrom?: EnterpriseTimestamp
  validTo?: EnterpriseTimestamp
  allocationPercent?: number
}

export interface AuthorityRule extends EnterpriseBaseEntity<"authority_rule"> {
  subject: EnterpriseEntityRef<"position" | "person" | "org_unit" | "node">
  action: string
  object: EnterpriseEntityRef
  condition?: EnterpriseMetadata
  delegable: boolean
  requiresAuditLog: boolean
}

export interface ResponsibilityMatrixEntry extends EnterpriseBaseEntity<"responsibility_matrix_entry"> {
  scope: EnterpriseEntityRef<"node" | "process_definition" | "enterprise_system" | "enterprise_tool">
  responsible: EnterpriseEntityRef<"position" | "person" | "org_unit" | "node">
  accountable?: EnterpriseEntityRef<"position" | "person" | "org_unit" | "node">
  consulted: Array<EnterpriseEntityRef<"position" | "person" | "org_unit" | "node">>
  informed: Array<EnterpriseEntityRef<"position" | "person" | "org_unit" | "node">>
}

export interface EnterpriseSystem extends EnterpriseBaseEntity<"enterprise_system"> {
  systemType: "internal" | "external" | "data_store" | "communication" | "automation" | "unknown"
  dataDomainIds: string[]
  criticality: "low" | "medium" | "high" | "critical" | "unknown"
}

export interface EnterpriseTool extends EnterpriseBaseEntity<"enterprise_tool"> {
  toolType: "read_only" | "write" | "external_action" | "analysis" | "unknown"
  systemId?: string
  inputSchema?: EnterpriseMetadata
  outputSchema?: EnterpriseMetadata
}

export interface ProcessDefinition extends EnterpriseBaseEntity<"process_definition"> {
  ownerNodeId?: string
  stepNodeIds: string[]
  accountablePositionId?: string
  slaMs?: number
}

export interface EnterpriseRelation extends EnterpriseBaseEntity<"relation"> {
  relationType: EnterpriseRelationType
  from: EnterpriseEntityRef
  to: EnterpriseEntityRef
  label?: string
  scope?: EnterpriseMetadata
  condition?: EnterpriseMetadata
}

export interface EnterpriseTopology extends EnterpriseBaseEntity<"topology"> {
  description?: string
  nodes: NodeContract[]
  teams: EnterpriseTeam[]
  orgUnits: OrgUnit[]
  positions: Position[]
  persons: Person[]
  memberships: Membership[]
  authorityRules: AuthorityRule[]
  responsibilities: ResponsibilityMatrixEntry[]
  systems: EnterpriseSystem[]
  tools: EnterpriseTool[]
  processes: ProcessDefinition[]
  relations: EnterpriseRelation[]
}

export interface EnterpriseTopologyVersionEnvelope extends EnterpriseBaseEntity<"topology_version"> {
  topologyId: string
  version: number
  topology: EnterpriseTopology
  validationSnapshotId?: string
  compiledSnapshotId?: string
  createdBy?: string
}

export type WorkOrderTargetType = "node" | "enterprise_tool" | "enterprise_system" | "position" | "person" | "org_unit"
export type SuccessCriterionValidationKind = "manual" | "schema" | "evidence" | "tool" | "policy"
export type NodeResultStatus =
  | "completed"
  | "partial_success"
  | "failed_candidate"
  | "permission_limited"
  | "needs_revision"
  | "failed"
export type NodeRuntimeState =
  | "created"
  | "work_order_received"
  | "analyzing"
  | "planning"
  | "permission_checking"
  | "self_executing"
  | "child_delegating"
  | "tool_executing"
  | "aggregating"
  | "validating"
  | "reporting"
  | "completed"
  | "partial_success"
  | "failed_candidate"
  | "exhaustion_checking"
  | "failed"
export type AttemptKind =
  | "self_execution"
  | "child_delegation"
  | "tool_execution"
  | "retry"
  | "fallback"
  | "partial_success_review"
  | "parent_recovery"
export type AttemptStatus = "attempted" | "skipped" | "blocked" | "succeeded" | "failed"
export type FailureIssueKind =
  | "success_criteria_unmet"
  | "runtime_risk"
  | "execution_incomplete"
  | "permission_or_tool_blocked"
  | "unknown"
export type FailureRecoveryActionKind =
  | "retry"
  | "delegate_to_next_executor"
  | "add_tool_permission"
  | "add_fallback_path"
  | "pass_partial_result"
  | "return_to_parent"
  | "review_trace"
  | "none"
export type FailureNextActionKind =
  | "add_permission"
  | "pass_partial"
  | "add_fallback"
  | "revise_description"
  | "review_trace"
  | "user_review"
export type TracePhase =
  | "topology_run"
  | "work_order"
  | "permission"
  | "authority"
  | "self_execution"
  | "child_delegation"
  | "tool_execution"
  | "aggregation"
  | "validation"
  | "recovery"
  | "exhaustion"
  | "reporting"

export interface WorkOrderTarget {
  type: WorkOrderTargetType
  id: string
}

export interface WorkOrderScope {
  included: string[]
  excluded: string[]
}

export interface WorkOrderSuccessCriterion {
  criterionId: string
  description: string
  required: boolean
  validationKind: SuccessCriterionValidationKind
  metadata?: EnterpriseMetadata
}

export interface PermissionScope {
  allowedToolIds: string[]
  allowedSystemIds: string[]
  dataDomainIds: string[]
  riskLevel?: "low" | "medium" | "high" | "critical" | "unknown"
}

export interface AuthorityScope {
  requiredAuthorityRuleIds: string[]
  approvalRequired: boolean
  approvedBy?: Array<EnterpriseEntityRef<"position" | "person" | "org_unit">>
}

export interface WorkOrder {
  schemaVersion: EnterpriseTopologySchemaVersion
  workOrderId: string
  topologyRunId: string
  parentWorkOrderId?: string | null
  fromNodeId: string
  to: WorkOrderTarget
  objective: string
  scope: WorkOrderScope
  input: EnterpriseMetadata
  expectedOutputSchema: EnterpriseMetadata
  successCriteria: WorkOrderSuccessCriterion[]
  permissionScope: PermissionScope
  authorityScope: AuthorityScope
  failureReportRequired: boolean
  delegationPath: string[]
  createdAt: EnterpriseTimestamp
}

export interface AttemptRecord {
  attemptId: string
  kind: AttemptKind
  status: AttemptStatus
  at: EnterpriseTimestamp
  reasonCode?: string
  summary?: string
  target?: WorkOrderTarget
}

export interface ExhaustionSummary {
  selfExecutionAttempted: boolean
  childDelegationAttempted: boolean
  toolExecutionAttempted: boolean
  retryAttempted: boolean
  fallbackAttempted: boolean
  partialSuccessChecked: boolean
  parentRecoveryPossibleChecked: boolean
  successCriteriaStillNotMet: boolean
  complete: boolean
}

export interface NodeResultOutput {
  outputId: string
  status: "satisfied" | "partial" | "missing"
  value?: EnterpriseMetadataValue
}

export interface NodeResultReport {
  schemaVersion: EnterpriseTopologySchemaVersion
  resultReportId: string
  topologyRunId: string
  nodeRunId: string
  workOrderId: string
  nodeId: string
  status: NodeResultStatus
  outputs: NodeResultOutput[]
  unmetSuccessCriteriaIds: string[]
  risksOrGaps: string[]
  partialResult?: EnterpriseMetadata
  failureReportId?: string
  createdAt: EnterpriseTimestamp
}

export interface FailureReport {
  schemaVersion: EnterpriseTopologySchemaVersion
  failureReportId: string
  topologyRunId: string
  nodeRunId: string
  workOrderId: string
  nodeId: string
  exhaustionSummary: ExhaustionSummary
  attempts: AttemptRecord[]
  untriedOptions: string[]
  partialResult?: EnterpriseMetadata
  organizationalCause?: string
  processCause?: string
  authorityCause?: string
  issueKind?: FailureIssueKind
  recoveryActionKind?: FailureRecoveryActionKind
  nextActionKind?: FailureNextActionKind
  recommendedAction: string
  createdAt: EnterpriseTimestamp
}

export interface TraceEvent {
  schemaVersion: EnterpriseTopologySchemaVersion
  traceEventId: string
  topologyRunId: string
  nodeRunId: string
  workOrderId: string
  parentWorkOrderId?: string | null
  delegationPath: string[]
  phase: TracePhase
  component: string
  at: EnterpriseTimestamp
  reasonCode: string
  payload?: EnterpriseMetadata
}

export interface FailurePolicy {
  failureReportRequired: boolean
  allowPartialSuccess: boolean
  fallbackNodeIds: string[]
}

export interface RecoveryPolicy {
  retryAllowed: boolean
  redelegationAllowed: boolean
  fallbackAllowed: boolean
  partialSuccessAllowed: boolean
}

/**
 * Execution-only profile derived from NodeContract + WorkOrder + CompiledTopology + PermissionScope.
 * This snapshot must never become the source topology model or require a persistent AgentConfig id.
 */
export interface NodeRuntimeProfileSnapshot {
  schemaVersion: EnterpriseTopologySchemaVersion
  profileSnapshotId: string
  topologyId: string
  compiledTopologySnapshotId: string
  nodeId: string
  workOrderId: string
  permissionScope: PermissionScope
  authorityScope: AuthorityScope
  allowedToolIds: string[]
  allowedSystemIds: string[]
  delegationPath: string[]
  createdAt: EnterpriseTimestamp
  source: {
    nodeContractId: string
    workOrderId: string
    compiledTopologySnapshotId: string
  }
}

export type EnterpriseTopologyValidationCode =
  | "enterprise_contract_validation_failed"
  | "unsupported_enterprise_topology_schema_version"
  | "missing_required_field"
  | "invalid_entity_type"
  | "invalid_entity_status"
  | "invalid_node_type"
  | "invalid_node_owner"
  | "invalid_relation_type"
  | "invalid_relation_endpoint"
  | "team_execution_semantics_forbidden"
  | "team_org_unit_mixed"
  | "fixed_role_catalog_forbidden"
  | "missing_success_criteria"
  | "missing_exhaustion_summary"
  | "missing_trace_linkage"
  | "invalid_runtime_state"
  | "final_failure_without_failure_report"

export interface EnterpriseTopologyValidationIssue {
  path: string
  code: EnterpriseTopologyValidationCode
  reasonCode: EnterpriseTopologyValidationCode
  message: string
  entityId?: string
  relationId?: string
}

export type EnterpriseTopologyValidationResult<T> =
  | { ok: true; value: T; issues: [] }
  | { ok: false; issues: EnterpriseTopologyValidationIssue[] }

const FIXED_ROLE_CATALOG_KEYS = new Set([
  "fixedRoleAgentCatalog",
  "roleAgentCatalog",
  "requiredRoleAgents",
  "plannerAgentId",
  "researcherAgentId",
  "validatorAgentId",
])

const TEAM_EXECUTION_KEYS = new Set([
  "children",
  "delegationPolicy",
  "executionPolicy",
  "runtimeProfile",
  "workOrderPolicy",
  "permissionScope",
  "authorityScope",
  "ownerAgentId",
  "leadAgentId",
])

const TEAM_ORG_UNIT_MIXED_KEYS = new Set([
  "orgUnitId",
  "parentOrgUnitId",
  "positionIds",
  "budget",
  "kpiIds",
  "responsibilityArea",
])

const ORG_UNIT_TEAM_MIXED_KEYS = new Set(["nodeIds", "leadNodeId", "memberNodeIds", "requiredTeamRoles"])

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

function addIssue(
  issues: EnterpriseTopologyValidationIssue[],
  path: string,
  code: EnterpriseTopologyValidationCode,
  message: string,
  details: { entityId?: string; relationId?: string } = {},
): void {
  issues.push({
    path,
    code,
    reasonCode: code,
    message,
    ...(details.entityId ? { entityId: details.entityId } : {}),
    ...(details.relationId ? { relationId: details.relationId } : {}),
  })
}

function hasKey(record: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key)
}

function validateRequiredString(
  record: Record<string, unknown>,
  key: string,
  path: string,
  issues: EnterpriseTopologyValidationIssue[],
): boolean {
  if (typeof record[key] === "string" && record[key].trim().length > 0) return true
  addIssue(issues, `${path}.${key}`, "missing_required_field", `${key} must be a non-empty string.`)
  return false
}

function validateTimestamp(
  record: Record<string, unknown>,
  key: string,
  path: string,
  issues: EnterpriseTopologyValidationIssue[],
): void {
  const value = record[key]
  if ((typeof value === "number" && Number.isFinite(value)) || (typeof value === "string" && value.trim())) return
  addIssue(issues, `${path}.${key}`, "missing_required_field", `${key} must be a timestamp.`)
}

function validateSchemaVersion(
  record: Record<string, unknown>,
  path: string,
  issues: EnterpriseTopologyValidationIssue[],
): void {
  if (record.schemaVersion === ENTERPRISE_TOPOLOGY_SCHEMA_VERSION) return
  addIssue(
    issues,
    `${path}.schemaVersion`,
    "unsupported_enterprise_topology_schema_version",
    "Unsupported enterprise topology schema version.",
  )
}

function validateBaseEntity(
  record: Record<string, unknown>,
  expectedType: EnterpriseEntityType,
  path: string,
  issues: EnterpriseTopologyValidationIssue[],
): void {
  validateSchemaVersion(record, path, issues)
  if (record.entityType !== expectedType) {
    addIssue(issues, `${path}.entityType`, "invalid_entity_type", `Expected entityType ${expectedType}.`)
  }
  validateRequiredString(record, "id", path, issues)
  validateRequiredString(record, "name", path, issues)
  if (typeof record.status !== "string" || !ENTITY_STATUSES.has(record.status as EnterpriseEntityStatus)) {
    addIssue(issues, `${path}.status`, "invalid_entity_status", "Unsupported enterprise entity status.")
  }
  validateTimestamp(record, "createdAt", path, issues)
  validateTimestamp(record, "updatedAt", path, issues)
}

function addForbiddenKeyIssues(
  record: Record<string, unknown>,
  keys: ReadonlySet<string>,
  path: string,
  code: EnterpriseTopologyValidationCode,
  message: string,
  issues: EnterpriseTopologyValidationIssue[],
): void {
  for (const key of keys) {
    if (hasKey(record, key)) addIssue(issues, `${path}.${key}`, code, message)
  }
}

function validateStringArray(
  value: unknown,
  path: string,
  issues: EnterpriseTopologyValidationIssue[],
): void {
  if (Array.isArray(value) && value.every((item) => typeof item === "string")) return
  addIssue(issues, path, "enterprise_contract_validation_failed", "Expected a string array.")
}

function validateRequiredBoolean(
  record: Record<string, unknown>,
  key: string,
  path: string,
  issues: EnterpriseTopologyValidationIssue[],
): void {
  if (typeof record[key] === "boolean") return
  addIssue(issues, `${path}.${key}`, "missing_required_field", `${key} must be a boolean.`)
}

function validateOptionalEnumString<T extends string>(
  record: Record<string, unknown>,
  key: string,
  values: ReadonlySet<T>,
  path: string,
  issues: EnterpriseTopologyValidationIssue[],
): void {
  if (!hasKey(record, key) || record[key] === undefined) return
  if (typeof record[key] === "string" && values.has(record[key] as T)) return
  addIssue(issues, `${path}.${key}`, "enterprise_contract_validation_failed", `${key} has an unsupported value.`)
}

function validateRequiredNumber(
  record: Record<string, unknown>,
  key: string,
  path: string,
  issues: EnterpriseTopologyValidationIssue[],
): void {
  if (typeof record[key] === "number" && Number.isFinite(record[key])) return
  addIssue(issues, `${path}.${key}`, "missing_required_field", `${key} must be a number.`)
}

function validateRequiredRecord(
  value: unknown,
  path: string,
  issues: EnterpriseTopologyValidationIssue[],
  code: EnterpriseTopologyValidationCode = "missing_required_field",
): value is Record<string, unknown> {
  if (isRecord(value)) return true
  addIssue(issues, path, code, `${path} must be an object.`)
  return false
}

function validateEntityRef(
  value: unknown,
  path: string,
  issues: EnterpriseTopologyValidationIssue[],
): value is EnterpriseEntityRef {
  if (!isRecord(value)) {
    addIssue(issues, path, "enterprise_contract_validation_failed", "Expected an entity reference.")
    return false
  }
  validateRequiredString(value, "entityType", path, issues)
  validateRequiredString(value, "id", path, issues)
  return typeof value.entityType === "string" && typeof value.id === "string"
}

function validateFailurePolicyContract(value: unknown, path: string, issues: EnterpriseTopologyValidationIssue[]): void {
  if (!validateRequiredRecord(value, path, issues, "enterprise_contract_validation_failed")) return
  validateRequiredBoolean(value, "failureReportRequired", path, issues)
  validateRequiredBoolean(value, "allowPartialSuccess", path, issues)
  validateStringArray(value.fallbackNodeIds, `${path}.fallbackNodeIds`, issues)
}

function validateRecoveryPolicyContract(value: unknown, path: string, issues: EnterpriseTopologyValidationIssue[]): void {
  if (!validateRequiredRecord(value, path, issues, "enterprise_contract_validation_failed")) return
  validateRequiredBoolean(value, "retryAllowed", path, issues)
  validateRequiredBoolean(value, "redelegationAllowed", path, issues)
  validateRequiredBoolean(value, "fallbackAllowed", path, issues)
  validateRequiredBoolean(value, "partialSuccessAllowed", path, issues)
}

export function validateNodeContract(value: unknown): EnterpriseTopologyValidationResult<NodeContract> {
  const issues: EnterpriseTopologyValidationIssue[] = []
  if (!isRecord(value)) {
    return {
      ok: false,
      issues: [{
        path: "$",
        code: "enterprise_contract_validation_failed",
        reasonCode: "enterprise_contract_validation_failed",
        message: "Node contract must be an object.",
      }],
    }
  }
  validateBaseEntity(value, "node", "$", issues)
  if (typeof value.nodeType !== "string" || !NODE_TYPES.has(value.nodeType as NodeType)) {
    addIssue(issues, "$.nodeType", "invalid_node_type", "Unsupported node type.")
  }
  validateStringArray(value.tags, "$.tags", issues)
  validateStringArray(value.children, "$.children", issues)
  validateStringArray(value.allowedToolIds, "$.allowedToolIds", issues)
  validateStringArray(value.allowedSystemIds, "$.allowedSystemIds", issues)
  if (value.failurePolicy !== undefined) validateFailurePolicyContract(value.failurePolicy, "$.failurePolicy", issues)
  if (value.recoveryPolicy !== undefined) validateRecoveryPolicyContract(value.recoveryPolicy, "$.recoveryPolicy", issues)
  if (value.owner != null && validateEntityRef(value.owner, "$.owner", issues)) {
    const allowedOwners = new Set<EnterpriseEntityType>(["position", "org_unit", "person", "enterprise_system"])
    if (!allowedOwners.has(value.owner.entityType)) {
      addIssue(issues, "$.owner.entityType", "invalid_node_owner", "Node owner must reference Position, OrgUnit, Person, or System.")
    }
  }
  if (isRecord(value.template) && value.template.fixedRoleCatalog !== undefined && value.template.fixedRoleCatalog !== false) {
    addIssue(
      issues,
      "$.template.fixedRoleCatalog",
      "fixed_role_catalog_forbidden",
      "Node templates cannot require a fixed role agent catalog.",
    )
  }
  addForbiddenKeyIssues(
    value,
    FIXED_ROLE_CATALOG_KEYS,
    "$",
    "fixed_role_catalog_forbidden",
    "Fixed role agent catalogs are not part of the enterprise topology source model.",
    issues,
  )
  return issues.length === 0 ? { ok: true, value: value as unknown as NodeContract, issues: [] } : { ok: false, issues }
}

export function validateEnterpriseTeam(value: unknown): EnterpriseTopologyValidationResult<EnterpriseTeam> {
  const issues: EnterpriseTopologyValidationIssue[] = []
  if (!isRecord(value)) {
    return {
      ok: false,
      issues: [{
        path: "$",
        code: "enterprise_contract_validation_failed",
        reasonCode: "enterprise_contract_validation_failed",
        message: "Team must be an object.",
      }],
    }
  }
  validateBaseEntity(value, "team", "$", issues)
  validateStringArray(value.nodeIds, "$.nodeIds", issues)
  validateStringArray(value.tags, "$.tags", issues)
  addForbiddenKeyIssues(
    value,
    TEAM_EXECUTION_KEYS,
    "$",
    "team_execution_semantics_forbidden",
    "Team is a logical group and cannot define execution semantics.",
    issues,
  )
  addForbiddenKeyIssues(
    value,
    TEAM_ORG_UNIT_MIXED_KEYS,
    "$",
    "team_org_unit_mixed",
    "Team and OrgUnit fields must not be mixed.",
    issues,
  )
  return issues.length === 0 ? { ok: true, value: value as unknown as EnterpriseTeam, issues: [] } : { ok: false, issues }
}

export function validateEnterpriseOrgUnit(value: unknown): EnterpriseTopologyValidationResult<OrgUnit> {
  const issues: EnterpriseTopologyValidationIssue[] = []
  if (!isRecord(value)) {
    return {
      ok: false,
      issues: [{
        path: "$",
        code: "enterprise_contract_validation_failed",
        reasonCode: "enterprise_contract_validation_failed",
        message: "OrgUnit must be an object.",
      }],
    }
  }
  validateBaseEntity(value, "org_unit", "$", issues)
  validateStringArray(value.positionIds, "$.positionIds", issues)
  validateStringArray(value.personIds, "$.personIds", issues)
  validateStringArray(value.kpiIds, "$.kpiIds", issues)
  addForbiddenKeyIssues(
    value,
    ORG_UNIT_TEAM_MIXED_KEYS,
    "$",
    "team_org_unit_mixed",
    "OrgUnit and Team fields must not be mixed.",
    issues,
  )
  return issues.length === 0 ? { ok: true, value: value as unknown as OrgUnit, issues: [] } : { ok: false, issues }
}

function endpointAllowed(
  relationType: EnterpriseRelationType,
  from: EnterpriseEntityType,
  to: EnterpriseEntityType,
): boolean {
  switch (relationType) {
    case "delegates_to":
      return from === "node" && to === "node"
    case "reports_to":
      return (from === "position" && to === "position") || (from === "person" && to === "person")
    case "belongs_to":
      return (
        (from === "node" && to === "team") ||
        (from === "position" && to === "org_unit") ||
        (from === "person" && to === "org_unit") ||
        (from === "team" && to === "org_unit")
      )
    case "approves":
      return ["position", "person", "org_unit"].includes(from) && ["node", "process_definition", "enterprise_system", "enterprise_tool"].includes(to)
    case "owns":
      return ["position", "person", "org_unit", "node"].includes(from) && ["node", "process_definition", "enterprise_system", "enterprise_tool"].includes(to)
    case "uses_system":
      return ["node", "process_definition"].includes(from) && to === "enterprise_system"
    case "uses_tool":
      return from === "node" && to === "enterprise_tool"
    case "has_access_to":
      return ["node", "position", "person", "org_unit"].includes(from) && ["enterprise_system", "enterprise_tool"].includes(to)
    case "accountable_for":
      return ["position", "person", "org_unit", "node"].includes(from) && ["node", "process_definition"].includes(to)
    case "collaborates_with":
    case "informs":
      return ["node", "team", "org_unit", "position", "person"].includes(from) && ["node", "team", "org_unit", "position", "person"].includes(to)
    case "escalates_to":
    case "consults":
      return ["node", "position", "person"].includes(from) && ["node", "position", "person"].includes(to)
    case "depends_on":
      return ["node", "process_definition", "enterprise_system", "enterprise_tool"].includes(from) && ["node", "process_definition", "enterprise_system", "enterprise_tool"].includes(to)
  }
}

export function validateEnterpriseRelation(value: unknown): EnterpriseTopologyValidationResult<EnterpriseRelation> {
  const issues: EnterpriseTopologyValidationIssue[] = []
  if (!isRecord(value)) {
    return {
      ok: false,
      issues: [{
        path: "$",
        code: "enterprise_contract_validation_failed",
        reasonCode: "enterprise_contract_validation_failed",
        message: "Enterprise relation must be an object.",
      }],
    }
  }
  validateBaseEntity(value, "relation", "$", issues)
  const relationDetails = typeof value.id === "string" ? { relationId: value.id } : {}
  if (typeof value.relationType !== "string" || !RELATION_TYPES.has(value.relationType as EnterpriseRelationType)) {
    addIssue(issues, "$.relationType", "invalid_relation_type", "Unsupported enterprise relation type.", relationDetails)
  }
  const from = value.from
  const to = value.to
  const fromOk = validateEntityRef(from, "$.from", issues)
  const toOk = validateEntityRef(to, "$.to", issues)
  if (fromOk && toOk && typeof value.relationType === "string" && RELATION_TYPES.has(value.relationType as EnterpriseRelationType)) {
    if (!endpointAllowed(value.relationType as EnterpriseRelationType, from.entityType, to.entityType)) {
      addIssue(issues, "$.to.entityType", "invalid_relation_endpoint", "Relation source and target entity types are not compatible.", {
        ...relationDetails,
      })
    }
  }
  return issues.length === 0 ? { ok: true, value: value as unknown as EnterpriseRelation, issues: [] } : { ok: false, issues }
}

function validateEntityArray(
  value: unknown,
  path: string,
  issues: EnterpriseTopologyValidationIssue[],
  validateItem: (value: unknown) => EnterpriseTopologyValidationResult<unknown>,
): void {
  if (!Array.isArray(value)) {
    addIssue(issues, path, "missing_required_field", `${path} must be an array.`)
    return
  }
  value.forEach((item, index) => {
    const result = validateItem(item)
    if (!result.ok) {
      issues.push(...result.issues.map((issue) => ({ ...issue, path: `${path}[${index}]${issue.path.slice(1)}` })))
    }
  })
}

function validateBaseOnlyArray(
  value: unknown,
  path: string,
  entityType: EnterpriseEntityType,
  issues: EnterpriseTopologyValidationIssue[],
  extra?: (record: Record<string, unknown>, itemPath: string) => void,
): void {
  if (!Array.isArray(value)) {
    addIssue(issues, path, "missing_required_field", `${path} must be an array.`)
    return
  }
  value.forEach((item, index) => {
    const itemPath = `${path}[${index}]`
    if (!isRecord(item)) {
      addIssue(issues, itemPath, "enterprise_contract_validation_failed", `${entityType} must be an object.`)
      return
    }
    validateBaseEntity(item, entityType, itemPath, issues)
    extra?.(item, itemPath)
  })
}

export function validateEnterpriseTopology(value: unknown): EnterpriseTopologyValidationResult<EnterpriseTopology> {
  const issues: EnterpriseTopologyValidationIssue[] = []
  if (!isRecord(value)) {
    return {
      ok: false,
      issues: [{
        path: "$",
        code: "enterprise_contract_validation_failed",
        reasonCode: "enterprise_contract_validation_failed",
        message: "Enterprise topology must be an object.",
      }],
    }
  }
  validateBaseEntity(value, "topology", "$", issues)
  addForbiddenKeyIssues(
    value,
    FIXED_ROLE_CATALOG_KEYS,
    "$",
    "fixed_role_catalog_forbidden",
    "Fixed role agent catalogs are not part of the enterprise topology source model.",
    issues,
  )
  validateEntityArray(value.nodes, "$.nodes", issues, validateNodeContract)
  validateEntityArray(value.teams, "$.teams", issues, validateEnterpriseTeam)
  validateEntityArray(value.orgUnits, "$.orgUnits", issues, validateEnterpriseOrgUnit)
  validateBaseOnlyArray(value.positions, "$.positions", "position", issues, (record, path) => {
    validateRequiredString(record, "orgUnitId", path, issues)
    validateStringArray(record.personIds, `${path}.personIds`, issues)
    validateStringArray(record.responsibilityIds, `${path}.responsibilityIds`, issues)
  })
  validateBaseOnlyArray(value.persons, "$.persons", "person", issues, (record, path) => {
    validateStringArray(record.positionIds, `${path}.positionIds`, issues)
    validateStringArray(record.orgUnitIds, `${path}.orgUnitIds`, issues)
  })
  validateBaseOnlyArray(value.memberships, "$.memberships", "membership", issues, (record, path) => {
    validateRequiredString(record, "personId", path, issues)
  })
  validateBaseOnlyArray(value.authorityRules, "$.authorityRules", "authority_rule", issues)
  validateBaseOnlyArray(value.responsibilities, "$.responsibilities", "responsibility_matrix_entry", issues)
  validateBaseOnlyArray(value.systems, "$.systems", "enterprise_system", issues)
  validateBaseOnlyArray(value.tools, "$.tools", "enterprise_tool", issues)
  validateBaseOnlyArray(value.processes, "$.processes", "process_definition", issues)
  validateEntityArray(value.relations, "$.relations", issues, validateEnterpriseRelation)
  return issues.length === 0 ? { ok: true, value: value as unknown as EnterpriseTopology, issues: [] } : { ok: false, issues }
}

function validatePermissionScope(value: unknown, path: string, issues: EnterpriseTopologyValidationIssue[]): void {
  if (!validateRequiredRecord(value, path, issues)) return
  validateStringArray(value.allowedToolIds, `${path}.allowedToolIds`, issues)
  validateStringArray(value.allowedSystemIds, `${path}.allowedSystemIds`, issues)
  validateStringArray(value.dataDomainIds, `${path}.dataDomainIds`, issues)
}

function validateAuthorityScope(value: unknown, path: string, issues: EnterpriseTopologyValidationIssue[]): void {
  if (!validateRequiredRecord(value, path, issues)) return
  validateStringArray(value.requiredAuthorityRuleIds, `${path}.requiredAuthorityRuleIds`, issues)
  validateRequiredBoolean(value, "approvalRequired", path, issues)
}

function validateWorkOrderTarget(value: unknown, path: string, issues: EnterpriseTopologyValidationIssue[]): void {
  if (!validateRequiredRecord(value, path, issues)) return
  validateRequiredString(value, "type", path, issues)
  validateRequiredString(value, "id", path, issues)
}

function validateSuccessCriteria(value: unknown, path: string, issues: EnterpriseTopologyValidationIssue[]): void {
  if (!Array.isArray(value) || value.length === 0) {
    addIssue(issues, path, "missing_success_criteria", "WorkOrder must define at least one success criterion.")
    return
  }
  value.forEach((item, index) => {
    const itemPath = `${path}[${index}]`
    if (!validateRequiredRecord(item, itemPath, issues)) return
    validateRequiredString(item, "criterionId", itemPath, issues)
    validateRequiredString(item, "description", itemPath, issues)
    validateRequiredBoolean(item, "required", itemPath, issues)
    validateRequiredString(item, "validationKind", itemPath, issues)
  })
}

export function validateWorkOrder(value: unknown): EnterpriseTopologyValidationResult<WorkOrder> {
  const issues: EnterpriseTopologyValidationIssue[] = []
  if (!isRecord(value)) {
    return {
      ok: false,
      issues: [{
        path: "$",
        code: "enterprise_contract_validation_failed",
        reasonCode: "enterprise_contract_validation_failed",
        message: "WorkOrder must be an object.",
      }],
    }
  }
  validateSchemaVersion(value, "$", issues)
  validateRequiredString(value, "workOrderId", "$", issues)
  validateRequiredString(value, "topologyRunId", "$", issues)
  validateRequiredString(value, "fromNodeId", "$", issues)
  validateWorkOrderTarget(value.to, "$.to", issues)
  validateRequiredString(value, "objective", "$", issues)
  if (validateRequiredRecord(value.scope, "$.scope", issues)) {
    validateStringArray(value.scope.included, "$.scope.included", issues)
    validateStringArray(value.scope.excluded, "$.scope.excluded", issues)
  }
  validateRequiredRecord(value.input, "$.input", issues)
  validateRequiredRecord(value.expectedOutputSchema, "$.expectedOutputSchema", issues)
  validateSuccessCriteria(value.successCriteria, "$.successCriteria", issues)
  validatePermissionScope(value.permissionScope, "$.permissionScope", issues)
  validateAuthorityScope(value.authorityScope, "$.authorityScope", issues)
  validateRequiredBoolean(value, "failureReportRequired", "$", issues)
  validateStringArray(value.delegationPath, "$.delegationPath", issues)
  validateTimestamp(value, "createdAt", "$", issues)
  return issues.length === 0 ? { ok: true, value: value as unknown as WorkOrder, issues: [] } : { ok: false, issues }
}

export function validateNodeResultReport(value: unknown): EnterpriseTopologyValidationResult<NodeResultReport> {
  const issues: EnterpriseTopologyValidationIssue[] = []
  if (!isRecord(value)) {
    return {
      ok: false,
      issues: [{
        path: "$",
        code: "enterprise_contract_validation_failed",
        reasonCode: "enterprise_contract_validation_failed",
        message: "NodeResultReport must be an object.",
      }],
    }
  }
  validateSchemaVersion(value, "$", issues)
  validateRequiredString(value, "resultReportId", "$", issues)
  validateRequiredString(value, "topologyRunId", "$", issues)
  validateRequiredString(value, "nodeRunId", "$", issues)
  validateRequiredString(value, "workOrderId", "$", issues)
  validateRequiredString(value, "nodeId", "$", issues)
  const allowedStatuses = new Set<NodeResultStatus>([
    "completed",
    "partial_success",
    "failed_candidate",
    "permission_limited",
    "needs_revision",
    "failed",
  ])
  if (typeof value.status !== "string" || !allowedStatuses.has(value.status as NodeResultStatus)) {
    addIssue(issues, "$.status", "invalid_runtime_state", "Unsupported node result status.")
  }
  if (value.status === "failed" && (typeof value.failureReportId !== "string" || !value.failureReportId.trim())) {
    addIssue(issues, "$.failureReportId", "final_failure_without_failure_report", "Final failed reports require a FailureReport id.")
  }
  if (!Array.isArray(value.outputs)) {
    addIssue(issues, "$.outputs", "missing_required_field", "outputs must be an array.")
  }
  validateStringArray(value.unmetSuccessCriteriaIds, "$.unmetSuccessCriteriaIds", issues)
  validateStringArray(value.risksOrGaps, "$.risksOrGaps", issues)
  validateTimestamp(value, "createdAt", "$", issues)
  return issues.length === 0 ? { ok: true, value: value as unknown as NodeResultReport, issues: [] } : { ok: false, issues }
}

function validateExhaustionSummary(value: unknown, path: string, issues: EnterpriseTopologyValidationIssue[]): void {
  if (!validateRequiredRecord(value, path, issues, "missing_exhaustion_summary")) return
  validateRequiredBoolean(value, "selfExecutionAttempted", path, issues)
  validateRequiredBoolean(value, "childDelegationAttempted", path, issues)
  validateRequiredBoolean(value, "toolExecutionAttempted", path, issues)
  validateRequiredBoolean(value, "retryAttempted", path, issues)
  validateRequiredBoolean(value, "fallbackAttempted", path, issues)
  validateRequiredBoolean(value, "partialSuccessChecked", path, issues)
  validateRequiredBoolean(value, "parentRecoveryPossibleChecked", path, issues)
  validateRequiredBoolean(value, "successCriteriaStillNotMet", path, issues)
  validateRequiredBoolean(value, "complete", path, issues)
}

export function validateFailureReport(value: unknown): EnterpriseTopologyValidationResult<FailureReport> {
  const issues: EnterpriseTopologyValidationIssue[] = []
  if (!isRecord(value)) {
    return {
      ok: false,
      issues: [{
        path: "$",
        code: "enterprise_contract_validation_failed",
        reasonCode: "enterprise_contract_validation_failed",
        message: "FailureReport must be an object.",
      }],
    }
  }
  validateSchemaVersion(value, "$", issues)
  validateRequiredString(value, "failureReportId", "$", issues)
  validateRequiredString(value, "topologyRunId", "$", issues)
  validateRequiredString(value, "nodeRunId", "$", issues)
  validateRequiredString(value, "workOrderId", "$", issues)
  validateRequiredString(value, "nodeId", "$", issues)
  validateExhaustionSummary(value.exhaustionSummary, "$.exhaustionSummary", issues)
  if (!Array.isArray(value.attempts)) {
    addIssue(issues, "$.attempts", "missing_required_field", "attempts must be an array.")
  }
  validateStringArray(value.untriedOptions, "$.untriedOptions", issues)
  validateOptionalEnumString(value, "issueKind", FAILURE_ISSUE_KINDS, "$", issues)
  validateOptionalEnumString(value, "recoveryActionKind", FAILURE_RECOVERY_ACTION_KINDS, "$", issues)
  validateOptionalEnumString(value, "nextActionKind", FAILURE_NEXT_ACTION_KINDS, "$", issues)
  validateRequiredString(value, "recommendedAction", "$", issues)
  validateTimestamp(value, "createdAt", "$", issues)
  return issues.length === 0 ? { ok: true, value: value as unknown as FailureReport, issues: [] } : { ok: false, issues }
}

export function validateTraceEvent(value: unknown): EnterpriseTopologyValidationResult<TraceEvent> {
  const issues: EnterpriseTopologyValidationIssue[] = []
  if (!isRecord(value)) {
    return {
      ok: false,
      issues: [{
        path: "$",
        code: "enterprise_contract_validation_failed",
        reasonCode: "enterprise_contract_validation_failed",
        message: "TraceEvent must be an object.",
      }],
    }
  }
  validateSchemaVersion(value, "$", issues)
  validateRequiredString(value, "traceEventId", "$", issues)
  validateRequiredString(value, "topologyRunId", "$", issues)
  validateRequiredString(value, "nodeRunId", "$", issues)
  validateRequiredString(value, "workOrderId", "$", issues)
  validateStringArray(value.delegationPath, "$.delegationPath", issues)
  validateRequiredString(value, "phase", "$", issues)
  validateRequiredString(value, "component", "$", issues)
  validateTimestamp(value, "at", "$", issues)
  validateRequiredString(value, "reasonCode", "$", issues)
  const linkageFields = ["topologyRunId", "nodeRunId", "workOrderId", "delegationPath"] as const
  for (const field of linkageFields) {
    const missingArray = field === "delegationPath" && !Array.isArray(value[field])
    const missingString = field !== "delegationPath" && (typeof value[field] !== "string" || !value[field].trim())
    if (missingArray || missingString) {
      addIssue(issues, `$.${field}`, "missing_trace_linkage", "TraceEvent must include topology, node, work order, and path linkage.")
    }
  }
  return issues.length === 0 ? { ok: true, value: value as unknown as TraceEvent, issues: [] } : { ok: false, issues }
}
