import { condenseMemoryText, extractFocusedErrorMessage, insertMemoryJournalRecord, } from "../memory/journal.js";
const defaultDependencies = {
    insertRecord: insertMemoryJournalRecord,
    onError: () => { },
};
export function buildRunInstructionJournalRecord(params) {
    return {
        kind: "instruction",
        scope: "task",
        title: "instruction",
        content: params.message,
        summary: condenseMemoryText(params.message, 280),
        sessionId: params.sessionId,
        runId: params.runId,
        requestGroupId: params.requestGroupId,
        source: params.source,
        tags: ["instruction"],
    };
}
export function buildRunSuccessJournalRecord(params) {
    return {
        kind: "success",
        scope: "session",
        title: "success",
        content: params.text,
        summary: condenseMemoryText(params.summary || params.text, 280),
        sessionId: params.sessionId,
        runId: params.runId,
        ...(params.requestGroupId ? { requestGroupId: params.requestGroupId } : {}),
        source: params.source,
        tags: ["success"],
    };
}
export function buildRunFailureJournalRecord(params) {
    const detail = params.detail?.trim() || params.summary;
    return {
        kind: "failure",
        scope: "session",
        title: params.title || "failure",
        content: detail,
        summary: extractFocusedErrorMessage(detail, 280) || condenseMemoryText(params.summary, 280),
        sessionId: params.sessionId,
        runId: params.runId,
        ...(params.requestGroupId ? { requestGroupId: params.requestGroupId } : {}),
        source: params.source,
        tags: ["failure"],
    };
}
export function safeInsertRunJournalRecord(input, dependencies) {
    const resolved = { ...defaultDependencies, ...dependencies };
    try {
        resolved.insertRecord(input);
    }
    catch (error) {
        resolved.onError(`memory journal insert failed: ${error instanceof Error ? error.message : String(error)}`);
    }
}
//# sourceMappingURL=journaling.js.map