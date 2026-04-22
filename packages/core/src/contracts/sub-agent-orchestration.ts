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
export type RelationshipEntityType = AgentEntityType | "team" | "session" | "sub_session" | "capability" | "data_exchange"
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
export type ResourceLockKind = "file" | "display" | "channel" | "mcp_server" | "secret_scope" | "external_target" | "custom"
export type CapabilityRiskLevel = "safe" | "moderate" | "external" | "sensitive" | "dangerous"
export type DataExchangeRetentionPolicy = "session_only" | "short_term" | "long_term_candidate" | "discard_after_review"
export type LearningApprovalState = "auto_applied" | "pending_review" | "rejected" | "applied_by_user"
export type RelationshipEdgeType = "delegation" | "data_exchange" | "permission" | "capability_delegation" | "team_membership"

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
  status: AgentStatus
  role: string
  personality: string
  specialtyTags: string[]
  avoidTasks: string[]
  memoryPolicy: MemoryPolicy
  capabilityPolicy: CapabilityPolicy
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
  delegation: {
    enabled: boolean
    maxParallelSessions: number
    retryBudget: number
  }
}

export type AgentConfig = NobieConfig | SubAgentConfig

export interface TeamConfig {
  schemaVersion: ContractSchemaVersion
  teamId: string
  displayName: string
  nickname?: string
  status: Exclude<AgentStatus, "degraded">
  purpose: string
  memberAgentIds: string[]
  roleHints: string[]
  profileVersion: number
  createdAt: number
  updatedAt: number
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
  agentId: string
  agentDisplayName: string
  agentNickname?: string
  commandRequestId: string
  status: SubSessionStatus
  retryBudgetRemaining: number
  promptBundleId: string
  promptBundleSnapshot?: AgentPromptBundle
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
    status: "planned" | "degraded"
    plannerVersion: string
    timedOut: boolean
    semanticComparisonUsed: false
    reasonCodes: string[]
    candidateScores: Array<{
      agentId: string
      teamIds: string[]
      score: number
      selected: boolean
      reasonCodes: string[]
      excludedReasonCodes: string[]
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
  taskScope: StructuredTaskScope
  safetyRules: string[]
  sourceProvenance: Array<{ sourceId: string; version: string; checksum?: string }>
  fragments?: AgentPromptFragment[]
  validation?: AgentPromptBundleValidationSummary
  cacheKey?: string
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
  | "completion_criteria"
  | "prompt_source"
  | "imported_profile"
  | "safety_rule"

export type AgentPromptFragmentStatus = "active" | "inactive" | "blocked"

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
  status: SubSessionStatus
  summary: string
  at: number
}

export interface ResultReport {
  identity: RuntimeIdentity
  resultReportId: string
  parentRunId: string
  subSessionId: string
  status: "completed" | "needs_revision" | "failed"
  outputs: Array<{ outputId: string; status: "satisfied" | "missing" | "partial"; value?: JsonValue }>
  evidence: Array<{ evidenceId: string; kind: string; sourceRef: string; sourceTimestamp?: string }>
  artifacts: Array<{ artifactId: string; kind: string; path?: string }>
  risksOrGaps: string[]
}

export interface FeedbackRequest {
  identity: RuntimeIdentity
  feedbackRequestId: string
  parentRunId: string
  subSessionId: string
  missingItems: string[]
  requiredChanges: string[]
  additionalContextRefs: string[]
  expectedRevisionOutputs: ExpectedOutputContract[]
  retryBudgetRemaining: number
  reasonCode: string
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
  purpose: string
  allowedUse: "temporary_context" | "memory_candidate" | "verification_only"
  retentionPolicy: DataExchangeRetentionPolicy
  redactionState: "redacted" | "not_sensitive" | "blocked"
  provenanceRefs: string[]
  payload: JsonObject
  expiresAt?: number | null
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
  status: "requested" | "approved" | "denied" | "completed" | "failed"
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

function hasNonEmptyString(record: Record<string, unknown>, key: string, path: string, issues: ContractValidationIssue[]): boolean {
  if (typeof record[key] === "string" && record[key].trim()) return true
  addIssue(issues, `${path}.${key}`, `${key} must be a non-empty string.`)
  return false
}

function hasArray(record: Record<string, unknown>, key: string, path: string, issues: ContractValidationIssue[]): boolean {
  if (Array.isArray(record[key])) return true
  addIssue(issues, `${path}.${key}`, `${key} must be an array.`)
  return false
}

function validateRuntimeIdentity(value: unknown, path: string, issues: ContractValidationIssue[]): boolean {
  if (!isRecord(value)) {
    addIssue(issues, path, "identity must be an object.")
    return false
  }
  if (value.schemaVersion !== CONTRACT_SCHEMA_VERSION) addIssue(issues, `${path}.schemaVersion`, "Unsupported contract schema version.")
  hasNonEmptyString(value, "entityType", path, issues)
  hasNonEmptyString(value, "entityId", path, issues)
  hasNonEmptyString(value, "idempotencyKey", path, issues)
  if (!isRecord(value.owner)) addIssue(issues, `${path}.owner`, "owner must be an object.")
  return true
}

export function validateAgentConfig(value: unknown): ContractValidationResult<AgentConfig> {
  const issues: ContractValidationIssue[] = []
  if (!isRecord(value)) {
    return { ok: false, issues: [{ path: "$", code: "contract_validation_failed", message: "Agent config must be an object." }] }
  }
  if (value.schemaVersion !== CONTRACT_SCHEMA_VERSION) addIssue(issues, "$.schemaVersion", "Unsupported contract schema version.")
  if (value.agentType !== "nobie" && value.agentType !== "sub_agent") {
    addIssue(issues, "$.agentType", "agentType must be nobie or sub_agent.")
  }
  hasNonEmptyString(value, "agentId", "$", issues)
  hasNonEmptyString(value, "displayName", "$", issues)
  hasNonEmptyString(value, "role", "$", issues)
  hasNonEmptyString(value, "personality", "$", issues)
  hasArray(value, "specialtyTags", "$", issues)
  hasArray(value, "avoidTasks", "$", issues)
  if (!isRecord(value.memoryPolicy)) addIssue(issues, "$.memoryPolicy", "memoryPolicy must be an object.")
  if (!isRecord(value.capabilityPolicy)) addIssue(issues, "$.capabilityPolicy", "capabilityPolicy must be an object.")
  if (value.agentType === "nobie" && !isRecord(value.coordinator)) addIssue(issues, "$.coordinator", "nobie agent requires coordinator settings.")
  if (value.agentType === "sub_agent") {
    hasArray(value, "teamIds", "$", issues)
    if (!isRecord(value.delegation)) addIssue(issues, "$.delegation", "sub_agent requires delegation settings.")
  }
  if (value.agentType !== "sub_agent" && ("teamIds" in value || "delegation" in value)) {
    addIssue(issues, "$.agentType", "Only sub_agent configs can include teamIds or delegation settings.")
  }
  return issues.length === 0 ? { ok: true, value: value as unknown as AgentConfig, issues: [] } : { ok: false, issues }
}

export function validateTeamConfig(value: unknown): ContractValidationResult<TeamConfig> {
  const issues: ContractValidationIssue[] = []
  if (!isRecord(value)) {
    return { ok: false, issues: [{ path: "$", code: "contract_validation_failed", message: "Team config must be an object." }] }
  }
  if (value.schemaVersion !== CONTRACT_SCHEMA_VERSION) addIssue(issues, "$.schemaVersion", "Unsupported contract schema version.")
  hasNonEmptyString(value, "teamId", "$", issues)
  hasNonEmptyString(value, "displayName", "$", issues)
  hasNonEmptyString(value, "purpose", "$", issues)
  hasArray(value, "memberAgentIds", "$", issues)
  hasArray(value, "roleHints", "$", issues)
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
    if (forbidden in value) addIssue(issues, `$.${forbidden}`, "Teams cannot directly own tools, skills, MCP servers, or permission profiles.")
  }
  return issues.length === 0 ? { ok: true, value: value as unknown as TeamConfig, issues: [] } : { ok: false, issues }
}

export function validateOrchestrationPlan(value: unknown): ContractValidationResult<OrchestrationPlan> {
  const issues: ContractValidationIssue[] = []
  if (!isRecord(value)) {
    return { ok: false, issues: [{ path: "$", code: "contract_validation_failed", message: "OrchestrationPlan must be an object." }] }
  }
  validateRuntimeIdentity(value.identity, "$.identity", issues)
  hasNonEmptyString(value, "planId", "$", issues)
  hasNonEmptyString(value, "parentRunId", "$", issues)
  hasNonEmptyString(value, "parentRequestId", "$", issues)
  hasArray(value, "directNobieTasks", "$", issues)
  hasArray(value, "delegatedTasks", "$", issues)
  hasArray(value, "dependencyEdges", "$", issues)
  hasArray(value, "resourceLocks", "$", issues)
  hasArray(value, "parallelGroups", "$", issues)
  hasArray(value, "approvalRequirements", "$", issues)
  if (!isRecord(value.fallbackStrategy)) addIssue(issues, "$.fallbackStrategy", "fallbackStrategy must be an object.")
  return issues.length === 0 ? { ok: true, value: value as unknown as OrchestrationPlan, issues: [] } : { ok: false, issues }
}

export function validateAgentPromptBundle(value: unknown): ContractValidationResult<AgentPromptBundle> {
  const issues: ContractValidationIssue[] = []
  if (!isRecord(value)) {
    return { ok: false, issues: [{ path: "$", code: "contract_validation_failed", message: "AgentPromptBundle must be an object." }] }
  }
  validateRuntimeIdentity(value.identity, "$.identity", issues)
  hasNonEmptyString(value, "bundleId", "$", issues)
  hasNonEmptyString(value, "agentId", "$", issues)
  hasNonEmptyString(value, "role", "$", issues)
  hasNonEmptyString(value, "displayNameSnapshot", "$", issues)
  hasNonEmptyString(value, "personalitySnapshot", "$", issues)
  if (!isRecord(value.memoryPolicy)) addIssue(issues, "$.memoryPolicy", "memoryPolicy must be an object.")
  if (!isRecord(value.capabilityPolicy)) addIssue(issues, "$.capabilityPolicy", "capabilityPolicy must be an object.")
  if (!isRecord(value.taskScope)) addIssue(issues, "$.taskScope", "taskScope must be an object.")
  hasArray(value, "safetyRules", "$", issues)
  hasArray(value, "sourceProvenance", "$", issues)
  if (Array.isArray(value.safetyRules) && value.safetyRules.length === 0) {
    addIssue(issues, "$.safetyRules", "safetyRules must include at least one safety boundary.")
  }
  if (Array.isArray(value.sourceProvenance) && value.sourceProvenance.length === 0) {
    addIssue(issues, "$.sourceProvenance", "sourceProvenance must include at least one prompt/profile source.")
  }
  if (typeof value.agentType !== "string" || (value.agentType !== "nobie" && value.agentType !== "sub_agent")) {
    addIssue(issues, "$.agentType", "agentType must be nobie or sub_agent.")
  }
  return issues.length === 0 ? { ok: true, value: value as unknown as AgentPromptBundle, issues: [] } : { ok: false, issues }
}
