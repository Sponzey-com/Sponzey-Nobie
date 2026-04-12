import BetterSqlite3 from "better-sqlite3";
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
    source: string;
    tool_name: string;
    params: string | null;
    output: string | null;
    result: string;
    duration_ms: number | null;
    approval_required: number;
    approved_by: string | null;
}
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
export declare function insertSession(session: Omit<DbSession, "token_count">): void;
export declare function getSession(id: string): DbSession | undefined;
export declare function insertMessage(msg: DbMessage): void;
export declare function getMessages(sessionId: string): DbMessage[];
export declare function getMessagesForRequestGroup(sessionId: string, requestGroupId: string): DbMessage[];
export declare function getMessagesForRequestGroupWithRunMeta(sessionId: string, requestGroupId: string): DbRequestGroupMessage[];
export declare function getMessagesForRun(sessionId: string, runId: string): DbMessage[];
export declare function insertAuditLog(log: Omit<DbAuditLog, "id">): void;
export declare function insertChannelMessageRef(ref: Omit<DbChannelMessageRef, "id">): string;
export declare function findChannelMessageRef(params: {
    source: string;
    externalChatId: string;
    externalMessageId: string;
    externalThreadId?: string;
}): DbChannelMessageRef | undefined;
export declare function upsertPromptSources(sources: PromptSourceMetadata[]): void;
export declare function updateRunPromptSourceSnapshot(runId: string, snapshot: PromptSourceSnapshot): void;
export declare function getPromptSourceStates(): PromptSourceState[];
export type MemoryScope = "global" | "session" | "task" | "artifact" | "diagnostic";
export interface DbMemoryItem {
    id: string;
    content: string;
    tags: string | null;
    source: string | null;
    memory_scope: "global" | "session" | "task" | null;
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
export declare function enqueueMemoryWritebackCandidate(input: {
    scope: MemoryScope;
    ownerId?: string;
    sourceType: string;
    content: string;
    metadata?: Record<string, unknown>;
    runId?: string;
}): string;
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
    scope?: "global" | "session" | "task";
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
    created_at: number;
    updated_at: number;
    last_run_at?: number | null;
    next_run_at?: number | null;
}
export interface DbScheduleRun {
    id: string;
    schedule_id: string;
    started_at: number;
    finished_at: number | null;
    success: number | null;
    summary: string | null;
    error: string | null;
}
export declare function getSchedules(): DbSchedule[];
export declare function getSchedule(id: string): DbSchedule | undefined;
export declare function getSchedulesForSession(sessionId: string, enabledOnly?: boolean): DbSchedule[];
export declare function insertSchedule(s: Omit<DbSchedule, "last_run_at" | "next_run_at">): void;
export declare function updateSchedule(id: string, fields: Partial<Omit<DbSchedule, "id" | "created_at" | "last_run_at" | "next_run_at">>): void;
export declare function deleteSchedule(id: string): void;
export declare function getScheduleRuns(scheduleId: string, limit: number, offset: number): DbScheduleRun[];
export declare function countScheduleRuns(scheduleId: string): number;
export declare function insertScheduleRun(r: DbScheduleRun): void;
export declare function updateScheduleRun(id: string, fields: Partial<Pick<DbScheduleRun, "finished_at" | "success" | "summary" | "error">>): void;
export declare function getScheduleStats(scheduleId: string): {
    total: number;
    successes: number;
    failures: number;
    avgDurationMs: number | null;
    lastRunAt: number | null;
};
//# sourceMappingURL=index.d.ts.map