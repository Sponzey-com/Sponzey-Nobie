import BetterSqlite3 from "better-sqlite3";
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
export declare function insertSession(session: Omit<DbSession, "token_count">): void;
export declare function getSession(id: string): DbSession | undefined;
export declare function insertMessage(msg: DbMessage): void;
export declare function getMessages(sessionId: string): DbMessage[];
export declare function getMessagesForRequestGroup(sessionId: string, requestGroupId: string): DbMessage[];
export declare function getMessagesForRequestGroupWithRunMeta(sessionId: string, requestGroupId: string): DbRequestGroupMessage[];
export declare function insertAuditLog(log: Omit<DbAuditLog, "id">): void;
export interface DbMemoryItem {
    id: string;
    content: string;
    tags: string | null;
    source: string | null;
    session_id: string | null;
    type: string | null;
    importance: string | null;
    embedding: Buffer | null;
    created_at: number;
    updated_at: number;
}
export declare function insertMemoryItem(item: {
    content: string;
    tags?: string[];
    sessionId?: string;
    type?: string;
    importance?: string;
}): string;
export declare function searchMemoryItems(query: string, limit?: number): DbMemoryItem[];
export declare function getRecentMemoryItems(limit?: number): DbMemoryItem[];
export declare function markMessagesCompressed(ids: string[], summaryId: string): void;
export interface DbSchedule {
    id: string;
    name: string;
    cron_expression: string;
    prompt: string;
    enabled: number;
    target_channel: string;
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