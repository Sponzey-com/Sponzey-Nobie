export type MemoryJournalKind = "instruction" | "success" | "failure" | "response";
export type MemoryJournalScope = "global" | "session" | "task";
export interface MemoryJournalRecord {
    id: string;
    kind: MemoryJournalKind;
    scope: MemoryJournalScope;
    session_id: string | null;
    run_id: string | null;
    request_group_id: string | null;
    title: string;
    content: string;
    summary: string;
    tags: string | null;
    source: string | null;
    created_at: number;
    updated_at: number;
}
export interface MemoryJournalRecordInput {
    kind: MemoryJournalKind;
    scope?: MemoryJournalScope;
    content: string;
    title?: string;
    summary?: string;
    sessionId?: string;
    runId?: string;
    requestGroupId?: string;
    source?: string;
    tags?: string[];
}
export declare function closeMemoryJournalDb(): void;
export declare function condenseMemoryText(text: string, maxChars?: number): string;
export declare function extractFocusedErrorMessage(text: string, maxChars?: number): string;
export declare function insertMemoryJournalRecord(input: MemoryJournalRecordInput): string;
export declare function searchMemoryJournal(query: string, options?: {
    limit?: number;
    kinds?: MemoryJournalKind[];
    sessionId?: string;
    requestGroupId?: string;
    runId?: string;
}): MemoryJournalRecord[];
export declare function buildMemoryJournalContext(query: string, options?: {
    limit?: number;
    sessionId?: string;
    requestGroupId?: string;
    runId?: string;
}): string;
//# sourceMappingURL=journal.d.ts.map