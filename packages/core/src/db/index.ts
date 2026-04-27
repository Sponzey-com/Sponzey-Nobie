import { existsSync, mkdirSync } from "node:fs"
import { dirname, join } from "node:path"
import BetterSqlite3 from "better-sqlite3"
import { PATHS } from "../config/index.js"
import {
  type ScheduleContract,
  buildDeliveryKey,
  buildPayloadHash,
  buildScheduleIdentityKey,
  formatContractValidationFailureForUser,
  toCanonicalJson,
  validateScheduleContract,
} from "../contracts/index.js"
import {
  type AgentConfig,
  type AgentEntityType,
  type AgentRelationship,
  type AgentStatus,
  type CapabilityDelegationRequest,
  type CapabilityPolicy,
  type CapabilityRiskLevel,
  type DataExchangePackage,
  type HistoryVersion,
  type LearningEvent,
  type OwnerScope,
  type PermissionProfile,
  type RestoreEvent,
  SUB_AGENT_CONTRACT_SCHEMA_VERSION,
  type SubSessionContract,
  type TeamConfig,
  type TeamConflictPolicyMode,
  type TeamExecutionPlan,
  type TeamMembership,
  type TeamResultPolicyMode,
  normalizeNickname,
  normalizeNicknameSnapshot,
} from "../contracts/sub-agent-orchestration.js"
import type {
  PromptSourceMetadata,
  PromptSourceSnapshot,
  PromptSourceState,
} from "../memory/nobie-md.js"
import { assertMigrationWriteAllowed } from "./migration-safety.js"
import { createPreMigrationBackupIfNeeded, runMigrations } from "./migrations.js"

let _db: BetterSqlite3.Database | null = null

export function getDb(): BetterSqlite3.Database {
  if (_db) return _db

  mkdirSync(dirname(PATHS.dbFile), { recursive: true })

  const dbExisted = existsSync(PATHS.dbFile)
  _db = new BetterSqlite3(PATHS.dbFile)
  _db.pragma("journal_mode = WAL")
  _db.pragma("foreign_keys = ON")
  _db.pragma("synchronous = NORMAL")

  const backupSnapshotId = dbExisted
    ? createPreMigrationBackupIfNeeded(_db, PATHS.dbFile, join(PATHS.stateDir, "backups", "db"))
    : null
  runMigrations(_db, { backupSnapshotId, lockedBy: `gateway:${process.pid}` })
  reconcileSubAgentStorageDerivedFields(_db)
  return _db
}

export function closeDb(): void {
  _db?.close()
  _db = null
}

// Typed helpers

export interface DbSession {
  id: string
  source: string
  source_id: string | null
  created_at: number
  updated_at: number
  summary: string | null
  token_count: number
}

export interface DbMessage {
  id: string
  session_id: string
  root_run_id?: string | null
  role: string
  content: string
  tool_calls: string | null
  tool_call_id: string | null
  created_at: number
}

export interface DbRequestGroupMessage extends DbMessage {
  run_prompt: string | null
  run_request_group_id: string | null
  run_worker_session_id: string | null
  run_context_mode: string | null
}

export interface DbAuditLog {
  id: string
  timestamp: number
  session_id: string | null
  run_id: string | null
  request_group_id: string | null
  channel: string | null
  source: string
  tool_name: string
  params: string | null
  output: string | null
  result: string
  duration_ms: number | null
  approval_required: number
  approved_by: string | null
  error_code: string | null
  retry_count: number | null
  stop_reason: string | null
}

type DbAuditLogInput = Omit<
  DbAuditLog,
  "id" | "run_id" | "request_group_id" | "channel" | "error_code" | "retry_count" | "stop_reason"
> &
  Partial<
    Pick<
      DbAuditLog,
      "run_id" | "request_group_id" | "channel" | "error_code" | "retry_count" | "stop_reason"
    >
  >

export interface DbChannelMessageRef {
  id: string
  source: string
  session_id: string
  root_run_id: string
  request_group_id: string
  external_chat_id: string
  external_thread_id: string | null
  external_message_id: string
  role: string
  created_at: number
}

export interface DbDecisionTrace {
  id: string
  run_id: string | null
  request_group_id: string | null
  session_id: string | null
  source: string | null
  channel: string | null
  decision_kind: string
  reason_code: string
  input_contract_ids_json: string | null
  receipt_ids_json: string | null
  sanitized_detail_json: string | null
  created_at: number
}

export interface DbDecisionTraceInput {
  id?: string
  runId?: string | null
  requestGroupId?: string | null
  sessionId?: string | null
  source?: string | null
  channel?: string | null
  decisionKind: string
  reasonCode: string
  inputContractIds?: string[]
  receiptIds?: string[]
  detail?: Record<string, unknown>
  createdAt?: number
}

export type DbMessageLedgerStatus =
  | "received"
  | "pending"
  | "started"
  | "generated"
  | "sent"
  | "delivered"
  | "succeeded"
  | "failed"
  | "skipped"
  | "suppressed"
  | "degraded"

export interface DbMessageLedgerEvent {
  id: string
  run_id: string | null
  request_group_id: string | null
  session_key: string | null
  thread_key: string | null
  channel: string
  event_kind: string
  delivery_key: string | null
  idempotency_key: string | null
  status: DbMessageLedgerStatus
  summary: string
  detail_json: string | null
  created_at: number
}

export interface DbMessageLedgerInput {
  id?: string
  runId?: string | null
  requestGroupId?: string | null
  sessionKey?: string | null
  threadKey?: string | null
  channel: string
  eventKind: string
  deliveryKey?: string | null
  idempotencyKey?: string | null
  status: DbMessageLedgerStatus
  summary: string
  detail?: Record<string, unknown>
  createdAt?: number
}

export type DbQueueBackpressureEventKind =
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "timeout"
  | "rejected"
  | "retry_scheduled"
  | "dead_letter"
  | "reset"

export interface DbQueueBackpressureEvent {
  id: string
  created_at: number
  queue_name: string
  event_kind: DbQueueBackpressureEventKind
  run_id: string | null
  request_group_id: string | null
  pending_count: number
  retry_count: number
  retry_budget_remaining: number | null
  recovery_key: string | null
  action_taken: string
  detail_json: string | null
}

export interface DbQueueBackpressureEventInput {
  id?: string
  createdAt?: number
  queueName: string
  eventKind: DbQueueBackpressureEventKind
  runId?: string | null
  requestGroupId?: string | null
  pendingCount?: number
  retryCount?: number
  retryBudgetRemaining?: number | null
  recoveryKey?: string | null
  actionTaken: string
  detail?: Record<string, unknown>
}

export interface DbWebRetrievalCacheEntry {
  cache_key: string
  target_hash: string
  source_evidence_id: string
  verdict_id: string
  freshness_policy: "normal" | "latest_approximate" | "strict_timestamp"
  ttl_ms: number
  fetch_timestamp: string
  created_at: number
  expires_at: number
  value_json: string
  evidence_json: string
  verdict_json: string
  metadata_json: string | null
}

export interface DbWebRetrievalCacheEntryInput {
  cacheKey: string
  targetHash: string
  sourceEvidenceId: string
  verdictId: string
  freshnessPolicy: DbWebRetrievalCacheEntry["freshness_policy"]
  ttlMs: number
  fetchTimestamp: string
  createdAt: number
  expiresAt: number
  value: Record<string, unknown>
  evidence: Record<string, unknown>
  verdict: Record<string, unknown>
  metadata?: Record<string, unknown>
}

export type DbConfigSource = "manual" | "import" | "system"

export interface DbAgentConfig {
  agent_id: string
  agent_type: AgentEntityType
  status: AgentStatus
  display_name: string
  nickname: string | null
  normalized_nickname: string | null
  role: string
  personality: string
  specialty_tags_json: string
  avoid_tasks_json: string
  model_profile_json: string | null
  memory_policy_json: string
  capability_policy_json: string
  delegation_policy_json: string | null
  profile_version: number
  config_json: string
  schema_version: number
  source: DbConfigSource
  audit_id: string | null
  idempotency_key: string | null
  created_at: number
  updated_at: number
  archived_at: number | null
}

export interface DbTeamConfig {
  team_id: string
  status: Exclude<AgentStatus, "degraded">
  display_name: string
  nickname: string | null
  normalized_nickname: string | null
  purpose: string
  owner_agent_id: string | null
  lead_agent_id: string | null
  member_count_min: number | null
  member_count_max: number | null
  required_team_roles_json: string | null
  required_capability_tags_json: string | null
  result_policy: TeamResultPolicyMode | null
  conflict_policy: TeamConflictPolicyMode | null
  role_hints_json: string
  member_agent_ids_json: string
  profile_version: number
  config_json: string
  schema_version: number
  source: DbConfigSource
  audit_id: string | null
  idempotency_key: string | null
  created_at: number
  updated_at: number
  archived_at: number | null
}

export interface DbAgentTeamMembership {
  membership_id: string
  team_id: string
  agent_id: string
  owner_agent_id_snapshot: string | null
  team_roles_json: string
  primary_role: string
  required: number
  fallback_for_agent_id: string | null
  status: "active" | "inactive" | "fallback_only" | "unresolved" | "removed"
  role_hint: string | null
  sort_order: number
  schema_version: number
  audit_id: string | null
  created_at: number
  updated_at: number
}

export interface DbNicknameNamespace {
  normalized_nickname: string
  entity_type: "agent" | "team"
  entity_id: string
  nickname_snapshot: string
  status: string
  source: DbConfigSource
  created_at: number
  updated_at: number
}

export interface DbAgentRelationship {
  edge_id: string
  parent_agent_id: string
  child_agent_id: string
  relationship_type: "parent_child"
  status: AgentRelationship["status"]
  sort_order: number
  schema_version: number
  audit_id: string | null
  created_at: number
  updated_at: number
}

export interface DbRunSubSession {
  sub_session_id: string
  parent_run_id: string
  parent_session_id: string
  parent_sub_session_id: string | null
  parent_request_id: string | null
  agent_id: string
  agent_display_name: string
  agent_nickname: string | null
  command_request_id: string
  status: SubSessionContract["status"]
  retry_budget_remaining: number
  prompt_bundle_id: string
  contract_json: string
  schema_version: number
  audit_id: string | null
  idempotency_key: string
  created_at: number
  updated_at: number
  started_at: number | null
  finished_at: number | null
}

export interface DbAgentDataExchange {
  exchange_id: string
  source_owner_type: DataExchangePackage["sourceOwner"]["ownerType"]
  source_owner_id: string
  source_nickname_snapshot: string | null
  recipient_owner_type: DataExchangePackage["recipientOwner"]["ownerType"]
  recipient_owner_id: string
  recipient_nickname_snapshot: string | null
  purpose: string
  allowed_use: DataExchangePackage["allowedUse"]
  retention_policy: DataExchangePackage["retentionPolicy"]
  redaction_state: DataExchangePackage["redactionState"]
  provenance_refs_json: string
  payload_json: string
  contract_json: string | null
  schema_version: number
  audit_id: string | null
  idempotency_key: string
  created_at: number
  updated_at: number
  expires_at: number | null
}

export interface DbTeamExecutionPlan {
  team_execution_plan_id: string
  parent_run_id: string
  team_id: string
  team_nickname_snapshot: string | null
  owner_agent_id: string
  lead_agent_id: string
  member_task_assignments_json: string
  reviewer_agent_ids_json: string
  verifier_agent_ids_json: string
  fallback_assignments_json: string
  coverage_report_json: string
  conflict_policy_snapshot: TeamConflictPolicyMode
  result_policy_snapshot: TeamResultPolicyMode
  contract_json: string
  schema_version: number
  audit_id: string | null
  created_at: number
}

export interface DbCapabilityDelegation {
  delegation_id: string
  requester_owner_type: CapabilityDelegationRequest["requester"]["ownerType"]
  requester_owner_id: string
  provider_owner_type: CapabilityDelegationRequest["provider"]["ownerType"]
  provider_owner_id: string
  capability: string
  risk: CapabilityDelegationRequest["risk"]
  status: CapabilityDelegationRequest["status"]
  input_package_ids_json: string
  result_package_id: string | null
  approval_id: string | null
  contract_json: string
  schema_version: number
  audit_id: string | null
  idempotency_key: string
  created_at: number
  updated_at: number
}

export interface DbLearningEvent {
  learning_event_id: string
  agent_id: string
  learning_target: LearningEvent["learningTarget"]
  before_summary: string
  after_summary: string
  evidence_refs_json: string
  confidence: number
  approval_state: LearningEvent["approvalState"]
  contract_json: string
  schema_version: number
  audit_id: string | null
  idempotency_key: string
  created_at: number
  updated_at: number
}

export interface DbProfileHistoryVersion {
  history_version_id: string
  target_entity_type: HistoryVersion["targetEntityType"]
  target_entity_id: string
  version: number
  before_json: string
  after_json: string
  reason_code: string
  schema_version: number
  audit_id: string | null
  idempotency_key: string
  created_at: number
}

export interface DbProfileRestoreEvent {
  restore_event_id: string
  target_entity_type: RestoreEvent["targetEntityType"]
  target_entity_id: string
  restored_history_version_id: string
  dry_run: number
  effect_summary_json: string
  schema_version: number
  audit_id: string | null
  idempotency_key: string
  created_at: number
}

export type DbCapabilityCatalogStatus = "enabled" | "disabled" | "archived"
export type DbAgentCapabilityBindingStatus = "enabled" | "disabled" | "archived"
export type DbAgentCapabilityKind = "skill" | "mcp_server"

export interface DbSkillCatalogEntry {
  skill_id: string
  status: DbCapabilityCatalogStatus
  display_name: string
  risk: CapabilityRiskLevel
  tool_names_json: string
  metadata_json: string | null
  schema_version: number
  source: DbConfigSource
  audit_id: string | null
  created_at: number
  updated_at: number
  archived_at: number | null
}

export interface DbMcpServerCatalogEntry {
  mcp_server_id: string
  status: DbCapabilityCatalogStatus
  display_name: string
  risk: CapabilityRiskLevel
  tool_names_json: string
  metadata_json: string | null
  schema_version: number
  source: DbConfigSource
  audit_id: string | null
  created_at: number
  updated_at: number
  archived_at: number | null
}

export interface DbAgentCapabilityBinding {
  binding_id: string
  agent_id: string
  capability_kind: DbAgentCapabilityKind
  catalog_id: string
  status: DbAgentCapabilityBindingStatus
  secret_scope_id: string | null
  enabled_tool_names_json: string
  disabled_tool_names_json: string
  permission_profile_json: string | null
  rate_limit_json: string | null
  approval_required_from: CapabilityRiskLevel | null
  schema_version: number
  source: DbConfigSource
  audit_id: string | null
  created_at: number
  updated_at: number
  archived_at: number | null
}

export interface AgentConfigPersistenceOptions {
  imported?: boolean
  source?: DbConfigSource
  auditId?: string | null
  idempotencyKey?: string | null
  now?: number
}

export interface TeamConfigPersistenceOptions extends AgentConfigPersistenceOptions {}

export interface CapabilityCatalogPersistenceOptions {
  source?: DbConfigSource
  auditId?: string | null
  now?: number
}

export interface SkillCatalogEntryInput {
  skillId: string
  displayName: string
  status?: DbCapabilityCatalogStatus
  risk?: CapabilityRiskLevel
  toolNames?: string[]
  metadata?: Record<string, unknown>
  createdAt?: number
  updatedAt?: number
}

export interface McpServerCatalogEntryInput {
  mcpServerId: string
  displayName: string
  status?: DbCapabilityCatalogStatus
  risk?: CapabilityRiskLevel
  toolNames?: string[]
  metadata?: Record<string, unknown>
  createdAt?: number
  updatedAt?: number
}

export interface AgentCapabilityBindingInput {
  bindingId?: string
  agentId: string
  capabilityKind: DbAgentCapabilityKind
  catalogId: string
  status?: DbAgentCapabilityBindingStatus
  secretScopeId?: string
  enabledToolNames?: string[]
  disabledToolNames?: string[]
  permissionProfile?: PermissionProfile
  rateLimit?: CapabilityPolicy["rateLimit"]
  approvalRequiredFrom?: CapabilityRiskLevel
  createdAt?: number
  updatedAt?: number
}

export interface NicknameNamespaceErrorDetails {
  reasonCode: "nickname_required" | "nickname_conflict"
  attemptedEntityType: "agent" | "team"
  attemptedEntityId: string
  nickname: string | null
  normalizedNickname: string
  existingEntityType?: "agent" | "team"
  existingEntityId?: string
  existingNickname?: string | null
  existingStatus?: string
}

export class NicknameNamespaceError extends Error {
  readonly details: NicknameNamespaceErrorDetails

  constructor(details: NicknameNamespaceErrorDetails) {
    const message =
      details.reasonCode === "nickname_conflict"
        ? `Nickname "${details.nickname ?? ""}" is already used by ${details.existingEntityType} ${details.existingEntityId}. Choose a different nickname.`
        : `Nickname is required for ${details.attemptedEntityType} ${details.attemptedEntityId}.`
    super(message)
    this.name = "NicknameNamespaceError"
    this.details = details
  }
}

export type DbControlEventSeverity = "debug" | "info" | "warning" | "error"

export interface DbControlEvent {
  id: string
  created_at: number
  event_type: string
  correlation_id: string
  run_id: string | null
  request_group_id: string | null
  session_key: string | null
  component: string
  severity: DbControlEventSeverity
  summary: string
  detail_json: string | null
}

export interface DbControlEventInput {
  id?: string
  createdAt?: number
  eventType: string
  correlationId: string
  runId?: string | null
  requestGroupId?: string | null
  sessionKey?: string | null
  component: string
  severity?: DbControlEventSeverity
  summary: string
  detail?: Record<string, unknown>
}

export type DbOrchestrationEventSeverity = DbControlEventSeverity

export interface DbOrchestrationEvent {
  sequence: number
  id: string
  created_at: number
  emitted_at: number
  event_kind: string
  run_id: string | null
  parent_run_id: string | null
  request_group_id: string | null
  sub_session_id: string | null
  agent_id: string | null
  team_id: string | null
  exchange_id: string | null
  approval_id: string | null
  correlation_id: string
  dedupe_key: string | null
  source: string
  severity: DbOrchestrationEventSeverity
  summary: string
  payload_redacted_json: string
  payload_raw_ref: string | null
  producer_task: string | null
}

export interface DbOrchestrationEventInput {
  id?: string
  createdAt?: number
  emittedAt?: number
  eventKind: string
  runId?: string | null
  parentRunId?: string | null
  requestGroupId?: string | null
  subSessionId?: string | null
  agentId?: string | null
  teamId?: string | null
  exchangeId?: string | null
  approvalId?: string | null
  correlationId: string
  dedupeKey?: string | null
  source: string
  severity?: DbOrchestrationEventSeverity
  summary: string
  payloadRedacted: Record<string, unknown>
  payloadRawRef?: string | null
  producerTask?: string | null
}

export type DbChannelSmokeRunMode = "dry-run" | "live-run"
export type DbChannelSmokeRunStatus = "running" | "passed" | "failed" | "skipped"
export type DbChannelSmokeStepStatus = "passed" | "failed" | "skipped"

export interface DbChannelSmokeRun {
  id: string
  mode: DbChannelSmokeRunMode
  status: DbChannelSmokeRunStatus
  started_at: number
  finished_at: number | null
  scenario_count: number
  passed_count: number
  failed_count: number
  skipped_count: number
  initiated_by: string | null
  summary: string | null
  metadata_json: string | null
}

export interface DbChannelSmokeStep {
  id: string
  run_id: string
  scenario_id: string
  channel: string
  scenario_kind: string
  status: DbChannelSmokeStepStatus
  reason: string | null
  failures_json: string
  trace_json: string | null
  audit_log_id: string | null
  started_at: number
  finished_at: number
}

export interface DbChannelSmokeRunInput {
  id?: string
  mode: DbChannelSmokeRunMode
  status?: DbChannelSmokeRunStatus
  startedAt?: number
  finishedAt?: number | null
  scenarioCount?: number
  passedCount?: number
  failedCount?: number
  skippedCount?: number
  initiatedBy?: string | null
  summary?: string | null
  metadata?: Record<string, unknown>
}

export interface DbChannelSmokeStepInput {
  id?: string
  runId: string
  scenarioId: string
  channel: string
  scenarioKind: string
  status: DbChannelSmokeStepStatus
  reason?: string | null
  failures?: string[]
  trace?: Record<string, unknown> | null
  auditLogId?: string | null
  startedAt?: number
  finishedAt?: number
}

export interface DbPromptSource {
  source_id: string
  locale: string
  path: string
  version: string
  priority: number
  enabled: number
  is_required: number
  usage_scope: string
  checksum: string
  updated_at: number
}

export interface DbTaskContinuity {
  lineage_root_run_id: string
  parent_run_id: string | null
  handoff_summary: string | null
  last_good_state: string | null
  pending_approvals: string | null
  pending_delivery: string | null
  last_tool_receipt: string | null
  last_delivery_receipt: string | null
  failed_recovery_key: string | null
  failure_kind: string | null
  recovery_budget: string | null
  continuity_status: string | null
  updated_at: number
}

export interface TaskContinuitySnapshot {
  lineageRootRunId: string
  parentRunId?: string
  handoffSummary?: string
  lastGoodState?: string
  pendingApprovals: string[]
  pendingDelivery: string[]
  lastToolReceipt?: string
  lastDeliveryReceipt?: string
  failedRecoveryKey?: string
  failureKind?: string
  recoveryBudget?: string
  status?: string
  updatedAt: number
}

export type DbArtifactRetentionPolicy = "ephemeral" | "standard" | "permanent"

export interface DbArtifactMetadata {
  id: string
  source_run_id: string | null
  request_group_id: string | null
  owner_channel: string
  channel_target: string | null
  artifact_path: string
  mime_type: string
  size_bytes: number | null
  retention_policy: DbArtifactRetentionPolicy
  expires_at: number | null
  metadata_json: string | null
  created_at: number
  updated_at: number
  deleted_at: number | null
}

export interface ArtifactMetadataInput {
  artifactPath: string
  ownerChannel: string
  channelTarget?: string | null
  sourceRunId?: string | null
  requestGroupId?: string | null
  mimeType?: string
  sizeBytes?: number
  retentionPolicy?: DbArtifactRetentionPolicy
  expiresAt?: number | null
  metadata?: Record<string, unknown>
  createdAt?: number
  updatedAt?: number
}

interface PromptSourceStateRow {
  sourceId: string
  locale: "ko" | "en"
  enabled: 0 | 1
}

export function insertSession(session: Omit<DbSession, "token_count">): void {
  const db = getDb()
  db.prepare(
    `INSERT OR REPLACE INTO sessions
     (id, source, source_id, created_at, updated_at, summary)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(
    session.id,
    session.source,
    session.source_id,
    session.created_at,
    session.updated_at,
    session.summary,
  )
}

export function getSession(id: string): DbSession | undefined {
  return getDb().prepare<[string], DbSession>("SELECT * FROM sessions WHERE id = ?").get(id)
}

export function insertMessage(msg: DbMessage): void {
  getDb()
    .prepare(
      `INSERT INTO messages
       (id, session_id, root_run_id, role, content, tool_calls, tool_call_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      msg.id,
      msg.session_id,
      msg.root_run_id ?? null,
      msg.role,
      msg.content,
      msg.tool_calls,
      msg.tool_call_id,
      msg.created_at,
    )
}

export function getMessages(sessionId: string): DbMessage[] {
  return getDb()
    .prepare<[string], DbMessage>(
      "SELECT * FROM messages WHERE session_id = ? ORDER BY created_at ASC",
    )
    .all(sessionId)
}

export function getMessagesForRequestGroup(sessionId: string, requestGroupId: string): DbMessage[] {
  return getDb()
    .prepare<[string, string], DbMessage>(
      `SELECT m.*
       FROM messages m
       JOIN root_runs r ON r.id = m.root_run_id
       WHERE m.session_id = ?
         AND r.request_group_id = ?
       ORDER BY m.created_at ASC`,
    )
    .all(sessionId, requestGroupId)
}

export function getMessagesForRequestGroupWithRunMeta(
  sessionId: string,
  requestGroupId: string,
): DbRequestGroupMessage[] {
  return getDb()
    .prepare<[string, string], DbRequestGroupMessage>(
      `SELECT m.*, r.prompt AS run_prompt, r.request_group_id AS run_request_group_id,
              r.worker_session_id AS run_worker_session_id, r.context_mode AS run_context_mode
       FROM messages m
       JOIN root_runs r ON r.id = m.root_run_id
       WHERE m.session_id = ?
         AND r.request_group_id = ?
       ORDER BY m.created_at ASC`,
    )
    .all(sessionId, requestGroupId)
}

export function getMessagesForRun(sessionId: string, runId: string): DbMessage[] {
  return getDb()
    .prepare<[string, string], DbMessage>(
      `SELECT * FROM messages
       WHERE session_id = ?
         AND root_run_id = ?
       ORDER BY created_at ASC`,
    )
    .all(sessionId, runId)
}

export function insertAuditLog(log: DbAuditLogInput): void {
  const id = crypto.randomUUID()
  getDb()
    .prepare(
      `INSERT INTO audit_logs
       (id, timestamp, session_id, run_id, request_group_id, channel, source, tool_name, params, output, result,
        duration_ms, approval_required, approved_by, error_code, retry_count, stop_reason)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      log.timestamp,
      log.session_id,
      log.run_id ?? null,
      log.request_group_id ?? null,
      log.channel ?? null,
      log.source,
      log.tool_name,
      log.params,
      log.output,
      log.result,
      log.duration_ms,
      log.approval_required,
      log.approved_by,
      log.error_code ?? null,
      log.retry_count ?? null,
      log.stop_reason ?? null,
    )
}

export function insertChannelMessageRef(ref: Omit<DbChannelMessageRef, "id">): string {
  const id = crypto.randomUUID()
  getDb()
    .prepare(
      `INSERT INTO channel_message_refs
       (id, source, session_id, root_run_id, request_group_id, external_chat_id, external_thread_id, external_message_id, role, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      ref.source,
      ref.session_id,
      ref.root_run_id,
      ref.request_group_id,
      ref.external_chat_id,
      ref.external_thread_id,
      ref.external_message_id,
      ref.role,
      ref.created_at,
    )
  return id
}

export function insertDecisionTrace(input: DbDecisionTraceInput): string {
  const id = input.id ?? crypto.randomUUID()
  getDb()
    .prepare(
      `INSERT INTO decision_traces
       (id, run_id, request_group_id, session_id, source, channel, decision_kind, reason_code,
        input_contract_ids_json, receipt_ids_json, sanitized_detail_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      input.runId ?? null,
      input.requestGroupId ?? null,
      input.sessionId ?? null,
      input.source ?? null,
      input.channel ?? null,
      input.decisionKind,
      input.reasonCode,
      input.inputContractIds ? JSON.stringify(input.inputContractIds) : null,
      input.receiptIds ? JSON.stringify(input.receiptIds) : null,
      toJsonOrNull(input.detail),
      input.createdAt ?? Date.now(),
    )
  return id
}

export function insertMessageLedgerEvent(input: DbMessageLedgerInput): string | null {
  const id = input.id ?? crypto.randomUUID()
  try {
    getDb()
      .prepare(
        `INSERT INTO message_ledger
         (id, run_id, request_group_id, session_key, thread_key, channel, event_kind,
          delivery_key, idempotency_key, status, summary, detail_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.runId ?? null,
        input.requestGroupId ?? null,
        input.sessionKey ?? null,
        input.threadKey ?? null,
        input.channel,
        input.eventKind,
        input.deliveryKey ?? null,
        input.idempotencyKey ?? null,
        input.status,
        input.summary,
        toJsonOrNull(input.detail),
        input.createdAt ?? Date.now(),
      )
    return id
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (message.toLowerCase().includes("unique") && message.includes("message_ledger")) {
      return null
    }
    throw error
  }
}

export function getMessageLedgerEventByIdempotencyKey(
  idempotencyKey: string,
): DbMessageLedgerEvent | undefined {
  return getDb()
    .prepare<[string], DbMessageLedgerEvent>(
      `SELECT *
       FROM message_ledger
       WHERE idempotency_key = ?
       ORDER BY created_at DESC
       LIMIT 1`,
    )
    .get(idempotencyKey)
}

export function insertQueueBackpressureEvent(input: DbQueueBackpressureEventInput): string {
  const id = input.id ?? crypto.randomUUID()
  getDb()
    .prepare(
      `INSERT INTO queue_backpressure_events
       (id, created_at, queue_name, event_kind, run_id, request_group_id, pending_count,
        retry_count, retry_budget_remaining, recovery_key, action_taken, detail_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      input.createdAt ?? Date.now(),
      input.queueName,
      input.eventKind,
      input.runId ?? null,
      input.requestGroupId ?? null,
      input.pendingCount ?? 0,
      input.retryCount ?? 0,
      input.retryBudgetRemaining ?? null,
      input.recoveryKey ?? null,
      input.actionTaken,
      toJsonOrNull(input.detail),
    )
  return id
}

export function listQueueBackpressureEvents(
  input: {
    queueName?: string
    eventKind?: DbQueueBackpressureEventKind
    recoveryKey?: string
    limit?: number
  } = {},
): DbQueueBackpressureEvent[] {
  const conditions: string[] = []
  const bindings: unknown[] = []
  if (input.queueName) {
    conditions.push("queue_name = ?")
    bindings.push(input.queueName)
  }
  if (input.eventKind) {
    conditions.push("event_kind = ?")
    bindings.push(input.eventKind)
  }
  if (input.recoveryKey) {
    conditions.push("recovery_key = ?")
    bindings.push(input.recoveryKey)
  }
  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : ""
  const limit = Math.max(1, Math.min(500, Math.floor(input.limit ?? 100)))
  return getDb()
    .prepare<[...unknown[], number], DbQueueBackpressureEvent>(
      `SELECT * FROM queue_backpressure_events ${where} ORDER BY created_at DESC, id DESC LIMIT ?`,
    )
    .all(...bindings, limit)
}

export function listMessageLedgerEvents(
  params: {
    runId?: string
    requestGroupId?: string
    sessionKey?: string
    threadKey?: string
    limit?: number
  } = {},
): DbMessageLedgerEvent[] {
  const where: string[] = []
  const values: (string | number)[] = []

  if (params.runId) {
    where.push("run_id = ?")
    values.push(params.runId)
  }
  if (params.requestGroupId) {
    where.push("request_group_id = ?")
    values.push(params.requestGroupId)
  }
  if (params.sessionKey) {
    where.push("session_key = ?")
    values.push(params.sessionKey)
  }
  if (params.threadKey) {
    where.push("thread_key = ?")
    values.push(params.threadKey)
  }

  const limit = Math.max(1, Math.min(1000, Math.floor(params.limit ?? 500)))
  values.push(limit)
  const whereSql = where.length > 0 ? `WHERE ${where.join(" AND ")}` : ""

  return getDb()
    .prepare<(string | number)[], DbMessageLedgerEvent>(
      `SELECT *
       FROM message_ledger
       ${whereSql}
       ORDER BY created_at ASC, id ASC
       LIMIT ?`,
    )
    .all(...values)
}

export function insertControlEvent(input: DbControlEventInput): string {
  const id = input.id ?? crypto.randomUUID()
  getDb()
    .prepare(
      `INSERT INTO control_events
       (id, created_at, event_type, correlation_id, run_id, request_group_id, session_key,
        component, severity, summary, detail_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      input.createdAt ?? Date.now(),
      input.eventType,
      input.correlationId,
      input.runId ?? null,
      input.requestGroupId ?? null,
      input.sessionKey ?? null,
      input.component,
      input.severity ?? "info",
      input.summary,
      toJsonOrNull(input.detail),
    )
  return id
}

export function listControlEvents(
  params: {
    runId?: string
    requestGroupId?: string
    correlationId?: string
    eventType?: string
    component?: string
    severity?: DbControlEventSeverity
    limit?: number
  } = {},
): DbControlEvent[] {
  const where: string[] = []
  const values: (string | number)[] = []

  if (params.runId) {
    where.push("run_id = ?")
    values.push(params.runId)
  }
  if (params.requestGroupId) {
    where.push("request_group_id = ?")
    values.push(params.requestGroupId)
  }
  if (params.correlationId) {
    where.push("correlation_id = ?")
    values.push(params.correlationId)
  }
  if (params.eventType) {
    where.push("event_type = ?")
    values.push(params.eventType)
  }
  if (params.component) {
    where.push("component = ?")
    values.push(params.component)
  }
  if (params.severity) {
    where.push("severity = ?")
    values.push(params.severity)
  }

  const limit = Math.max(1, Math.min(2_000, Math.floor(params.limit ?? 500)))
  values.push(limit)
  const whereSql = where.length > 0 ? `WHERE ${where.join(" AND ")}` : ""

  return getDb()
    .prepare<(string | number)[], DbControlEvent>(
      `SELECT *
       FROM control_events
       ${whereSql}
       ORDER BY created_at ASC, id ASC
       LIMIT ?`,
    )
    .all(...values)
}

export function insertOrchestrationEvent(input: DbOrchestrationEventInput): DbOrchestrationEvent {
  const id = input.id ?? crypto.randomUUID()
  const createdAt = input.createdAt ?? Date.now()
  const emittedAt = input.emittedAt ?? createdAt
  const db = getDb()
  try {
    db.prepare(
      `INSERT INTO orchestration_events
       (id, created_at, emitted_at, event_kind, run_id, parent_run_id, request_group_id,
        sub_session_id, agent_id, team_id, exchange_id, approval_id, correlation_id,
        dedupe_key, source, severity, summary, payload_redacted_json, payload_raw_ref, producer_task)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      createdAt,
      emittedAt,
      input.eventKind,
      input.runId ?? null,
      input.parentRunId ?? null,
      input.requestGroupId ?? null,
      input.subSessionId ?? null,
      input.agentId ?? null,
      input.teamId ?? null,
      input.exchangeId ?? null,
      input.approvalId ?? null,
      input.correlationId,
      input.dedupeKey ?? null,
      input.source,
      input.severity ?? "info",
      input.summary,
      JSON.stringify(input.payloadRedacted),
      input.payloadRawRef ?? null,
      input.producerTask ?? null,
    )
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (message.toLowerCase().includes("unique") && message.includes("orchestration_events")) {
      const existing =
        (input.dedupeKey ? getOrchestrationEventByDedupeKey(input.dedupeKey) : undefined) ??
        getOrchestrationEventById(id)
      if (existing) return existing
    }
    throw error
  }
  const inserted = getOrchestrationEventById(id)
  if (!inserted) throw new Error(`orchestration event insert failed: ${id}`)
  return inserted
}

export function getOrchestrationEventById(id: string): DbOrchestrationEvent | undefined {
  return getDb()
    .prepare<[string], DbOrchestrationEvent>(
      `SELECT *
       FROM orchestration_events
       WHERE id = ?
       LIMIT 1`,
    )
    .get(id)
}

export function getOrchestrationEventByDedupeKey(
  dedupeKey: string,
): DbOrchestrationEvent | undefined {
  return getDb()
    .prepare<[string], DbOrchestrationEvent>(
      `SELECT *
       FROM orchestration_events
       WHERE dedupe_key = ?
       ORDER BY sequence ASC
       LIMIT 1`,
    )
    .get(dedupeKey)
}

export function listOrchestrationEvents(
  params: {
    runId?: string
    requestGroupId?: string
    subSessionId?: string
    agentId?: string
    teamId?: string
    exchangeId?: string
    approvalId?: string
    correlationId?: string
    eventKind?: string
    afterSequence?: number
    limit?: number
  } = {},
): DbOrchestrationEvent[] {
  const where: string[] = []
  const values: (string | number)[] = []

  if (params.runId) {
    where.push("run_id = ?")
    values.push(params.runId)
  }
  if (params.requestGroupId) {
    where.push("request_group_id = ?")
    values.push(params.requestGroupId)
  }
  if (params.subSessionId) {
    where.push("sub_session_id = ?")
    values.push(params.subSessionId)
  }
  if (params.agentId) {
    where.push("agent_id = ?")
    values.push(params.agentId)
  }
  if (params.teamId) {
    where.push("team_id = ?")
    values.push(params.teamId)
  }
  if (params.exchangeId) {
    where.push("exchange_id = ?")
    values.push(params.exchangeId)
  }
  if (params.approvalId) {
    where.push("approval_id = ?")
    values.push(params.approvalId)
  }
  if (params.correlationId) {
    where.push("correlation_id = ?")
    values.push(params.correlationId)
  }
  if (params.eventKind) {
    where.push("event_kind = ?")
    values.push(params.eventKind)
  }
  if (params.afterSequence !== undefined) {
    where.push("sequence > ?")
    values.push(Math.max(0, Math.floor(params.afterSequence)))
  }

  const limit = Math.max(1, Math.min(2_000, Math.floor(params.limit ?? 500)))
  values.push(limit)
  const whereSql = where.length > 0 ? `WHERE ${where.join(" AND ")}` : ""

  return getDb()
    .prepare<(string | number)[], DbOrchestrationEvent>(
      `SELECT *
       FROM orchestration_events
       ${whereSql}
       ORDER BY sequence ASC
       LIMIT ?`,
    )
    .all(...values)
}

export function upsertWebRetrievalCacheEntry(input: DbWebRetrievalCacheEntryInput): void {
  getDb()
    .prepare(
      `INSERT INTO web_retrieval_cache
       (cache_key, target_hash, source_evidence_id, verdict_id, freshness_policy, ttl_ms,
        fetch_timestamp, created_at, expires_at, value_json, evidence_json, verdict_json, metadata_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(cache_key) DO UPDATE SET
         target_hash = excluded.target_hash,
         source_evidence_id = excluded.source_evidence_id,
         verdict_id = excluded.verdict_id,
         freshness_policy = excluded.freshness_policy,
         ttl_ms = excluded.ttl_ms,
         fetch_timestamp = excluded.fetch_timestamp,
         created_at = excluded.created_at,
         expires_at = excluded.expires_at,
         value_json = excluded.value_json,
         evidence_json = excluded.evidence_json,
         verdict_json = excluded.verdict_json,
         metadata_json = excluded.metadata_json`,
    )
    .run(
      input.cacheKey,
      input.targetHash,
      input.sourceEvidenceId,
      input.verdictId,
      input.freshnessPolicy,
      input.ttlMs,
      input.fetchTimestamp,
      input.createdAt,
      input.expiresAt,
      JSON.stringify(input.value),
      JSON.stringify(input.evidence),
      JSON.stringify(input.verdict),
      toJsonOrNull(input.metadata),
    )
}

export function getWebRetrievalCacheEntry(cacheKey: string): DbWebRetrievalCacheEntry | undefined {
  return getDb()
    .prepare<[string], DbWebRetrievalCacheEntry>(
      `SELECT * FROM web_retrieval_cache WHERE cache_key = ? LIMIT 1`,
    )
    .get(cacheKey)
}

export function listWebRetrievalCacheEntries(
  params: {
    targetHash?: string
    freshnessPolicy?: DbWebRetrievalCacheEntry["freshness_policy"]
    now?: number
    limit?: number
  } = {},
): DbWebRetrievalCacheEntry[] {
  const where: string[] = []
  const values: (string | number)[] = []
  if (params.targetHash) {
    where.push("target_hash = ?")
    values.push(params.targetHash)
  }
  if (params.freshnessPolicy) {
    where.push("freshness_policy = ?")
    values.push(params.freshnessPolicy)
  }
  if (params.now !== undefined) {
    where.push("expires_at >= ?")
    values.push(params.now)
  }
  const limit = Math.max(1, Math.min(200, Math.floor(params.limit ?? 20)))
  values.push(limit)
  const whereSql = where.length > 0 ? `WHERE ${where.join(" AND ")}` : ""
  return getDb()
    .prepare<(string | number)[], DbWebRetrievalCacheEntry>(
      `SELECT * FROM web_retrieval_cache
       ${whereSql}
       ORDER BY expires_at DESC, created_at DESC
       LIMIT ?`,
    )
    .all(...values)
}

export function findChannelMessageRef(params: {
  source: string
  externalChatId: string
  externalMessageId: string
  externalThreadId?: string
}): DbChannelMessageRef | undefined {
  const withThread = params.externalThreadId
    ? getDb()
        .prepare<[string, string, string, string], DbChannelMessageRef>(
          `SELECT *
           FROM channel_message_refs
           WHERE source = ?
             AND external_chat_id = ?
             AND external_message_id = ?
             AND (external_thread_id = ? OR external_thread_id IS NULL)
           ORDER BY created_at DESC
           LIMIT 1`,
        )
        .get(
          params.source,
          params.externalChatId,
          params.externalMessageId,
          params.externalThreadId,
        )
    : undefined

  if (withThread) return withThread

  return getDb()
    .prepare<[string, string, string], DbChannelMessageRef>(
      `SELECT *
       FROM channel_message_refs
       WHERE source = ?
         AND external_chat_id = ?
         AND external_message_id = ?
       ORDER BY created_at DESC
       LIMIT 1`,
    )
    .get(params.source, params.externalChatId, params.externalMessageId)
}

export function findLatestChannelMessageRefForThread(params: {
  source: string
  externalChatId: string
  externalThreadId?: string
}): DbChannelMessageRef | undefined {
  if (params.externalThreadId !== undefined) {
    return getDb()
      .prepare<[string, string, string], DbChannelMessageRef>(
        `SELECT *
         FROM channel_message_refs
         WHERE source = ?
           AND external_chat_id = ?
           AND external_thread_id = ?
           AND role IN ('assistant', 'tool')
         ORDER BY created_at DESC
         LIMIT 1`,
      )
      .get(params.source, params.externalChatId, params.externalThreadId)
  }

  return getDb()
    .prepare<[string, string], DbChannelMessageRef>(
      `SELECT *
       FROM channel_message_refs
       WHERE source = ?
         AND external_chat_id = ?
         AND external_thread_id IS NULL
         AND role IN ('assistant', 'tool')
       ORDER BY created_at DESC
       LIMIT 1`,
    )
    .get(params.source, params.externalChatId)
}

export function insertChannelSmokeRun(input: DbChannelSmokeRunInput): string {
  const id = input.id ?? crypto.randomUUID()
  const startedAt = input.startedAt ?? Date.now()
  getDb()
    .prepare(
      `INSERT INTO channel_smoke_runs
       (id, mode, status, started_at, finished_at, scenario_count, passed_count, failed_count, skipped_count, initiated_by, summary, metadata_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      input.mode,
      input.status ?? "running",
      startedAt,
      input.finishedAt ?? null,
      input.scenarioCount ?? 0,
      input.passedCount ?? 0,
      input.failedCount ?? 0,
      input.skippedCount ?? 0,
      input.initiatedBy ?? null,
      input.summary ?? null,
      toJsonOrNull(input.metadata),
    )
  return id
}

export function updateChannelSmokeRun(
  id: string,
  fields: Partial<
    Pick<
      DbChannelSmokeRunInput,
      | "status"
      | "finishedAt"
      | "scenarioCount"
      | "passedCount"
      | "failedCount"
      | "skippedCount"
      | "summary"
      | "metadata"
    >
  >,
): void {
  const sets: string[] = []
  const values: unknown[] = []
  const push = (column: string, value: unknown) => {
    sets.push(`${column} = ?`)
    values.push(value)
  }

  if (fields.status !== undefined) push("status", fields.status)
  if (fields.finishedAt !== undefined) push("finished_at", fields.finishedAt)
  if (fields.scenarioCount !== undefined) push("scenario_count", fields.scenarioCount)
  if (fields.passedCount !== undefined) push("passed_count", fields.passedCount)
  if (fields.failedCount !== undefined) push("failed_count", fields.failedCount)
  if (fields.skippedCount !== undefined) push("skipped_count", fields.skippedCount)
  if (fields.summary !== undefined) push("summary", fields.summary)
  if (fields.metadata !== undefined) push("metadata_json", toJsonOrNull(fields.metadata))
  if (sets.length === 0) return

  values.push(id)
  getDb()
    .prepare(`UPDATE channel_smoke_runs SET ${sets.join(", ")} WHERE id = ?`)
    .run(...values)
}

export function insertChannelSmokeStep(input: DbChannelSmokeStepInput): string {
  const id = input.id ?? crypto.randomUUID()
  const startedAt = input.startedAt ?? Date.now()
  const finishedAt = input.finishedAt ?? startedAt
  getDb()
    .prepare(
      `INSERT INTO channel_smoke_steps
       (id, run_id, scenario_id, channel, scenario_kind, status, reason, failures_json, trace_json, audit_log_id, started_at, finished_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      input.runId,
      input.scenarioId,
      input.channel,
      input.scenarioKind,
      input.status,
      input.reason ?? null,
      JSON.stringify(input.failures ?? []),
      input.trace ? JSON.stringify(input.trace) : null,
      input.auditLogId ?? null,
      startedAt,
      finishedAt,
    )
  return id
}

export function getChannelSmokeRun(id: string): DbChannelSmokeRun | undefined {
  return getDb()
    .prepare<[string], DbChannelSmokeRun>("SELECT * FROM channel_smoke_runs WHERE id = ?")
    .get(id)
}

export function listChannelSmokeRuns(limit = 20): DbChannelSmokeRun[] {
  return getDb()
    .prepare<[number], DbChannelSmokeRun>(
      `SELECT * FROM channel_smoke_runs
       ORDER BY started_at DESC
       LIMIT ?`,
    )
    .all(Math.max(1, Math.min(limit, 200)))
}

export function listChannelSmokeSteps(runId: string): DbChannelSmokeStep[] {
  return getDb()
    .prepare<[string], DbChannelSmokeStep>(
      `SELECT * FROM channel_smoke_steps
       WHERE run_id = ?
       ORDER BY started_at ASC, id ASC`,
    )
    .all(runId)
}

export function upsertPromptSources(sources: PromptSourceMetadata[]): void {
  if (sources.length === 0) return
  const now = Date.now()
  const db = getDb()
  const insert = db.prepare(
    `INSERT INTO prompt_sources
     (source_id, locale, path, version, priority, enabled, is_required, usage_scope, checksum, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(source_id, locale) DO UPDATE SET
       path = excluded.path,
       version = excluded.version,
       priority = excluded.priority,
       enabled = CASE WHEN excluded.is_required = 1 THEN 1 ELSE prompt_sources.enabled END,
       is_required = excluded.is_required,
       usage_scope = excluded.usage_scope,
       checksum = excluded.checksum,
       updated_at = excluded.updated_at`,
  )
  const tx = db.transaction(() => {
    for (const source of sources) {
      insert.run(
        source.sourceId,
        source.locale,
        source.path,
        source.version,
        source.priority,
        source.enabled ? 1 : 0,
        source.required ? 1 : 0,
        source.usageScope,
        source.checksum,
        now,
      )
    }
  })
  tx()
}

export function updateRunPromptSourceSnapshot(runId: string, snapshot: PromptSourceSnapshot): void {
  getDb()
    .prepare(`UPDATE root_runs SET prompt_source_snapshot = ?, updated_at = ? WHERE id = ?`)
    .run(JSON.stringify(snapshot), Date.now(), runId)
}

export function getPromptSourceStates(): PromptSourceState[] {
  return getDb()
    .prepare<[], PromptSourceStateRow>(
      `SELECT source_id AS sourceId, locale, enabled
       FROM prompt_sources`,
    )
    .all()
    .map((row) => ({
      sourceId: row.sourceId,
      locale: row.locale,
      enabled: row.enabled === 1,
    }))
}

// ── Memory Items ───────────────────────────────────────────────────────────

export type MemoryScope =
  | "global"
  | "session"
  | "task"
  | "artifact"
  | "diagnostic"
  | "long-term"
  | "short-term"
  | "schedule"
  | "flash-feedback"

export interface DbMemoryItem {
  id: string
  content: string
  tags: string | null // JSON array
  source: string | null
  memory_scope: MemoryScope | null
  session_id: string | null
  run_id: string | null
  request_group_id: string | null
  type: string | null // "user_fact" | "session_summary" | "project_note"
  importance: string | null // "low" | "medium" | "high"
  embedding: Buffer | null
  created_at: number
  updated_at: number
}

export interface DbMemoryDocument {
  id: string
  scope: MemoryScope
  owner_id: string
  source_type: string
  source_ref: string | null
  title: string | null
  raw_text: string
  checksum: string
  metadata_json: string | null
  archived_at: number | null
  created_at: number
  updated_at: number
}

export interface DbMemoryChunk {
  id: string
  document_id: string
  scope: MemoryScope
  owner_id: string
  ordinal: number
  token_estimate: number
  content: string
  checksum: string
  source_checksum: string | null
  metadata_json: string | null
  created_at: number
  updated_at: number
}

export type MemoryIndexJobStatus =
  | "queued"
  | "indexing"
  | "embedded"
  | "failed"
  | "stale"
  | "disabled"

export type MemoryWritebackStatus = "pending" | "writing" | "failed" | "completed" | "discarded"

export interface DbMemoryWritebackCandidate {
  id: string
  scope: MemoryScope
  owner_id: string
  source_type: string
  content: string
  metadata_json: string | null
  status: MemoryWritebackStatus
  retry_count: number
  last_error: string | null
  run_id: string | null
  created_at: number
  updated_at: number
}

export interface DbMemoryChunkSearchRow extends DbMemoryChunk {
  document_title: string | null
  document_source_type: string
  document_source_ref: string | null
  document_metadata_json: string | null
  score: number
}

export interface StoreMemoryDocumentInput {
  scope: MemoryScope
  ownerId?: string
  sourceType: string
  sourceRef?: string
  title?: string
  rawText: string
  checksum: string
  metadata?: Record<string, unknown>
  chunks: Array<{
    ordinal: number
    tokenEstimate: number
    content: string
    checksum: string
    metadata?: Record<string, unknown>
  }>
}

export interface StoreMemoryDocumentResult {
  documentId: string
  chunkIds: string[]
  deduplicated: boolean
}

export interface MemorySearchFilters {
  sessionId?: string
  runId?: string
  requestGroupId?: string
  scheduleId?: string
  ownerScope?: OwnerScope
  recipientScope?: OwnerScope
  includeSchedule?: boolean
  includeArtifact?: boolean
  includeDiagnostic?: boolean
  includeFlashFeedback?: boolean
}

function resolveMemoryOwnerId(scope: MemoryScope, ownerId: string | undefined): string {
  if (scope === "global" || scope === "long-term") return ownerId?.trim() || "global"
  const normalized = ownerId?.trim()
  if (!normalized) {
    throw new Error(`${scope} memory requires an owner id`)
  }
  return normalized
}

function toJsonOrNull(value: Record<string, unknown> | undefined): string | null {
  return value ? JSON.stringify(value) : null
}

function toJson(value: unknown): string {
  return toCanonicalJson(value)
}

function toConfigJson(value: unknown): string {
  return toCanonicalJson(value, { dropEmptyArrays: false })
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined
}

function asNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined
}

function asBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
}

function parseJsonRecord(value: string | null | undefined): Record<string, unknown> | undefined {
  if (!value) return undefined
  try {
    const parsed = JSON.parse(value) as unknown
    return isRecord(parsed) ? parsed : undefined
  } catch {
    return undefined
  }
}

function parseJsonStringArray(value: string | null | undefined): string[] {
  if (!value) return []
  try {
    return asStringArray(JSON.parse(value) as unknown)
  } catch {
    return []
  }
}

function jsonStringOrNull(value: unknown): string | null {
  if (value === undefined || value === null) return null
  if (!isRecord(value) && !Array.isArray(value)) return null
  return toJson(value)
}

function tableExists(db: BetterSqlite3.Database, table: string): boolean {
  return Boolean(
    db
      .prepare<[string], { name: string }>(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?",
      )
      .get(table),
  )
}

function tableColumns(db: BetterSqlite3.Database, table: string): Set<string> {
  return new Set(
    (db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map(
      (column) => column.name,
    ),
  )
}

function normalizedNicknameOrNull(value: string | null | undefined): string | null {
  const normalized = normalizeNickname(value ?? "")
  return normalized || null
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values.filter((value) => value.trim().length > 0)))
}

function defaultMembershipId(teamId: string, agentId: string, index: number): string {
  return `${teamId}:membership:${agentId || index + 1}`
}

function deriveDelegationPolicyValue(
  value: Record<string, unknown> | AgentConfig,
): Record<string, unknown> | undefined {
  if (isRecord((value as { delegationPolicy?: unknown }).delegationPolicy)) {
    return (value as { delegationPolicy: Record<string, unknown> }).delegationPolicy
  }
  const legacyDelegation = (value as { delegation?: unknown }).delegation
  if (!isRecord(legacyDelegation)) return undefined
  return {
    enabled: asBoolean(legacyDelegation.enabled) ?? false,
    maxParallelSessions: asNumber(legacyDelegation.maxParallelSessions) ?? 1,
    retryBudget: asNumber(legacyDelegation.retryBudget) ?? 0,
  }
}

function buildPersistedTeamMemberships(config: TeamConfig): TeamMembership[] {
  const next: TeamMembership[] = []
  const memberships = Array.isArray(config.memberships) ? config.memberships : []
  const seenAgentIds = new Set<string>()

  for (const [index, rawMembership] of memberships.entries()) {
    if (!rawMembership?.agentId) continue
    seenAgentIds.add(rawMembership.agentId)
    const primaryRole =
      rawMembership.primaryRole || rawMembership.teamRoles[0] || config.roleHints[index] || "member"
    const teamRoles = uniqueStrings(
      rawMembership.teamRoles.length > 0 ? rawMembership.teamRoles : [primaryRole],
    )
    const membership: TeamMembership = {
      membershipId:
        rawMembership.membershipId ||
        defaultMembershipId(config.teamId, rawMembership.agentId, index),
      teamId: config.teamId,
      agentId: rawMembership.agentId,
      teamRoles: teamRoles.length > 0 ? teamRoles : [primaryRole],
      primaryRole,
      required: rawMembership.required ?? true,
      sortOrder: rawMembership.sortOrder ?? index,
      status: rawMembership.status ?? (config.status === "disabled" ? "inactive" : "active"),
      ...((rawMembership.ownerAgentIdSnapshot ?? config.ownerAgentId)
        ? { ownerAgentIdSnapshot: rawMembership.ownerAgentIdSnapshot ?? config.ownerAgentId! }
        : {}),
      ...(rawMembership.fallbackForAgentId
        ? { fallbackForAgentId: rawMembership.fallbackForAgentId }
        : {}),
    }
    next.push(membership)
  }

  for (const [index, agentId] of config.memberAgentIds.entries()) {
    if (!agentId || seenAgentIds.has(agentId)) continue
    const primaryRole = config.roleHints[index] ?? "member"
    const membership: TeamMembership = {
      membershipId: defaultMembershipId(config.teamId, agentId, next.length),
      teamId: config.teamId,
      agentId,
      teamRoles: [primaryRole],
      primaryRole,
      required: true,
      sortOrder: next.length,
      status: config.status === "disabled" ? "inactive" : "active",
      ...(config.ownerAgentId ? { ownerAgentIdSnapshot: config.ownerAgentId } : {}),
    }
    next.push(membership)
  }

  return next.sort(
    (left, right) => left.sortOrder - right.sortOrder || left.agentId.localeCompare(right.agentId),
  )
}

function persistedTeamShape(input: TeamConfig): TeamConfig {
  const memberships = buildPersistedTeamMemberships(input)
  const ownerAgentId = input.ownerAgentId ?? memberships[0]?.agentId ?? "agent:nobie"
  const leadAgentId = input.leadAgentId ?? memberships[0]?.agentId ?? ownerAgentId
  const memberAgentIds = uniqueStrings([
    ...input.memberAgentIds,
    ...memberships.map((membership) => membership.agentId),
  ])
  const roleHints =
    input.roleHints.length > 0
      ? input.roleHints
      : memberships.map((membership) => membership.primaryRole)
  const requiredTeamRoles = uniqueStrings([
    ...(input.requiredTeamRoles ?? []),
    ...memberships.map((membership) => membership.primaryRole),
  ])
  const memberCountMin =
    input.memberCountMin ?? memberships.filter((membership) => membership.required).length
  const memberCountMax = input.memberCountMax ?? Math.max(memberCountMin, memberships.length)
  return {
    ...input,
    memberAgentIds,
    roleHints,
    ownerAgentId,
    leadAgentId,
    memberCountMin,
    memberCountMax,
    requiredTeamRoles,
    requiredCapabilityTags: input.requiredCapabilityTags ?? [],
    resultPolicy: input.resultPolicy ?? "lead_synthesis",
    conflictPolicy: input.conflictPolicy ?? "lead_decides",
    memberships,
  }
}

function optionalAuditId(
  identityAuditId: string | undefined,
  override: string | null | undefined,
): string | null {
  return override ?? identityAuditId ?? null
}

function syncNicknameNamespace(
  db: BetterSqlite3.Database,
  input: {
    entityType: "agent" | "team"
    entityId: string
    nickname: string | null
    status: string
    source: DbConfigSource
    createdAt: number
    updatedAt: number
  },
): void {
  if (!tableExists(db, "nickname_namespaces")) return

  const normalizedNickname = normalizedNicknameOrNull(input.nickname)
  db.prepare<[string, string]>(
    "DELETE FROM nickname_namespaces WHERE entity_type = ? AND entity_id = ?",
  ).run(input.entityType, input.entityId)
  if (!normalizedNickname) return

  const existing = db
    .prepare<[string], DbNicknameNamespace>(
      "SELECT * FROM nickname_namespaces WHERE normalized_nickname = ?",
    )
    .get(normalizedNickname)
  if (
    existing &&
    (existing.entity_type !== input.entityType || existing.entity_id !== input.entityId)
  ) {
    throw new NicknameNamespaceError({
      reasonCode: "nickname_conflict",
      attemptedEntityType: input.entityType,
      attemptedEntityId: input.entityId,
      nickname: input.nickname,
      normalizedNickname,
      existingEntityType: existing.entity_type,
      existingEntityId: existing.entity_id,
      existingNickname: existing.nickname_snapshot,
      existingStatus: existing.status,
    })
  }

  db.prepare(
    `INSERT INTO nickname_namespaces
     (normalized_nickname, entity_type, entity_id, nickname_snapshot, status, source, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(normalized_nickname) DO UPDATE SET
       entity_type = excluded.entity_type,
       entity_id = excluded.entity_id,
       nickname_snapshot = excluded.nickname_snapshot,
       status = excluded.status,
       source = excluded.source,
       created_at = excluded.created_at,
       updated_at = excluded.updated_at`,
  ).run(
    normalizedNickname,
    input.entityType,
    input.entityId,
    input.nickname ?? normalizedNickname,
    input.status,
    input.source,
    input.createdAt,
    input.updatedAt,
  )
}

function reconcileSubAgentStorageDerivedFields(db: BetterSqlite3.Database): void {
  if (!tableExists(db, "agent_configs") || !tableExists(db, "team_configs")) return

  const agentColumns = tableColumns(db, "agent_configs")
  const teamColumns = tableColumns(db, "team_configs")
  const canSyncNicknameNamespace = tableExists(db, "nickname_namespaces")
  const tx = db.transaction(() => {
    const agentRows = db
      .prepare<[], DbAgentConfig>(
        "SELECT * FROM agent_configs ORDER BY updated_at DESC, agent_id ASC",
      )
      .all()
    for (const row of agentRows) {
      const config = parseJsonRecord(row.config_json)
      const nextNormalizedNickname = normalizedNicknameOrNull(row.nickname)
      const nextModelProfileJson = jsonStringOrNull(config?.["modelProfile"])
      const nextDelegationPolicyJson = jsonStringOrNull(deriveDelegationPolicyValue(config ?? {}))
      if (
        agentColumns.has("normalized_nickname") ||
        agentColumns.has("model_profile_json") ||
        agentColumns.has("delegation_policy_json")
      ) {
        db.prepare(
          `UPDATE agent_configs
           SET normalized_nickname = ?, model_profile_json = ?, delegation_policy_json = ?
           WHERE agent_id = ?`,
        ).run(nextNormalizedNickname, nextModelProfileJson, nextDelegationPolicyJson, row.agent_id)
      }
      if (canSyncNicknameNamespace) {
        try {
          syncNicknameNamespace(db, {
            entityType: "agent",
            entityId: row.agent_id,
            nickname: row.nickname,
            status: row.status,
            source: row.source,
            createdAt: row.created_at,
            updatedAt: row.updated_at,
          })
        } catch (error) {
          if (!(error instanceof NicknameNamespaceError)) throw error
        }
      }
    }

    const teamRows = db
      .prepare<[], DbTeamConfig>("SELECT * FROM team_configs ORDER BY updated_at DESC, team_id ASC")
      .all()
    for (const row of teamRows) {
      const config = parseJsonRecord(row.config_json)
      const memberships = Array.isArray(config?.["memberships"])
        ? (config["memberships"] as unknown[])
        : []
      const memberAgentIds = asStringArray(config?.["memberAgentIds"])
      const fallbackMemberAgentIds =
        memberAgentIds.length > 0 ? memberAgentIds : parseJsonStringArray(row.member_agent_ids_json)
      const roleHints = asStringArray(config?.["roleHints"])
      const fallbackRoleHints =
        roleHints.length > 0 ? roleHints : parseJsonStringArray(row.role_hints_json)
      const ownerAgentId =
        asString(config?.["ownerAgentId"]) ?? fallbackMemberAgentIds[0] ?? "agent:nobie"
      const leadAgentId =
        asString(config?.["leadAgentId"]) ?? fallbackMemberAgentIds[0] ?? ownerAgentId
      const requiredCount =
        memberships.length > 0
          ? memberships.filter((membership) =>
              isRecord(membership) ? (asBoolean(membership["required"]) ?? true) : false,
            ).length
          : fallbackMemberAgentIds.length
      const memberCountMin = asNumber(config?.["memberCountMin"]) ?? requiredCount
      const memberCountMax =
        asNumber(config?.["memberCountMax"]) ??
        Math.max(memberCountMin, fallbackMemberAgentIds.length)
      const requiredTeamRoles = uniqueStrings([
        ...asStringArray(config?.["requiredTeamRoles"]),
        ...fallbackRoleHints,
      ])
      const requiredCapabilityTags = asStringArray(config?.["requiredCapabilityTags"])
      if (teamColumns.has("normalized_nickname") || teamColumns.has("owner_agent_id")) {
        db.prepare(
          `UPDATE team_configs
           SET normalized_nickname = ?, owner_agent_id = ?, lead_agent_id = ?, member_count_min = ?, member_count_max = ?,
               required_team_roles_json = ?, required_capability_tags_json = ?, result_policy = ?, conflict_policy = ?
           WHERE team_id = ?`,
        ).run(
          normalizedNicknameOrNull(row.nickname),
          ownerAgentId,
          leadAgentId,
          memberCountMin,
          memberCountMax,
          toJson(requiredTeamRoles),
          toJson(requiredCapabilityTags),
          asString(config?.["resultPolicy"]) ?? "lead_synthesis",
          asString(config?.["conflictPolicy"]) ?? "lead_decides",
          row.team_id,
        )
      }
      if (canSyncNicknameNamespace) {
        try {
          syncNicknameNamespace(db, {
            entityType: "team",
            entityId: row.team_id,
            nickname: row.nickname,
            status: row.status,
            source: row.source,
            createdAt: row.created_at,
            updatedAt: row.updated_at,
          })
        } catch (error) {
          if (!(error instanceof NicknameNamespaceError)) throw error
        }
      }
    }
  })
  tx()
}

function isUniqueConstraintError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false
  const code = "code" in error ? String((error as { code?: unknown }).code) : ""
  const message = "message" in error ? String((error as { message?: unknown }).message) : ""
  return code === "SQLITE_CONSTRAINT_UNIQUE" || message.includes("UNIQUE constraint failed")
}

function persistenceSource(
  options: Pick<AgentConfigPersistenceOptions, "imported" | "source"> | undefined,
): DbConfigSource {
  if (options?.imported) return "import"
  return options?.source ?? "manual"
}

function agentNickname(input: AgentConfig): string {
  return normalizeNicknameSnapshot(input.nickname ?? "")
}

function teamNickname(input: TeamConfig): string {
  return normalizeNicknameSnapshot(input.nickname ?? "")
}

function persistedAgentConfig(input: AgentConfig, imported: boolean | undefined): AgentConfig {
  const normalizedBase = {
    ...input,
    nickname: agentNickname(input),
  }
  const normalized = (
    normalizedNicknameOrNull(input.nickname)
      ? { ...normalizedBase, normalizedNickname: normalizedNicknameOrNull(input.nickname)! }
      : normalizedBase
  ) as AgentConfig
  if (!imported) return normalized
  return { ...normalized, status: "disabled" } as AgentConfig
}

function persistedTeamConfig(input: TeamConfig, imported: boolean | undefined): TeamConfig {
  const normalizedInput = {
    ...input,
    nickname: teamNickname(input),
  }
  const normalized = persistedTeamShape(
    normalizedNicknameOrNull(input.nickname)
      ? { ...normalizedInput, normalizedNickname: normalizedNicknameOrNull(input.nickname)! }
      : normalizedInput,
  )
  if (!imported) return normalized
  return { ...normalized, status: "disabled" }
}

function throwNicknameRequired(input: {
  attemptedEntityType: "agent" | "team"
  attemptedEntityId: string
  nickname: string | null
}): never {
  throw new NicknameNamespaceError({
    reasonCode: "nickname_required",
    attemptedEntityType: input.attemptedEntityType,
    attemptedEntityId: input.attemptedEntityId,
    nickname: input.nickname,
    normalizedNickname: "",
  })
}

function assertNicknameAvailable(input: {
  attemptedEntityType: "agent" | "team"
  attemptedEntityId: string
  nickname: string | null
}): void {
  const normalizedNickname = normalizeNickname(input.nickname ?? "")
  if (!normalizedNickname) throwNicknameRequired(input)

  const db = getDb()
  if (tableExists(db, "nickname_namespaces")) {
    const existing = db
      .prepare<[string], DbNicknameNamespace>(
        "SELECT * FROM nickname_namespaces WHERE normalized_nickname = ?",
      )
      .get(normalizedNickname)
    if (!existing) return
    if (
      existing.entity_type === input.attemptedEntityType &&
      existing.entity_id === input.attemptedEntityId
    )
      return
    throw new NicknameNamespaceError({
      reasonCode: "nickname_conflict",
      attemptedEntityType: input.attemptedEntityType,
      attemptedEntityId: input.attemptedEntityId,
      nickname: input.nickname,
      normalizedNickname,
      existingEntityType: existing.entity_type,
      existingEntityId: existing.entity_id,
      existingNickname: existing.nickname_snapshot,
      existingStatus: existing.status,
    })
  }

  const agentRows = db
    .prepare<[], { agent_id: string; nickname: string | null; status: string }>(
      "SELECT agent_id, nickname, status FROM agent_configs",
    )
    .all()
  const teamRows = db
    .prepare<[], { team_id: string; nickname: string | null; status: string }>(
      "SELECT team_id, nickname, status FROM team_configs",
    )
    .all()

  for (const row of agentRows) {
    if (input.attemptedEntityType === "agent" && row.agent_id === input.attemptedEntityId) continue
    if (normalizeNickname(row.nickname ?? "") !== normalizedNickname) continue
    throw new NicknameNamespaceError({
      reasonCode: "nickname_conflict",
      attemptedEntityType: input.attemptedEntityType,
      attemptedEntityId: input.attemptedEntityId,
      nickname: input.nickname,
      normalizedNickname,
      existingEntityType: "agent",
      existingEntityId: row.agent_id,
      existingNickname: row.nickname,
      existingStatus: row.status,
    })
  }

  for (const row of teamRows) {
    if (input.attemptedEntityType === "team" && row.team_id === input.attemptedEntityId) continue
    if (normalizeNickname(row.nickname ?? "") !== normalizedNickname) continue
    throw new NicknameNamespaceError({
      reasonCode: "nickname_conflict",
      attemptedEntityType: input.attemptedEntityType,
      attemptedEntityId: input.attemptedEntityId,
      nickname: input.nickname,
      normalizedNickname,
      existingEntityType: "team",
      existingEntityId: row.team_id,
      existingNickname: row.nickname,
      existingStatus: row.status,
    })
  }
}

export function upsertAgentConfig(
  input: AgentConfig,
  options: AgentConfigPersistenceOptions = {},
): void {
  const db = getDb()
  assertMigrationWriteAllowed(db, "agent.config.upsert")
  const config = persistedAgentConfig(input, options.imported)
  assertNicknameAvailable({
    attemptedEntityType: "agent",
    attemptedEntityId: config.agentId,
    nickname: config.nickname ?? null,
  })
  const now = options.now ?? Date.now()
  const updatedAt = options.now ?? config.updatedAt ?? now
  const source = persistenceSource(options)
  const tx = db.transaction(() => {
    db.prepare(
      `INSERT INTO agent_configs
       (agent_id, agent_type, status, display_name, nickname, normalized_nickname, role, personality, specialty_tags_json,
        avoid_tasks_json, model_profile_json, memory_policy_json, capability_policy_json, delegation_policy_json,
        profile_version, config_json, schema_version, source, audit_id, idempotency_key, created_at, updated_at, archived_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(agent_id) DO UPDATE SET
         agent_type = excluded.agent_type,
         status = excluded.status,
         display_name = excluded.display_name,
         nickname = excluded.nickname,
         normalized_nickname = excluded.normalized_nickname,
         role = excluded.role,
         personality = excluded.personality,
         specialty_tags_json = excluded.specialty_tags_json,
         avoid_tasks_json = excluded.avoid_tasks_json,
         model_profile_json = excluded.model_profile_json,
         memory_policy_json = excluded.memory_policy_json,
         capability_policy_json = excluded.capability_policy_json,
         delegation_policy_json = excluded.delegation_policy_json,
         profile_version = excluded.profile_version,
         config_json = excluded.config_json,
         schema_version = excluded.schema_version,
         source = excluded.source,
         audit_id = excluded.audit_id,
         idempotency_key = COALESCE(excluded.idempotency_key, agent_configs.idempotency_key),
         updated_at = excluded.updated_at,
         archived_at = excluded.archived_at`,
    ).run(
      config.agentId,
      config.agentType,
      config.status,
      config.displayName,
      config.nickname ?? null,
      normalizedNicknameOrNull(config.nickname),
      config.role,
      config.personality,
      toJson(config.specialtyTags),
      toJson(config.avoidTasks),
      jsonStringOrNull((config as { modelProfile?: unknown }).modelProfile),
      toJson(config.memoryPolicy),
      toJson(config.capabilityPolicy),
      jsonStringOrNull(deriveDelegationPolicyValue(config)),
      config.profileVersion,
      toConfigJson(config),
      config.schemaVersion,
      source,
      options.auditId ?? null,
      options.idempotencyKey ?? null,
      config.createdAt,
      updatedAt,
      config.status === "archived" ? updatedAt : null,
    )
    syncNicknameNamespace(db, {
      entityType: "agent",
      entityId: config.agentId,
      nickname: config.nickname ?? null,
      status: config.status,
      source,
      createdAt: config.createdAt,
      updatedAt,
    })
  })
  tx()
}

export function getAgentConfig(agentId: string): DbAgentConfig | undefined {
  return getDb()
    .prepare<[string], DbAgentConfig>("SELECT * FROM agent_configs WHERE agent_id = ?")
    .get(agentId)
}

export function listAgentConfigs(
  filters: {
    enabledOnly?: boolean
    includeArchived?: boolean
    agentType?: AgentEntityType
  } = {},
): DbAgentConfig[] {
  const where: string[] = []
  const params: unknown[] = []
  if (filters.enabledOnly) where.push("status = 'enabled'")
  else if (!filters.includeArchived) where.push("status <> 'archived'")
  if (filters.agentType) {
    where.push("agent_type = ?")
    params.push(filters.agentType)
  }
  const clause = where.length ? `WHERE ${where.join(" AND ")}` : ""
  return getDb()
    .prepare(`SELECT * FROM agent_configs ${clause} ORDER BY updated_at DESC, agent_id ASC`)
    .all(...params) as DbAgentConfig[]
}

export function disableAgentConfig(agentId: string, now = Date.now()): boolean {
  const db = getDb()
  assertMigrationWriteAllowed(db, "agent.config.disable")
  const row = getAgentConfig(agentId)
  if (!row) return false
  let nextConfigJson = row.config_json
  try {
    const parsed = JSON.parse(row.config_json) as Record<string, unknown>
    nextConfigJson = toConfigJson({ ...parsed, status: "disabled", updatedAt: now })
  } catch {
    nextConfigJson = row.config_json
  }
  const tx = db.transaction(() => {
    const result = db
      .prepare<[string, string, number, string]>(
        `UPDATE agent_configs
         SET status = ?, config_json = ?, updated_at = ?, archived_at = NULL
         WHERE agent_id = ?`,
      )
      .run("disabled", nextConfigJson, now, agentId)
    if (result.changes > 0) {
      syncNicknameNamespace(db, {
        entityType: "agent",
        entityId: agentId,
        nickname: row.nickname,
        status: "disabled",
        source: row.source,
        createdAt: row.created_at,
        updatedAt: now,
      })
    }
    return result.changes > 0
  })
  return tx()
}

export function upsertTeamConfig(
  input: TeamConfig,
  options: TeamConfigPersistenceOptions = {},
): void {
  const db = getDb()
  assertMigrationWriteAllowed(db, "team.config.upsert")
  const config = persistedTeamConfig(input, options.imported)
  assertNicknameAvailable({
    attemptedEntityType: "team",
    attemptedEntityId: config.teamId,
    nickname: config.nickname ?? null,
  })
  const now = options.now ?? Date.now()
  const updatedAt = options.now ?? config.updatedAt ?? now
  const source = persistenceSource(options)
  const tx = db.transaction(() => {
    db.prepare(
      `INSERT INTO team_configs
       (team_id, status, display_name, nickname, normalized_nickname, purpose, owner_agent_id, lead_agent_id,
        member_count_min, member_count_max, required_team_roles_json, required_capability_tags_json, result_policy,
        conflict_policy, role_hints_json, member_agent_ids_json, profile_version, config_json, schema_version, source,
        audit_id, idempotency_key, created_at, updated_at, archived_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(team_id) DO UPDATE SET
         status = excluded.status,
         display_name = excluded.display_name,
         nickname = excluded.nickname,
         normalized_nickname = excluded.normalized_nickname,
         purpose = excluded.purpose,
         owner_agent_id = excluded.owner_agent_id,
         lead_agent_id = excluded.lead_agent_id,
         member_count_min = excluded.member_count_min,
         member_count_max = excluded.member_count_max,
         required_team_roles_json = excluded.required_team_roles_json,
         required_capability_tags_json = excluded.required_capability_tags_json,
         result_policy = excluded.result_policy,
         conflict_policy = excluded.conflict_policy,
         role_hints_json = excluded.role_hints_json,
         member_agent_ids_json = excluded.member_agent_ids_json,
         profile_version = excluded.profile_version,
         config_json = excluded.config_json,
         schema_version = excluded.schema_version,
         source = excluded.source,
         audit_id = excluded.audit_id,
         idempotency_key = COALESCE(excluded.idempotency_key, team_configs.idempotency_key),
         updated_at = excluded.updated_at,
         archived_at = excluded.archived_at`,
    ).run(
      config.teamId,
      config.status,
      config.displayName,
      config.nickname ?? null,
      normalizedNicknameOrNull(config.nickname),
      config.purpose,
      config.ownerAgentId ?? null,
      config.leadAgentId ?? null,
      config.memberCountMin ?? null,
      config.memberCountMax ?? null,
      toJson(config.requiredTeamRoles ?? []),
      toJson(config.requiredCapabilityTags ?? []),
      config.resultPolicy ?? "lead_synthesis",
      config.conflictPolicy ?? "lead_decides",
      toJson(config.roleHints),
      toJson(config.memberAgentIds),
      config.profileVersion,
      toConfigJson(config),
      config.schemaVersion,
      source,
      options.auditId ?? null,
      options.idempotencyKey ?? null,
      config.createdAt,
      updatedAt,
      config.status === "archived" ? updatedAt : null,
    )
    syncNicknameNamespace(db, {
      entityType: "team",
      entityId: config.teamId,
      nickname: config.nickname ?? null,
      status: config.status,
      source,
      createdAt: config.createdAt,
      updatedAt,
    })

    db.prepare<[number, string]>(
      `UPDATE agent_team_memberships SET status = 'removed', updated_at = ? WHERE team_id = ?`,
    ).run(updatedAt, config.teamId)

    const agentExists = db.prepare<[string], { agent_id: string }>(
      "SELECT agent_id FROM agent_configs WHERE agent_id = ? LIMIT 1",
    )
    const upsertMember = db.prepare(
      `INSERT INTO agent_team_memberships
       (membership_id, team_id, agent_id, owner_agent_id_snapshot, team_roles_json, primary_role, required,
        fallback_for_agent_id, status, role_hint, sort_order, schema_version, audit_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(team_id, agent_id) DO UPDATE SET
         membership_id = excluded.membership_id,
         owner_agent_id_snapshot = excluded.owner_agent_id_snapshot,
         team_roles_json = excluded.team_roles_json,
         primary_role = excluded.primary_role,
         required = excluded.required,
         fallback_for_agent_id = excluded.fallback_for_agent_id,
         status = excluded.status,
         role_hint = excluded.role_hint,
         sort_order = excluded.sort_order,
         schema_version = excluded.schema_version,
         audit_id = excluded.audit_id,
         updated_at = excluded.updated_at`,
    )
    const memberships = buildPersistedTeamMemberships(config)
    for (const membership of memberships) {
      const status = agentExists.get(membership.agentId)
        ? membership.status
        : membership.status === "removed"
          ? "removed"
          : "unresolved"
      upsertMember.run(
        membership.membershipId,
        config.teamId,
        membership.agentId,
        membership.ownerAgentIdSnapshot ?? config.ownerAgentId ?? null,
        toJson(membership.teamRoles),
        membership.primaryRole,
        membership.required ? 1 : 0,
        membership.fallbackForAgentId ?? null,
        status,
        membership.primaryRole,
        membership.sortOrder,
        config.schemaVersion,
        options.auditId ?? null,
        updatedAt,
        updatedAt,
      )
    }
  })
  tx()
}

export function getTeamConfig(teamId: string): DbTeamConfig | undefined {
  return getDb()
    .prepare<[string], DbTeamConfig>("SELECT * FROM team_configs WHERE team_id = ?")
    .get(teamId)
}

export function deleteTeamConfig(teamId: string): boolean {
  const db = getDb()
  assertMigrationWriteAllowed(db, "team.config.delete")
  if (!getTeamConfig(teamId)) return false
  const tx = db.transaction(() => {
    if (tableExists(db, "team_execution_plans")) {
      db.prepare<[string]>("DELETE FROM team_execution_plans WHERE team_id = ?").run(teamId)
    }
    db.prepare<[string]>("DELETE FROM agent_team_memberships WHERE team_id = ?").run(teamId)
    if (tableExists(db, "nickname_namespaces")) {
      db.prepare<[string, string]>(
        "DELETE FROM nickname_namespaces WHERE entity_type = ? AND entity_id = ?",
      ).run("team", teamId)
    }
    const result = db.prepare<[string]>("DELETE FROM team_configs WHERE team_id = ?").run(teamId)
    return result.changes > 0
  })
  return tx()
}

export function listTeamConfigs(
  filters: {
    enabledOnly?: boolean
    includeArchived?: boolean
  } = {},
): DbTeamConfig[] {
  const where: string[] = []
  if (filters.enabledOnly) where.push("status = 'enabled'")
  else if (!filters.includeArchived) where.push("status <> 'archived'")
  const clause = where.length ? `WHERE ${where.join(" AND ")}` : ""
  return getDb()
    .prepare(`SELECT * FROM team_configs ${clause} ORDER BY updated_at DESC, team_id ASC`)
    .all() as DbTeamConfig[]
}

export function listAgentTeamMemberships(teamId?: string): DbAgentTeamMembership[] {
  if (teamId) {
    return getDb()
      .prepare<[string], DbAgentTeamMembership>(
        "SELECT * FROM agent_team_memberships WHERE team_id = ? ORDER BY sort_order ASC, agent_id ASC",
      )
      .all(teamId)
  }
  return getDb()
    .prepare<[], DbAgentTeamMembership>(
      "SELECT * FROM agent_team_memberships ORDER BY team_id ASC, sort_order ASC, agent_id ASC",
    )
    .all()
}

function defaultCapabilityBindingId(input: {
  agentId: string
  capabilityKind: DbAgentCapabilityKind
  catalogId: string
}): string {
  return `${input.agentId}:capability:${input.capabilityKind}:${input.catalogId}`
}

function normalizedCatalogStatus(
  status: DbCapabilityCatalogStatus | undefined,
): DbCapabilityCatalogStatus {
  return status ?? "enabled"
}

function normalizedBindingStatus(
  status: DbAgentCapabilityBindingStatus | undefined,
): DbAgentCapabilityBindingStatus {
  return status ?? "enabled"
}

export function upsertSkillCatalogEntry(
  input: SkillCatalogEntryInput,
  options: CapabilityCatalogPersistenceOptions = {},
): void {
  const db = getDb()
  assertMigrationWriteAllowed(db, "skill.catalog.upsert")
  const now = options.now ?? input.updatedAt ?? Date.now()
  const createdAt = input.createdAt ?? now
  const status = normalizedCatalogStatus(input.status)
  db.prepare(
    `INSERT INTO skill_catalog
     (skill_id, status, display_name, risk, tool_names_json, metadata_json, schema_version, source,
      audit_id, created_at, updated_at, archived_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(skill_id) DO UPDATE SET
       status = excluded.status,
       display_name = excluded.display_name,
       risk = excluded.risk,
       tool_names_json = excluded.tool_names_json,
       metadata_json = excluded.metadata_json,
       schema_version = excluded.schema_version,
       source = excluded.source,
       audit_id = excluded.audit_id,
       updated_at = excluded.updated_at,
       archived_at = excluded.archived_at`,
  ).run(
    input.skillId,
    status,
    input.displayName,
    input.risk ?? "safe",
    toJson(uniqueStrings(input.toolNames ?? [])),
    input.metadata ? toJson(input.metadata) : null,
    SUB_AGENT_CONTRACT_SCHEMA_VERSION,
    options.source ?? "manual",
    options.auditId ?? null,
    createdAt,
    now,
    status === "archived" ? now : null,
  )
}

export function upsertMcpServerCatalogEntry(
  input: McpServerCatalogEntryInput,
  options: CapabilityCatalogPersistenceOptions = {},
): void {
  const db = getDb()
  assertMigrationWriteAllowed(db, "mcp_server.catalog.upsert")
  const now = options.now ?? input.updatedAt ?? Date.now()
  const createdAt = input.createdAt ?? now
  const status = normalizedCatalogStatus(input.status)
  db.prepare(
    `INSERT INTO mcp_server_catalog
     (mcp_server_id, status, display_name, risk, tool_names_json, metadata_json, schema_version, source,
      audit_id, created_at, updated_at, archived_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(mcp_server_id) DO UPDATE SET
       status = excluded.status,
       display_name = excluded.display_name,
       risk = excluded.risk,
       tool_names_json = excluded.tool_names_json,
       metadata_json = excluded.metadata_json,
       schema_version = excluded.schema_version,
       source = excluded.source,
       audit_id = excluded.audit_id,
       updated_at = excluded.updated_at,
       archived_at = excluded.archived_at`,
  ).run(
    input.mcpServerId,
    status,
    input.displayName,
    input.risk ?? "safe",
    toJson(uniqueStrings(input.toolNames ?? [])),
    input.metadata ? toJson(input.metadata) : null,
    SUB_AGENT_CONTRACT_SCHEMA_VERSION,
    options.source ?? "manual",
    options.auditId ?? null,
    createdAt,
    now,
    status === "archived" ? now : null,
  )
}

export function upsertAgentCapabilityBinding(
  input: AgentCapabilityBindingInput,
  options: CapabilityCatalogPersistenceOptions = {},
): void {
  const db = getDb()
  assertMigrationWriteAllowed(db, "agent.capability_binding.upsert")
  const now = options.now ?? input.updatedAt ?? Date.now()
  const createdAt = input.createdAt ?? now
  const status = normalizedBindingStatus(input.status)
  const bindingId = input.bindingId ?? defaultCapabilityBindingId(input)
  db.prepare(
    `INSERT INTO agent_capability_bindings
     (binding_id, agent_id, capability_kind, catalog_id, status, secret_scope_id, enabled_tool_names_json,
      disabled_tool_names_json, permission_profile_json, rate_limit_json, approval_required_from, schema_version,
      source, audit_id, created_at, updated_at, archived_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(binding_id) DO UPDATE SET
       agent_id = excluded.agent_id,
       capability_kind = excluded.capability_kind,
       catalog_id = excluded.catalog_id,
       status = excluded.status,
       secret_scope_id = excluded.secret_scope_id,
       enabled_tool_names_json = excluded.enabled_tool_names_json,
       disabled_tool_names_json = excluded.disabled_tool_names_json,
       permission_profile_json = excluded.permission_profile_json,
       rate_limit_json = excluded.rate_limit_json,
       approval_required_from = excluded.approval_required_from,
       schema_version = excluded.schema_version,
       source = excluded.source,
       audit_id = excluded.audit_id,
       updated_at = excluded.updated_at,
       archived_at = excluded.archived_at`,
  ).run(
    bindingId,
    input.agentId,
    input.capabilityKind,
    input.catalogId,
    status,
    input.secretScopeId ?? null,
    toJson(uniqueStrings(input.enabledToolNames ?? [])),
    toJson(uniqueStrings(input.disabledToolNames ?? [])),
    input.permissionProfile ? toJson(input.permissionProfile) : null,
    input.rateLimit ? toJson(input.rateLimit) : null,
    input.approvalRequiredFrom ?? null,
    SUB_AGENT_CONTRACT_SCHEMA_VERSION,
    options.source ?? "manual",
    options.auditId ?? null,
    createdAt,
    now,
    status === "archived" ? now : null,
  )
}

export function getAgentCapabilityBinding(bindingId: string): DbAgentCapabilityBinding | undefined {
  return getDb()
    .prepare<[string], DbAgentCapabilityBinding>(
      "SELECT * FROM agent_capability_bindings WHERE binding_id = ?",
    )
    .get(bindingId)
}

export function listSkillCatalogEntries(
  filters: {
    includeArchived?: boolean
    enabledOnly?: boolean
  } = {},
): DbSkillCatalogEntry[] {
  const where: string[] = []
  if (filters.enabledOnly) where.push("status = 'enabled'")
  else if (!filters.includeArchived) where.push("status <> 'archived'")
  const clause = where.length ? `WHERE ${where.join(" AND ")}` : ""
  return getDb()
    .prepare(`SELECT * FROM skill_catalog ${clause} ORDER BY skill_id ASC`)
    .all() as DbSkillCatalogEntry[]
}

export function listMcpServerCatalogEntries(
  filters: {
    includeArchived?: boolean
    enabledOnly?: boolean
  } = {},
): DbMcpServerCatalogEntry[] {
  const where: string[] = []
  if (filters.enabledOnly) where.push("status = 'enabled'")
  else if (!filters.includeArchived) where.push("status <> 'archived'")
  const clause = where.length ? `WHERE ${where.join(" AND ")}` : ""
  return getDb()
    .prepare(`SELECT * FROM mcp_server_catalog ${clause} ORDER BY mcp_server_id ASC`)
    .all() as DbMcpServerCatalogEntry[]
}

export function listAgentCapabilityBindings(
  filters: {
    agentId?: string
    capabilityKind?: DbAgentCapabilityKind
    includeArchived?: boolean
    enabledOnly?: boolean
  } = {},
): DbAgentCapabilityBinding[] {
  const where: string[] = []
  const params: string[] = []
  if (filters.agentId) {
    where.push("agent_id = ?")
    params.push(filters.agentId)
  }
  if (filters.capabilityKind) {
    where.push("capability_kind = ?")
    params.push(filters.capabilityKind)
  }
  if (filters.enabledOnly) where.push("status = 'enabled'")
  else if (!filters.includeArchived) where.push("status <> 'archived'")
  const clause = where.length ? `WHERE ${where.join(" AND ")}` : ""
  return getDb()
    .prepare(
      `SELECT * FROM agent_capability_bindings ${clause}
       ORDER BY agent_id ASC, capability_kind ASC, catalog_id ASC`,
    )
    .all(...params) as DbAgentCapabilityBinding[]
}

export function listNicknameNamespaces(): DbNicknameNamespace[] {
  if (!tableExists(getDb(), "nickname_namespaces")) return []
  return getDb()
    .prepare<[], DbNicknameNamespace>(
      "SELECT * FROM nickname_namespaces ORDER BY normalized_nickname ASC",
    )
    .all()
}

export function upsertAgentRelationship(
  input: AgentRelationship,
  options: { auditId?: string | null; now?: number } = {},
): void {
  const db = getDb()
  assertMigrationWriteAllowed(db, "agent.relationship.upsert")
  const now = options.now ?? input.updatedAt ?? input.createdAt ?? Date.now()
  db.prepare(
    `INSERT INTO agent_relationships
     (edge_id, parent_agent_id, child_agent_id, relationship_type, status, sort_order, schema_version, audit_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(edge_id) DO UPDATE SET
       parent_agent_id = excluded.parent_agent_id,
       child_agent_id = excluded.child_agent_id,
       relationship_type = excluded.relationship_type,
       status = excluded.status,
       sort_order = excluded.sort_order,
       schema_version = excluded.schema_version,
       audit_id = excluded.audit_id,
       updated_at = excluded.updated_at`,
  ).run(
    input.edgeId,
    input.parentAgentId,
    input.childAgentId,
    input.relationshipType,
    input.status,
    input.sortOrder,
    SUB_AGENT_CONTRACT_SCHEMA_VERSION,
    options.auditId ?? null,
    input.createdAt ?? now,
    now,
  )
}

export function getAgentRelationship(edgeId: string): DbAgentRelationship | undefined {
  return getDb()
    .prepare<[string], DbAgentRelationship>("SELECT * FROM agent_relationships WHERE edge_id = ?")
    .get(edgeId)
}

export function listAgentRelationships(
  filters: {
    parentAgentId?: string
    childAgentId?: string
    status?: AgentRelationship["status"]
  } = {},
): DbAgentRelationship[] {
  const where: string[] = []
  const params: Array<string> = []
  if (filters.parentAgentId) {
    where.push("parent_agent_id = ?")
    params.push(filters.parentAgentId)
  }
  if (filters.childAgentId) {
    where.push("child_agent_id = ?")
    params.push(filters.childAgentId)
  }
  if (filters.status) {
    where.push("status = ?")
    params.push(filters.status)
  }
  const clause = where.length ? `WHERE ${where.join(" AND ")}` : ""
  return getDb()
    .prepare(
      `SELECT * FROM agent_relationships ${clause} ORDER BY parent_agent_id ASC, sort_order ASC, edge_id ASC`,
    )
    .all(...params) as DbAgentRelationship[]
}

export function insertTeamExecutionPlan(
  input: TeamExecutionPlan,
  options: { auditId?: string | null } = {},
): boolean {
  const db = getDb()
  assertMigrationWriteAllowed(db, "team.execution_plan.insert")
  try {
    db.prepare(
      `INSERT INTO team_execution_plans
       (team_execution_plan_id, parent_run_id, team_id, team_nickname_snapshot, owner_agent_id, lead_agent_id,
        member_task_assignments_json, reviewer_agent_ids_json, verifier_agent_ids_json, fallback_assignments_json,
        coverage_report_json, conflict_policy_snapshot, result_policy_snapshot, contract_json, schema_version, audit_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      input.teamExecutionPlanId,
      input.parentRunId,
      input.teamId,
      input.teamNicknameSnapshot ?? null,
      input.ownerAgentId,
      input.leadAgentId,
      toJson(input.memberTaskAssignments),
      toJson(input.reviewerAgentIds),
      toJson(input.verifierAgentIds),
      toJson(input.fallbackAssignments),
      toJson(input.coverageReport),
      input.conflictPolicySnapshot,
      input.resultPolicySnapshot,
      toJson(input),
      SUB_AGENT_CONTRACT_SCHEMA_VERSION,
      options.auditId ?? null,
      input.createdAt,
    )
    return true
  } catch (error) {
    if (isUniqueConstraintError(error)) return false
    throw error
  }
}

export function getTeamExecutionPlan(teamExecutionPlanId: string): DbTeamExecutionPlan | undefined {
  return getDb()
    .prepare<[string], DbTeamExecutionPlan>(
      "SELECT * FROM team_execution_plans WHERE team_execution_plan_id = ?",
    )
    .get(teamExecutionPlanId)
}

export function listTeamExecutionPlansForParentRun(parentRunId: string): DbTeamExecutionPlan[] {
  return getDb()
    .prepare<[string], DbTeamExecutionPlan>(
      "SELECT * FROM team_execution_plans WHERE parent_run_id = ? ORDER BY created_at ASC, team_execution_plan_id ASC",
    )
    .all(parentRunId)
}

export function insertRunSubSession(
  input: SubSessionContract,
  options: { auditId?: string | null; now?: number } = {},
): boolean {
  const db = getDb()
  assertMigrationWriteAllowed(db, "run.subsession.insert")
  const now = options.now ?? Date.now()
  try {
    db.prepare(
      `INSERT INTO run_subsessions
       (sub_session_id, parent_run_id, parent_session_id, parent_sub_session_id, parent_request_id, agent_id, agent_display_name,
        agent_nickname, command_request_id, status, retry_budget_remaining, prompt_bundle_id, contract_json, schema_version,
        audit_id, idempotency_key, created_at, updated_at, started_at, finished_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      input.subSessionId,
      input.parentRunId,
      input.parentSessionId,
      input.identity.parent?.parentSubSessionId ?? null,
      input.identity.parent?.parentRequestId ?? null,
      input.agentId,
      input.agentDisplayName,
      input.agentNickname ?? null,
      input.commandRequestId,
      input.status,
      input.retryBudgetRemaining,
      input.promptBundleId,
      toJson(input),
      input.identity.schemaVersion,
      optionalAuditId(input.identity.auditCorrelationId, options.auditId),
      input.identity.idempotencyKey,
      now,
      now,
      input.startedAt ?? null,
      input.finishedAt ?? null,
    )
    return true
  } catch (error) {
    if (isUniqueConstraintError(error)) return false
    throw error
  }
}

export function updateRunSubSession(
  input: SubSessionContract,
  options: { auditId?: string | null; now?: number } = {},
): boolean {
  const db = getDb()
  assertMigrationWriteAllowed(db, "run.subsession.update")
  const now = options.now ?? Date.now()
  const result = db
    .prepare(
      `UPDATE run_subsessions
       SET parent_run_id = ?,
           parent_session_id = ?,
           parent_sub_session_id = ?,
           parent_request_id = ?,
           agent_id = ?,
           agent_display_name = ?,
           agent_nickname = ?,
           command_request_id = ?,
           status = ?,
           retry_budget_remaining = ?,
           prompt_bundle_id = ?,
           contract_json = ?,
           schema_version = ?,
           audit_id = ?,
           idempotency_key = ?,
           updated_at = ?,
           started_at = ?,
           finished_at = ?
       WHERE sub_session_id = ?`,
    )
    .run(
      input.parentRunId,
      input.parentSessionId,
      input.identity.parent?.parentSubSessionId ?? null,
      input.identity.parent?.parentRequestId ?? null,
      input.agentId,
      input.agentDisplayName,
      input.agentNickname ?? null,
      input.commandRequestId,
      input.status,
      input.retryBudgetRemaining,
      input.promptBundleId,
      toJson(input),
      input.identity.schemaVersion,
      optionalAuditId(input.identity.auditCorrelationId, options.auditId),
      input.identity.idempotencyKey,
      now,
      input.startedAt ?? null,
      input.finishedAt ?? null,
      input.subSessionId,
    )
  return result.changes > 0
}

export function getRunSubSession(subSessionId: string): DbRunSubSession | undefined {
  return getDb()
    .prepare<[string], DbRunSubSession>("SELECT * FROM run_subsessions WHERE sub_session_id = ?")
    .get(subSessionId)
}

export function getRunSubSessionByIdempotencyKey(
  idempotencyKey: string,
): DbRunSubSession | undefined {
  return getDb()
    .prepare<[string], DbRunSubSession>("SELECT * FROM run_subsessions WHERE idempotency_key = ?")
    .get(idempotencyKey)
}

export function listRunSubSessionsForParentRun(parentRunId: string): DbRunSubSession[] {
  return getDb()
    .prepare<[string], DbRunSubSession>(
      "SELECT * FROM run_subsessions WHERE parent_run_id = ? ORDER BY created_at ASC, sub_session_id ASC",
    )
    .all(parentRunId)
}

export function insertAgentDataExchange(
  input: DataExchangePackage,
  options: { auditId?: string | null; expiresAt?: number | null; now?: number } = {},
): boolean {
  const db = getDb()
  assertMigrationWriteAllowed(db, "agent.data_exchange.insert")
  const now = options.now ?? Date.now()
  try {
    db.prepare(
      `INSERT INTO agent_data_exchanges
       (exchange_id, source_owner_type, source_owner_id, source_nickname_snapshot, recipient_owner_type, recipient_owner_id,
        recipient_nickname_snapshot, purpose, allowed_use, retention_policy, redaction_state, provenance_refs_json, payload_json,
        contract_json, schema_version, audit_id, idempotency_key, created_at, updated_at, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      input.exchangeId,
      input.sourceOwner.ownerType,
      input.sourceOwner.ownerId,
      input.sourceNicknameSnapshot ?? null,
      input.recipientOwner.ownerType,
      input.recipientOwner.ownerId,
      input.recipientNicknameSnapshot ?? null,
      input.purpose,
      input.allowedUse,
      input.retentionPolicy,
      input.redactionState,
      toJson(input.provenanceRefs),
      toJson(input.payload),
      toJson(input),
      input.identity.schemaVersion,
      optionalAuditId(input.identity.auditCorrelationId, options.auditId),
      input.identity.idempotencyKey,
      input.createdAt,
      now,
      options.expiresAt ?? input.expiresAt ?? null,
    )
    return true
  } catch (error) {
    if (isUniqueConstraintError(error)) return false
    throw error
  }
}

export function getAgentDataExchange(exchangeId: string): DbAgentDataExchange | undefined {
  return getDb()
    .prepare<[string], DbAgentDataExchange>(
      "SELECT * FROM agent_data_exchanges WHERE exchange_id = ?",
    )
    .get(exchangeId)
}

export function listAgentDataExchangesForRecipient(
  recipientOwner: OwnerScope,
  options: {
    now?: number
    includeExpired?: boolean
    allowedUse?: DataExchangePackage["allowedUse"]
    limit?: number
  } = {},
): DbAgentDataExchange[] {
  const limit = Math.max(1, Math.min(500, Math.floor(options.limit ?? 100)))
  const clauses = ["recipient_owner_type = ?", "recipient_owner_id = ?"]
  const values: Array<string | number> = [recipientOwner.ownerType, recipientOwner.ownerId]
  if (!options.includeExpired) {
    clauses.push("(expires_at IS NULL OR expires_at > ?)")
    values.push(options.now ?? Date.now())
  }
  if (options.allowedUse) {
    clauses.push("allowed_use = ?")
    values.push(options.allowedUse)
  }
  values.push(limit)
  return getDb()
    .prepare<unknown[], DbAgentDataExchange>(
      `SELECT * FROM agent_data_exchanges
       WHERE ${clauses.join(" AND ")}
       ORDER BY created_at DESC, exchange_id ASC
       LIMIT ?`,
    )
    .all(...values)
}

export function listAgentDataExchangesForSource(
  sourceOwner: OwnerScope,
  options: {
    now?: number
    includeExpired?: boolean
    recipientOwner?: OwnerScope
    limit?: number
  } = {},
): DbAgentDataExchange[] {
  const limit = Math.max(1, Math.min(500, Math.floor(options.limit ?? 100)))
  const clauses = ["source_owner_type = ?", "source_owner_id = ?"]
  const values: Array<string | number> = [sourceOwner.ownerType, sourceOwner.ownerId]
  if (options.recipientOwner) {
    clauses.push("recipient_owner_type = ?", "recipient_owner_id = ?")
    values.push(options.recipientOwner.ownerType, options.recipientOwner.ownerId)
  }
  if (!options.includeExpired) {
    clauses.push("(expires_at IS NULL OR expires_at > ?)")
    values.push(options.now ?? Date.now())
  }
  values.push(limit)
  return getDb()
    .prepare<unknown[], DbAgentDataExchange>(
      `SELECT * FROM agent_data_exchanges
       WHERE ${clauses.join(" AND ")}
       ORDER BY created_at DESC, exchange_id ASC
       LIMIT ?`,
    )
    .all(...values)
}

export function insertCapabilityDelegation(
  input: CapabilityDelegationRequest,
  options: { auditId?: string | null; now?: number } = {},
): boolean {
  assertMigrationWriteAllowed(getDb(), "agent.capability_delegation.insert")
  const now = options.now ?? Date.now()
  try {
    getDb()
      .prepare(
        `INSERT INTO capability_delegations
         (delegation_id, requester_owner_type, requester_owner_id, provider_owner_type, provider_owner_id, capability, risk,
          status, input_package_ids_json, result_package_id, approval_id, contract_json, schema_version, audit_id,
          idempotency_key, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.delegationId,
        input.requester.ownerType,
        input.requester.ownerId,
        input.provider.ownerType,
        input.provider.ownerId,
        input.capability,
        input.risk,
        input.status,
        toJson(input.inputPackageIds),
        input.resultPackageId ?? null,
        input.approvalId ?? null,
        toJson(input),
        input.identity.schemaVersion,
        optionalAuditId(input.identity.auditCorrelationId, options.auditId),
        input.identity.idempotencyKey,
        now,
        now,
      )
    return true
  } catch (error) {
    if (isUniqueConstraintError(error)) return false
    throw error
  }
}

export function updateCapabilityDelegation(
  input: {
    delegationId: string
    status: CapabilityDelegationRequest["status"]
    resultPackageId?: string | null
    approvalId?: string | null
    contract?: CapabilityDelegationRequest
  },
  options: { auditId?: string | null; now?: number } = {},
): boolean {
  assertMigrationWriteAllowed(getDb(), "agent.capability_delegation.update")
  const now = options.now ?? Date.now()
  const existing = getCapabilityDelegation(input.delegationId)
  if (!existing) return false
  const contract =
    input.contract ??
    ({
      ...(JSON.parse(existing.contract_json) as CapabilityDelegationRequest),
      status: input.status,
      ...(input.resultPackageId !== undefined && input.resultPackageId !== null
        ? { resultPackageId: input.resultPackageId }
        : {}),
      ...(input.approvalId !== undefined && input.approvalId !== null
        ? { approvalId: input.approvalId }
        : {}),
    } satisfies CapabilityDelegationRequest)
  const result = getDb()
    .prepare(
      `UPDATE capability_delegations
       SET status = ?,
           result_package_id = ?,
           approval_id = ?,
           contract_json = ?,
           audit_id = COALESCE(?, audit_id),
           updated_at = ?
       WHERE delegation_id = ?`,
    )
    .run(
      input.status,
      input.resultPackageId !== undefined ? input.resultPackageId : existing.result_package_id,
      input.approvalId !== undefined ? input.approvalId : existing.approval_id,
      toJson(contract),
      options.auditId ?? null,
      now,
      input.delegationId,
    )
  return result.changes > 0
}

export function getCapabilityDelegation(delegationId: string): DbCapabilityDelegation | undefined {
  return getDb()
    .prepare<[string], DbCapabilityDelegation>(
      "SELECT * FROM capability_delegations WHERE delegation_id = ?",
    )
    .get(delegationId)
}

export function listCapabilityDelegations(
  filters: {
    requester?: OwnerScope
    provider?: OwnerScope
    status?: CapabilityDelegationRequest["status"]
    limit?: number
  } = {},
): DbCapabilityDelegation[] {
  const clauses: string[] = []
  const values: Array<string | number> = []
  if (filters.requester) {
    clauses.push("requester_owner_type = ?", "requester_owner_id = ?")
    values.push(filters.requester.ownerType, filters.requester.ownerId)
  }
  if (filters.provider) {
    clauses.push("provider_owner_type = ?", "provider_owner_id = ?")
    values.push(filters.provider.ownerType, filters.provider.ownerId)
  }
  if (filters.status) {
    clauses.push("status = ?")
    values.push(filters.status)
  }
  const limit = Math.max(1, Math.min(500, Math.floor(filters.limit ?? 100)))
  values.push(limit)
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : ""
  return getDb()
    .prepare<unknown[], DbCapabilityDelegation>(
      `SELECT * FROM capability_delegations
       ${where}
       ORDER BY created_at DESC, delegation_id ASC
       LIMIT ?`,
    )
    .all(...values)
}

export function insertLearningEvent(
  input: LearningEvent,
  options: { auditId?: string | null; now?: number } = {},
): boolean {
  assertMigrationWriteAllowed(getDb(), "agent.learning_event.insert")
  const now = options.now ?? Date.now()
  try {
    getDb()
      .prepare(
        `INSERT INTO learning_events
         (learning_event_id, agent_id, learning_target, before_summary, after_summary, evidence_refs_json, confidence,
          approval_state, contract_json, schema_version, audit_id, idempotency_key, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.learningEventId,
        input.agentId,
        input.learningTarget,
        input.beforeSummary,
        input.afterSummary,
        toJson(input.evidenceRefs),
        input.confidence,
        input.approvalState,
        toJson(input),
        input.identity.schemaVersion,
        optionalAuditId(input.identity.auditCorrelationId, options.auditId),
        input.identity.idempotencyKey,
        now,
        now,
      )
    return true
  } catch (error) {
    if (isUniqueConstraintError(error)) return false
    throw error
  }
}

export function listLearningEvents(agentId: string): DbLearningEvent[] {
  return getDb()
    .prepare<[string], DbLearningEvent>(
      "SELECT * FROM learning_events WHERE agent_id = ? ORDER BY created_at DESC",
    )
    .all(agentId)
}

export function listLearningEventsByApprovalState(
  approvalState: LearningEvent["approvalState"],
  filters: { agentId?: string; limit?: number } = {},
): DbLearningEvent[] {
  const clauses = ["approval_state = ?"]
  const values: Array<string | number> = [approvalState]
  if (filters.agentId?.trim()) {
    clauses.push("agent_id = ?")
    values.push(filters.agentId.trim())
  }
  const requestedLimit = Math.floor(filters.limit ?? 100)
  values.push(Number.isFinite(requestedLimit) ? Math.max(1, Math.min(500, requestedLimit)) : 100)
  return getDb()
    .prepare<unknown[], DbLearningEvent>(
      `SELECT * FROM learning_events
       WHERE ${clauses.join(" AND ")}
       ORDER BY created_at ASC, learning_event_id ASC
       LIMIT ?`,
    )
    .all(...values)
}

export function updateLearningEventApprovalState(
  learningEventId: string,
  approvalState: LearningEvent["approvalState"],
  options: { auditId?: string | null; now?: number } = {},
): boolean {
  assertMigrationWriteAllowed(getDb(), "agent.learning_event.update_approval")
  const now = options.now ?? Date.now()
  const result = getDb()
    .prepare<[LearningEvent["approvalState"], string | null, number, string]>(
      `UPDATE learning_events
       SET approval_state = ?, audit_id = coalesce(?, audit_id), updated_at = ?
       WHERE learning_event_id = ?`,
    )
    .run(approvalState, options.auditId ?? null, now, learningEventId)
  return result.changes > 0
}

export function insertProfileHistoryVersion(
  input: HistoryVersion,
  options: { auditId?: string | null } = {},
): boolean {
  assertMigrationWriteAllowed(getDb(), "agent.profile_history.insert")
  try {
    getDb()
      .prepare(
        `INSERT INTO profile_history_versions
         (history_version_id, target_entity_type, target_entity_id, version, before_json, after_json, reason_code,
          schema_version, audit_id, idempotency_key, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.historyVersionId,
        input.targetEntityType,
        input.targetEntityId,
        input.version,
        toJson(input.before),
        toJson(input.after),
        input.reasonCode,
        input.identity.schemaVersion,
        optionalAuditId(input.identity.auditCorrelationId, options.auditId),
        input.identity.idempotencyKey,
        input.createdAt,
      )
    return true
  } catch (error) {
    if (isUniqueConstraintError(error)) return false
    throw error
  }
}

export function listProfileHistoryVersions(
  targetEntityType: HistoryVersion["targetEntityType"],
  targetEntityId: string,
): DbProfileHistoryVersion[] {
  return getDb()
    .prepare<[HistoryVersion["targetEntityType"], string], DbProfileHistoryVersion>(
      `SELECT * FROM profile_history_versions
       WHERE target_entity_type = ? AND target_entity_id = ?
       ORDER BY version ASC`,
    )
    .all(targetEntityType, targetEntityId)
}

export function insertProfileRestoreEvent(
  input: RestoreEvent,
  options: { auditId?: string | null } = {},
): boolean {
  assertMigrationWriteAllowed(getDb(), "agent.profile_restore.insert")
  try {
    getDb()
      .prepare(
        `INSERT INTO profile_restore_events
         (restore_event_id, target_entity_type, target_entity_id, restored_history_version_id, dry_run, effect_summary_json,
          schema_version, audit_id, idempotency_key, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.restoreEventId,
        input.targetEntityType,
        input.targetEntityId,
        input.restoredHistoryVersionId,
        input.dryRun ? 1 : 0,
        toJson(input.effectSummary),
        input.identity.schemaVersion,
        optionalAuditId(input.identity.auditCorrelationId, options.auditId),
        input.identity.idempotencyKey,
        input.createdAt,
      )
    return true
  } catch (error) {
    if (isUniqueConstraintError(error)) return false
    throw error
  }
}

export function listProfileRestoreEvents(
  targetEntityType: RestoreEvent["targetEntityType"],
  targetEntityId: string,
): DbProfileRestoreEvent[] {
  return getDb()
    .prepare<[RestoreEvent["targetEntityType"], string], DbProfileRestoreEvent>(
      `SELECT * FROM profile_restore_events
       WHERE target_entity_type = ? AND target_entity_id = ?
       ORDER BY created_at DESC`,
    )
    .all(targetEntityType, targetEntityId)
}

export function subAgentStorageSchemaVersion(): number {
  return SUB_AGENT_CONTRACT_SCHEMA_VERSION
}

export function storeMemoryDocument(input: StoreMemoryDocumentInput): StoreMemoryDocumentResult {
  const ownerId = resolveMemoryOwnerId(input.scope, input.ownerId)
  const db = getDb()
  const now = Date.now()
  const existing = db
    .prepare<[string, string, string], { id: string }>(
      `SELECT id FROM memory_documents WHERE scope = ? AND owner_id = ? AND checksum = ? LIMIT 1`,
    )
    .get(input.scope, ownerId, input.checksum)
  if (existing) {
    const chunks = db
      .prepare<[string], { id: string }>(
        `SELECT id FROM memory_chunks WHERE document_id = ? ORDER BY ordinal ASC`,
      )
      .all(existing.id)
    return {
      documentId: existing.id,
      chunkIds: chunks.map((chunk) => chunk.id),
      deduplicated: true,
    }
  }

  const documentId = crypto.randomUUID()
  const chunkIds: string[] = []
  const insertDocument = db.prepare(
    `INSERT INTO memory_documents
     (id, scope, owner_id, source_type, source_ref, title, raw_text, checksum, metadata_json, archived_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)`,
  )
  const insertChunk = db.prepare(
    `INSERT INTO memory_chunks
     (id, document_id, scope, owner_id, ordinal, token_estimate, content, checksum, source_checksum, metadata_json, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
  const insertChunkFts = db.prepare(
    `INSERT INTO memory_chunks_fts(rowid, content, metadata_json)
     SELECT rowid, content, metadata_json FROM memory_chunks WHERE id = ?`,
  )
  const insertIndexJob = db.prepare(
    `INSERT INTO memory_index_jobs (id, document_id, status, retry_count, created_at, updated_at)
     VALUES (?, ?, 'queued', 0, ?, ?)`,
  )

  const tx = db.transaction(() => {
    insertDocument.run(
      documentId,
      input.scope,
      ownerId,
      input.sourceType,
      input.sourceRef ?? null,
      input.title ?? null,
      input.rawText,
      input.checksum,
      toJsonOrNull(input.metadata),
      now,
      now,
    )

    for (const chunk of input.chunks) {
      const chunkId = crypto.randomUUID()
      chunkIds.push(chunkId)
      insertChunk.run(
        chunkId,
        documentId,
        input.scope,
        ownerId,
        chunk.ordinal,
        chunk.tokenEstimate,
        chunk.content,
        chunk.checksum,
        input.checksum,
        toJsonOrNull(chunk.metadata),
        now,
        now,
      )
      insertChunkFts.run(chunkId)
    }

    insertIndexJob.run(crypto.randomUUID(), documentId, now, now)
  })
  tx()

  return { documentId, chunkIds, deduplicated: false }
}

export function insertMemoryEmbeddingIfMissing(input: {
  chunkId: string
  provider: string
  model: string
  dimensions: number
  textChecksum: string
  vector: Buffer
}): string {
  const id = crypto.randomUUID()
  getDb()
    .prepare(
      `INSERT OR IGNORE INTO memory_embeddings
       (id, chunk_id, provider, model, dimensions, text_checksum, vector, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      input.chunkId,
      input.provider,
      input.model,
      input.dimensions,
      input.textChecksum,
      input.vector,
      Date.now(),
    )
  const existing = getDb()
    .prepare<[string, string, number, string], { id: string }>(
      `SELECT id FROM memory_embeddings
       WHERE provider = ? AND model = ? AND dimensions = ? AND text_checksum = ?`,
    )
    .get(input.provider, input.model, input.dimensions, input.textChecksum)
  return existing?.id ?? id
}

export function rebuildMemorySearchIndexes(): void {
  getDb().exec(`
    INSERT INTO memory_fts(memory_fts) VALUES('rebuild');
    INSERT INTO memory_chunks_fts(memory_chunks_fts) VALUES('rebuild');
  `)
}

export function markMemoryIndexJobCompleted(documentId: string): void {
  getDb()
    .prepare(
      `UPDATE memory_index_jobs SET status = 'embedded', updated_at = ? WHERE document_id = ?`,
    )
    .run(Date.now(), documentId)
}

export function markMemoryIndexJobDisabled(documentId: string, reason: string): void {
  getDb()
    .prepare(
      `UPDATE memory_index_jobs
       SET status = 'disabled', last_error = ?, updated_at = ?
       WHERE document_id = ?`,
    )
    .run(reason, Date.now(), documentId)
}

export function markMemoryIndexJobStale(documentId: string, reason: string): void {
  getDb()
    .prepare(
      `UPDATE memory_index_jobs
       SET status = 'stale', last_error = ?, updated_at = ?
       WHERE document_id = ? AND status != 'failed'`,
    )
    .run(reason, Date.now(), documentId)
}

export function markMemoryIndexJobFailed(documentId: string, error: string): void {
  getDb()
    .prepare(
      `UPDATE memory_index_jobs
       SET status = 'failed', retry_count = retry_count + 1, last_error = ?, updated_at = ?
       WHERE document_id = ?`,
    )
    .run(error, Date.now(), documentId)
}

export function recordMemoryAccessLog(input: {
  runId?: string
  sessionId?: string
  requestGroupId?: string
  documentId?: string
  chunkId?: string
  sourceChecksum?: string | null
  scope?: MemoryScope | string | null
  query: string
  resultSource: string
  score?: number
  latencyMs?: number
  reason?: string
}): string {
  const id = crypto.randomUUID()
  getDb()
    .prepare(
      `INSERT INTO memory_access_log
       (id, run_id, session_id, request_group_id, document_id, chunk_id, source_checksum, scope, query, result_source, score, latency_ms, reason, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      input.runId ?? null,
      input.sessionId ?? null,
      input.requestGroupId ?? null,
      input.documentId ?? null,
      input.chunkId ?? null,
      input.sourceChecksum ?? null,
      input.scope ?? null,
      input.query,
      input.resultSource,
      input.score ?? null,
      input.latencyMs ?? null,
      input.reason ?? null,
      Date.now(),
    )
  return id
}

export interface DbMemoryAccessTraceRow {
  id: string
  run_id: string | null
  session_id: string | null
  request_group_id: string | null
  document_id: string | null
  chunk_id: string | null
  source_checksum: string | null
  scope: string | null
  query: string
  result_source: string
  score: number | null
  latency_ms: number | null
  reason: string | null
  created_at: number
}

export function listMemoryAccessTraceForRun(runId: string, limit = 100): DbMemoryAccessTraceRow[] {
  const normalized = runId.trim()
  if (!normalized) return []
  return getDb()
    .prepare<[string, number], DbMemoryAccessTraceRow>(
      `SELECT id, run_id, session_id, request_group_id, document_id, chunk_id,
              source_checksum, scope, query, result_source, score, latency_ms, reason, created_at
       FROM memory_access_log
       WHERE run_id = ?
       ORDER BY created_at DESC
       LIMIT ?`,
    )
    .all(normalized, Math.max(1, Math.min(500, Math.floor(limit))))
}

export function insertFlashFeedback(input: {
  sessionId: string
  content: string
  runId?: string
  requestGroupId?: string
  severity?: "low" | "normal" | "high"
  ttlMs?: number
  metadata?: Record<string, unknown>
}): string {
  const sessionId = input.sessionId.trim()
  if (!sessionId) throw new Error("flash-feedback requires a session id")
  const id = crypto.randomUUID()
  const now = Date.now()
  const ttlMs = Math.max(1, input.ttlMs ?? 30 * 60 * 1000)
  getDb()
    .prepare(
      `INSERT INTO flash_feedback
       (id, session_id, run_id, request_group_id, content, severity, expires_at, metadata_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      sessionId,
      input.runId ?? null,
      input.requestGroupId ?? null,
      input.content,
      input.severity ?? "normal",
      now + ttlMs,
      toJsonOrNull(input.metadata),
      now,
      now,
    )
  return id
}

export function upsertScheduleMemoryEntry(input: {
  scheduleId: string
  prompt: string
  sessionId?: string
  requestGroupId?: string
  title?: string
  cronExpression?: string
  nextRunAt?: number
  enabled?: boolean
  metadata?: Record<string, unknown>
}): string {
  const scheduleId = input.scheduleId.trim()
  if (!scheduleId) throw new Error("schedule memory requires a schedule id")
  assertMigrationWriteAllowed(getDb(), "schedule.memory.upsert")
  const id = crypto.randomUUID()
  const now = Date.now()
  getDb()
    .prepare(
      `INSERT INTO schedule_entries
       (id, schedule_id, session_id, request_group_id, title, prompt, cron_expression, next_run_at, enabled, metadata_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(schedule_id) DO UPDATE SET
         session_id = excluded.session_id,
         request_group_id = excluded.request_group_id,
         title = excluded.title,
         prompt = excluded.prompt,
         cron_expression = excluded.cron_expression,
         next_run_at = excluded.next_run_at,
         enabled = excluded.enabled,
         metadata_json = excluded.metadata_json,
         updated_at = excluded.updated_at`,
    )
    .run(
      id,
      scheduleId,
      input.sessionId ?? null,
      input.requestGroupId ?? null,
      input.title ?? null,
      input.prompt,
      input.cronExpression ?? null,
      input.nextRunAt ?? null,
      input.enabled === false ? 0 : 1,
      toJsonOrNull(input.metadata),
      now,
      now,
    )
  const row = getDb()
    .prepare<[string], { id: string }>(
      `SELECT id FROM schedule_entries WHERE schedule_id = ? LIMIT 1`,
    )
    .get(scheduleId)
  return row?.id ?? id
}

export function insertArtifactReceipt(input: {
  channel: string
  artifactPath: string
  runId?: string
  requestGroupId?: string
  mimeType?: string
  sizeBytes?: number
  deliveryReceipt?: Record<string, unknown>
  deliveredAt?: number
}): string {
  const id = crypto.randomUUID()
  getDb()
    .prepare(
      `INSERT INTO artifact_receipts
       (id, run_id, request_group_id, channel, artifact_path, mime_type, size_bytes, delivery_receipt_json, delivered_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      input.runId ?? null,
      input.requestGroupId ?? null,
      input.channel,
      input.artifactPath,
      input.mimeType ?? null,
      input.sizeBytes ?? null,
      toJsonOrNull(input.deliveryReceipt),
      input.deliveredAt ?? null,
      Date.now(),
    )
  return id
}

export function hasArtifactReceipt(input: {
  runId: string
  channel: string
  artifactPath: string
}): boolean {
  const row = getDb()
    .prepare<[string, string, string], { id: string }>(
      `SELECT id FROM artifact_receipts
       WHERE run_id = ? AND channel = ? AND artifact_path = ?
       LIMIT 1`,
    )
    .get(input.runId, input.channel, input.artifactPath)
  return Boolean(row)
}

export function insertArtifactMetadata(input: ArtifactMetadataInput): string {
  const id = crypto.randomUUID()
  const now = Date.now()
  getDb()
    .prepare(
      `INSERT INTO artifacts
       (id, source_run_id, request_group_id, owner_channel, channel_target, artifact_path, mime_type, size_bytes,
        retention_policy, expires_at, metadata_json, created_at, updated_at, deleted_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
    )
    .run(
      id,
      input.sourceRunId ?? null,
      input.requestGroupId ?? null,
      input.ownerChannel,
      input.channelTarget ?? null,
      input.artifactPath,
      input.mimeType ?? "application/octet-stream",
      input.sizeBytes ?? null,
      input.retentionPolicy ?? "standard",
      input.expiresAt ?? null,
      toJsonOrNull(input.metadata),
      input.createdAt ?? now,
      input.updatedAt ?? input.createdAt ?? now,
    )
  return id
}

export function getLatestArtifactMetadataByPath(
  artifactPath: string,
): DbArtifactMetadata | undefined {
  return getDb()
    .prepare<[string], DbArtifactMetadata>(
      `SELECT * FROM artifacts
       WHERE artifact_path = ?
       ORDER BY created_at DESC
       LIMIT 1`,
    )
    .get(artifactPath)
}

export function getArtifactMetadata(id: string): DbArtifactMetadata | undefined {
  return getDb()
    .prepare<[string], DbArtifactMetadata>(
      `SELECT * FROM artifacts
       WHERE id = ?
       LIMIT 1`,
    )
    .get(id)
}

export function listExpiredArtifactMetadata(now: number = Date.now()): DbArtifactMetadata[] {
  return getDb()
    .prepare<[number], DbArtifactMetadata>(
      `SELECT * FROM artifacts
       WHERE expires_at IS NOT NULL
         AND expires_at <= ?
         AND deleted_at IS NULL
       ORDER BY expires_at ASC`,
    )
    .all(now)
}

export function listActiveArtifactMetadata(): DbArtifactMetadata[] {
  return getDb()
    .prepare<[], DbArtifactMetadata>(
      `SELECT * FROM artifacts
       WHERE deleted_at IS NULL
       ORDER BY created_at ASC, id ASC`,
    )
    .all()
}

export function markArtifactDeleted(id: string, deletedAt: number = Date.now()): void {
  getDb()
    .prepare(`UPDATE artifacts SET deleted_at = ?, updated_at = ? WHERE id = ?`)
    .run(deletedAt, deletedAt, id)
}

export function insertDiagnosticEvent(input: {
  kind: string
  summary: string
  runId?: string
  sessionId?: string
  requestGroupId?: string
  recoveryKey?: string
  detail?: Record<string, unknown>
}): string {
  const id = crypto.randomUUID()
  getDb()
    .prepare(
      `INSERT INTO diagnostic_events
       (id, run_id, session_id, request_group_id, recovery_key, kind, summary, detail_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      input.runId ?? null,
      input.sessionId ?? null,
      input.requestGroupId ?? null,
      input.recoveryKey ?? null,
      input.kind,
      input.summary,
      toJsonOrNull(input.detail),
      Date.now(),
    )
  return id
}

export function enqueueMemoryWritebackCandidate(input: {
  scope: MemoryScope
  ownerId?: string
  sourceType: string
  content: string
  metadata?: Record<string, unknown>
  runId?: string
  status?: MemoryWritebackStatus
  lastError?: string
}): string {
  const ownerId = resolveMemoryOwnerId(input.scope, input.ownerId)
  const id = crypto.randomUUID()
  const now = Date.now()
  const status = input.status ?? "pending"
  getDb()
    .prepare(
      `INSERT INTO memory_writeback_queue
       (id, scope, owner_id, source_type, content, metadata_json, status, retry_count, last_error, run_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?)`,
    )
    .run(
      id,
      input.scope,
      ownerId,
      input.sourceType,
      input.content,
      toJsonOrNull(input.metadata),
      status,
      input.lastError ?? null,
      input.runId ?? null,
      now,
      now,
    )
  return id
}

export function listMemoryWritebackCandidates(
  input: {
    status?: MemoryWritebackStatus | "all"
    limit?: number
  } = {},
): DbMemoryWritebackCandidate[] {
  const status = input.status ?? "pending"
  const limit = Math.max(1, Math.min(500, Math.floor(input.limit ?? 100)))
  if (status === "all") {
    return getDb()
      .prepare<[number], DbMemoryWritebackCandidate>(
        `SELECT * FROM memory_writeback_queue ORDER BY updated_at DESC LIMIT ?`,
      )
      .all(limit)
  }
  return getDb()
    .prepare<[MemoryWritebackStatus, number], DbMemoryWritebackCandidate>(
      `SELECT * FROM memory_writeback_queue WHERE status = ? ORDER BY updated_at DESC LIMIT ?`,
    )
    .all(status, limit)
}

export function getMemoryWritebackCandidate(id: string): DbMemoryWritebackCandidate | undefined {
  return getDb()
    .prepare<[string], DbMemoryWritebackCandidate>(
      `SELECT * FROM memory_writeback_queue WHERE id = ? LIMIT 1`,
    )
    .get(id)
}

export function updateMemoryWritebackCandidate(input: {
  id: string
  status: MemoryWritebackStatus
  content?: string
  metadata?: Record<string, unknown>
  lastError?: string | null
}): DbMemoryWritebackCandidate | undefined {
  const current = getMemoryWritebackCandidate(input.id)
  if (!current) return undefined
  const nextContent = input.content ?? current.content
  const nextMetadata =
    input.metadata !== undefined ? toJsonOrNull(input.metadata) : current.metadata_json
  const nextLastError = Object.prototype.hasOwnProperty.call(input, "lastError")
    ? (input.lastError ?? null)
    : current.last_error
  getDb()
    .prepare(
      `UPDATE memory_writeback_queue
       SET status = ?, content = ?, metadata_json = ?, last_error = ?, updated_at = ?
       WHERE id = ?`,
    )
    .run(input.status, nextContent, nextMetadata, nextLastError, Date.now(), input.id)
  return getMemoryWritebackCandidate(input.id)
}

export function upsertSessionSnapshot(input: {
  sessionId: string
  summary: string
  preservedFacts?: string[]
  activeTaskIds?: string[]
}): string {
  const id = crypto.randomUUID()
  const now = Date.now()
  getDb()
    .prepare(
      `INSERT INTO session_snapshots
       (id, session_id, snapshot_version, summary, preserved_facts, active_task_ids, created_at, updated_at)
       VALUES (?, ?, 1, ?, ?, ?, ?, ?)
       ON CONFLICT(session_id, snapshot_version) DO UPDATE SET
         summary = excluded.summary,
         preserved_facts = excluded.preserved_facts,
         active_task_ids = excluded.active_task_ids,
         updated_at = excluded.updated_at`,
    )
    .run(
      id,
      input.sessionId,
      input.summary,
      JSON.stringify(input.preservedFacts ?? []),
      JSON.stringify(input.activeTaskIds ?? []),
      now,
      now,
    )
  const row = getDb()
    .prepare<[string], { id: string }>(
      `SELECT id FROM session_snapshots WHERE session_id = ? AND snapshot_version = 1 LIMIT 1`,
    )
    .get(input.sessionId)
  return row?.id ?? id
}

export function upsertTaskContinuity(input: {
  lineageRootRunId: string
  parentRunId?: string
  handoffSummary?: string
  lastGoodState?: string
  pendingApprovals?: string[]
  pendingDelivery?: string[]
  lastToolReceipt?: string
  lastDeliveryReceipt?: string
  failedRecoveryKey?: string
  failureKind?: string
  recoveryBudget?: string
  status?: string
}): void {
  const hasField = (key: keyof typeof input): boolean =>
    Object.prototype.hasOwnProperty.call(input, key)
  getDb()
    .prepare(
      `INSERT INTO task_continuity
       (lineage_root_run_id, parent_run_id, handoff_summary, last_good_state, pending_approvals, pending_delivery,
        last_tool_receipt, last_delivery_receipt, failed_recovery_key, failure_kind, recovery_budget, continuity_status, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(lineage_root_run_id) DO UPDATE SET
         parent_run_id = COALESCE(excluded.parent_run_id, task_continuity.parent_run_id),
         handoff_summary = COALESCE(excluded.handoff_summary, task_continuity.handoff_summary),
         last_good_state = COALESCE(excluded.last_good_state, task_continuity.last_good_state),
         pending_approvals = COALESCE(excluded.pending_approvals, task_continuity.pending_approvals),
         pending_delivery = COALESCE(excluded.pending_delivery, task_continuity.pending_delivery),
         last_tool_receipt = COALESCE(excluded.last_tool_receipt, task_continuity.last_tool_receipt),
         last_delivery_receipt = COALESCE(excluded.last_delivery_receipt, task_continuity.last_delivery_receipt),
         failed_recovery_key = COALESCE(excluded.failed_recovery_key, task_continuity.failed_recovery_key),
         failure_kind = COALESCE(excluded.failure_kind, task_continuity.failure_kind),
         recovery_budget = COALESCE(excluded.recovery_budget, task_continuity.recovery_budget),
         continuity_status = COALESCE(excluded.continuity_status, task_continuity.continuity_status),
         updated_at = excluded.updated_at`,
    )
    .run(
      input.lineageRootRunId,
      input.parentRunId ?? null,
      input.handoffSummary ?? null,
      input.lastGoodState ?? null,
      hasField("pendingApprovals") ? JSON.stringify(input.pendingApprovals ?? []) : null,
      hasField("pendingDelivery") ? JSON.stringify(input.pendingDelivery ?? []) : null,
      input.lastToolReceipt ?? null,
      input.lastDeliveryReceipt ?? null,
      input.failedRecoveryKey ?? null,
      input.failureKind ?? null,
      input.recoveryBudget ?? null,
      input.status ?? null,
      Date.now(),
    )
}

function parseContinuityStringArray(value: string | null): string[] {
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

function mapTaskContinuity(row: DbTaskContinuity): TaskContinuitySnapshot {
  return {
    lineageRootRunId: row.lineage_root_run_id,
    ...(row.parent_run_id ? { parentRunId: row.parent_run_id } : {}),
    ...(row.handoff_summary ? { handoffSummary: row.handoff_summary } : {}),
    ...(row.last_good_state ? { lastGoodState: row.last_good_state } : {}),
    pendingApprovals: parseContinuityStringArray(row.pending_approvals),
    pendingDelivery: parseContinuityStringArray(row.pending_delivery),
    ...(row.last_tool_receipt ? { lastToolReceipt: row.last_tool_receipt } : {}),
    ...(row.last_delivery_receipt ? { lastDeliveryReceipt: row.last_delivery_receipt } : {}),
    ...(row.failed_recovery_key ? { failedRecoveryKey: row.failed_recovery_key } : {}),
    ...(row.failure_kind ? { failureKind: row.failure_kind } : {}),
    ...(row.recovery_budget ? { recoveryBudget: row.recovery_budget } : {}),
    ...(row.continuity_status ? { status: row.continuity_status } : {}),
    updatedAt: row.updated_at,
  }
}

export function getTaskContinuity(lineageRootRunId: string): TaskContinuitySnapshot | undefined {
  const row = getDb()
    .prepare<[string], DbTaskContinuity>(
      `SELECT * FROM task_continuity WHERE lineage_root_run_id = ?`,
    )
    .get(lineageRootRunId)
  return row ? mapTaskContinuity(row) : undefined
}

export function listTaskContinuityForLineages(
  lineageRootRunIds: string[],
): TaskContinuitySnapshot[] {
  const ids = [...new Set(lineageRootRunIds.filter((value) => value.trim().length > 0))]
  if (ids.length === 0) return []
  const placeholders = ids.map(() => "?").join(", ")
  return getDb()
    .prepare<unknown[], DbTaskContinuity>(
      `SELECT * FROM task_continuity WHERE lineage_root_run_id IN (${placeholders})`,
    )
    .all(...ids)
    .map(mapTaskContinuity)
}

export function insertMemoryItem(item: {
  content: string
  tags?: string[]
  scope?: MemoryScope
  sessionId?: string
  runId?: string
  requestGroupId?: string
  type?: string
  importance?: string
}): string {
  if (
    (item.scope === "session" || item.scope === "short-term" || item.scope === "flash-feedback") &&
    !item.sessionId
  ) {
    throw new Error(`${item.scope} memory requires a session id`)
  }
  if (item.scope === "task" && !item.runId && !item.requestGroupId) {
    throw new Error("task memory requires a runId or requestGroupId")
  }
  if (item.scope === "schedule" && !item.requestGroupId) {
    throw new Error("schedule memory requires a schedule id")
  }
  const id = crypto.randomUUID()
  const now = Date.now()
  const db = getDb()
  db.prepare(
    `INSERT INTO memory_items (id, content, tags, source, memory_scope, session_id, run_id, request_group_id, type, importance, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    item.content,
    JSON.stringify(item.tags ?? []),
    "agent",
    item.scope ?? "global",
    item.sessionId ?? null,
    item.runId ?? null,
    item.requestGroupId ?? null,
    item.type ?? "user_fact",
    item.importance ?? "medium",
    now,
    now,
  )
  // Sync into FTS index
  db.prepare(
    `INSERT INTO memory_fts(rowid, content, tags)
     SELECT rowid, content, tags FROM memory_items WHERE id = ?`,
  ).run(id)
  return id
}

function buildMemoryScopeWhere(
  filters?: {
    sessionId?: string
    runId?: string
    requestGroupId?: string
    scheduleId?: string
    includeSchedule?: boolean
  },
  alias = "m",
): { clause: string; values: string[] } {
  const prefix = alias ? `${alias}.` : ""
  const clauses = [
    `${prefix}memory_scope = 'global'`,
    `${prefix}memory_scope = 'long-term'`,
    `${prefix}memory_scope IS NULL`,
    `${prefix}memory_scope = ''`,
  ]
  const values: string[] = []

  if (filters?.sessionId) {
    clauses.push(
      `(${prefix}memory_scope IN ('session', 'short-term', 'flash-feedback') AND ${prefix}session_id = ?)`,
    )
    values.push(filters.sessionId)
  }

  const taskOwners = [filters?.requestGroupId, filters?.runId].filter((value): value is string =>
    Boolean(value),
  )
  if (taskOwners.length > 0) {
    const placeholders = taskOwners.map(() => "?").join(", ")
    clauses.push(
      `(${prefix}memory_scope = 'task' AND (${prefix}request_group_id IN (${placeholders}) OR ${prefix}run_id IN (${placeholders})))`,
    )
    values.push(...taskOwners, ...taskOwners)
  }

  if (filters?.includeSchedule && filters.scheduleId) {
    clauses.push(`(${prefix}memory_scope = 'schedule' AND ${prefix}request_group_id = ?)`)
    values.push(filters.scheduleId)
  }

  return {
    clause: `(${clauses.join(" OR ")})`,
    values,
  }
}

function sanitizeMemoryFtsQuery(query: string): string | null {
  const terms =
    query
      .normalize("NFKC")
      .match(/[\p{L}\p{N}_]+/gu)
      ?.map((term) => term.trim())
      .filter(Boolean)
      .slice(0, 12) ?? []
  return terms.length > 0 ? terms.map((term) => `"${term.replace(/"/g, '""')}"`).join(" OR ") : null
}

function escapeMemoryLike(query: string): string {
  return query.replace(/[\\%_]/g, (match) => `\\${match}`)
}

export function searchMemoryItems(
  query: string,
  limit = 5,
  filters?: {
    sessionId?: string
    runId?: string
    requestGroupId?: string
  },
): DbMemoryItem[] {
  const scope = buildMemoryScopeWhere(filters)
  const sanitized = sanitizeMemoryFtsQuery(query)
  if (sanitized) {
    try {
      return getDb()
        .prepare<unknown[], DbMemoryItem>(
          `SELECT m.* FROM memory_fts f
           JOIN memory_items m ON m.rowid = f.rowid
           WHERE memory_fts MATCH ?
             AND ${scope.clause}
           ORDER BY rank
           LIMIT ?`,
        )
        .all(sanitized, ...scope.values, limit)
    } catch {
      // Fall through to LIKE search when MATCH rejects special input or the FTS table is unavailable.
    }
  }

  const likeScope = buildMemoryScopeWhere(filters, "")
  const pattern = `%${escapeMemoryLike(query.normalize("NFKC").trim())}%`
  return getDb()
    .prepare<unknown[], DbMemoryItem>(
      `SELECT * FROM memory_items
       WHERE content LIKE ? ESCAPE '\\'
         AND ${likeScope.clause}
       ORDER BY updated_at DESC
       LIMIT ?`,
    )
    .all(pattern, ...likeScope.values, limit)
}

export function getRecentMemoryItems(
  limit = 10,
  filters?: {
    sessionId?: string
    runId?: string
    requestGroupId?: string
  },
): DbMemoryItem[] {
  const scope = buildMemoryScopeWhere(filters, "")
  return getDb()
    .prepare<unknown[], DbMemoryItem>(
      `SELECT * FROM memory_items
       WHERE ${scope.clause}
       ORDER BY updated_at DESC LIMIT ?`,
    )
    .all(...scope.values, limit)
}

export function markMessagesCompressed(ids: string[], summaryId: string): void {
  if (!ids.length) return
  const db = getDb()
  const update = db.prepare<[string, string]>(
    "UPDATE messages SET compressed = 1, summary_id = ? WHERE id = ?",
  )
  const tx = db.transaction(() => {
    for (const id of ids) update.run(summaryId, id)
  })
  tx()
}

// ── Schedules ─────────────────────────────────────────────────────────────

export interface DbSchedule {
  id: string
  name: string
  cron_expression: string
  timezone: string | null
  prompt: string
  enabled: number // 0 | 1
  target_channel: string
  target_session_id: string | null
  execution_driver: string
  origin_run_id: string | null
  origin_request_group_id: string | null
  model: string | null
  max_retries: number
  timeout_sec: number
  contract_json: string | null
  identity_key: string | null
  payload_hash: string | null
  delivery_key: string | null
  contract_schema_version: number | null
  created_at: number
  updated_at: number
  // computed / optional
  last_run_at?: number | null
  next_run_at?: number | null
  legacy?: number
}

export type DbScheduleInsertInput = Omit<
  DbSchedule,
  | "last_run_at"
  | "next_run_at"
  | "timezone"
  | "contract_json"
  | "identity_key"
  | "payload_hash"
  | "delivery_key"
  | "contract_schema_version"
  | "legacy"
> & {
  timezone?: string | null
  contract?: ScheduleContract
  contract_json?: string | null
  identity_key?: string | null
  payload_hash?: string | null
  delivery_key?: string | null
  contract_schema_version?: number | null
}

export interface DbScheduleRun {
  id: string
  schedule_id: string
  started_at: number
  finished_at: number | null
  success: number | null // 0 | 1
  summary: string | null
  error: string | null
  execution_success?: number | null
  delivery_success?: number | null
  delivery_dedupe_key?: string | null
  delivery_error?: string | null
}

export type DbScheduleDeliveryStatus = "delivered" | "failed" | "skipped"

export interface DbScheduleDeliveryReceipt {
  dedupe_key: string
  schedule_id: string
  schedule_run_id: string
  due_at: string
  target_channel: string
  target_session_id: string | null
  payload_hash: string
  delivery_status: DbScheduleDeliveryStatus
  summary: string | null
  error: string | null
  created_at: number
  updated_at: number
}

export type DbScheduleDeliveryReceiptInput = Omit<
  DbScheduleDeliveryReceipt,
  "created_at" | "updated_at"
> & {
  created_at?: number
  updated_at?: number
}

export function getSchedules(): DbSchedule[] {
  return getDb()
    .prepare<[], DbSchedule>(
      `SELECT s.*,
        (SELECT r.started_at FROM schedule_runs r WHERE r.schedule_id = s.id ORDER BY r.started_at DESC LIMIT 1) AS last_run_at,
        CASE WHEN s.contract_json IS NULL OR s.contract_schema_version IS NULL THEN 1 ELSE 0 END AS legacy
       FROM schedules s ORDER BY s.created_at DESC`,
    )
    .all()
}

export function getSchedule(id: string): DbSchedule | undefined {
  return getDb()
    .prepare<[string], DbSchedule>(
      `SELECT s.*,
        (SELECT r.started_at FROM schedule_runs r WHERE r.schedule_id = s.id ORDER BY r.started_at DESC LIMIT 1) AS last_run_at,
        CASE WHEN s.contract_json IS NULL OR s.contract_schema_version IS NULL THEN 1 ELSE 0 END AS legacy
       FROM schedules s WHERE s.id = ?`,
    )
    .get(id)
}

export function getSchedulesForSession(sessionId: string, enabledOnly = false): DbSchedule[] {
  const enabledClause = enabledOnly ? "AND s.enabled = 1" : ""
  return getDb()
    .prepare<[string], DbSchedule>(
      `SELECT s.*,
        (SELECT r.started_at FROM schedule_runs r WHERE r.schedule_id = s.id ORDER BY r.started_at DESC LIMIT 1) AS last_run_at,
        CASE WHEN s.contract_json IS NULL OR s.contract_schema_version IS NULL THEN 1 ELSE 0 END AS legacy
       FROM schedules s
       WHERE s.target_session_id = ?
       ${enabledClause}
       ORDER BY s.created_at DESC`,
    )
    .all(sessionId)
}

export function prepareScheduleContractPersistence(
  contract: ScheduleContract,
): Pick<
  DbSchedule,
  "contract_json" | "identity_key" | "payload_hash" | "delivery_key" | "contract_schema_version"
> {
  const validation = validateScheduleContract(contract)
  if (!validation.ok) {
    throw new Error(formatContractValidationFailureForUser(validation.issues))
  }

  return {
    contract_json: toCanonicalJson(contract),
    identity_key: buildScheduleIdentityKey(contract),
    payload_hash: buildPayloadHash(contract.payload),
    delivery_key: buildDeliveryKey(contract.delivery),
    contract_schema_version: contract.schemaVersion,
  }
}

export function isLegacySchedule(
  schedule: Pick<DbSchedule, "contract_json" | "contract_schema_version">,
): boolean {
  return !schedule.contract_json || schedule.contract_schema_version == null
}

export function insertSchedule(s: DbScheduleInsertInput): void {
  assertMigrationWriteAllowed(getDb(), "schedule.insert")
  const contractFields = s.contract
    ? prepareScheduleContractPersistence(s.contract)
    : {
        contract_json: s.contract_json ?? null,
        identity_key: s.identity_key ?? null,
        payload_hash: s.payload_hash ?? null,
        delivery_key: s.delivery_key ?? null,
        contract_schema_version: s.contract_schema_version ?? null,
      }

  getDb()
    .prepare(
      `INSERT INTO schedules (id, name, cron_expression, timezone, prompt, enabled, target_channel, target_session_id, execution_driver, origin_run_id, origin_request_group_id, model, max_retries, timeout_sec, contract_json, identity_key, payload_hash, delivery_key, contract_schema_version, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      s.id,
      s.name,
      s.cron_expression,
      s.timezone ?? null,
      s.prompt,
      s.enabled,
      s.target_channel,
      s.target_session_id,
      s.execution_driver,
      s.origin_run_id,
      s.origin_request_group_id,
      s.model,
      s.max_retries,
      s.timeout_sec,
      contractFields.contract_json,
      contractFields.identity_key,
      contractFields.payload_hash,
      contractFields.delivery_key,
      contractFields.contract_schema_version,
      s.created_at,
      s.updated_at,
    )
}

export function updateSchedule(
  id: string,
  fields: Partial<Omit<DbSchedule, "id" | "created_at" | "last_run_at" | "next_run_at">>,
): void {
  assertMigrationWriteAllowed(getDb(), "schedule.update")
  const sets: string[] = []
  const vals: unknown[] = []
  for (const [k, v] of Object.entries(fields)) {
    sets.push(`${k} = ?`)
    vals.push(v)
  }
  if (!sets.length) return
  vals.push(Date.now(), id)
  getDb()
    .prepare(`UPDATE schedules SET ${sets.join(", ")}, updated_at = ? WHERE id = ?`)
    .run(...vals)
}

export function deleteSchedule(id: string): void {
  assertMigrationWriteAllowed(getDb(), "schedule.delete")
  getDb().prepare("DELETE FROM schedules WHERE id = ?").run(id)
}

export function getScheduleRuns(
  scheduleId: string,
  limit: number,
  offset: number,
): DbScheduleRun[] {
  return getDb()
    .prepare<[string, number, number], DbScheduleRun>(
      "SELECT * FROM schedule_runs WHERE schedule_id = ? ORDER BY started_at DESC LIMIT ? OFFSET ?",
    )
    .all(scheduleId, limit, offset)
}

export function listUnfinishedScheduleRuns(limit = 200): DbScheduleRun[] {
  return getDb()
    .prepare<[number], DbScheduleRun>(
      `SELECT * FROM schedule_runs
       WHERE finished_at IS NULL OR success IS NULL
       ORDER BY started_at DESC
       LIMIT ?`,
    )
    .all(Math.max(1, Math.min(1000, Math.floor(limit))))
}

export function interruptUnfinishedScheduleRunsOnStartup(
  input: {
    finishedAt?: number
    error?: string
    limit?: number
  } = {},
): DbScheduleRun[] {
  const rows = listUnfinishedScheduleRuns(input.limit ?? 200)
  if (!rows.length) return []
  const finishedAt = input.finishedAt ?? Date.now()
  const error = input.error ?? "Interrupted by daemon restart; not retried automatically."
  const update = getDb().prepare<[number, string, string]>(
    `UPDATE schedule_runs
     SET finished_at = ?, success = 0, error = COALESCE(error, ?)
     WHERE id = ? AND (finished_at IS NULL OR success IS NULL)`,
  )
  const tx = getDb().transaction(() => {
    for (const row of rows) update.run(finishedAt, error, row.id)
  })
  tx()
  return rows
}

export function countScheduleRuns(scheduleId: string): number {
  return (
    getDb()
      .prepare<[string], { n: number }>(
        "SELECT COUNT(*) as n FROM schedule_runs WHERE schedule_id = ?",
      )
      .get(scheduleId) as { n: number }
  ).n
}

export function insertScheduleRun(r: DbScheduleRun): void {
  getDb()
    .prepare(
      `INSERT INTO schedule_runs (id, schedule_id, started_at, finished_at, success, summary, error)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(r.id, r.schedule_id, r.started_at, r.finished_at, r.success, r.summary, r.error)
}

export function updateScheduleRun(
  id: string,
  fields: Partial<
    Pick<
      DbScheduleRun,
      | "finished_at"
      | "success"
      | "summary"
      | "error"
      | "execution_success"
      | "delivery_success"
      | "delivery_dedupe_key"
      | "delivery_error"
    >
  >,
): void {
  const sets: string[] = []
  const vals: unknown[] = []
  for (const [k, v] of Object.entries(fields)) {
    sets.push(`${k} = ?`)
    vals.push(v)
  }
  if (!sets.length) return
  vals.push(id)
  getDb()
    .prepare(`UPDATE schedule_runs SET ${sets.join(", ")} WHERE id = ?`)
    .run(...vals)
}

export function getScheduleDeliveryReceipt(
  dedupeKey: string,
): DbScheduleDeliveryReceipt | undefined {
  return getDb()
    .prepare<[string], DbScheduleDeliveryReceipt>(
      "SELECT * FROM schedule_delivery_receipts WHERE dedupe_key = ?",
    )
    .get(dedupeKey)
}

export function insertScheduleDeliveryReceipt(input: DbScheduleDeliveryReceiptInput): void {
  const now = Date.now()
  const createdAt = input.created_at ?? now
  const updatedAt = input.updated_at ?? now
  getDb()
    .prepare(
      `INSERT INTO schedule_delivery_receipts
       (dedupe_key, schedule_id, schedule_run_id, due_at, target_channel, target_session_id, payload_hash, delivery_status, summary, error, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(dedupe_key) DO UPDATE SET
         schedule_run_id = excluded.schedule_run_id,
         delivery_status = excluded.delivery_status,
         summary = excluded.summary,
         error = excluded.error,
         updated_at = excluded.updated_at`,
    )
    .run(
      input.dedupe_key,
      input.schedule_id,
      input.schedule_run_id,
      input.due_at,
      input.target_channel,
      input.target_session_id,
      input.payload_hash,
      input.delivery_status,
      input.summary,
      input.error,
      createdAt,
      updatedAt,
    )
}

export function getScheduleStats(scheduleId: string): {
  total: number
  successes: number
  failures: number
  avgDurationMs: number | null
  lastRunAt: number | null
} {
  const row = getDb()
    .prepare<
      [string],
      {
        total: number
        successes: number
        failures: number
        avg_ms: number | null
        last_run: number | null
      }
    >(
      `SELECT
         COUNT(*) as total,
         SUM(CASE WHEN success = 1 THEN 1 ELSE 0 END) as successes,
         SUM(CASE WHEN success = 0 THEN 1 ELSE 0 END) as failures,
         AVG(CASE WHEN finished_at IS NOT NULL THEN finished_at - started_at END) as avg_ms,
         MAX(started_at) as last_run
       FROM schedule_runs WHERE schedule_id = ?`,
    )
    .get(scheduleId)
  return {
    total: row?.total ?? 0,
    successes: row?.successes ?? 0,
    failures: row?.failures ?? 0,
    avgDurationMs: row?.avg_ms ? Math.round(row.avg_ms) : null,
    lastRunAt: row?.last_run ?? null,
  }
}
