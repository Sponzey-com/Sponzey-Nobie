import { type MemoryJournalRecordInput } from "../memory/journal.js";
export type RunJournalSource = "webui" | "cli" | "telegram" | "slack";
export interface RunInstructionJournalParams {
    runId: string;
    sessionId: string;
    requestGroupId: string;
    source: RunJournalSource;
    message: string;
}
export interface RunSuccessJournalParams {
    runId: string;
    sessionId: string;
    requestGroupId?: string;
    source: RunJournalSource;
    text: string;
    summary: string;
}
export interface RunFailureJournalParams {
    runId: string;
    sessionId: string;
    requestGroupId?: string;
    source: RunJournalSource;
    summary: string;
    detail?: string;
    title?: string;
}
interface RunJournalDependencies {
    insertRecord: (input: MemoryJournalRecordInput) => string;
    onError: (message: string) => void;
}
export declare function buildRunInstructionJournalRecord(params: RunInstructionJournalParams): MemoryJournalRecordInput;
export declare function buildRunSuccessJournalRecord(params: RunSuccessJournalParams): MemoryJournalRecordInput;
export declare function buildRunFailureJournalRecord(params: RunFailureJournalParams): MemoryJournalRecordInput;
export declare function safeInsertRunJournalRecord(input: MemoryJournalRecordInput, dependencies?: Partial<RunJournalDependencies>): void;
export {};
//# sourceMappingURL=journaling.d.ts.map