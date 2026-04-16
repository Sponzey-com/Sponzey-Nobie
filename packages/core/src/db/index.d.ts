import BetterSqlite3 from "better-sqlite3";
import type { PromptSourceMetadata, PromptSourceSnapshot, PromptSourceState } from "../memory/nobie-md.js";
import { type ScheduleContract } from "../contracts/index.js";
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
    metadata_json: string | null;
    created_at: number;
    updated_at: number;
}
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
    includeSchedule?: boolean;
    includeArtifact?: boolean;
    includeDiagnostic?: boolean;
}
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
export declare function markMemoryIndexJobFailed(documentId: string, error: string): void;
export declare function recordMemoryAccessLog(input: {
    runId?: string;
    sessionId?: string;
    requestGroupId?: string;
    documentId?: string;
    chunkId?: string;
    query: string;
    resultSource: string;
    score?: number;
    latencyMs?: number;
}): string;
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