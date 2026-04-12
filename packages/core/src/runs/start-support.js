import { enqueueMemoryWritebackCandidate, getDb, getSession, insertSession, upsertSessionSnapshot, upsertTaskContinuity } from "../db/index.js";
import { createLogger } from "../logger/index.js";
import { buildActiveQueueCancellationMessage, } from "./entry-semantics.js";
import { buildFilesystemVerificationPrompt, verifyFilesystemTargets, } from "./filesystem-verification.js";
import { runFilesystemVerificationSubtask as runAnalysisOnlyFilesystemVerificationSubtask, } from "./analysis-subrun.js";
import { buildRunFailureJournalRecord, buildRunInstructionJournalRecord, buildRunSuccessJournalRecord, safeInsertRunJournalRecord, } from "./journaling.js";
import { condenseMemoryText } from "../memory/journal.js";
import { appendRunEvent, cancelRootRun, createRootRun, getRootRun, listActiveSessionRequestGroups, setRunStepStatus, updateRunStatus, } from "./store.js";
const log = createLogger("runs:start-support");
function mapTaskProfileToWorkerRole(taskProfile) {
    switch (taskProfile) {
        case "coding":
            return "coding";
        case "research":
            return "research";
        case "review":
            return "verification";
        case "operations":
        case "private_local":
            return "local-ops";
        case "planning":
        case "summarization":
            return "planning";
        default:
            return "general";
    }
}
export function normalizeTaskProfile(taskProfile) {
    switch (taskProfile) {
        case "planning":
        case "coding":
        case "review":
        case "research":
        case "private_local":
        case "summarization":
        case "operations":
            return taskProfile;
        default:
            return "general_chat";
    }
}
export function buildWorkerSessionId(params) {
    if (params.isRootRequest && !params.workerRuntime)
        return undefined;
    const workerRole = mapTaskProfileToWorkerRole(params.taskProfile);
    const rawTarget = params.workerRuntime?.kind || params.targetId || "default";
    const normalizedTarget = rawTarget
        .replace(/^provider:/, "")
        .replace(/^worker:/, "")
        .replace(/[^a-z0-9]+/gi, "-")
        .replace(/^-+|-+$/g, "")
        .toLowerCase();
    return `B-${params.runId.slice(0, 8)}-${workerRole}-${normalizedTarget || "default"}`;
}
export function markAbortedRunCancelledIfActive(runId) {
    const current = getRootRun(runId);
    if (!current)
        return;
    if (current.status === "interrupted" || current.status === "cancelled" || current.status === "completed" || current.status === "failed") {
        return;
    }
    updateRunStatus(runId, "cancelled", "사용자가 실행을 취소했습니다.", false);
}
export async function tryHandleActiveQueueCancellation(params) {
    if (!params.mode)
        return null;
    const activeGroups = listActiveSessionRequestGroups(params.sessionId, params.runId);
    if (activeGroups.length === 0) {
        return {
            kind: "complete",
            text: buildActiveQueueCancellationMessage({
                originalMessage: params.message,
                mode: params.mode,
                cancelledTitles: [],
                remainingCount: 0,
                hadTargets: false,
            }),
            eventLabel: "취소 요청 결과 전달",
        };
    }
    const targets = params.mode === "all" ? activeGroups : activeGroups.length > 0 ? [activeGroups[0]] : [];
    const cancelledTitles = [];
    for (const target of targets) {
        const cancelled = cancelRootRun(target.id);
        if (cancelled)
            cancelledTitles.push(target.title);
    }
    const remainingCount = Math.max(0, activeGroups.length - cancelledTitles.length);
    return {
        kind: "complete",
        text: buildActiveQueueCancellationMessage({
            originalMessage: params.message,
            mode: params.mode,
            cancelledTitles,
            remainingCount,
            hadTargets: cancelledTitles.length > 0,
        }),
        eventLabel: "취소 요청 결과 전달",
    };
}
export function ensureSessionExists(sessionId, source, now) {
    const existing = getSession(sessionId);
    if (!existing) {
        insertSession({
            id: sessionId,
            source,
            source_id: null,
            created_at: now,
            updated_at: now,
            summary: null,
        });
        return;
    }
    getDb()
        .prepare("UPDATE sessions SET updated_at = ? WHERE id = ?")
        .run(now, sessionId);
}
export function rememberRunInstruction(params) {
    safeInsertRunJournalRecord(buildRunInstructionJournalRecord(params), {
        onError: (message) => log.warn(message),
    });
    safeEnqueueWriteback({
        scope: "task",
        ownerId: params.requestGroupId,
        sourceType: "instruction",
        content: params.message,
        runId: params.runId,
        metadata: {
            sessionId: params.sessionId,
            source: params.source,
            durableFact: false,
        },
    });
    safeUpsertTaskContinuity({
        lineageRootRunId: params.requestGroupId,
        ...(params.runId !== params.requestGroupId ? { parentRunId: params.runId } : {}),
        handoffSummary: condenseMemoryText(params.message, 280),
        lastGoodState: "instruction_received",
    });
}
export function rememberRunSuccess(params) {
    const run = getRootRun(params.runId);
    const requestGroupId = run?.requestGroupId;
    safeInsertRunJournalRecord(buildRunSuccessJournalRecord({
        ...params,
        ...(requestGroupId ? { requestGroupId } : {}),
    }), {
        onError: (message) => log.warn(message),
    });
    const summary = condenseMemoryText(params.summary || params.text, 360);
    if (summary) {
        safeEnqueueWriteback({
            scope: "session",
            ownerId: params.sessionId,
            sourceType: "success",
            content: summary,
            runId: params.runId,
            metadata: {
                requestGroupId,
                source: params.source,
                durableFact: false,
            },
        });
        safeUpsertSessionSnapshot({
            sessionId: params.sessionId,
            summary,
            activeTaskIds: requestGroupId ? [requestGroupId] : [],
        });
        if (requestGroupId) {
            safeUpsertTaskContinuity({
                lineageRootRunId: requestGroupId,
                ...(run?.parentRunId ? { parentRunId: run.parentRunId } : {}),
                ...(run?.handoffSummary ? { handoffSummary: run.handoffSummary } : {}),
                lastGoodState: summary,
            });
        }
    }
}
export function rememberRunFailure(params) {
    const run = getRootRun(params.runId);
    const requestGroupId = run?.requestGroupId;
    safeInsertRunJournalRecord(buildRunFailureJournalRecord({
        ...params,
        ...(requestGroupId ? { requestGroupId } : {}),
    }), {
        onError: (message) => log.warn(message),
    });
    const detail = condenseMemoryText(params.detail || params.summary, 480);
    if (detail) {
        safeEnqueueWriteback({
            scope: "diagnostic",
            ownerId: requestGroupId ?? params.runId,
            sourceType: params.title || "failure",
            content: detail,
            runId: params.runId,
            metadata: {
                sessionId: params.sessionId,
                requestGroupId,
                source: params.source,
                durableFact: false,
            },
        });
        if (requestGroupId) {
            safeUpsertTaskContinuity({
                lineageRootRunId: requestGroupId,
                ...(run?.parentRunId ? { parentRunId: run.parentRunId } : {}),
                ...(run?.handoffSummary ? { handoffSummary: run.handoffSummary } : {}),
                lastGoodState: `failure: ${detail}`,
            });
        }
    }
}
function safeEnqueueWriteback(input) {
    try {
        enqueueMemoryWritebackCandidate(input);
    }
    catch (error) {
        log.warn(`memory writeback enqueue failed: ${error instanceof Error ? error.message : String(error)}`);
    }
}
function safeUpsertSessionSnapshot(input) {
    try {
        upsertSessionSnapshot(input);
    }
    catch (error) {
        log.warn(`session snapshot upsert failed: ${error instanceof Error ? error.message : String(error)}`);
    }
}
function safeUpsertTaskContinuity(input) {
    try {
        upsertTaskContinuity(input);
    }
    catch (error) {
        log.warn(`task continuity upsert failed: ${error instanceof Error ? error.message : String(error)}`);
    }
}
export async function runFilesystemVerificationSubtask(params) {
    return runAnalysisOnlyFilesystemVerificationSubtask({
        ...params,
        dependencies: {
            createRun: createRootRun,
            appendRunEvent,
            setRunStepStatus,
            updateRunStatus,
            verifyFilesystemTargets,
            buildFilesystemVerificationPrompt,
            createId: () => crypto.randomUUID(),
        },
    });
}
//# sourceMappingURL=start-support.js.map