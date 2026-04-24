import {
  CONTRACT_SCHEMA_VERSION,
  type ContractSchemaVersion,
  type ContractValidationIssue,
  type ContractValidationResult,
  type JsonObject,
  type JsonValue,
} from "./index.js"

export const SUB_AGENT_CONTRACT_SCHEMA_VERSION = CONTRACT_SCHEMA_VERSION

export type AgentEntityType = "nobie" | "sub_agent"
export type RelationshipEntityType =
  | AgentEntityType
  | "team"
  | "session"
  | "sub_session"
  | "capability"
  | "data_exchange"
export type AgentStatus = "enabled" | "disabled" | "archived" | "degraded"
export type OrchestrationMode = "single_nobie" | "orchestration"
export type SubSessionStatus =
  | "created"
  | "queued"
  | "running"
  | "waiting_for_input"
  | "awaiting_approval"
  | "completed"
  | "needs_revision"
  | "failed"
  | "cancelled"
export type TaskExecutionKind = "direct_nobie" | "delegated_sub_agent"
export type ResourceLockKind =
  | "file"
  | "display"
  | "channel"
  | "mcp_server"
  | "secret_scope"
  | "external_target"
  | "custom"
export type CapabilityRiskLevel = "safe" | "moderate" | "external" | "sensitive" | "dangerous"
export type DataExchangeRetentionPolicy =
  | "session_only"
  | "short_term"
  | "long_term_candidate"
  | "discard_after_review"
export type LearningApprovalState =
  | "auto_applied"
  | "pending_review"
  | "rejected"
  | "applied_by_user"
export type RelationshipEdgeType =
  | "parent_child"
  | "delegation"
  | "data_exchange"
  | "permission"
  | "capability_delegation"
  | "team_membership"
export type NicknameEntityType = AgentEntityType | "team"
export type NamedDeliveryKind = "data_exchange" | "result_report" | "handoff_context"
export type TeamResultPolicyMode =
  | "lead_synthesis"
  | "owner_synthesis"
  | "reviewer_required"
  | "verifier_required"
  | "quorum_required"
export type TeamConflictPolicyMode =
  | "lead_decides"
  | "owner_decides"
  | "reviewer_decides"
  | "report_conflict"
export type TeamMembershipStatus = "active" | "inactive" | "fallback_only" | "removed"
export type AgentRelationshipStatus = "active" | "disabled" | "archived"
export type FeedbackTargetAgentPolicy =
  | "same_agent"
  | "alternative_direct_child"
  | "parent_decides"
  | "fallback_agent"
  | "lead_assigns"
  | "nobie_direct"

export interface ModelProfile {
  providerId: string
  modelId: string
  effort?: string
  temperature?: number
  maxOutputTokens?: number
  timeoutMs?: number
  retryCount?: number
  costBudget?: number
  fallbackModelId?: string
}

export interface ModelExecutionSnapshot {
  providerId: string
  modelId: string
  effort?: string
  fallbackApplied: boolean
  fallbackFromModelId?: string
  fallbackReasonCode?: string
  timeoutMs?: number
  retryCount: number
  costBudget?: number
  maxOutputTokens?: number
  estimatedInputTokens: number
  estimatedOutputTokens: number
  estimatedCost: number
  attemptCount?: number
  latencyMs?: number
  reasonCodes: string[]
}

export interface DelegationPolicy {
  enabled: boolean
  maxParallelSessions: number
  retryBudget: number
}

export interface NicknameSnapshot {
  entityType: NicknameEntityType
  entityId: string
  nicknameSnapshot: string
}

export interface NicknameNamespaceEntry extends NicknameSnapshot {
  sourcePath?: string
}

export interface NicknameNamespaceConflict {
  normalizedNickname: string
  existing: NicknameNamespaceEntry
  attempted: NicknameNamespaceEntry
}

export interface OwnerScope {
  ownerType: "nobie" | "sub_agent" | "team" | "system"
  ownerId: string
}

export interface ParentLinkage {
  parentRunId?: string
  parentSessionId?: string
  parentSubSessionId?: string
  parentRequestId?: string
}

export interface RuntimeIdentity {
  schemaVersion: ContractSchemaVersion
  entityType: RelationshipEntityType
  entityId: string
  owner: OwnerScope
  idempotencyKey: string
  auditCorrelationId?: string
  parent?: ParentLinkage
}

export interface MemoryPolicy {
  owner: OwnerScope
  visibility: "private" | "coordinator_visible" | "team_visible"
  readScopes: OwnerScope[]
  writeScope: OwnerScope
  retentionPolicy: "session" | "short_term" | "long_term"
  writebackReviewRequired: boolean
}

export interface SkillMcpAllowlist {
  enabledSkillIds: string[]
  enabledMcpServerIds: string[]
  enabledToolNames: string[]
  disabledToolNames: string[]
  secretScopeId?: string
}

export interface PermissionProfile {
  profileId: string
  riskCeiling: CapabilityRiskLevel
  approvalRequiredFrom: CapabilityRiskLevel
  allowExternalNetwork: boolean
  allowFilesystemWrite: boolean
  allowShellExecution: boolean
  allowScreenControl: boolean
  allowedPaths: string[]
}

export interface CapabilityPolicy {
  permissionProfile: PermissionProfile
  skillMcpAllowlist: SkillMcpAllowlist
  rateLimit: {
    maxConcurrentCalls: number
    maxCallsPerMinute?: number
  }
}

export interface BaseAgentConfig {
  schemaVersion: ContractSchemaVersion
  agentType: AgentEntityType
  agentId: string
  displayName: string
  nickname?: string
  normalizedNickname?: string
  status: AgentStatus
  role: string
  personality: string
  specialtyTags: string[]
  avoidTasks: string[]
  modelProfile?: ModelProfile
  memoryPolicy: MemoryPolicy
  capabilityPolicy: CapabilityPolicy
  delegationPolicy?: DelegationPolicy
  profileVersion: number
  createdAt: number
  updatedAt: number
}

export interface NobieConfig extends BaseAgentConfig {
  agentType: "nobie"
  coordinator: {
    defaultMode: OrchestrationMode
    fallbackMode: "single_nobie"
    maxDelegatedSubSessions: number
  }
}

export interface SubAgentConfig extends BaseAgentConfig {
  agentType: "sub_agent"
  teamIds: string[]
  delegation: DelegationPolicy
}

export type AgentConfig = NobieConfig | SubAgentConfig

export interface TeamMembership {
  membershipId: string
  teamId: string
  agentId: string
  ownerAgentIdSnapshot?: string
  teamRoles: string[]
  primaryRole: string
  required: boolean
  fallbackForAgentId?: string
  sortOrder: number
  status: TeamMembershipStatus
}

export interface AgentRelationship {
  edgeId: string
  parentAgentId: string
  childAgentId: string
  relationshipType: "parent_child"
  status: AgentRelationshipStatus
  sortOrder: number
  createdAt?: number
  updatedAt?: number
}

export interface TeamConfig {
  schemaVersion: ContractSchemaVersion
  teamId: string
  displayName: string
  nickname?: string
  normalizedNickname?: string
  status: Exclude<AgentStatus, "degraded">
  purpose: string
  ownerAgentId?: string
  leadAgentId?: string
  memberCountMin?: number
  memberCountMax?: number
  requiredTeamRoles?: string[]
  requiredCapabilityTags?: string[]
  resultPolicy?: TeamResultPolicyMode
  conflictPolicy?: TeamConflictPolicyMode
  memberships?: TeamMembership[]
  memberAgentIds: string[]
  roleHints: string[]
  profileVersion: number
  createdAt: number
  updatedAt: number
}

export interface TeamExecutionPlanAssignment {
  agentId: string
  taskIds: string[]
  role?: string
  membershipId?: string
  required?: boolean
  executionState?: "active" | "fallback" | "synthesis" | "review" | "verification"
  taskKinds?: Array<"member" | "synthesis" | "review" | "verification">
  inputContext?: JsonObject
  expectedOutputs?: ExpectedOutputContract[]
  validationCriteria?: string[]
  dependsOnTaskIds?: string[]
  fallbackForAgentId?: string
  reasonCodes?: string[]
  tasks?: TeamExecutionTaskSnapshot[]
}

export interface TeamExecutionTaskSnapshot {
  taskId: string
  taskKind: "member" | "synthesis" | "review" | "verification"
  executionKind: TaskExecutionKind
  scope: StructuredTaskScope
  assignedAgentId?: string
  assignedTeamId?: string
  requiredCapabilities: string[]
  resourceLockIds: string[]
  inputContext: JsonObject
  expectedOutputs: ExpectedOutputContract[]
  validationCriteria: string[]
  dependsOnTaskIds: string[]
  required: boolean
  reasonCodes: string[]
}

export interface TeamExecutionFallbackAssignment {
  missingAgentId: string
  fallbackAgentId: string
  reasonCode?: string
}

export interface TeamExecutionPlan {
  teamExecutionPlanId: string
  parentRunId: string
  teamId: string
  teamNicknameSnapshot?: string
  ownerAgentId: string
  leadAgentId: string
  memberTaskAssignments: TeamExecutionPlanAssignment[]
  reviewerAgentIds: string[]
  verifierAgentIds: string[]
  fallbackAssignments: TeamExecutionFallbackAssignment[]
  coverageReport: JsonObject
  conflictPolicySnapshot: TeamConflictPolicyMode
  resultPolicySnapshot: TeamResultPolicyMode
  createdAt: number
}

export interface ExpectedOutputContract {
  outputId: string
  kind: "text" | "artifact" | "tool_result" | "data_package" | "state_change"
  description: string
  required: boolean
  acceptance: {
    statusField?: string
    requiredEvidenceKinds: string[]
    artifactRequired: boolean
    reasonCodes: string[]
  }
}

export interface StructuredTaskScope {
  goal: string
  intentType: string
  actionType: string
  constraints: string[]
  expectedOutputs: ExpectedOutputContract[]
  reasonCodes: string[]
}

export interface SessionContract {
  identity: RuntimeIdentity
  sessionId: string
  mode: OrchestrationMode
  source: "webui" | "cli" | "telegram" | "slack" | "scheduler" | "system"
  owner: OwnerScope
  parentRequestId: string
  status: SubSessionStatus
  agentDisplayName?: string
  agentNickname?: string
  orchestrationPlanId?: string
  startedAt?: number
  finishedAt?: number
}

export interface SubSessionContract {
  identity: RuntimeIdentity
  subSessionId: string
  parentSessionId: string
  parentRunId: string
  parentAgentId?: string
  parentAgentDisplayName?: string
  parentAgentNickname?: string
  agentId: string
  agentDisplayName: string
  agentNickname?: string
  commandRequestId: string
  status: SubSessionStatus
  retryBudgetRemaining: number
  promptBundleId: string
  promptBundleSnapshot?: AgentPromptBundle
  modelExecutionSnapshot?: ModelExecutionSnapshot
  startedAt?: number
  finishedAt?: number
}

export interface ResourceLockContract {
  lockId: string
  kind: ResourceLockKind
  target: string
  mode: "shared" | "exclusive"
  reasonCode: string
}

export interface DependencyEdgeContract {
  fromTaskId: string
  toTaskId: string
  reasonCode: string
}

export interface ParallelSubSessionGroup {
  groupId: string
  parentRunId: string
  subSessionIds: string[]
  dependencyEdges: DependencyEdgeContract[]
  resourceLocks: ResourceLockContract[]
  concurrencyLimit: number
  status: "planned" | "running" | "completed" | "blocked" | "failed"
}

export interface OrchestrationTask {
  taskId: string
  executionKind: TaskExecutionKind
  scope: StructuredTaskScope
  assignedAgentId?: string
  assignedTeamId?: string
  requiredCapabilities: string[]
  resourceLockIds: string[]
  planningTrace?: {
    score?: number
    reasonCodes: string[]
    excludedReasonCodes?: string[]
    explanation?: string
  }
}

export interface ApprovalRequirementContract {
  approvalId: string
  taskId: string
  agentId?: string
  capability: string
  risk: CapabilityRiskLevel
  reasonCode: string
}

export interface OrchestrationPlan {
  identity: RuntimeIdentity
  planId: string
  parentRunId: string
  parentRequestId: string
  directNobieTasks: OrchestrationTask[]
  delegatedTasks: OrchestrationTask[]
  dependencyEdges: DependencyEdgeContract[]
  resourceLocks: ResourceLockContract[]
  parallelGroups: ParallelSubSessionGroup[]
  approvalRequirements: ApprovalRequirementContract[]
  fallbackStrategy: {
    mode: "single_nobie" | "ask_user" | "fail_with_reason"
    reasonCode: string
    userMessage?: string
  }
  plannerMetadata?: {
    status: "planned" | "degraded" | "requires_team_expansion" | "requires_workflow_recommendation"
    plannerVersion: string
    timedOut: boolean
    latencyMs?: number
    targetP95Ms?: number
    semanticComparisonUsed: false
    reasonCodes: string[]
    fastPath?: {
      classification: "direct_nobie" | "delegation_candidate" | "workflow_candidate"
      reasonCodes: string[]
      targetP95Ms: number
      latencyMs: number
      explanation: string
    }
    candidateScores: Array<{
      agentId: string
      teamIds: string[]
      score: number
      selected: boolean
      reasonCodes: string[]
      excludedReasonCodes: string[]
      explanation?: string
    }>
    directReasonCodes: string[]
    fallbackReasonCodes: string[]
  }
  createdAt: number
}

export interface AgentPromptBundle {
  identity: RuntimeIdentity
  bundleId: string
  agentId: string
  agentType: AgentEntityType
  role: string
  displayNameSnapshot: string
  nicknameSnapshot?: string
  personalitySnapshot: string
  teamContext: Array<{ teamId: string; displayName: string; roleHint?: string }>
  memoryPolicy: MemoryPolicy
  capabilityPolicy: CapabilityPolicy
  modelProfileSnapshot?: ModelProfile
  taskScope: StructuredTaskScope
  safetyRules: string[]
  sourceProvenance: Array<{ sourceId: string; version: string; checksum?: string }>
  fragments?: AgentPromptFragment[]
  validation?: AgentPromptBundleValidationSummary
  cacheKey?: string
  promptChecksum?: string
  profileVersionSnapshot?: number
  renderedPrompt?: string
  completionCriteria?: ExpectedOutputContract[]
  createdAt: number
}

export type AgentPromptFragmentKind =
  | "identity"
  | "role"
  | "personality"
  | "specialty"
  | "avoid_tasks"
  | "team_context"
  | "memory_policy"
  | "capability_policy"
  | "permission_profile"
  | "model_profile"
  | "completion_criteria"
  | "prompt_source"
  | "imported_profile"
  | "safety_rule"
  | "self_nickname_rule"
  | "nickname_attribution_rule"
  | "capability_catalog"
  | "capability_binding"

export type AgentPromptFragmentStatus = "active" | "inactive" | "review" | "blocked"

export interface AgentPromptFragment {
  fragmentId: string
  kind: AgentPromptFragmentKind
  title: string
  content: string
  status: AgentPromptFragmentStatus
  sourceId: string
  version: string
  checksum?: string
  issueCodes?: string[]
}

export interface AgentPromptBundleValidationSummary {
  ok: boolean
  issueCodes: string[]
  blockedFragmentIds: string[]
  inactiveFragmentIds: string[]
}

export interface CommandRequest {
  identity: RuntimeIdentity
  commandRequestId: string
  parentRunId: string
  subSessionId: string
  targetAgentId: string
  targetNicknameSnapshot?: string
  taskScope: StructuredTaskScope
  contextPackageIds: string[]
  expectedOutputs: ExpectedOutputContract[]
  retryBudget: number
}

export interface ProgressEvent {
  identity: RuntimeIdentity
  eventId: string
  parentRunId: string
  subSessionId: string
  speaker?: NicknameSnapshot
  status: SubSessionStatus
  summary: string
  at: number
}

export type ResultReportImpossibleReasonKind = "physical" | "logical" | "policy"

export interface ResultReportImpossibleReason {
  kind: ResultReportImpossibleReasonKind
  reasonCode: string
  detail: string
}

export interface ResultReport {
  identity: RuntimeIdentity
  resultReportId: string
  parentRunId: string
  subSessionId: string
  source?: NicknameSnapshot
  status: "completed" | "needs_revision" | "failed"
  outputs: Array<{
    outputId: string
    status: "satisfied" | "missing" | "partial"
    value?: JsonValue
  }>
  evidence: Array<{ evidenceId: string; kind: string; sourceRef: string; sourceTimestamp?: string }>
  artifacts: Array<{ artifactId: string; kind: string; path?: string }>
  risksOrGaps: string[]
  impossibleReason?: ResultReportImpossibleReason
}

export interface FeedbackRequest {
  identity: RuntimeIdentity
  feedbackRequestId: string
  parentRunId: string
  subSessionId: string
  sourceResultReportIds: string[]
  previousSubSessionIds: string[]
  targetAgentPolicy: FeedbackTargetAgentPolicy
  targetAgentId?: string
  targetAgentNicknameSnapshot?: string
  requestingAgentNicknameSnapshot?: string
  synthesizedContextExchangeId?: string
  carryForwardOutputs: Array<{
    outputId: string
    status: "satisfied" | "partial"
    value?: JsonValue
  }>
  missingItems: string[]
  conflictItems: string[]
  requiredChanges: string[]
  additionalConstraints: string[]
  additionalContextRefs: string[]
  expectedRevisionOutputs: ExpectedOutputContract[]
  retryBudgetRemaining: number
  reasonCode: string
  createdAt?: number
}

export interface ErrorReport {
  identity: RuntimeIdentity
  errorReportId: string
  parentRunId: string
  subSessionId?: string
  reasonCode: string
  safeMessage: string
  retryable: boolean
}

export interface DataExchangePackage {
  identity: RuntimeIdentity
  exchangeId: string
  sourceOwner: OwnerScope
  recipientOwner: OwnerScope
  sourceNicknameSnapshot?: string
  recipientNicknameSnapshot?: string
  purpose: string
  allowedUse: "temporary_context" | "memory_candidate" | "verification_only"
  retentionPolicy: DataExchangeRetentionPolicy
  redactionState: "redacted" | "not_sensitive" | "blocked"
  provenanceRefs: string[]
  payload: JsonObject
  expiresAt?: number | null
  createdAt: number
}

export interface UserVisibleAgentMessage {
  identity: RuntimeIdentity
  messageId: string
  parentRunId: string
  speaker: NicknameSnapshot
  text: string
  createdAt: number
}

export interface NamedHandoffEvent {
  identity: RuntimeIdentity
  handoffId: string
  parentRunId: string
  sender: NicknameSnapshot
  recipient: NicknameSnapshot
  purpose: string
  createdAt: number
}

export interface NamedDeliveryEvent {
  identity: RuntimeIdentity
  deliveryId: string
  parentRunId: string
  deliveryKind: NamedDeliveryKind
  sender: NicknameSnapshot
  recipient: NicknameSnapshot
  summary: string
  exchangeId?: string
  resultReportId?: string
  createdAt: number
}

export interface CapabilityDelegationRequest {
  identity: RuntimeIdentity
  delegationId: string
  requester: OwnerScope
  provider: OwnerScope
  capability: string
  risk: CapabilityRiskLevel
  inputPackageIds: string[]
  resultPackageId?: string
  approvalId?: string
  status: "requested" | "approved" | "denied" | "expired" | "completed" | "failed"
}

export interface LearningEvent {
  identity: RuntimeIdentity
  learningEventId: string
  agentId: string
  agentType?: AgentEntityType
  sourceSessionId?: string
  sourceSubSessionId?: string
  learningTarget: "memory" | "role" | "personality" | "team_profile"
  before?: JsonObject
  after?: JsonObject
  beforeSummary: string
  afterSummary: string
  evidenceRefs: string[]
  confidence: number
  approvalState: LearningApprovalState
  policyReasonCode?: string
}

export interface HistoryVersion {
  identity: RuntimeIdentity
  historyVersionId: string
  targetEntityType: "agent" | "team" | "memory"
  targetEntityId: string
  version: number
  before: JsonObject
  after: JsonObject
  reasonCode: string
  createdAt: number
}

export interface RestoreEvent {
  identity: RuntimeIdentity
  restoreEventId: string
  targetEntityType: "agent" | "team" | "memory"
  targetEntityId: string
  restoredHistoryVersionId: string
  dryRun: boolean
  effectSummary: string[]
  createdAt: number
}

export interface RelationshipGraphNode {
  nodeId: string
  entityType: RelationshipEntityType
  entityId: string
  label: string
  status?: AgentStatus | SubSessionStatus
  metadata?: JsonObject
}

export interface RelationshipGraphEdge {
  edgeId: string
  edgeType: RelationshipEdgeType
  fromNodeId: string
  toNodeId: string
  label?: string
  metadata?: JsonObject
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

function addIssue(issues: ContractValidationIssue[], path: string, message: string): void {
  issues.push({ path, code: "contract_validation_failed", message })
}

function collapseNicknameWhitespace(value: string): string {
  return value.trim().replace(/\s+/gu, " ")
}

export function normalizeNicknameSnapshot(value: string): string {
  return collapseNicknameWhitespace(value)
}

export function normalizeNickname(value: string): string {
  return collapseNicknameWhitespace(value).toLowerCase()
}

export function findNicknameNamespaceConflict(
  entries: NicknameNamespaceEntry[],
): NicknameNamespaceConflict | undefined {
  const seen = new Map<string, NicknameNamespaceEntry>()
  for (const entry of entries) {
    const normalizedNickname = normalizeNickname(entry.nicknameSnapshot)
    if (!normalizedNickname) continue
    const existing = seen.get(normalizedNickname)
    if (
      existing &&
      (existing.entityType !== entry.entityType || existing.entityId !== entry.entityId)
    ) {
      return {
        normalizedNickname,
        existing,
        attempted: entry,
      }
    }
    seen.set(normalizedNickname, entry)
  }
  return undefined
}

const USER_FACING_DISPLAY_NAME_ALIASES = ["displayName", "display_name", "nameForDisplay"] as const

function rejectUserFacingDisplayNameAliases(
  record: Record<string, unknown>,
  path: string,
  issues: ContractValidationIssue[],
): void {
  for (const key of USER_FACING_DISPLAY_NAME_ALIASES) {
    if (key in record)
      addIssue(
        issues,
        `${path}.${key}`,
        `${key} is not allowed in user-facing nickname attribution contracts.`,
      )
  }
}

function hasNonEmptyString(
  record: Record<string, unknown>,
  key: string,
  path: string,
  issues: ContractValidationIssue[],
): boolean {
  if (typeof record[key] === "string" && record[key].trim()) return true
  addIssue(issues, `${path}.${key}`, `${key} must be a non-empty string.`)
  return false
}

function hasNonEmptyNickname(
  record: Record<string, unknown>,
  key: string,
  path: string,
  issues: ContractValidationIssue[],
): boolean {
  if (typeof record[key] === "string" && normalizeNickname(record[key]).length > 0) return true
  addIssue(issues, `${path}.${key}`, `${key} must be a non-empty nickname.`)
  return false
}

function hasArray(
  record: Record<string, unknown>,
  key: string,
  path: string,
  issues: ContractValidationIssue[],
): boolean {
  if (Array.isArray(record[key])) return true
  addIssue(issues, `${path}.${key}`, `${key} must be an array.`)
  return false
}

const RELATIONSHIP_ENTITY_TYPES = new Set<RelationshipEntityType>([
  "nobie",
  "sub_agent",
  "team",
  "session",
  "sub_session",
  "capability",
  "data_exchange",
])
const OWNER_SCOPE_TYPES = new Set<OwnerScope["ownerType"]>(["nobie", "sub_agent", "team", "system"])
const CAPABILITY_RISK_LEVELS = new Set<CapabilityRiskLevel>([
  "safe",
  "moderate",
  "external",
  "sensitive",
  "dangerous",
])
const TEAM_RESULT_POLICY_MODES = new Set<TeamResultPolicyMode>([
  "lead_synthesis",
  "owner_synthesis",
  "reviewer_required",
  "verifier_required",
  "quorum_required",
])
const TEAM_CONFLICT_POLICY_MODES = new Set<TeamConflictPolicyMode>([
  "lead_decides",
  "owner_decides",
  "reviewer_decides",
  "report_conflict",
])
const TEAM_EXECUTION_TASK_KINDS = new Set<TeamExecutionTaskSnapshot["taskKind"]>([
  "member",
  "synthesis",
  "review",
  "verification",
])
const TEAM_MEMBERSHIP_STATUSES = new Set<TeamMembershipStatus>([
  "active",
  "inactive",
  "fallback_only",
  "removed",
])
const AGENT_RELATIONSHIP_STATUSES = new Set<AgentRelationshipStatus>([
  "active",
  "disabled",
  "archived",
])
const FEEDBACK_TARGET_AGENT_POLICIES = new Set<FeedbackTargetAgentPolicy>([
  "same_agent",
  "alternative_direct_child",
  "parent_decides",
  "fallback_agent",
  "lead_assigns",
  "nobie_direct",
])
const DATA_EXCHANGE_ALLOWED_USE = new Set<DataExchangePackage["allowedUse"]>([
  "temporary_context",
  "memory_candidate",
  "verification_only",
])
const DATA_EXCHANGE_REDACTION_STATES = new Set<DataExchangePackage["redactionState"]>([
  "redacted",
  "not_sensitive",
  "blocked",
])
const DATA_EXCHANGE_RETENTION_POLICIES = new Set<DataExchangeRetentionPolicy>([
  "session_only",
  "short_term",
  "long_term_candidate",
  "discard_after_review",
])
const RESULT_REPORT_STATUSES = new Set<ResultReport["status"]>([
  "completed",
  "needs_revision",
  "failed",
])
const RESULT_OUTPUT_STATUSES = new Set<ResultReport["outputs"][number]["status"]>([
  "satisfied",
  "missing",
  "partial",
])
const RESULT_REPORT_IMPOSSIBLE_REASON_KINDS = new Set<ResultReportImpossibleReasonKind>([
  "physical",
  "logical",
  "policy",
])
const EXPECTED_OUTPUT_KINDS = new Set<ExpectedOutputContract["kind"]>([
  "text",
  "artifact",
  "tool_result",
  "data_package",
  "state_change",
])
const MEMORY_VISIBILITIES = new Set<MemoryPolicy["visibility"]>([
  "private",
  "coordinator_visible",
  "team_visible",
])
const MEMORY_RETENTION_POLICIES = new Set<MemoryPolicy["retentionPolicy"]>([
  "session",
  "short_term",
  "long_term",
])
const RESOURCE_LOCK_KINDS = new Set<ResourceLockKind>([
  "file",
  "display",
  "channel",
  "mcp_server",
  "secret_scope",
  "external_target",
  "custom",
])
const SUB_SESSION_STATUSES = new Set<SubSessionStatus>([
  "created",
  "queued",
  "running",
  "waiting_for_input",
  "awaiting_approval",
  "completed",
  "needs_revision",
  "failed",
  "cancelled",
])

function hasBoolean(
  record: Record<string, unknown>,
  key: string,
  path: string,
  issues: ContractValidationIssue[],
): boolean {
  if (typeof record[key] === "boolean") return true
  addIssue(issues, `${path}.${key}`, `${key} must be a boolean.`)
  return false
}

function hasFiniteNumber(
  record: Record<string, unknown>,
  key: string,
  path: string,
  issues: ContractValidationIssue[],
  options: { min?: number } = {},
): boolean {
  if (
    typeof record[key] === "number" &&
    Number.isFinite(record[key]) &&
    (options.min === undefined || record[key] >= options.min)
  ) {
    return true
  }
  const qualifier =
    options.min === undefined
      ? "a finite number"
      : `a finite number greater than or equal to ${options.min}`
  addIssue(issues, `${path}.${key}`, `${key} must be ${qualifier}.`)
  return false
}

function validateStringArray(
  value: unknown,
  path: string,
  issues: ContractValidationIssue[],
  options: { requireNonEmptyItems?: boolean } = {},
): value is string[] {
  if (!Array.isArray(value)) {
    addIssue(issues, path, `${path.split(".").pop() ?? "value"} must be an array.`)
    return false
  }
  let ok = true
  for (const [index, item] of value.entries()) {
    if (typeof item !== "string") {
      addIssue(issues, `${path}[${index}]`, "Array items must be strings.")
      ok = false
      continue
    }
    if (options.requireNonEmptyItems && !item.trim()) {
      addIssue(issues, `${path}[${index}]`, "Array items must be non-empty strings.")
      ok = false
    }
  }
  return ok
}

function validateOwnerScope(
  value: unknown,
  path: string,
  issues: ContractValidationIssue[],
): boolean {
  if (!isRecord(value)) {
    addIssue(issues, path, "owner scope must be an object.")
    return false
  }
  if (
    typeof value.ownerType !== "string" ||
    !OWNER_SCOPE_TYPES.has(value.ownerType as OwnerScope["ownerType"])
  ) {
    addIssue(issues, `${path}.ownerType`, "ownerType must be nobie, sub_agent, team, or system.")
  }
  hasNonEmptyString(value, "ownerId", path, issues)
  return true
}

function validateMemoryPolicy(
  value: unknown,
  path: string,
  issues: ContractValidationIssue[],
): boolean {
  if (!isRecord(value)) {
    addIssue(issues, path, "memoryPolicy must be an object.")
    return false
  }
  validateOwnerScope(value.owner, `${path}.owner`, issues)
  if (
    typeof value.visibility !== "string" ||
    !MEMORY_VISIBILITIES.has(value.visibility as MemoryPolicy["visibility"])
  ) {
    addIssue(
      issues,
      `${path}.visibility`,
      "visibility must be private, coordinator_visible, or team_visible.",
    )
  }
  if (Array.isArray(value.readScopes)) {
    value.readScopes.forEach((scope, index) =>
      validateOwnerScope(scope, `${path}.readScopes[${index}]`, issues),
    )
  } else {
    addIssue(issues, `${path}.readScopes`, "readScopes must be an array.")
  }
  validateOwnerScope(value.writeScope, `${path}.writeScope`, issues)
  if (
    typeof value.retentionPolicy !== "string" ||
    !MEMORY_RETENTION_POLICIES.has(value.retentionPolicy as MemoryPolicy["retentionPolicy"])
  ) {
    addIssue(
      issues,
      `${path}.retentionPolicy`,
      "retentionPolicy must be session, short_term, or long_term.",
    )
  }
  if (typeof value.writebackReviewRequired !== "boolean") {
    addIssue(
      issues,
      `${path}.writebackReviewRequired`,
      "writebackReviewRequired must be a boolean.",
    )
  }
  return true
}

function validatePermissionProfile(
  value: unknown,
  path: string,
  issues: ContractValidationIssue[],
): boolean {
  if (!isRecord(value)) {
    addIssue(issues, path, "permissionProfile must be an object.")
    return false
  }
  hasNonEmptyString(value, "profileId", path, issues)
  if (
    typeof value.riskCeiling !== "string" ||
    !CAPABILITY_RISK_LEVELS.has(value.riskCeiling as CapabilityRiskLevel)
  ) {
    addIssue(
      issues,
      `${path}.riskCeiling`,
      "riskCeiling must be a supported capability risk level.",
    )
  }
  if (
    typeof value.approvalRequiredFrom !== "string" ||
    !CAPABILITY_RISK_LEVELS.has(value.approvalRequiredFrom as CapabilityRiskLevel)
  ) {
    addIssue(
      issues,
      `${path}.approvalRequiredFrom`,
      "approvalRequiredFrom must be a supported capability risk level.",
    )
  }
  for (const key of [
    "allowExternalNetwork",
    "allowFilesystemWrite",
    "allowShellExecution",
    "allowScreenControl",
  ] as const) {
    hasBoolean(value, key, path, issues)
  }
  validateStringArray(value.allowedPaths, `${path}.allowedPaths`, issues)
  return true
}

function validateSkillMcpAllowlist(
  value: unknown,
  path: string,
  issues: ContractValidationIssue[],
): boolean {
  if (!isRecord(value)) {
    addIssue(issues, path, "skillMcpAllowlist must be an object.")
    return false
  }
  validateStringArray(value.enabledSkillIds, `${path}.enabledSkillIds`, issues)
  validateStringArray(value.enabledMcpServerIds, `${path}.enabledMcpServerIds`, issues)
  validateStringArray(value.enabledToolNames, `${path}.enabledToolNames`, issues)
  validateStringArray(value.disabledToolNames, `${path}.disabledToolNames`, issues)
  if (
    "secretScopeId" in value &&
    value.secretScopeId !== undefined &&
    value.secretScopeId !== null &&
    !`${value.secretScopeId}`.trim()
  ) {
    addIssue(
      issues,
      `${path}.secretScopeId`,
      "secretScopeId must be a non-empty string when present.",
    )
  }
  return true
}

function validateCapabilityPolicy(
  value: unknown,
  path: string,
  issues: ContractValidationIssue[],
): boolean {
  if (!isRecord(value)) {
    addIssue(issues, path, "capabilityPolicy must be an object.")
    return false
  }
  validatePermissionProfile(value.permissionProfile, `${path}.permissionProfile`, issues)
  validateSkillMcpAllowlist(value.skillMcpAllowlist, `${path}.skillMcpAllowlist`, issues)
  if (!isRecord(value.rateLimit)) {
    addIssue(issues, `${path}.rateLimit`, "rateLimit must be an object.")
  } else {
    hasFiniteNumber(value.rateLimit, "maxConcurrentCalls", `${path}.rateLimit`, issues, { min: 1 })
    if ("maxCallsPerMinute" in value.rateLimit && value.rateLimit.maxCallsPerMinute !== undefined) {
      hasFiniteNumber(value.rateLimit, "maxCallsPerMinute", `${path}.rateLimit`, issues, { min: 1 })
    }
  }
  return true
}

function validateModelProfile(
  value: unknown,
  path: string,
  issues: ContractValidationIssue[],
): boolean {
  if (!isRecord(value)) {
    addIssue(issues, path, "modelProfile must be an object.")
    return false
  }
  hasNonEmptyString(value, "providerId", path, issues)
  hasNonEmptyString(value, "modelId", path, issues)
  for (const key of ["effort"] as const) {
    if (key in value && value[key] !== undefined && typeof value[key] !== "string") {
      addIssue(issues, `${path}.${key}`, `${key} must be a string when present.`)
    }
  }
  for (const key of [
    "temperature",
    "maxOutputTokens",
    "timeoutMs",
    "retryCount",
    "costBudget",
  ] as const) {
    if (key in value && value[key] !== undefined)
      hasFiniteNumber(value, key, path, issues, { min: 0 })
  }
  if (
    "fallbackModelId" in value &&
    value.fallbackModelId !== undefined &&
    typeof value.fallbackModelId !== "string"
  ) {
    addIssue(issues, `${path}.fallbackModelId`, "fallbackModelId must be a string when present.")
  }
  return true
}

function validateDelegationPolicy(
  value: unknown,
  path: string,
  issues: ContractValidationIssue[],
): boolean {
  if (!isRecord(value)) {
    addIssue(issues, path, "delegationPolicy must be an object.")
    return false
  }
  hasBoolean(value, "enabled", path, issues)
  hasFiniteNumber(value, "maxParallelSessions", path, issues, { min: 1 })
  hasFiniteNumber(value, "retryBudget", path, issues, { min: 0 })
  return true
}

function validateExpectedOutputContract(
  value: unknown,
  path: string,
  issues: ContractValidationIssue[],
): boolean {
  if (!isRecord(value)) {
    addIssue(issues, path, "ExpectedOutputContract must be an object.")
    return false
  }
  hasNonEmptyString(value, "outputId", path, issues)
  if (
    typeof value.kind !== "string" ||
    !EXPECTED_OUTPUT_KINDS.has(value.kind as ExpectedOutputContract["kind"])
  ) {
    addIssue(
      issues,
      `${path}.kind`,
      "kind must be text, artifact, tool_result, data_package, or state_change.",
    )
  }
  hasNonEmptyString(value, "description", path, issues)
  hasBoolean(value, "required", path, issues)
  if (!isRecord(value.acceptance)) {
    addIssue(issues, `${path}.acceptance`, "acceptance must be an object.")
  } else {
    if (
      "statusField" in value.acceptance &&
      value.acceptance.statusField !== undefined &&
      typeof value.acceptance.statusField !== "string"
    ) {
      addIssue(
        issues,
        `${path}.acceptance.statusField`,
        "statusField must be a string when present.",
      )
    }
    validateStringArray(
      value.acceptance.requiredEvidenceKinds,
      `${path}.acceptance.requiredEvidenceKinds`,
      issues,
    )
    if (typeof value.acceptance.artifactRequired !== "boolean") {
      addIssue(issues, `${path}.acceptance.artifactRequired`, "artifactRequired must be a boolean.")
    }
    validateStringArray(value.acceptance.reasonCodes, `${path}.acceptance.reasonCodes`, issues, {
      requireNonEmptyItems: true,
    })
  }
  return true
}

function validateStructuredTaskScope(
  value: unknown,
  path: string,
  issues: ContractValidationIssue[],
): boolean {
  if (!isRecord(value)) {
    addIssue(issues, path, "taskScope must be an object.")
    return false
  }
  hasNonEmptyString(value, "goal", path, issues)
  hasNonEmptyString(value, "intentType", path, issues)
  hasNonEmptyString(value, "actionType", path, issues)
  validateStringArray(value.constraints, `${path}.constraints`, issues)
  if (Array.isArray(value.expectedOutputs)) {
    value.expectedOutputs.forEach((output, index) =>
      validateExpectedOutputContract(output, `${path}.expectedOutputs[${index}]`, issues),
    )
  } else {
    addIssue(issues, `${path}.expectedOutputs`, "expectedOutputs must be an array.")
  }
  validateStringArray(value.reasonCodes, `${path}.reasonCodes`, issues, {
    requireNonEmptyItems: true,
  })
  return true
}

export function validateTeamMembership(value: unknown): ContractValidationResult<TeamMembership> {
  const issues: ContractValidationIssue[] = []
  if (!isRecord(value)) {
    return {
      ok: false,
      issues: [
        {
          path: "$",
          code: "contract_validation_failed",
          message: "TeamMembership must be an object.",
        },
      ],
    }
  }
  hasNonEmptyString(value, "membershipId", "$", issues)
  hasNonEmptyString(value, "teamId", "$", issues)
  hasNonEmptyString(value, "agentId", "$", issues)
  if (
    "ownerAgentIdSnapshot" in value &&
    value.ownerAgentIdSnapshot !== undefined &&
    typeof value.ownerAgentIdSnapshot !== "string"
  ) {
    addIssue(
      issues,
      "$.ownerAgentIdSnapshot",
      "ownerAgentIdSnapshot must be a string when present.",
    )
  }
  validateStringArray(value.teamRoles, "$.teamRoles", issues, { requireNonEmptyItems: true })
  hasNonEmptyString(value, "primaryRole", "$", issues)
  hasBoolean(value, "required", "$", issues)
  if (
    "fallbackForAgentId" in value &&
    value.fallbackForAgentId !== undefined &&
    typeof value.fallbackForAgentId !== "string"
  ) {
    addIssue(issues, "$.fallbackForAgentId", "fallbackForAgentId must be a string when present.")
  }
  hasFiniteNumber(value, "sortOrder", "$", issues, { min: 0 })
  if (
    typeof value.status !== "string" ||
    !TEAM_MEMBERSHIP_STATUSES.has(value.status as TeamMembershipStatus)
  ) {
    addIssue(issues, "$.status", "status must be active, inactive, fallback_only, or removed.")
  }
  return issues.length === 0
    ? { ok: true, value: value as unknown as TeamMembership, issues: [] }
    : { ok: false, issues }
}

export function validateAgentRelationship(
  value: unknown,
): ContractValidationResult<AgentRelationship> {
  const issues: ContractValidationIssue[] = []
  if (!isRecord(value)) {
    return {
      ok: false,
      issues: [
        {
          path: "$",
          code: "contract_validation_failed",
          message: "AgentRelationship must be an object.",
        },
      ],
    }
  }
  hasNonEmptyString(value, "edgeId", "$", issues)
  hasNonEmptyString(value, "parentAgentId", "$", issues)
  hasNonEmptyString(value, "childAgentId", "$", issues)
  if (value.relationshipType !== "parent_child") {
    addIssue(issues, "$.relationshipType", "relationshipType must be parent_child.")
  }
  if (
    typeof value.parentAgentId === "string" &&
    typeof value.childAgentId === "string" &&
    value.parentAgentId === value.childAgentId
  ) {
    addIssue(issues, "$.childAgentId", "parentAgentId and childAgentId must be different.")
  }
  if (
    typeof value.status !== "string" ||
    !AGENT_RELATIONSHIP_STATUSES.has(value.status as AgentRelationshipStatus)
  ) {
    addIssue(issues, "$.status", "status must be active, disabled, or archived.")
  }
  hasFiniteNumber(value, "sortOrder", "$", issues, { min: 0 })
  return issues.length === 0
    ? { ok: true, value: value as unknown as AgentRelationship, issues: [] }
    : { ok: false, issues }
}

function validateRuntimeIdentity(
  value: unknown,
  path: string,
  issues: ContractValidationIssue[],
): boolean {
  if (!isRecord(value)) {
    addIssue(issues, path, "identity must be an object.")
    return false
  }
  if (value.schemaVersion !== CONTRACT_SCHEMA_VERSION)
    addIssue(issues, `${path}.schemaVersion`, "Unsupported contract schema version.")
  if (
    typeof value.entityType !== "string" ||
    !RELATIONSHIP_ENTITY_TYPES.has(value.entityType as RelationshipEntityType)
  ) {
    addIssue(
      issues,
      `${path}.entityType`,
      "entityType must be nobie, sub_agent, team, session, sub_session, capability, or data_exchange.",
    )
  }
  hasNonEmptyString(value, "entityId", path, issues)
  hasNonEmptyString(value, "idempotencyKey", path, issues)
  validateOwnerScope(value.owner, `${path}.owner`, issues)
  return true
}

function validateNicknameSnapshot(
  value: unknown,
  path: string,
  issues: ContractValidationIssue[],
): boolean {
  if (!isRecord(value)) {
    addIssue(issues, path, "nickname attribution snapshot must be an object.")
    return false
  }
  rejectUserFacingDisplayNameAliases(value, path, issues)
  if (
    value.entityType !== "nobie" &&
    value.entityType !== "sub_agent" &&
    value.entityType !== "team"
  ) {
    addIssue(issues, `${path}.entityType`, "entityType must be nobie, sub_agent, or team.")
  }
  hasNonEmptyString(value, "entityId", path, issues)
  hasNonEmptyNickname(value, "nicknameSnapshot", path, issues)
  return true
}

function usesExtendedTeamShape(value: Record<string, unknown>): boolean {
  return [
    "ownerAgentId",
    "leadAgentId",
    "memberCountMin",
    "memberCountMax",
    "requiredTeamRoles",
    "requiredCapabilityTags",
    "resultPolicy",
    "conflictPolicy",
    "memberships",
  ].some((key) => key in value)
}

function validateOrchestrationTask(
  value: unknown,
  path: string,
  issues: ContractValidationIssue[],
  expectedExecutionKind?: TaskExecutionKind,
): boolean {
  if (!isRecord(value)) {
    addIssue(issues, path, "OrchestrationTask must be an object.")
    return false
  }
  hasNonEmptyString(value, "taskId", path, issues)
  if (
    typeof value.executionKind !== "string" ||
    (value.executionKind !== "direct_nobie" && value.executionKind !== "delegated_sub_agent")
  ) {
    addIssue(
      issues,
      `${path}.executionKind`,
      "executionKind must be direct_nobie or delegated_sub_agent.",
    )
  } else if (expectedExecutionKind && value.executionKind !== expectedExecutionKind) {
    addIssue(
      issues,
      `${path}.executionKind`,
      `executionKind must be ${expectedExecutionKind} in this task group.`,
    )
  }
  validateStructuredTaskScope(value.scope, `${path}.scope`, issues)
  if (
    "assignedAgentId" in value &&
    value.assignedAgentId !== undefined &&
    typeof value.assignedAgentId !== "string"
  ) {
    addIssue(issues, `${path}.assignedAgentId`, "assignedAgentId must be a string when present.")
  }
  if (
    "assignedTeamId" in value &&
    value.assignedTeamId !== undefined &&
    typeof value.assignedTeamId !== "string"
  ) {
    addIssue(issues, `${path}.assignedTeamId`, "assignedTeamId must be a string when present.")
  }
  validateStringArray(value.requiredCapabilities, `${path}.requiredCapabilities`, issues, {
    requireNonEmptyItems: true,
  })
  validateStringArray(value.resourceLockIds, `${path}.resourceLockIds`, issues, {
    requireNonEmptyItems: true,
  })
  if ("planningTrace" in value && value.planningTrace !== undefined) {
    if (!isRecord(value.planningTrace)) {
      addIssue(issues, `${path}.planningTrace`, "planningTrace must be an object when present.")
    } else {
      if ("score" in value.planningTrace && value.planningTrace.score !== undefined) {
        hasFiniteNumber(value.planningTrace, "score", `${path}.planningTrace`, issues)
      }
      validateStringArray(
        value.planningTrace.reasonCodes,
        `${path}.planningTrace.reasonCodes`,
        issues,
        { requireNonEmptyItems: true },
      )
      if (
        "excludedReasonCodes" in value.planningTrace &&
        value.planningTrace.excludedReasonCodes !== undefined
      ) {
        validateStringArray(
          value.planningTrace.excludedReasonCodes,
          `${path}.planningTrace.excludedReasonCodes`,
          issues,
          {
            requireNonEmptyItems: true,
          },
        )
      }
    }
  }
  return true
}

function validateTeamExecutionTaskSnapshot(
  value: unknown,
  path: string,
  issues: ContractValidationIssue[],
): boolean {
  if (!isRecord(value)) {
    addIssue(issues, path, "TeamExecutionTaskSnapshot must be an object.")
    return false
  }
  hasNonEmptyString(value, "taskId", path, issues)
  if (
    typeof value.taskKind !== "string" ||
    !TEAM_EXECUTION_TASK_KINDS.has(value.taskKind as TeamExecutionTaskSnapshot["taskKind"])
  ) {
    addIssue(
      issues,
      `${path}.taskKind`,
      "taskKind must be member, synthesis, review, or verification.",
    )
  }
  validateOrchestrationTask(value, path, issues)
  if (!isRecord(value.inputContext))
    addIssue(issues, `${path}.inputContext`, "inputContext must be an object.")
  if (Array.isArray(value.expectedOutputs)) {
    value.expectedOutputs.forEach((output, index) =>
      validateExpectedOutputContract(output, `${path}.expectedOutputs[${index}]`, issues),
    )
  } else {
    addIssue(issues, `${path}.expectedOutputs`, "expectedOutputs must be an array.")
  }
  validateStringArray(value.validationCriteria, `${path}.validationCriteria`, issues, {
    requireNonEmptyItems: true,
  })
  validateStringArray(value.dependsOnTaskIds, `${path}.dependsOnTaskIds`, issues, {
    requireNonEmptyItems: true,
  })
  hasBoolean(value, "required", path, issues)
  validateStringArray(value.reasonCodes, `${path}.reasonCodes`, issues, {
    requireNonEmptyItems: true,
  })
  return true
}

function validateDependencyEdge(
  value: unknown,
  path: string,
  issues: ContractValidationIssue[],
): boolean {
  if (!isRecord(value)) {
    addIssue(issues, path, "DependencyEdgeContract must be an object.")
    return false
  }
  hasNonEmptyString(value, "fromTaskId", path, issues)
  hasNonEmptyString(value, "toTaskId", path, issues)
  hasNonEmptyString(value, "reasonCode", path, issues)
  return true
}

function validateResourceLock(
  value: unknown,
  path: string,
  issues: ContractValidationIssue[],
): boolean {
  if (!isRecord(value)) {
    addIssue(issues, path, "ResourceLockContract must be an object.")
    return false
  }
  hasNonEmptyString(value, "lockId", path, issues)
  if (typeof value.kind !== "string" || !RESOURCE_LOCK_KINDS.has(value.kind as ResourceLockKind)) {
    addIssue(issues, `${path}.kind`, "kind must be a supported resource lock kind.")
  }
  hasNonEmptyString(value, "target", path, issues)
  if (value.mode !== "shared" && value.mode !== "exclusive") {
    addIssue(issues, `${path}.mode`, "mode must be shared or exclusive.")
  }
  hasNonEmptyString(value, "reasonCode", path, issues)
  return true
}

function validateParallelSubSessionGroup(
  value: unknown,
  path: string,
  issues: ContractValidationIssue[],
): boolean {
  if (!isRecord(value)) {
    addIssue(issues, path, "ParallelSubSessionGroup must be an object.")
    return false
  }
  hasNonEmptyString(value, "groupId", path, issues)
  hasNonEmptyString(value, "parentRunId", path, issues)
  validateStringArray(value.subSessionIds, `${path}.subSessionIds`, issues, {
    requireNonEmptyItems: true,
  })
  if (Array.isArray(value.dependencyEdges)) {
    value.dependencyEdges.forEach((edge, index) =>
      validateDependencyEdge(edge, `${path}.dependencyEdges[${index}]`, issues),
    )
  } else {
    addIssue(issues, `${path}.dependencyEdges`, "dependencyEdges must be an array.")
  }
  if (Array.isArray(value.resourceLocks)) {
    value.resourceLocks.forEach((lock, index) =>
      validateResourceLock(lock, `${path}.resourceLocks[${index}]`, issues),
    )
  } else {
    addIssue(issues, `${path}.resourceLocks`, "resourceLocks must be an array.")
  }
  hasFiniteNumber(value, "concurrencyLimit", path, issues, { min: 1 })
  if (
    value.status !== "planned" &&
    value.status !== "running" &&
    value.status !== "completed" &&
    value.status !== "blocked" &&
    value.status !== "failed"
  ) {
    addIssue(
      issues,
      `${path}.status`,
      "status must be planned, running, completed, blocked, or failed.",
    )
  }
  return true
}

function validateApprovalRequirement(
  value: unknown,
  path: string,
  issues: ContractValidationIssue[],
): boolean {
  if (!isRecord(value)) {
    addIssue(issues, path, "ApprovalRequirementContract must be an object.")
    return false
  }
  hasNonEmptyString(value, "approvalId", path, issues)
  hasNonEmptyString(value, "taskId", path, issues)
  if ("agentId" in value && value.agentId !== undefined && typeof value.agentId !== "string") {
    addIssue(issues, `${path}.agentId`, "agentId must be a string when present.")
  }
  hasNonEmptyString(value, "capability", path, issues)
  if (
    typeof value.risk !== "string" ||
    !CAPABILITY_RISK_LEVELS.has(value.risk as CapabilityRiskLevel)
  ) {
    addIssue(issues, `${path}.risk`, "risk must be a supported capability risk level.")
  }
  hasNonEmptyString(value, "reasonCode", path, issues)
  return true
}

export function validateAgentConfig(value: unknown): ContractValidationResult<AgentConfig> {
  const issues: ContractValidationIssue[] = []
  if (!isRecord(value)) {
    return {
      ok: false,
      issues: [
        {
          path: "$",
          code: "contract_validation_failed",
          message: "Agent config must be an object.",
        },
      ],
    }
  }
  if (value.schemaVersion !== CONTRACT_SCHEMA_VERSION)
    addIssue(issues, "$.schemaVersion", "Unsupported contract schema version.")
  if (value.agentType !== "nobie" && value.agentType !== "sub_agent") {
    addIssue(issues, "$.agentType", "agentType must be nobie or sub_agent.")
  }
  hasNonEmptyString(value, "agentId", "$", issues)
  hasNonEmptyString(value, "displayName", "$", issues)
  hasNonEmptyNickname(value, "nickname", "$", issues)
  if ("normalizedNickname" in value && value.normalizedNickname !== undefined) {
    hasNonEmptyNickname(value, "normalizedNickname", "$", issues)
  }
  hasNonEmptyString(value, "role", "$", issues)
  hasNonEmptyString(value, "personality", "$", issues)
  validateStringArray(value.specialtyTags, "$.specialtyTags", issues, {
    requireNonEmptyItems: true,
  })
  validateStringArray(value.avoidTasks, "$.avoidTasks", issues)
  if ("modelProfile" in value && value.modelProfile !== undefined)
    validateModelProfile(value.modelProfile, "$.modelProfile", issues)
  validateMemoryPolicy(value.memoryPolicy, "$.memoryPolicy", issues)
  validateCapabilityPolicy(value.capabilityPolicy, "$.capabilityPolicy", issues)
  if ("delegationPolicy" in value && value.delegationPolicy !== undefined) {
    validateDelegationPolicy(value.delegationPolicy, "$.delegationPolicy", issues)
  }
  hasFiniteNumber(value, "profileVersion", "$", issues, { min: 1 })
  hasFiniteNumber(value, "createdAt", "$", issues, { min: 0 })
  hasFiniteNumber(value, "updatedAt", "$", issues, { min: 0 })
  if (value.agentType === "nobie") {
    if (!isRecord(value.coordinator)) {
      addIssue(issues, "$.coordinator", "nobie agent requires coordinator settings.")
    } else {
      if (
        value.coordinator.defaultMode !== "single_nobie" &&
        value.coordinator.defaultMode !== "orchestration"
      ) {
        addIssue(
          issues,
          "$.coordinator.defaultMode",
          "defaultMode must be single_nobie or orchestration.",
        )
      }
      if (value.coordinator.fallbackMode !== "single_nobie") {
        addIssue(issues, "$.coordinator.fallbackMode", "fallbackMode must be single_nobie.")
      }
      hasFiniteNumber(value.coordinator, "maxDelegatedSubSessions", "$.coordinator", issues, {
        min: 1,
      })
    }
  }
  if (value.agentType === "sub_agent") {
    validateStringArray(value.teamIds, "$.teamIds", issues, { requireNonEmptyItems: true })
    if ("delegation" in value && value.delegation !== undefined) {
      validateDelegationPolicy(value.delegation, "$.delegation", issues)
    } else if (!("delegationPolicy" in value && value.delegationPolicy !== undefined)) {
      addIssue(
        issues,
        "$.delegation",
        "sub_agent requires delegation or delegationPolicy settings.",
      )
    }
  }
  if (value.agentType !== "sub_agent" && ("teamIds" in value || "delegation" in value)) {
    addIssue(
      issues,
      "$.agentType",
      "Only sub_agent configs can include teamIds or delegation settings.",
    )
  }
  return issues.length === 0
    ? { ok: true, value: value as unknown as AgentConfig, issues: [] }
    : { ok: false, issues }
}

export function validateTeamConfig(value: unknown): ContractValidationResult<TeamConfig> {
  const issues: ContractValidationIssue[] = []
  if (!isRecord(value)) {
    return {
      ok: false,
      issues: [
        {
          path: "$",
          code: "contract_validation_failed",
          message: "Team config must be an object.",
        },
      ],
    }
  }
  if (value.schemaVersion !== CONTRACT_SCHEMA_VERSION)
    addIssue(issues, "$.schemaVersion", "Unsupported contract schema version.")
  hasNonEmptyString(value, "teamId", "$", issues)
  hasNonEmptyString(value, "displayName", "$", issues)
  hasNonEmptyNickname(value, "nickname", "$", issues)
  if ("normalizedNickname" in value && value.normalizedNickname !== undefined) {
    hasNonEmptyNickname(value, "normalizedNickname", "$", issues)
  }
  hasNonEmptyString(value, "purpose", "$", issues)
  validateStringArray(value.memberAgentIds, "$.memberAgentIds", issues, {
    requireNonEmptyItems: true,
  })
  validateStringArray(value.roleHints, "$.roleHints", issues)
  const extended = usesExtendedTeamShape(value)
  if (extended) {
    hasNonEmptyString(value, "ownerAgentId", "$", issues)
    hasNonEmptyString(value, "leadAgentId", "$", issues)
  }
  if ("memberCountMin" in value && value.memberCountMin !== undefined)
    hasFiniteNumber(value, "memberCountMin", "$", issues, { min: 0 })
  if ("memberCountMax" in value && value.memberCountMax !== undefined)
    hasFiniteNumber(value, "memberCountMax", "$", issues, { min: 0 })
  if (
    typeof value.memberCountMin === "number" &&
    typeof value.memberCountMax === "number" &&
    value.memberCountMin > value.memberCountMax
  ) {
    addIssue(
      issues,
      "$.memberCountMax",
      "memberCountMax must be greater than or equal to memberCountMin.",
    )
  }
  if ("requiredTeamRoles" in value && value.requiredTeamRoles !== undefined) {
    validateStringArray(value.requiredTeamRoles, "$.requiredTeamRoles", issues, {
      requireNonEmptyItems: true,
    })
  }
  if ("requiredCapabilityTags" in value && value.requiredCapabilityTags !== undefined) {
    validateStringArray(value.requiredCapabilityTags, "$.requiredCapabilityTags", issues, {
      requireNonEmptyItems: true,
    })
  }
  if ("resultPolicy" in value && value.resultPolicy !== undefined) {
    if (
      typeof value.resultPolicy !== "string" ||
      !TEAM_RESULT_POLICY_MODES.has(value.resultPolicy as TeamResultPolicyMode)
    ) {
      addIssue(issues, "$.resultPolicy", "resultPolicy must be a supported team result policy.")
    }
  }
  if ("conflictPolicy" in value && value.conflictPolicy !== undefined) {
    if (
      typeof value.conflictPolicy !== "string" ||
      !TEAM_CONFLICT_POLICY_MODES.has(value.conflictPolicy as TeamConflictPolicyMode)
    ) {
      addIssue(
        issues,
        "$.conflictPolicy",
        "conflictPolicy must be a supported team conflict policy.",
      )
    }
  }
  if ("memberships" in value && value.memberships !== undefined) {
    if (Array.isArray(value.memberships)) {
      value.memberships.forEach((membership, index) => {
        const validation = validateTeamMembership(membership)
        if (!validation.ok) {
          for (const issue of validation.issues) {
            addIssue(
              issues,
              `$.memberships[${index}]${issue.path === "$" ? "" : issue.path.slice(1)}`,
              issue.message,
            )
          }
        }
      })
    } else {
      addIssue(issues, "$.memberships", "memberships must be an array when present.")
    }
  }
  hasFiniteNumber(value, "profileVersion", "$", issues, { min: 1 })
  hasFiniteNumber(value, "createdAt", "$", issues, { min: 0 })
  hasFiniteNumber(value, "updatedAt", "$", issues, { min: 0 })
  for (const forbidden of [
    "allowedTools",
    "allowedSkills",
    "allowedMcpServers",
    "allowed_tools",
    "allowed_skills",
    "allowed_mcp_servers",
    "skillMcpAllowlist",
    "permissionProfile",
  ]) {
    if (forbidden in value)
      addIssue(
        issues,
        `$.${forbidden}`,
        "Teams cannot directly own tools, skills, MCP servers, or permission profiles.",
      )
  }
  return issues.length === 0
    ? { ok: true, value: value as unknown as TeamConfig, issues: [] }
    : { ok: false, issues }
}

export function validateTeamExecutionPlan(
  value: unknown,
): ContractValidationResult<TeamExecutionPlan> {
  const issues: ContractValidationIssue[] = []
  if (!isRecord(value)) {
    return {
      ok: false,
      issues: [
        {
          path: "$",
          code: "contract_validation_failed",
          message: "TeamExecutionPlan must be an object.",
        },
      ],
    }
  }
  hasNonEmptyString(value, "teamExecutionPlanId", "$", issues)
  hasNonEmptyString(value, "parentRunId", "$", issues)
  hasNonEmptyString(value, "teamId", "$", issues)
  if ("teamNicknameSnapshot" in value && value.teamNicknameSnapshot !== undefined) {
    hasNonEmptyNickname(value, "teamNicknameSnapshot", "$", issues)
  }
  hasNonEmptyString(value, "ownerAgentId", "$", issues)
  hasNonEmptyString(value, "leadAgentId", "$", issues)
  if (Array.isArray(value.memberTaskAssignments)) {
    value.memberTaskAssignments.forEach((assignment, index) => {
      if (!isRecord(assignment)) {
        addIssue(
          issues,
          `$.memberTaskAssignments[${index}]`,
          "memberTaskAssignments items must be objects.",
        )
        return
      }
      hasNonEmptyString(assignment, "agentId", `$.memberTaskAssignments[${index}]`, issues)
      validateStringArray(assignment.taskIds, `$.memberTaskAssignments[${index}].taskIds`, issues, {
        requireNonEmptyItems: true,
      })
      if (
        "role" in assignment &&
        assignment.role !== undefined &&
        typeof assignment.role !== "string"
      ) {
        addIssue(
          issues,
          `$.memberTaskAssignments[${index}].role`,
          "role must be a string when present.",
        )
      }
      if (
        "membershipId" in assignment &&
        assignment.membershipId !== undefined &&
        typeof assignment.membershipId !== "string"
      ) {
        addIssue(
          issues,
          `$.memberTaskAssignments[${index}].membershipId`,
          "membershipId must be a string when present.",
        )
      }
      if ("required" in assignment && assignment.required !== undefined) {
        hasBoolean(assignment, "required", `$.memberTaskAssignments[${index}]`, issues)
      }
      if (
        "executionState" in assignment &&
        assignment.executionState !== undefined &&
        typeof assignment.executionState !== "string"
      ) {
        addIssue(
          issues,
          `$.memberTaskAssignments[${index}].executionState`,
          "executionState must be a string when present.",
        )
      }
      if ("taskKinds" in assignment && assignment.taskKinds !== undefined) {
        if (Array.isArray(assignment.taskKinds)) {
          assignment.taskKinds.forEach((taskKind, taskKindIndex) => {
            if (
              typeof taskKind !== "string" ||
              !TEAM_EXECUTION_TASK_KINDS.has(taskKind as TeamExecutionTaskSnapshot["taskKind"])
            ) {
              addIssue(
                issues,
                `$.memberTaskAssignments[${index}].taskKinds[${taskKindIndex}]`,
                "taskKinds items must be member, synthesis, review, or verification.",
              )
            }
          })
        } else {
          addIssue(
            issues,
            `$.memberTaskAssignments[${index}].taskKinds`,
            "taskKinds must be an array when present.",
          )
        }
      }
      if ("inputContext" in assignment && assignment.inputContext !== undefined) {
        if (!isRecord(assignment.inputContext)) {
          addIssue(
            issues,
            `$.memberTaskAssignments[${index}].inputContext`,
            "inputContext must be an object when present.",
          )
        }
      }
      if ("expectedOutputs" in assignment && assignment.expectedOutputs !== undefined) {
        if (Array.isArray(assignment.expectedOutputs)) {
          assignment.expectedOutputs.forEach((output, outputIndex) =>
            validateExpectedOutputContract(
              output,
              `$.memberTaskAssignments[${index}].expectedOutputs[${outputIndex}]`,
              issues,
            ),
          )
        } else {
          addIssue(
            issues,
            `$.memberTaskAssignments[${index}].expectedOutputs`,
            "expectedOutputs must be an array when present.",
          )
        }
      }
      if ("validationCriteria" in assignment && assignment.validationCriteria !== undefined) {
        validateStringArray(
          assignment.validationCriteria,
          `$.memberTaskAssignments[${index}].validationCriteria`,
          issues,
          { requireNonEmptyItems: true },
        )
      }
      if ("dependsOnTaskIds" in assignment && assignment.dependsOnTaskIds !== undefined) {
        validateStringArray(
          assignment.dependsOnTaskIds,
          `$.memberTaskAssignments[${index}].dependsOnTaskIds`,
          issues,
          { requireNonEmptyItems: true },
        )
      }
      if (
        "fallbackForAgentId" in assignment &&
        assignment.fallbackForAgentId !== undefined &&
        typeof assignment.fallbackForAgentId !== "string"
      ) {
        addIssue(
          issues,
          `$.memberTaskAssignments[${index}].fallbackForAgentId`,
          "fallbackForAgentId must be a string when present.",
        )
      }
      if ("reasonCodes" in assignment && assignment.reasonCodes !== undefined) {
        validateStringArray(
          assignment.reasonCodes,
          `$.memberTaskAssignments[${index}].reasonCodes`,
          issues,
          { requireNonEmptyItems: true },
        )
      }
      if ("tasks" in assignment && assignment.tasks !== undefined) {
        if (Array.isArray(assignment.tasks)) {
          assignment.tasks.forEach((task, taskIndex) =>
            validateTeamExecutionTaskSnapshot(
              task,
              `$.memberTaskAssignments[${index}].tasks[${taskIndex}]`,
              issues,
            ),
          )
        } else {
          addIssue(
            issues,
            `$.memberTaskAssignments[${index}].tasks`,
            "tasks must be an array when present.",
          )
        }
      }
    })
  } else {
    addIssue(issues, "$.memberTaskAssignments", "memberTaskAssignments must be an array.")
  }
  validateStringArray(value.reviewerAgentIds, "$.reviewerAgentIds", issues, {
    requireNonEmptyItems: true,
  })
  validateStringArray(value.verifierAgentIds, "$.verifierAgentIds", issues, {
    requireNonEmptyItems: true,
  })
  if (Array.isArray(value.fallbackAssignments)) {
    value.fallbackAssignments.forEach((assignment, index) => {
      if (!isRecord(assignment)) {
        addIssue(
          issues,
          `$.fallbackAssignments[${index}]`,
          "fallbackAssignments items must be objects.",
        )
        return
      }
      hasNonEmptyString(assignment, "missingAgentId", `$.fallbackAssignments[${index}]`, issues)
      hasNonEmptyString(assignment, "fallbackAgentId", `$.fallbackAssignments[${index}]`, issues)
      if (
        "reasonCode" in assignment &&
        assignment.reasonCode !== undefined &&
        typeof assignment.reasonCode !== "string"
      ) {
        addIssue(
          issues,
          `$.fallbackAssignments[${index}].reasonCode`,
          "reasonCode must be a string when present.",
        )
      }
    })
  } else {
    addIssue(issues, "$.fallbackAssignments", "fallbackAssignments must be an array.")
  }
  if (!isRecord(value.coverageReport))
    addIssue(issues, "$.coverageReport", "coverageReport must be an object.")
  if (
    typeof value.conflictPolicySnapshot !== "string" ||
    !TEAM_CONFLICT_POLICY_MODES.has(value.conflictPolicySnapshot as TeamConflictPolicyMode)
  ) {
    addIssue(
      issues,
      "$.conflictPolicySnapshot",
      "conflictPolicySnapshot must be a supported team conflict policy.",
    )
  }
  if (
    typeof value.resultPolicySnapshot !== "string" ||
    !TEAM_RESULT_POLICY_MODES.has(value.resultPolicySnapshot as TeamResultPolicyMode)
  ) {
    addIssue(
      issues,
      "$.resultPolicySnapshot",
      "resultPolicySnapshot must be a supported team result policy.",
    )
  }
  hasFiniteNumber(value, "createdAt", "$", issues, { min: 0 })
  return issues.length === 0
    ? { ok: true, value: value as unknown as TeamExecutionPlan, issues: [] }
    : { ok: false, issues }
}

export function validateOrchestrationPlan(
  value: unknown,
): ContractValidationResult<OrchestrationPlan> {
  const issues: ContractValidationIssue[] = []
  if (!isRecord(value)) {
    return {
      ok: false,
      issues: [
        {
          path: "$",
          code: "contract_validation_failed",
          message: "OrchestrationPlan must be an object.",
        },
      ],
    }
  }
  validateRuntimeIdentity(value.identity, "$.identity", issues)
  hasNonEmptyString(value, "planId", "$", issues)
  hasNonEmptyString(value, "parentRunId", "$", issues)
  hasNonEmptyString(value, "parentRequestId", "$", issues)
  if (Array.isArray(value.directNobieTasks)) {
    value.directNobieTasks.forEach((task, index) =>
      validateOrchestrationTask(task, `$.directNobieTasks[${index}]`, issues, "direct_nobie"),
    )
  } else {
    addIssue(issues, "$.directNobieTasks", "directNobieTasks must be an array.")
  }
  if (Array.isArray(value.delegatedTasks)) {
    value.delegatedTasks.forEach((task, index) =>
      validateOrchestrationTask(task, `$.delegatedTasks[${index}]`, issues, "delegated_sub_agent"),
    )
  } else {
    addIssue(issues, "$.delegatedTasks", "delegatedTasks must be an array.")
  }
  if (Array.isArray(value.dependencyEdges)) {
    value.dependencyEdges.forEach((edge, index) =>
      validateDependencyEdge(edge, `$.dependencyEdges[${index}]`, issues),
    )
  } else {
    addIssue(issues, "$.dependencyEdges", "dependencyEdges must be an array.")
  }
  if (Array.isArray(value.resourceLocks)) {
    value.resourceLocks.forEach((lock, index) =>
      validateResourceLock(lock, `$.resourceLocks[${index}]`, issues),
    )
  } else {
    addIssue(issues, "$.resourceLocks", "resourceLocks must be an array.")
  }
  if (Array.isArray(value.parallelGroups)) {
    value.parallelGroups.forEach((group, index) =>
      validateParallelSubSessionGroup(group, `$.parallelGroups[${index}]`, issues),
    )
  } else {
    addIssue(issues, "$.parallelGroups", "parallelGroups must be an array.")
  }
  if (Array.isArray(value.approvalRequirements)) {
    value.approvalRequirements.forEach((requirement, index) => {
      validateApprovalRequirement(requirement, `$.approvalRequirements[${index}]`, issues)
    })
  } else {
    addIssue(issues, "$.approvalRequirements", "approvalRequirements must be an array.")
  }
  if (!isRecord(value.fallbackStrategy)) {
    addIssue(issues, "$.fallbackStrategy", "fallbackStrategy must be an object.")
  } else {
    if (
      value.fallbackStrategy.mode !== "single_nobie" &&
      value.fallbackStrategy.mode !== "ask_user" &&
      value.fallbackStrategy.mode !== "fail_with_reason"
    ) {
      addIssue(
        issues,
        "$.fallbackStrategy.mode",
        "fallbackStrategy.mode must be single_nobie, ask_user, or fail_with_reason.",
      )
    }
    hasNonEmptyString(value.fallbackStrategy, "reasonCode", "$.fallbackStrategy", issues)
    if (
      "userMessage" in value.fallbackStrategy &&
      value.fallbackStrategy.userMessage !== undefined &&
      typeof value.fallbackStrategy.userMessage !== "string"
    ) {
      addIssue(
        issues,
        "$.fallbackStrategy.userMessage",
        "userMessage must be a string when present.",
      )
    }
  }
  hasFiniteNumber(value, "createdAt", "$", issues, { min: 0 })
  return issues.length === 0
    ? { ok: true, value: value as unknown as OrchestrationPlan, issues: [] }
    : { ok: false, issues }
}

export function validateCommandRequest(value: unknown): ContractValidationResult<CommandRequest> {
  const issues: ContractValidationIssue[] = []
  if (!isRecord(value)) {
    return {
      ok: false,
      issues: [
        {
          path: "$",
          code: "contract_validation_failed",
          message: "CommandRequest must be an object.",
        },
      ],
    }
  }
  validateRuntimeIdentity(value.identity, "$.identity", issues)
  hasNonEmptyString(value, "commandRequestId", "$", issues)
  hasNonEmptyString(value, "parentRunId", "$", issues)
  hasNonEmptyString(value, "subSessionId", "$", issues)
  hasNonEmptyString(value, "targetAgentId", "$", issues)
  if ("targetNicknameSnapshot" in value && value.targetNicknameSnapshot !== undefined) {
    hasNonEmptyNickname(value, "targetNicknameSnapshot", "$", issues)
  }
  validateStructuredTaskScope(value.taskScope, "$.taskScope", issues)
  validateStringArray(value.contextPackageIds, "$.contextPackageIds", issues, {
    requireNonEmptyItems: true,
  })
  if (Array.isArray(value.expectedOutputs)) {
    value.expectedOutputs.forEach((output, index) =>
      validateExpectedOutputContract(output, `$.expectedOutputs[${index}]`, issues),
    )
  } else {
    addIssue(issues, "$.expectedOutputs", "expectedOutputs must be an array.")
  }
  hasFiniteNumber(value, "retryBudget", "$", issues, { min: 0 })
  return issues.length === 0
    ? { ok: true, value: value as unknown as CommandRequest, issues: [] }
    : { ok: false, issues }
}

export function validateDataExchangePackage(
  value: unknown,
): ContractValidationResult<DataExchangePackage> {
  const issues: ContractValidationIssue[] = []
  if (!isRecord(value)) {
    return {
      ok: false,
      issues: [
        {
          path: "$",
          code: "contract_validation_failed",
          message: "DataExchangePackage must be an object.",
        },
      ],
    }
  }
  validateRuntimeIdentity(value.identity, "$.identity", issues)
  hasNonEmptyString(value, "exchangeId", "$", issues)
  validateOwnerScope(value.sourceOwner, "$.sourceOwner", issues)
  validateOwnerScope(value.recipientOwner, "$.recipientOwner", issues)
  hasNonEmptyNickname(value, "sourceNicknameSnapshot", "$", issues)
  hasNonEmptyNickname(value, "recipientNicknameSnapshot", "$", issues)
  hasNonEmptyString(value, "purpose", "$", issues)
  if (
    typeof value.allowedUse !== "string" ||
    !DATA_EXCHANGE_ALLOWED_USE.has(value.allowedUse as DataExchangePackage["allowedUse"])
  ) {
    addIssue(
      issues,
      "$.allowedUse",
      "allowedUse must be temporary_context, memory_candidate, or verification_only.",
    )
  }
  if (
    typeof value.retentionPolicy !== "string" ||
    !DATA_EXCHANGE_RETENTION_POLICIES.has(value.retentionPolicy as DataExchangeRetentionPolicy)
  ) {
    addIssue(
      issues,
      "$.retentionPolicy",
      "retentionPolicy must be a supported data exchange retention policy.",
    )
  }
  if (
    typeof value.redactionState !== "string" ||
    !DATA_EXCHANGE_REDACTION_STATES.has(
      value.redactionState as DataExchangePackage["redactionState"],
    )
  ) {
    addIssue(
      issues,
      "$.redactionState",
      "redactionState must be redacted, not_sensitive, or blocked.",
    )
  }
  validateStringArray(value.provenanceRefs, "$.provenanceRefs", issues, {
    requireNonEmptyItems: true,
  })
  if (!isRecord(value.payload)) addIssue(issues, "$.payload", "payload must be an object.")
  if (
    "expiresAt" in value &&
    value.expiresAt !== undefined &&
    value.expiresAt !== null &&
    typeof value.expiresAt !== "number"
  ) {
    addIssue(issues, "$.expiresAt", "expiresAt must be a number or null when present.")
  }
  hasFiniteNumber(value, "createdAt", "$", issues, { min: 0 })
  return issues.length === 0
    ? { ok: true, value: value as unknown as DataExchangePackage, issues: [] }
    : { ok: false, issues }
}

export function validateResultReport(
  value: unknown,
  options: { expectedOutputs?: ExpectedOutputContract[] } = {},
): ContractValidationResult<ResultReport> {
  const issues: ContractValidationIssue[] = []
  if (!isRecord(value)) {
    return {
      ok: false,
      issues: [
        {
          path: "$",
          code: "contract_validation_failed",
          message: "ResultReport must be an object.",
        },
      ],
    }
  }
  validateRuntimeIdentity(value.identity, "$.identity", issues)
  hasNonEmptyString(value, "resultReportId", "$", issues)
  hasNonEmptyString(value, "parentRunId", "$", issues)
  hasNonEmptyString(value, "subSessionId", "$", issues)
  if ("source" in value && value.source !== undefined)
    validateNicknameSnapshot(value.source, "$.source", issues)
  if (
    typeof value.status !== "string" ||
    !RESULT_REPORT_STATUSES.has(value.status as ResultReport["status"])
  ) {
    addIssue(issues, "$.status", "status must be completed, needs_revision, or failed.")
  }
  const reportStatus = typeof value.status === "string" ? value.status : undefined
  const outputsById = new Map<string, ResultReport["outputs"][number]>()
  if (Array.isArray(value.outputs)) {
    value.outputs.forEach((output, index) => {
      if (!isRecord(output)) {
        addIssue(issues, `$.outputs[${index}]`, "outputs items must be objects.")
        return
      }
      hasNonEmptyString(output, "outputId", `$.outputs[${index}]`, issues)
      if (
        typeof output.status !== "string" ||
        !RESULT_OUTPUT_STATUSES.has(output.status as ResultReport["outputs"][number]["status"])
      ) {
        addIssue(
          issues,
          `$.outputs[${index}].status`,
          "output status must be satisfied, missing, or partial.",
        )
      }
      if (typeof output.outputId === "string")
        outputsById.set(output.outputId, output as ResultReport["outputs"][number])
    })
  } else {
    addIssue(issues, "$.outputs", "outputs must be an array.")
  }
  if (Array.isArray(value.evidence)) {
    value.evidence.forEach((evidence, index) => {
      if (!isRecord(evidence)) {
        addIssue(issues, `$.evidence[${index}]`, "evidence items must be objects.")
        return
      }
      hasNonEmptyString(evidence, "evidenceId", `$.evidence[${index}]`, issues)
      hasNonEmptyString(evidence, "kind", `$.evidence[${index}]`, issues)
      hasNonEmptyString(evidence, "sourceRef", `$.evidence[${index}]`, issues)
      if (
        "sourceTimestamp" in evidence &&
        evidence.sourceTimestamp !== undefined &&
        typeof evidence.sourceTimestamp !== "string"
      ) {
        addIssue(
          issues,
          `$.evidence[${index}].sourceTimestamp`,
          "sourceTimestamp must be a string when present.",
        )
      }
    })
  } else {
    addIssue(issues, "$.evidence", "evidence must be an array.")
  }
  if (Array.isArray(value.artifacts)) {
    value.artifacts.forEach((artifact, index) => {
      if (!isRecord(artifact)) {
        addIssue(issues, `$.artifacts[${index}]`, "artifacts items must be objects.")
        return
      }
      hasNonEmptyString(artifact, "artifactId", `$.artifacts[${index}]`, issues)
      hasNonEmptyString(artifact, "kind", `$.artifacts[${index}]`, issues)
      if ("path" in artifact && artifact.path !== undefined && typeof artifact.path !== "string") {
        addIssue(issues, `$.artifacts[${index}].path`, "path must be a string when present.")
      }
    })
  } else {
    addIssue(issues, "$.artifacts", "artifacts must be an array.")
  }
  validateStringArray(value.risksOrGaps, "$.risksOrGaps", issues)
  if ("impossibleReason" in value && value.impossibleReason !== undefined) {
    if (!isRecord(value.impossibleReason)) {
      addIssue(issues, "$.impossibleReason", "impossibleReason must be an object when present.")
    } else {
      if (
        typeof value.impossibleReason.kind !== "string" ||
        !RESULT_REPORT_IMPOSSIBLE_REASON_KINDS.has(
          value.impossibleReason.kind as ResultReportImpossibleReasonKind,
        )
      ) {
        addIssue(
          issues,
          "$.impossibleReason.kind",
          "impossibleReason.kind must be physical, logical, or policy.",
        )
      }
      hasNonEmptyString(value.impossibleReason, "reasonCode", "$.impossibleReason", issues)
      hasNonEmptyString(value.impossibleReason, "detail", "$.impossibleReason", issues)
    }
  }
  for (const [index, expected] of (options.expectedOutputs ?? []).entries()) {
    validateExpectedOutputContract(expected, `$.expectedOutputs[${index}]`, issues)
    if (!expected.required) continue
    const output = outputsById.get(expected.outputId)
    if (!output || output.status === "missing") {
      addIssue(
        issues,
        "$.outputs",
        `Required output ${expected.outputId} is missing from ResultReport.`,
      )
    }
    if (reportStatus !== "completed") continue
    if (output && output.status !== "satisfied") {
      addIssue(
        issues,
        "$.outputs",
        `Required output ${expected.outputId} must be satisfied when ResultReport status is completed.`,
      )
    }
    for (const evidenceKind of expected.acceptance.requiredEvidenceKinds) {
      const matchingEvidence = Array.isArray(value.evidence)
        ? value.evidence.filter(
            (evidence) =>
              isRecord(evidence) &&
              evidence.kind === evidenceKind &&
              typeof evidence.sourceRef === "string" &&
              evidence.sourceRef.trim().length > 0,
          )
        : []
      if (matchingEvidence.length === 0) {
        addIssue(
          issues,
          "$.evidence",
          `Required evidence kind ${evidenceKind} with sourceRef is missing for ${expected.outputId}.`,
        )
      }
    }
    if (expected.acceptance.artifactRequired) {
      const artifactReferences = Array.isArray(value.artifacts)
        ? value.artifacts.filter(
            (artifact) =>
              isRecord(artifact) &&
              typeof artifact.path === "string" &&
              artifact.path.trim().length > 0,
          )
        : []
      if (artifactReferences.length === 0) {
        addIssue(
          issues,
          "$.artifacts",
          `Required artifact reference is missing for ${expected.outputId}.`,
        )
      }
    }
  }
  return issues.length === 0
    ? { ok: true, value: value as unknown as ResultReport, issues: [] }
    : { ok: false, issues }
}

export function validateFeedbackRequest(value: unknown): ContractValidationResult<FeedbackRequest> {
  const issues: ContractValidationIssue[] = []
  if (!isRecord(value)) {
    return {
      ok: false,
      issues: [
        {
          path: "$",
          code: "contract_validation_failed",
          message: "FeedbackRequest must be an object.",
        },
      ],
    }
  }
  validateRuntimeIdentity(value.identity, "$.identity", issues)
  hasNonEmptyString(value, "feedbackRequestId", "$", issues)
  hasNonEmptyString(value, "parentRunId", "$", issues)
  hasNonEmptyString(value, "subSessionId", "$", issues)
  validateStringArray(value.sourceResultReportIds, "$.sourceResultReportIds", issues, {
    requireNonEmptyItems: true,
  })
  if (Array.isArray(value.sourceResultReportIds) && value.sourceResultReportIds.length === 0) {
    addIssue(
      issues,
      "$.sourceResultReportIds",
      "sourceResultReportIds must include at least one result report id.",
    )
  }
  validateStringArray(value.previousSubSessionIds, "$.previousSubSessionIds", issues, {
    requireNonEmptyItems: true,
  })
  if (Array.isArray(value.previousSubSessionIds) && value.previousSubSessionIds.length === 0) {
    addIssue(
      issues,
      "$.previousSubSessionIds",
      "previousSubSessionIds must include at least one sub-session id.",
    )
  }
  if (
    typeof value.targetAgentPolicy !== "string" ||
    !FEEDBACK_TARGET_AGENT_POLICIES.has(value.targetAgentPolicy as FeedbackTargetAgentPolicy)
  ) {
    addIssue(
      issues,
      "$.targetAgentPolicy",
      "targetAgentPolicy must be same_agent, alternative_direct_child, parent_decides, fallback_agent, lead_assigns, or nobie_direct.",
    )
  }
  if (
    "targetAgentId" in value &&
    value.targetAgentId !== undefined &&
    typeof value.targetAgentId !== "string"
  ) {
    addIssue(issues, "$.targetAgentId", "targetAgentId must be a string when present.")
  }
  if ("targetAgentNicknameSnapshot" in value && value.targetAgentNicknameSnapshot !== undefined) {
    hasNonEmptyNickname(value, "targetAgentNicknameSnapshot", "$", issues)
  }
  if (
    "requestingAgentNicknameSnapshot" in value &&
    value.requestingAgentNicknameSnapshot !== undefined
  ) {
    hasNonEmptyNickname(value, "requestingAgentNicknameSnapshot", "$", issues)
  }
  if (
    "synthesizedContextExchangeId" in value &&
    value.synthesizedContextExchangeId !== undefined &&
    typeof value.synthesizedContextExchangeId !== "string"
  ) {
    addIssue(
      issues,
      "$.synthesizedContextExchangeId",
      "synthesizedContextExchangeId must be a string when present.",
    )
  }
  if (Array.isArray(value.carryForwardOutputs)) {
    value.carryForwardOutputs.forEach((output, index) => {
      if (!isRecord(output)) {
        addIssue(
          issues,
          `$.carryForwardOutputs[${index}]`,
          "carryForwardOutputs items must be objects.",
        )
        return
      }
      hasNonEmptyString(output, "outputId", `$.carryForwardOutputs[${index}]`, issues)
      if (output.status !== "satisfied" && output.status !== "partial") {
        addIssue(
          issues,
          `$.carryForwardOutputs[${index}].status`,
          "carryForward output status must be satisfied or partial.",
        )
      }
    })
  } else {
    addIssue(issues, "$.carryForwardOutputs", "carryForwardOutputs must be an array.")
  }
  validateStringArray(value.missingItems, "$.missingItems", issues, { requireNonEmptyItems: true })
  validateStringArray(value.conflictItems, "$.conflictItems", issues)
  validateStringArray(value.requiredChanges, "$.requiredChanges", issues, {
    requireNonEmptyItems: true,
  })
  validateStringArray(value.additionalConstraints, "$.additionalConstraints", issues)
  validateStringArray(value.additionalContextRefs, "$.additionalContextRefs", issues)
  if (Array.isArray(value.expectedRevisionOutputs)) {
    value.expectedRevisionOutputs.forEach((output, index) => {
      validateExpectedOutputContract(output, `$.expectedRevisionOutputs[${index}]`, issues)
    })
  } else {
    addIssue(issues, "$.expectedRevisionOutputs", "expectedRevisionOutputs must be an array.")
  }
  hasFiniteNumber(value, "retryBudgetRemaining", "$", issues, { min: 0 })
  hasNonEmptyString(value, "reasonCode", "$", issues)
  if ("createdAt" in value && value.createdAt !== undefined) {
    hasFiniteNumber(value, "createdAt", "$", issues, { min: 0 })
  }
  return issues.length === 0
    ? { ok: true, value: value as unknown as FeedbackRequest, issues: [] }
    : { ok: false, issues }
}

export function validateAgentPromptBundle(
  value: unknown,
): ContractValidationResult<AgentPromptBundle> {
  const issues: ContractValidationIssue[] = []
  if (!isRecord(value)) {
    return {
      ok: false,
      issues: [
        {
          path: "$",
          code: "contract_validation_failed",
          message: "AgentPromptBundle must be an object.",
        },
      ],
    }
  }
  validateRuntimeIdentity(value.identity, "$.identity", issues)
  hasNonEmptyString(value, "bundleId", "$", issues)
  hasNonEmptyString(value, "agentId", "$", issues)
  hasNonEmptyString(value, "role", "$", issues)
  hasNonEmptyString(value, "displayNameSnapshot", "$", issues)
  hasNonEmptyString(value, "personalitySnapshot", "$", issues)
  validateMemoryPolicy(value.memoryPolicy, "$.memoryPolicy", issues)
  validateCapabilityPolicy(value.capabilityPolicy, "$.capabilityPolicy", issues)
  validateStructuredTaskScope(value.taskScope, "$.taskScope", issues)
  validateStringArray(value.safetyRules, "$.safetyRules", issues, { requireNonEmptyItems: true })
  if (Array.isArray(value.sourceProvenance)) {
    value.sourceProvenance.forEach((source, index) => {
      if (!isRecord(source)) {
        addIssue(issues, `$.sourceProvenance[${index}]`, "sourceProvenance items must be objects.")
        return
      }
      hasNonEmptyString(source, "sourceId", `$.sourceProvenance[${index}]`, issues)
      hasNonEmptyString(source, "version", `$.sourceProvenance[${index}]`, issues)
      if (
        "checksum" in source &&
        source.checksum !== undefined &&
        typeof source.checksum !== "string"
      ) {
        addIssue(
          issues,
          `$.sourceProvenance[${index}].checksum`,
          "checksum must be a string when present.",
        )
      }
    })
  } else {
    addIssue(issues, "$.sourceProvenance", "sourceProvenance must be an array.")
  }
  if (Array.isArray(value.safetyRules) && value.safetyRules.length === 0) {
    addIssue(issues, "$.safetyRules", "safetyRules must include at least one safety boundary.")
  }
  if (Array.isArray(value.sourceProvenance) && value.sourceProvenance.length === 0) {
    addIssue(
      issues,
      "$.sourceProvenance",
      "sourceProvenance must include at least one prompt/profile source.",
    )
  }
  if (
    typeof value.agentType !== "string" ||
    (value.agentType !== "nobie" && value.agentType !== "sub_agent")
  ) {
    addIssue(issues, "$.agentType", "agentType must be nobie or sub_agent.")
  }
  return issues.length === 0
    ? { ok: true, value: value as unknown as AgentPromptBundle, issues: [] }
    : { ok: false, issues }
}

export function validateUserVisibleAgentMessage(
  value: unknown,
): ContractValidationResult<UserVisibleAgentMessage> {
  const issues: ContractValidationIssue[] = []
  if (!isRecord(value)) {
    return {
      ok: false,
      issues: [
        {
          path: "$",
          code: "contract_validation_failed",
          message: "UserVisibleAgentMessage must be an object.",
        },
      ],
    }
  }
  rejectUserFacingDisplayNameAliases(value, "$", issues)
  validateRuntimeIdentity(value.identity, "$.identity", issues)
  hasNonEmptyString(value, "messageId", "$", issues)
  hasNonEmptyString(value, "parentRunId", "$", issues)
  validateNicknameSnapshot(value.speaker, "$.speaker", issues)
  hasNonEmptyString(value, "text", "$", issues)
  return issues.length === 0
    ? { ok: true, value: value as unknown as UserVisibleAgentMessage, issues: [] }
    : { ok: false, issues }
}

export function validateNamedHandoffEvent(
  value: unknown,
): ContractValidationResult<NamedHandoffEvent> {
  const issues: ContractValidationIssue[] = []
  if (!isRecord(value)) {
    return {
      ok: false,
      issues: [
        {
          path: "$",
          code: "contract_validation_failed",
          message: "NamedHandoffEvent must be an object.",
        },
      ],
    }
  }
  rejectUserFacingDisplayNameAliases(value, "$", issues)
  validateRuntimeIdentity(value.identity, "$.identity", issues)
  hasNonEmptyString(value, "handoffId", "$", issues)
  hasNonEmptyString(value, "parentRunId", "$", issues)
  validateNicknameSnapshot(value.sender, "$.sender", issues)
  validateNicknameSnapshot(value.recipient, "$.recipient", issues)
  hasNonEmptyString(value, "purpose", "$", issues)
  return issues.length === 0
    ? { ok: true, value: value as unknown as NamedHandoffEvent, issues: [] }
    : { ok: false, issues }
}

export function validateNamedDeliveryEvent(
  value: unknown,
): ContractValidationResult<NamedDeliveryEvent> {
  const issues: ContractValidationIssue[] = []
  if (!isRecord(value)) {
    return {
      ok: false,
      issues: [
        {
          path: "$",
          code: "contract_validation_failed",
          message: "NamedDeliveryEvent must be an object.",
        },
      ],
    }
  }
  rejectUserFacingDisplayNameAliases(value, "$", issues)
  validateRuntimeIdentity(value.identity, "$.identity", issues)
  hasNonEmptyString(value, "deliveryId", "$", issues)
  hasNonEmptyString(value, "parentRunId", "$", issues)
  if (
    value.deliveryKind !== "data_exchange" &&
    value.deliveryKind !== "result_report" &&
    value.deliveryKind !== "handoff_context"
  ) {
    addIssue(
      issues,
      "$.deliveryKind",
      "deliveryKind must be data_exchange, result_report, or handoff_context.",
    )
  }
  validateNicknameSnapshot(value.sender, "$.sender", issues)
  validateNicknameSnapshot(value.recipient, "$.recipient", issues)
  hasNonEmptyString(value, "summary", "$", issues)
  return issues.length === 0
    ? { ok: true, value: value as unknown as NamedDeliveryEvent, issues: [] }
    : { ok: false, issues }
}
