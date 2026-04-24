import BetterSqlite3 from "better-sqlite3";
import { type ScheduleContract } from "../contracts/index.js";
import { type AgentConfig, type AgentEntityType, type AgentRelationship, type AgentStatus, type CapabilityDelegationRequest, type CapabilityPolicy, type CapabilityRiskLevel, type DataExchangePackage, type HistoryVersion, type LearningEvent, type OwnerScope, type PermissionProfile, type RestoreEvent, type SubSessionContract, type TeamConfig, type TeamConflictPolicyMode, type TeamExecutionPlan, type TeamResultPolicyMode } from "../contracts/sub-agent-orchestration.js";
import type { PromptSourceMetadata, PromptSourceSnapshot, PromptSourceState } from "../memory/nobie-md.js";
export declare function getDb(): BetterSqlite3.Database;
export declare function closeDb(): void;
export interface DbSession {
    id: string;
    source: string;
    source_id: string | null;
    created_at: number;
    updated_at: number;
    summary: string | null;
    token_count: number;
}
export interface DbMessage {
    id: string;
    session_id: string;
    root_run_id?: string | null;
    role: string;
    content: string;
    tool_calls: string | null;
    tool_call_id: string | null;
    created_at: number;
}
export interface DbRequestGroupMessage extends DbMessage {
    run_prompt: string | null;
    run_request_group_id: string | null;
    run_worker_session_id: string | null;
    run_context_mode: string | null;
}
export interface DbAuditLog {
    id: string;
    timestamp: number;
    session_id: string | null;
    run_id: string | null;
    request_group_id: string | null;
    channel: string | null;
    source: string;
    tool_name: string;
    params: string | null;
    output: string | null;
    result: string;
    duration_ms: number | null;
    approval_required: number;
    approved_by: string | null;
    error_code: string | null;
    retry_count: number | null;
    stop_reason: string | null;
}
type DbAuditLogInput = Omit<DbAuditLog, "id" | "run_id" | "request_group_id" | "channel" | "error_code" | "retry_count" | "stop_reason"> & Partial<Pick<DbAuditLog, "run_id" | "request_group_id" | "channel" | "error_code" | "retry_count" | "stop_reason">>;
export interface DbChannelMessageRef {
    id: string;
    source: string;
    session_id: string;
    root_run_id: string;
    request_group_id: string;
    external_chat_id: string;
    external_thread_id: string | null;
    external_message_id: string;
    role: string;
    created_at: number;
}
export interface DbDecisionTrace {
    id: string;
    run_id: string | null;
    request_group_id: string | null;
    session_id: string | null;
    source: string | null;
    channel: string | null;
    decision_kind: string;
    reason_code: string;
    input_contract_ids_json: string | null;
    receipt_ids_json: string | null;
    sanitized_detail_json: string | null;
    created_at: number;
}
export interface DbDecisionTraceInput {
    id?: string;
    runId?: string | null;
    requestGroupId?: string | null;
    sessionId?: string | null;
    source?: string | null;
    channel?: string | null;
    decisionKind: string;
    reasonCode: string;
    inputContractIds?: string[];
    receiptIds?: string[];
    detail?: Record<string, unknown>;
    createdAt?: number;
}
export type DbMessageLedgerStatus = "received" | "pending" | "started" | "generated" | "sent" | "delivered" | "succeeded" | "failed" | "skipped" | "suppressed" | "degraded";
export interface DbMessageLedgerEvent {
    id: string;
    run_id: string | null;
    request_group_id: string | null;
    session_key: string | null;
    thread_key: string | null;
    channel: string;
    event_kind: string;
    delivery_key: string | null;
    idempotency_key: string | null;
    status: DbMessageLedgerStatus;
    summary: string;
    detail_json: string | null;
    created_at: number;
}
export interface DbMessageLedgerInput {
    id?: string;
    runId?: string | null;
    requestGroupId?: string | null;
    sessionKey?: string | null;
    threadKey?: string | null;
    channel: string;
    eventKind: string;
    deliveryKey?: string | null;
    idempotencyKey?: string | null;
    status: DbMessageLedgerStatus;
    summary: string;
    detail?: Record<string, unknown>;
    createdAt?: number;
}
export type DbQueueBackpressureEventKind = "queued" | "running" | "completed" | "failed" | "timeout" | "rejected" | "retry_scheduled" | "dead_letter" | "reset";
export interface DbQueueBackpressureEvent {
    id: string;
    created_at: number;
    queue_name: string;
    event_kind: DbQueueBackpressureEventKind;
    run_id: string | null;
    request_group_id: string | null;
    pending_count: number;
    retry_count: number;
    retry_budget_remaining: number | null;
    recovery_key: string | null;
    action_taken: string;
    detail_json: string | null;
}
export interface DbQueueBackpressureEventInput {
    id?: string;
    createdAt?: number;
    queueName: string;
    eventKind: DbQueueBackpressureEventKind;
    runId?: string | null;
    requestGroupId?: string | null;
    pendingCount?: number;
    retryCount?: number;
    retryBudgetRemaining?: number | null;
    recoveryKey?: string | null;
    actionTaken: string;
    detail?: Record<string, unknown>;
}
export interface DbWebRetrievalCacheEntry {
    cache_key: string;
    target_hash: string;
    source_evidence_id: string;
    verdict_id: string;
    freshness_policy: "normal" | "latest_approximate" | "strict_timestamp";
    ttl_ms: number;
    fetch_timestamp: string;
    created_at: number;
    expires_at: number;
    value_json: string;
    evidence_json: string;
    verdict_json: string;
    metadata_json: string | null;
}
export interface DbWebRetrievalCacheEntryInput {
    cacheKey: string;
    targetHash: string;
    sourceEvidenceId: string;
    verdictId: string;
    freshnessPolicy: DbWebRetrievalCacheEntry["freshness_policy"];
    ttlMs: number;
    fetchTimestamp: string;
    createdAt: number;
    expiresAt: number;
    value: Record<string, unknown>;
    evidence: Record<string, unknown>;
    verdict: Record<string, unknown>;
    metadata?: Record<string, unknown>;
}
export type DbConfigSource = "manual" | "import" | "system";
export interface DbAgentConfig {
    agent_id: string;
    agent_type: AgentEntityType;
    status: AgentStatus;
    display_name: string;
    nickname: string | null;
    normalized_nickname: string | null;
    role: string;
    personality: string;
    specialty_tags_json: string;
    avoid_tasks_json: string;
    model_profile_json: string | null;
    memory_policy_json: string;
    capability_policy_json: string;
    delegation_policy_json: string | null;
    profile_version: number;
    config_json: string;
    schema_version: number;
    source: DbConfigSource;
    audit_id: string | null;
    idempotency_key: string | null;
    created_at: number;
    updated_at: number;
    archived_at: number | null;
}
export interface DbTeamConfig {
    team_id: string;
    status: Exclude<AgentStatus, "degraded">;
    display_name: string;
    nickname: string | null;
    normalized_nickname: string | null;
    purpose: string;
    owner_agent_id: string | null;
    lead_agent_id: string | null;
    member_count_min: number | null;
    member_count_max: number | null;
    required_team_roles_json: string | null;
    required_capability_tags_json: string | null;
    result_policy: TeamResultPolicyMode | null;
    conflict_policy: TeamConflictPolicyMode | null;
    role_hints_json: string;
    member_agent_ids_json: string;
    profile_version: number;
    config_json: string;
    schema_version: number;
    source: DbConfigSource;
    audit_id: string | null;
    idempotency_key: string | null;
    created_at: number;
    updated_at: number;
    archived_at: number | null;
}
export interface DbAgentTeamMembership {
    membership_id: string;
    team_id: string;
    agent_id: string;
    owner_agent_id_snapshot: string | null;
    team_roles_json: string;
    primary_role: string;
    required: number;
    fallback_for_agent_id: string | null;
    status: "active" | "inactive" | "fallback_only" | "unresolved" | "removed";
    role_hint: string | null;
    sort_order: number;
    schema_version: number;
    audit_id: string | null;
    created_at: number;
    updated_at: number;
}
export interface DbNicknameNamespace {
    normalized_nickname: string;
    entity_type: "agent" | "team";
    entity_id: string;
    nickname_snapshot: string;
    status: string;
    source: DbConfigSource;
    created_at: number;
    updated_at: number;
}
export interface DbAgentRelationship {
    edge_id: string;
    parent_agent_id: string;
    child_agent_id: string;
    relationship_type: "parent_child";
    status: AgentRelationship["status"];
    sort_order: number;
    schema_version: number;
    audit_id: string | null;
    created_at: number;
    updated_at: number;
}
export interface DbRunSubSession {
    sub_session_id: string;
    parent_run_id: string;
    parent_session_id: string;
    parent_sub_session_id: string | null;
    parent_request_id: string | null;
    agent_id: string;
    agent_display_name: string;
    agent_nickname: string | null;
    command_request_id: string;
    status: SubSessionContract["status"];
    retry_budget_remaining: number;
    prompt_bundle_id: string;
    contract_json: string;
    schema_version: number;
    audit_id: string | null;
    idempotency_key: string;
    created_at: number;
    updated_at: number;
    started_at: number | null;
    finished_at: number | null;
}
export interface DbAgentDataExchange {
    exchange_id: string;
    source_owner_type: DataExchangePackage["sourceOwner"]["ownerType"];
    source_owner_id: string;
    source_nickname_snapshot: string | null;
    recipient_owner_type: DataExchangePackage["recipientOwner"]["ownerType"];
    recipient_owner_id: string;
    recipient_nickname_snapshot: string | null;
    purpose: string;
    allowed_use: DataExchangePackage["allowedUse"];
    retention_policy: DataExchangePackage["retentionPolicy"];
    redaction_state: DataExchangePackage["redactionState"];
    provenance_refs_json: string;
    payload_json: string;
    contract_json: string | null;
    schema_version: number;
    audit_id: string | null;
    idempotency_key: string;
    created_at: number;
    updated_at: number;
    expires_at: number | null;
}
export interface DbTeamExecutionPlan {
    team_execution_plan_id: string;
    parent_run_id: string;
    team_id: string;
    team_nickname_snapshot: string | null;
    owner_agent_id: string;
    lead_agent_id: string;
    member_task_assignments_json: string;
    reviewer_agent_ids_json: string;
    verifier_agent_ids_json: string;
    fallback_assignments_json: string;
    coverage_report_json: string;
    conflict_policy_snapshot: TeamConflictPolicyMode;
    result_policy_snapshot: TeamResultPolicyMode;
    contract_json: string;
    schema_version: number;
    audit_id: string | null;
    created_at: number;
}
export interface DbCapabilityDelegation {
    delegation_id: string;
    requester_owner_type: CapabilityDelegationRequest["requester"]["ownerType"];
    requester_owner_id: string;
    provider_owner_type: CapabilityDelegationRequest["provider"]["ownerType"];
    provider_owner_id: string;
    capability: string;
    risk: CapabilityDelegationRequest["risk"];
    status: CapabilityDelegationRequest["status"];
    input_package_ids_json: string;
    result_package_id: string | null;
    approval_id: string | null;
    contract_json: string;
    schema_version: number;
    audit_id: string | null;
    idempotency_key: string;
    created_at: number;
    updated_at: number;
}
export interface DbLearningEvent {
    learning_event_id: string;
    agent_id: string;
    learning_target: LearningEvent["learningTarget"];
    before_summary: string;
    after_summary: string;
    evidence_refs_json: string;
    confidence: number;
    approval_state: LearningEvent["approvalState"];
    contract_json: string;
    schema_version: number;
    audit_id: string | null;
    idempotency_key: string;
    created_at: number;
    updated_at: number;
}
export interface DbProfileHistoryVersion {
    history_version_id: string;
    target_entity_type: HistoryVersion["targetEntityType"];
    target_entity_id: string;
    version: number;
    before_json: string;
    after_json: string;
    reason_code: string;
    schema_version: number;
    audit_id: string | null;
    idempotency_key: string;
    created_at: number;
}
export interface DbProfileRestoreEvent {
    restore_event_id: string;
    target_entity_type: RestoreEvent["targetEntityType"];
    target_entity_id: string;
    restored_history_version_id: string;
    dry_run: number;
    effect_summary_json: string;
    schema_version: number;
    audit_id: string | null;
    idempotency_key: string;
    created_at: number;
}
export type DbCapabilityCatalogStatus = "enabled" | "disabled" | "archived";
export type DbAgentCapabilityBindingStatus = "enabled" | "disabled" | "archived";
export type DbAgentCapabilityKind = "skill" | "mcp_server";
export interface DbSkillCatalogEntry {
    skill_id: string;
    status: DbCapabilityCatalogStatus;
    display_name: string;
    risk: CapabilityRiskLevel;
    tool_names_json: string;
    metadata_json: string | null;
    schema_version: number;
    source: DbConfigSource;
    audit_id: string | null;
    created_at: number;
    updated_at: number;
    archived_at: number | null;
}
export interface DbMcpServerCatalogEntry {
    mcp_server_id: string;
    status: DbCapabilityCatalogStatus;
    display_name: string;
    risk: CapabilityRiskLevel;
    tool_names_json: string;
    metadata_json: string | null;
    schema_version: number;
    source: DbConfigSource;
    audit_id: string | null;
    created_at: number;
    updated_at: number;
    archived_at: number | null;
}
export interface DbAgentCapabilityBinding {
    binding_id: string;
    agent_id: string;
    capability_kind: DbAgentCapabilityKind;
    catalog_id: string;
    status: DbAgentCapabilityBindingStatus;
    secret_scope_id: string | null;
    enabled_tool_names_json: string;
    disabled_tool_names_json: string;
    permission_profile_json: string | null;
    rate_limit_json: string | null;
    approval_required_from: CapabilityRiskLevel | null;
    schema_version: number;
    source: DbConfigSource;
    audit_id: string | null;
    created_at: number;
    updated_at: number;
    archived_at: number | null;
}
export interface AgentConfigPersistenceOptions {
    imported?: boolean;
    source?: DbConfigSource;
    auditId?: string | null;
    idempotencyKey?: string | null;
    now?: number;
}
export interface TeamConfigPersistenceOptions extends AgentConfigPersistenceOptions {
}
export interface CapabilityCatalogPersistenceOptions {
    source?: DbConfigSource;
    auditId?: string | null;
    now?: number;
}
export interface SkillCatalogEntryInput {
    skillId: string;
    displayName: string;
    status?: DbCapabilityCatalogStatus;
    risk?: CapabilityRiskLevel;
    toolNames?: string[];
    metadata?: Record<string, unknown>;
    createdAt?: number;
    updatedAt?: number;
}
export interface McpServerCatalogEntryInput {
    mcpServerId: string;
    displayName: string;
    status?: DbCapabilityCatalogStatus;
    risk?: CapabilityRiskLevel;
    toolNames?: string[];
    metadata?: Record<string, unknown>;
    createdAt?: number;
    updatedAt?: number;
}
export interface AgentCapabilityBindingInput {
    bindingId?: string;
    agentId: string;
    capabilityKind: DbAgentCapabilityKind;
    catalogId: string;
    status?: DbAgentCapabilityBindingStatus;
    secretScopeId?: string;
    enabledToolNames?: string[];
    disabledToolNames?: string[];
    permissionProfile?: PermissionProfile;
    rateLimit?: CapabilityPolicy["rateLimit"];
    approvalRequiredFrom?: CapabilityRiskLevel;
    createdAt?: number;
    updatedAt?: number;
}
export interface NicknameNamespaceErrorDetails {
    reasonCode: "nickname_required" | "nickname_conflict";
    attemptedEntityType: "agent" | "team";
    attemptedEntityId: string;
    nickname: string | null;
    normalizedNickname: string;
    existingEntityType?: "agent" | "team";
    existingEntityId?: string;
    existingNickname?: string | null;
    existingStatus?: string;
}
export declare class NicknameNamespaceError extends Error {
    readonly details: NicknameNamespaceErrorDetails;
    constructor(details: NicknameNamespaceErrorDetails);
}
export type DbControlEventSeverity = "debug" | "info" | "warning" | "error";
export interface DbControlEvent {
    id: string;
    created_at: number;
    event_type: string;
    correlation_id: string;
    run_id: string | null;
    request_group_id: string | null;
    session_key: string | null;
    component: string;
    severity: DbControlEventSeverity;
    summary: string;
    detail_json: string | null;
}
export interface DbControlEventInput {
    id?: string;
    createdAt?: number;
    eventType: string;
    correlationId: string;
    runId?: string | null;
    requestGroupId?: string | null;
    sessionKey?: string | null;
    component: string;
    severity?: DbControlEventSeverity;
    summary: string;
    detail?: Record<string, unknown>;
}
export type DbOrchestrationEventSeverity = DbControlEventSeverity;
export interface DbOrchestrationEvent {
    sequence: number;
    id: string;
    created_at: number;
    emitted_at: number;
    event_kind: string;
    run_id: string | null;
    parent_run_id: string | null;
    request_group_id: string | null;
    sub_session_id: string | null;
    agent_id: string | null;
    team_id: string | null;
    exchange_id: string | null;
    approval_id: string | null;
    correlation_id: string;
    dedupe_key: string | null;
    source: string;
    severity: DbOrchestrationEventSeverity;
    summary: string;
    payload_redacted_json: string;
    payload_raw_ref: string | null;
    producer_task: string | null;
}
export interface DbOrchestrationEventInput {
    id?: string;
    createdAt?: number;
    emittedAt?: number;
    eventKind: string;
    runId?: string | null;
    parentRunId?: string | null;
    requestGroupId?: string | null;
    subSessionId?: string | null;
    agentId?: string | null;
    teamId?: string | null;
    exchangeId?: string | null;
    approvalId?: string | null;
    correlationId: string;
    dedupeKey?: string | null;
    source: string;
    severity?: DbOrchestrationEventSeverity;
    summary: string;
    payloadRedacted: Record<string, unknown>;
    payloadRawRef?: string | null;
    producerTask?: string | null;
}
export type DbChannelSmokeRunMode = "dry-run" | "live-run";
export type DbChannelSmokeRunStatus = "running" | "passed" | "failed" | "skipped";
export type DbChannelSmokeStepStatus = "passed" | "failed" | "skipped";
export interface DbChannelSmokeRun {
    id: string;
    mode: DbChannelSmokeRunMode;
    status: DbChannelSmokeRunStatus;
    started_at: number;
    finished_at: number | null;
    scenario_count: number;
    passed_count: number;
    failed_count: number;
    skipped_count: number;
    initiated_by: string | null;
    summary: string | null;
    metadata_json: string | null;
}
export interface DbChannelSmokeStep {
    id: string;
    run_id: string;
    scenario_id: string;
    channel: string;
    scenario_kind: string;
    status: DbChannelSmokeStepStatus;
    reason: string | null;
    failures_json: string;
    trace_json: string | null;
    audit_log_id: string | null;
    started_at: number;
    finished_at: number;
}
export interface DbChannelSmokeRunInput {
    id?: string;
    mode: DbChannelSmokeRunMode;
    status?: DbChannelSmokeRunStatus;
    startedAt?: number;
    finishedAt?: number | null;
    scenarioCount?: number;
    passedCount?: number;
    failedCount?: number;
    skippedCount?: number;
    initiatedBy?: string | null;
    summary?: string | null;
    metadata?: Record<string, unknown>;
}
export interface DbChannelSmokeStepInput {
    id?: string;
    runId: string;
    scenarioId: string;
    channel: string;
    scenarioKind: string;
    status: DbChannelSmokeStepStatus;
    reason?: string | null;
    failures?: string[];
    trace?: Record<string, unknown> | null;
    auditLogId?: string | null;
    startedAt?: number;
    finishedAt?: number;
}
export interface DbPromptSource {
    source_id: string;
    locale: string;
    path: string;
    version: string;
    priority: number;
    enabled: number;
    is_required: number;
    usage_scope: string;
    checksum: string;
    updated_at: number;
}
export interface DbTaskContinuity {
    lineage_root_run_id: string;
    parent_run_id: string | null;
    handoff_summary: string | null;
    last_good_state: string | null;
    pending_approvals: string | null;
    pending_delivery: string | null;
    last_tool_receipt: string | null;
    last_delivery_receipt: string | null;
    failed_recovery_key: string | null;
    failure_kind: string | null;
    recovery_budget: string | null;
    continuity_status: string | null;
    updated_at: number;
}
export interface TaskContinuitySnapshot {
    lineageRootRunId: string;
    parentRunId?: string;
    handoffSummary?: string;
    lastGoodState?: string;
    pendingApprovals: string[];
    pendingDelivery: string[];
    lastToolReceipt?: string;
    lastDeliveryReceipt?: string;
    failedRecoveryKey?: string;
    failureKind?: string;
    recoveryBudget?: string;
    status?: string;
    updatedAt: number;
}
export type DbArtifactRetentionPolicy = "ephemeral" | "standard" | "permanent";
export interface DbArtifactMetadata {
    id: string;
    source_run_id: string | null;
    request_group_id: string | null;
    owner_channel: string;
    channel_target: string | null;
    artifact_path: string;
    mime_type: string;
    size_bytes: number | null;
    retention_policy: DbArtifactRetentionPolicy;
    expires_at: number | null;
    metadata_json: string | null;
    created_at: number;
    updated_at: number;
    deleted_at: number | null;
}
export interface ArtifactMetadataInput {
    artifactPath: string;
    ownerChannel: string;
    channelTarget?: string | null;
    sourceRunId?: string | null;
    requestGroupId?: string | null;
    mimeType?: string;
    sizeBytes?: number;
    retentionPolicy?: DbArtifactRetentionPolicy;
    expiresAt?: number | null;
    metadata?: Record<string, unknown>;
    createdAt?: number;
    updatedAt?: number;
}
export declare function insertSession(session: Omit<DbSession, "token_count">): void;
export declare function getSession(id: string): DbSession | undefined;
export declare function insertMessage(msg: DbMessage): void;
export declare function getMessages(sessionId: string): DbMessage[];
export declare function getMessagesForRequestGroup(sessionId: string, requestGroupId: string): DbMessage[];
export declare function getMessagesForRequestGroupWithRunMeta(sessionId: string, requestGroupId: string): DbRequestGroupMessage[];
export declare function getMessagesForRun(sessionId: string, runId: string): DbMessage[];
export declare function insertAuditLog(log: DbAuditLogInput): void;
export declare function insertChannelMessageRef(ref: Omit<DbChannelMessageRef, "id">): string;
export declare function insertDecisionTrace(input: DbDecisionTraceInput): string;
export declare function insertMessageLedgerEvent(input: DbMessageLedgerInput): string | null;
export declare function getMessageLedgerEventByIdempotencyKey(idempotencyKey: string): DbMessageLedgerEvent | undefined;
export declare function insertQueueBackpressureEvent(input: DbQueueBackpressureEventInput): string;
export declare function listQueueBackpressureEvents(input?: {
    queueName?: string;
    eventKind?: DbQueueBackpressureEventKind;
    recoveryKey?: string;
    limit?: number;
}): DbQueueBackpressureEvent[];
export declare function listMessageLedgerEvents(params?: {
    runId?: string;
    requestGroupId?: string;
    sessionKey?: string;
    threadKey?: string;
    limit?: number;
}): DbMessageLedgerEvent[];
export declare function insertControlEvent(input: DbControlEventInput): string;
export declare function listControlEvents(params?: {
    runId?: string;
    requestGroupId?: string;
    correlationId?: string;
    eventType?: string;
    component?: string;
    severity?: DbControlEventSeverity;
    limit?: number;
}): DbControlEvent[];
export declare function insertOrchestrationEvent(input: DbOrchestrationEventInput): DbOrchestrationEvent;
export declare function getOrchestrationEventById(id: string): DbOrchestrationEvent | undefined;
export declare function getOrchestrationEventByDedupeKey(dedupeKey: string): DbOrchestrationEvent | undefined;
export declare function listOrchestrationEvents(params?: {
    runId?: string;
    requestGroupId?: string;
    subSessionId?: string;
    agentId?: string;
    teamId?: string;
    exchangeId?: string;
    approvalId?: string;
    correlationId?: string;
    eventKind?: string;
    afterSequence?: number;
    limit?: number;
}): DbOrchestrationEvent[];
export declare function upsertWebRetrievalCacheEntry(input: DbWebRetrievalCacheEntryInput): void;
export declare function getWebRetrievalCacheEntry(cacheKey: string): DbWebRetrievalCacheEntry | undefined;
export declare function listWebRetrievalCacheEntries(params?: {
    targetHash?: string;
    freshnessPolicy?: DbWebRetrievalCacheEntry["freshness_policy"];
    now?: number;
    limit?: number;
}): DbWebRetrievalCacheEntry[];
export declare function findChannelMessageRef(params: {
    source: string;
    externalChatId: string;
    externalMessageId: string;
    externalThreadId?: string;
}): DbChannelMessageRef | undefined;
export declare function insertChannelSmokeRun(input: DbChannelSmokeRunInput): string;
export declare function updateChannelSmokeRun(id: string, fields: Partial<Pick<DbChannelSmokeRunInput, "status" | "finishedAt" | "scenarioCount" | "passedCount" | "failedCount" | "skippedCount" | "summary" | "metadata">>): void;
export declare function insertChannelSmokeStep(input: DbChannelSmokeStepInput): string;
export declare function getChannelSmokeRun(id: string): DbChannelSmokeRun | undefined;
export declare function listChannelSmokeRuns(limit?: number): DbChannelSmokeRun[];
export declare function listChannelSmokeSteps(runId: string): DbChannelSmokeStep[];
export declare function upsertPromptSources(sources: PromptSourceMetadata[]): void;
export declare function updateRunPromptSourceSnapshot(runId: string, snapshot: PromptSourceSnapshot): void;
export declare function getPromptSourceStates(): PromptSourceState[];
export type MemoryScope = "global" | "session" | "task" | "artifact" | "diagnostic" | "long-term" | "short-term" | "schedule" | "flash-feedback";
export interface DbMemoryItem {
    id: string;
    content: string;
    tags: string | null;
    source: string | null;
    memory_scope: MemoryScope | null;
    session_id: string | null;
    run_id: string | null;
    request_group_id: string | null;
    type: string | null;
    importance: string | null;
    embedding: Buffer | null;
    created_at: number;
    updated_at: number;
}
export interface DbMemoryDocument {
    id: string;
    scope: MemoryScope;
    owner_id: string;
    source_type: string;
    source_ref: string | null;
    title: string | null;
    raw_text: string;
    checksum: string;
    metadata_json: string | null;
    archived_at: number | null;
    created_at: number;
    updated_at: number;
}
export interface DbMemoryChunk {
    id: string;
    document_id: string;
    scope: MemoryScope;
    owner_id: string;
    ordinal: number;
    token_estimate: number;
    content: string;
    checksum: string;
    source_checksum: string | null;
    metadata_json: string | null;
    created_at: number;
    updated_at: number;
}
export type MemoryIndexJobStatus = "queued" | "indexing" | "embedded" | "failed" | "stale" | "disabled";
export type MemoryWritebackStatus = "pending" | "writing" | "failed" | "completed" | "discarded";
export interface DbMemoryWritebackCandidate {
    id: string;
    scope: MemoryScope;
    owner_id: string;
    source_type: string;
    content: string;
    metadata_json: string | null;
    status: MemoryWritebackStatus;
    retry_count: number;
    last_error: string | null;
    run_id: string | null;
    created_at: number;
    updated_at: number;
}
export interface DbMemoryChunkSearchRow extends DbMemoryChunk {
    document_title: string | null;
    document_source_type: string;
    document_source_ref: string | null;
    document_metadata_json: string | null;
    score: number;
}
export interface StoreMemoryDocumentInput {
    scope: MemoryScope;
    ownerId?: string;
    sourceType: string;
    sourceRef?: string;
    title?: string;
    rawText: string;
    checksum: string;
    metadata?: Record<string, unknown>;
    chunks: Array<{
        ordinal: number;
        tokenEstimate: number;
        content: string;
        checksum: string;
        metadata?: Record<string, unknown>;
    }>;
}
export interface StoreMemoryDocumentResult {
    documentId: string;
    chunkIds: string[];
    deduplicated: boolean;
}
export interface MemorySearchFilters {
    sessionId?: string;
    runId?: string;
    requestGroupId?: string;
    scheduleId?: string;
    ownerScope?: OwnerScope;
    recipientScope?: OwnerScope;
    includeSchedule?: boolean;
    includeArtifact?: boolean;
    includeDiagnostic?: boolean;
    includeFlashFeedback?: boolean;
}
export declare function upsertAgentConfig(input: AgentConfig, options?: AgentConfigPersistenceOptions): void;
export declare function getAgentConfig(agentId: string): DbAgentConfig | undefined;
export declare function listAgentConfigs(filters?: {
    enabledOnly?: boolean;
    includeArchived?: boolean;
    agentType?: AgentEntityType;
}): DbAgentConfig[];
export declare function disableAgentConfig(agentId: string, now?: number): boolean;
export declare function upsertTeamConfig(input: TeamConfig, options?: TeamConfigPersistenceOptions): void;
export declare function getTeamConfig(teamId: string): DbTeamConfig | undefined;
export declare function listTeamConfigs(filters?: {
    enabledOnly?: boolean;
    includeArchived?: boolean;
}): DbTeamConfig[];
export declare function listAgentTeamMemberships(teamId?: string): DbAgentTeamMembership[];
export declare function upsertSkillCatalogEntry(input: SkillCatalogEntryInput, options?: CapabilityCatalogPersistenceOptions): void;
export declare function upsertMcpServerCatalogEntry(input: McpServerCatalogEntryInput, options?: CapabilityCatalogPersistenceOptions): void;
export declare function upsertAgentCapabilityBinding(input: AgentCapabilityBindingInput, options?: CapabilityCatalogPersistenceOptions): void;
export declare function getAgentCapabilityBinding(bindingId: string): DbAgentCapabilityBinding | undefined;
export declare function listSkillCatalogEntries(filters?: {
    includeArchived?: boolean;
    enabledOnly?: boolean;
}): DbSkillCatalogEntry[];
export declare function listMcpServerCatalogEntries(filters?: {
    includeArchived?: boolean;
    enabledOnly?: boolean;
}): DbMcpServerCatalogEntry[];
export declare function listAgentCapabilityBindings(filters?: {
    agentId?: string;
    capabilityKind?: DbAgentCapabilityKind;
    includeArchived?: boolean;
    enabledOnly?: boolean;
}): DbAgentCapabilityBinding[];
export declare function listNicknameNamespaces(): DbNicknameNamespace[];
export declare function upsertAgentRelationship(input: AgentRelationship, options?: {
    auditId?: string | null;
    now?: number;
}): void;
export declare function getAgentRelationship(edgeId: string): DbAgentRelationship | undefined;
export declare function listAgentRelationships(filters?: {
    parentAgentId?: string;
    childAgentId?: string;
    status?: AgentRelationship["status"];
}): DbAgentRelationship[];
export declare function insertTeamExecutionPlan(input: TeamExecutionPlan, options?: {
    auditId?: string | null;
}): boolean;
export declare function getTeamExecutionPlan(teamExecutionPlanId: string): DbTeamExecutionPlan | undefined;
export declare function listTeamExecutionPlansForParentRun(parentRunId: string): DbTeamExecutionPlan[];
export declare function insertRunSubSession(input: SubSessionContract, options?: {
    auditId?: string | null;
    now?: number;
}): boolean;
export declare function updateRunSubSession(input: SubSessionContract, options?: {
    auditId?: string | null;
    now?: number;
}): boolean;
export declare function getRunSubSession(subSessionId: string): DbRunSubSession | undefined;
export declare function getRunSubSessionByIdempotencyKey(idempotencyKey: string): DbRunSubSession | undefined;
export declare function listRunSubSessionsForParentRun(parentRunId: string): DbRunSubSession[];
export declare function insertAgentDataExchange(input: DataExchangePackage, options?: {
    auditId?: string | null;
    expiresAt?: number | null;
    now?: number;
}): boolean;
export declare function getAgentDataExchange(exchangeId: string): DbAgentDataExchange | undefined;
export declare function listAgentDataExchangesForRecipient(recipientOwner: OwnerScope, options?: {
    now?: number;
    includeExpired?: boolean;
    allowedUse?: DataExchangePackage["allowedUse"];
    limit?: number;
}): DbAgentDataExchange[];
export declare function listAgentDataExchangesForSource(sourceOwner: OwnerScope, options?: {
    now?: number;
    includeExpired?: boolean;
    recipientOwner?: OwnerScope;
    limit?: number;
}): DbAgentDataExchange[];
export declare function insertCapabilityDelegation(input: CapabilityDelegationRequest, options?: {
    auditId?: string | null;
    now?: number;
}): boolean;
export declare function updateCapabilityDelegation(input: {
    delegationId: string;
    status: CapabilityDelegationRequest["status"];
    resultPackageId?: string | null;
    approvalId?: string | null;
    contract?: CapabilityDelegationRequest;
}, options?: {
    auditId?: string | null;
    now?: number;
}): boolean;
export declare function getCapabilityDelegation(delegationId: string): DbCapabilityDelegation | undefined;
export declare function listCapabilityDelegations(filters?: {
    requester?: OwnerScope;
    provider?: OwnerScope;
    status?: CapabilityDelegationRequest["status"];
    limit?: number;
}): DbCapabilityDelegation[];
export declare function insertLearningEvent(input: LearningEvent, options?: {
    auditId?: string | null;
    now?: number;
}): boolean;
export declare function listLearningEvents(agentId: string): DbLearningEvent[];
export declare function listLearningEventsByApprovalState(approvalState: LearningEvent["approvalState"], filters?: {
    agentId?: string;
    limit?: number;
}): DbLearningEvent[];
export declare function updateLearningEventApprovalState(learningEventId: string, approvalState: LearningEvent["approvalState"], options?: {
    auditId?: string | null;
    now?: number;
}): boolean;
export declare function insertProfileHistoryVersion(input: HistoryVersion, options?: {
    auditId?: string | null;
}): boolean;
export declare function listProfileHistoryVersions(targetEntityType: HistoryVersion["targetEntityType"], targetEntityId: string): DbProfileHistoryVersion[];
export declare function insertProfileRestoreEvent(input: RestoreEvent, options?: {
    auditId?: string | null;
}): boolean;
export declare function listProfileRestoreEvents(targetEntityType: RestoreEvent["targetEntityType"], targetEntityId: string): DbProfileRestoreEvent[];
export declare function subAgentStorageSchemaVersion(): number;
export declare function storeMemoryDocument(input: StoreMemoryDocumentInput): StoreMemoryDocumentResult;
export declare function insertMemoryEmbeddingIfMissing(input: {
    chunkId: string;
    provider: string;
    model: string;
    dimensions: number;
    textChecksum: string;
    vector: Buffer;
}): string;
export declare function rebuildMemorySearchIndexes(): void;
export declare function markMemoryIndexJobCompleted(documentId: string): void;
export declare function markMemoryIndexJobDisabled(documentId: string, reason: string): void;
export declare function markMemoryIndexJobStale(documentId: string, reason: string): void;
export declare function markMemoryIndexJobFailed(documentId: string, error: string): void;
export declare function recordMemoryAccessLog(input: {
    runId?: string;
    sessionId?: string;
    requestGroupId?: string;
    documentId?: string;
    chunkId?: string;
    sourceChecksum?: string | null;
    scope?: MemoryScope | string | null;
    query: string;
    resultSource: string;
    score?: number;
    latencyMs?: number;
    reason?: string;
}): string;
export interface DbMemoryAccessTraceRow {
    id: string;
    run_id: string | null;
    session_id: string | null;
    request_group_id: string | null;
    document_id: string | null;
    chunk_id: string | null;
    source_checksum: string | null;
    scope: string | null;
    query: string;
    result_source: string;
    score: number | null;
    latency_ms: number | null;
    reason: string | null;
    created_at: number;
}
export declare function listMemoryAccessTraceForRun(runId: string, limit?: number): DbMemoryAccessTraceRow[];
export declare function insertFlashFeedback(input: {
    sessionId: string;
    content: string;
    runId?: string;
    requestGroupId?: string;
    severity?: "low" | "normal" | "high";
    ttlMs?: number;
    metadata?: Record<string, unknown>;
}): string;
export declare function upsertScheduleMemoryEntry(input: {
    scheduleId: string;
    prompt: string;
    sessionId?: string;
    requestGroupId?: string;
    title?: string;
    cronExpression?: string;
    nextRunAt?: number;
    enabled?: boolean;
    metadata?: Record<string, unknown>;
}): string;
export declare function insertArtifactReceipt(input: {
    channel: string;
    artifactPath: string;
    runId?: string;
    requestGroupId?: string;
    mimeType?: string;
    sizeBytes?: number;
    deliveryReceipt?: Record<string, unknown>;
    deliveredAt?: number;
}): string;
export declare function hasArtifactReceipt(input: {
    runId: string;
    channel: string;
    artifactPath: string;
}): boolean;
export declare function insertArtifactMetadata(input: ArtifactMetadataInput): string;
export declare function getLatestArtifactMetadataByPath(artifactPath: string): DbArtifactMetadata | undefined;
export declare function getArtifactMetadata(id: string): DbArtifactMetadata | undefined;
export declare function listExpiredArtifactMetadata(now?: number): DbArtifactMetadata[];
export declare function listActiveArtifactMetadata(): DbArtifactMetadata[];
export declare function markArtifactDeleted(id: string, deletedAt?: number): void;
export declare function insertDiagnosticEvent(input: {
    kind: string;
    summary: string;
    runId?: string;
    sessionId?: string;
    requestGroupId?: string;
    recoveryKey?: string;
    detail?: Record<string, unknown>;
}): string;
export declare function enqueueMemoryWritebackCandidate(input: {
    scope: MemoryScope;
    ownerId?: string;
    sourceType: string;
    content: string;
    metadata?: Record<string, unknown>;
    runId?: string;
    status?: MemoryWritebackStatus;
    lastError?: string;
}): string;
export declare function listMemoryWritebackCandidates(input?: {
    status?: MemoryWritebackStatus | "all";
    limit?: number;
}): DbMemoryWritebackCandidate[];
export declare function getMemoryWritebackCandidate(id: string): DbMemoryWritebackCandidate | undefined;
export declare function updateMemoryWritebackCandidate(input: {
    id: string;
    status: MemoryWritebackStatus;
    content?: string;
    metadata?: Record<string, unknown>;
    lastError?: string | null;
}): DbMemoryWritebackCandidate | undefined;
export declare function upsertSessionSnapshot(input: {
    sessionId: string;
    summary: string;
    preservedFacts?: string[];
    activeTaskIds?: string[];
}): string;
export declare function upsertTaskContinuity(input: {
    lineageRootRunId: string;
    parentRunId?: string;
    handoffSummary?: string;
    lastGoodState?: string;
    pendingApprovals?: string[];
    pendingDelivery?: string[];
    lastToolReceipt?: string;
    lastDeliveryReceipt?: string;
    failedRecoveryKey?: string;
    failureKind?: string;
    recoveryBudget?: string;
    status?: string;
}): void;
export declare function getTaskContinuity(lineageRootRunId: string): TaskContinuitySnapshot | undefined;
export declare function listTaskContinuityForLineages(lineageRootRunIds: string[]): TaskContinuitySnapshot[];
export declare function insertMemoryItem(item: {
    content: string;
    tags?: string[];
    scope?: MemoryScope;
    sessionId?: string;
    runId?: string;
    requestGroupId?: string;
    type?: string;
    importance?: string;
}): string;
export declare function searchMemoryItems(query: string, limit?: number, filters?: {
    sessionId?: string;
    runId?: string;
    requestGroupId?: string;
}): DbMemoryItem[];
export declare function getRecentMemoryItems(limit?: number, filters?: {
    sessionId?: string;
    runId?: string;
    requestGroupId?: string;
}): DbMemoryItem[];
export declare function markMessagesCompressed(ids: string[], summaryId: string): void;
export interface DbSchedule {
    id: string;
    name: string;
    cron_expression: string;
    timezone: string | null;
    prompt: string;
    enabled: number;
    target_channel: string;
    target_session_id: string | null;
    execution_driver: string;
    origin_run_id: string | null;
    origin_request_group_id: string | null;
    model: string | null;
    max_retries: number;
    timeout_sec: number;
    contract_json: string | null;
    identity_key: string | null;
    payload_hash: string | null;
    delivery_key: string | null;
    contract_schema_version: number | null;
    created_at: number;
    updated_at: number;
    last_run_at?: number | null;
    next_run_at?: number | null;
    legacy?: number;
}
export type DbScheduleInsertInput = Omit<DbSchedule, "last_run_at" | "next_run_at" | "timezone" | "contract_json" | "identity_key" | "payload_hash" | "delivery_key" | "contract_schema_version" | "legacy"> & {
    timezone?: string | null;
    contract?: ScheduleContract;
    contract_json?: string | null;
    identity_key?: string | null;
    payload_hash?: string | null;
    delivery_key?: string | null;
    contract_schema_version?: number | null;
};
export interface DbScheduleRun {
    id: string;
    schedule_id: string;
    started_at: number;
    finished_at: number | null;
    success: number | null;
    summary: string | null;
    error: string | null;
    execution_success?: number | null;
    delivery_success?: number | null;
    delivery_dedupe_key?: string | null;
    delivery_error?: string | null;
}
export type DbScheduleDeliveryStatus = "delivered" | "failed" | "skipped";
export interface DbScheduleDeliveryReceipt {
    dedupe_key: string;
    schedule_id: string;
    schedule_run_id: string;
    due_at: string;
    target_channel: string;
    target_session_id: string | null;
    payload_hash: string;
    delivery_status: DbScheduleDeliveryStatus;
    summary: string | null;
    error: string | null;
    created_at: number;
    updated_at: number;
}
export type DbScheduleDeliveryReceiptInput = Omit<DbScheduleDeliveryReceipt, "created_at" | "updated_at"> & {
    created_at?: number;
    updated_at?: number;
};
export declare function getSchedules(): DbSchedule[];
export declare function getSchedule(id: string): DbSchedule | undefined;
export declare function getSchedulesForSession(sessionId: string, enabledOnly?: boolean): DbSchedule[];
export declare function prepareScheduleContractPersistence(contract: ScheduleContract): Pick<DbSchedule, "contract_json" | "identity_key" | "payload_hash" | "delivery_key" | "contract_schema_version">;
export declare function isLegacySchedule(schedule: Pick<DbSchedule, "contract_json" | "contract_schema_version">): boolean;
export declare function insertSchedule(s: DbScheduleInsertInput): void;
export declare function updateSchedule(id: string, fields: Partial<Omit<DbSchedule, "id" | "created_at" | "last_run_at" | "next_run_at">>): void;
export declare function deleteSchedule(id: string): void;
export declare function getScheduleRuns(scheduleId: string, limit: number, offset: number): DbScheduleRun[];
export declare function listUnfinishedScheduleRuns(limit?: number): DbScheduleRun[];
export declare function interruptUnfinishedScheduleRunsOnStartup(input?: {
    finishedAt?: number;
    error?: string;
    limit?: number;
}): DbScheduleRun[];
export declare function countScheduleRuns(scheduleId: string): number;
export declare function insertScheduleRun(r: DbScheduleRun): void;
export declare function updateScheduleRun(id: string, fields: Partial<Pick<DbScheduleRun, "finished_at" | "success" | "summary" | "error" | "execution_success" | "delivery_success" | "delivery_dedupe_key" | "delivery_error">>): void;
export declare function getScheduleDeliveryReceipt(dedupeKey: string): DbScheduleDeliveryReceipt | undefined;
export declare function insertScheduleDeliveryReceipt(input: DbScheduleDeliveryReceiptInput): void;
export declare function getScheduleStats(scheduleId: string): {
    total: number;
    successes: number;
    failures: number;
    avgDurationMs: number | null;
    lastRunAt: number | null;
};
export {};
//# sourceMappingURL=index.d.ts.map