import crypto from "node:crypto";
import { insertDiagnosticEvent, insertQueueBackpressureEvent, listQueueBackpressureEvents } from "../db/index.js";
export const QUEUE_NAMES = [
    "fast_receipt",
    "interactive_run",
    "tool_execution",
    "delivery",
    "web_browser",
    "memory_index",
    "diagnostic",
    "schedule_tick",
];
export class QueueBackpressureError extends Error {
    code;
    queueName;
    constructor(code, queueName, message) {
        super(message);
        this.name = "QueueBackpressureError";
        this.code = code;
        this.queueName = queueName;
    }
}
export const DEFAULT_QUEUE_BUDGETS = {
    fast_receipt: { concurrency: 8, timeoutMs: 500, retryCount: 0, backoffMs: 0, maxPending: 100 },
    interactive_run: { concurrency: 2, timeoutMs: 120_000, retryCount: 1, backoffMs: 500, maxPending: 50 },
    tool_execution: { concurrency: 4, timeoutMs: 60_000, retryCount: 2, backoffMs: 1_000, maxPending: 80 },
    delivery: { concurrency: 3, timeoutMs: 30_000, retryCount: 3, backoffMs: 1_500, maxPending: 100 },
    web_browser: { concurrency: 1, timeoutMs: 20_000, retryCount: 1, backoffMs: 2_000, maxPending: 10 },
    memory_index: { concurrency: 1, timeoutMs: 90_000, retryCount: 2, backoffMs: 2_000, maxPending: 500 },
    diagnostic: { concurrency: 1, timeoutMs: 30_000, retryCount: 1, backoffMs: 1_000, maxPending: 20 },
    schedule_tick: { concurrency: 2, timeoutMs: 30_000, retryCount: 1, backoffMs: 1_000, maxPending: 200 },
};
const queueStates = new Map();
const retryStates = new Map();
const deadLetterKeys = new Set();
function budgetFor(queueName, override) {
    const base = DEFAULT_QUEUE_BUDGETS[queueName];
    return {
        concurrency: Math.max(1, Math.floor(override?.concurrency ?? base.concurrency)),
        timeoutMs: Math.max(1, Math.floor(override?.timeoutMs ?? base.timeoutMs)),
        retryCount: Math.max(0, Math.floor(override?.retryCount ?? base.retryCount)),
        backoffMs: Math.max(0, Math.floor(override?.backoffMs ?? base.backoffMs)),
        maxPending: Math.max(0, Math.floor(override?.maxPending ?? base.maxPending)),
    };
}
function stateFor(queueName) {
    const existing = queueStates.get(queueName);
    if (existing)
        return existing;
    const state = { running: 0, pending: [] };
    queueStates.set(queueName, state);
    return state;
}
function retryKey(queueName, recoveryKey) {
    return `${queueName}:${recoveryKey}`;
}
function safeRecordQueueEvent(input) {
    try {
        insertQueueBackpressureEvent({
            queueName: input.queueName,
            eventKind: input.eventKind,
            actionTaken: input.actionTaken,
            ...(input.runId ? { runId: input.runId } : {}),
            ...(input.requestGroupId ? { requestGroupId: input.requestGroupId } : {}),
            pendingCount: input.pendingCount ?? 0,
            retryCount: input.retryCount ?? 0,
            retryBudgetRemaining: input.retryBudgetRemaining ?? null,
            ...(input.recoveryKey ? { recoveryKey: input.recoveryKey } : {}),
            ...(input.detail ? { detail: input.detail } : {}),
        });
    }
    catch {
        // Queue diagnostics must not block user-facing execution.
    }
}
export function recordQueueBackpressureEvent(input) {
    safeRecordQueueEvent(input);
}
function recordDeadLetter(input) {
    const key = retryKey(input.queueName, input.recoveryKey);
    deadLetterKeys.add(key);
    safeRecordQueueEvent({
        queueName: input.queueName,
        eventKind: "dead_letter",
        actionTaken: "stop_auto_retry",
        ...(input.runId ? { runId: input.runId } : {}),
        ...(input.requestGroupId ? { requestGroupId: input.requestGroupId } : {}),
        retryCount: input.retryCount,
        retryBudgetRemaining: 0,
        recoveryKey: input.recoveryKey,
        detail: { reason: input.reason },
    });
    try {
        insertDiagnosticEvent({
            kind: "queue_dead_letter",
            summary: `${input.queueName} 자동 재시도 중단: ${input.recoveryKey}`,
            ...(input.runId ? { runId: input.runId } : {}),
            ...(input.requestGroupId ? { requestGroupId: input.requestGroupId } : {}),
            recoveryKey: input.recoveryKey,
            detail: {
                queueName: input.queueName,
                retryCount: input.retryCount,
                reason: input.reason,
            },
        });
    }
    catch {
        // Best-effort diagnostic.
    }
}
function runNext(queueName, budget) {
    const state = stateFor(queueName);
    while (state.running < budget.concurrency && state.pending.length > 0) {
        const job = state.pending.shift();
        void runJob(queueName, budget, job);
    }
}
async function runJob(queueName, budget, job) {
    const state = stateFor(queueName);
    state.running += 1;
    safeRecordQueueEvent({
        queueName,
        eventKind: "running",
        actionTaken: "dequeue",
        ...(job.runId ? { runId: job.runId } : {}),
        ...(job.requestGroupId ? { requestGroupId: job.requestGroupId } : {}),
        pendingCount: state.pending.length,
        ...(job.recoveryKey ? { recoveryKey: job.recoveryKey } : {}),
    });
    let timeout;
    let settled = false;
    try {
        const taskPromise = Promise.resolve().then(job.task);
        taskPromise.catch(() => undefined);
        const timed = new Promise((_, reject) => {
            timeout = setTimeout(() => {
                if (settled)
                    return;
                reject(new QueueBackpressureError("queue_timeout", queueName, `${queueName} queue timeout after ${budget.timeoutMs}ms`));
            }, budget.timeoutMs);
        });
        const result = await Promise.race([taskPromise, timed]);
        settled = true;
        job.resolve(result);
        safeRecordQueueEvent({
            queueName,
            eventKind: "completed",
            actionTaken: "complete",
            ...(job.runId ? { runId: job.runId } : {}),
            ...(job.requestGroupId ? { requestGroupId: job.requestGroupId } : {}),
            pendingCount: state.pending.length,
            ...(job.recoveryKey ? { recoveryKey: job.recoveryKey } : {}),
        });
    }
    catch (error) {
        settled = true;
        const isTimeout = error instanceof QueueBackpressureError && error.code === "queue_timeout";
        safeRecordQueueEvent({
            queueName,
            eventKind: isTimeout ? "timeout" : "failed",
            actionTaken: isTimeout ? "timeout" : "fail",
            ...(job.runId ? { runId: job.runId } : {}),
            ...(job.requestGroupId ? { requestGroupId: job.requestGroupId } : {}),
            pendingCount: state.pending.length,
            ...(job.recoveryKey ? { recoveryKey: job.recoveryKey } : {}),
            detail: { error: error instanceof Error ? error.message : String(error) },
        });
        job.reject(error);
    }
    finally {
        if (timeout)
            clearTimeout(timeout);
        state.running = Math.max(0, state.running - 1);
        runNext(queueName, budget);
    }
}
export function enqueueBackpressureTask(input) {
    const budget = budgetFor(input.queueName, input.budget);
    const state = stateFor(input.queueName);
    const pendingCount = state.pending.length;
    if (state.running >= budget.concurrency) {
        if (pendingCount >= budget.maxPending) {
            safeRecordQueueEvent({
                queueName: input.queueName,
                eventKind: "rejected",
                actionTaken: "queue_full",
                ...(input.runId ? { runId: input.runId } : {}),
                ...(input.requestGroupId ? { requestGroupId: input.requestGroupId } : {}),
                pendingCount,
                ...(input.recoveryKey ? { recoveryKey: input.recoveryKey } : {}),
            });
            const error = new QueueBackpressureError("queue_full", input.queueName, `${input.queueName} queue is full`);
            return Promise.reject(error);
        }
    }
    return new Promise((resolve, reject) => {
        const job = {
            id: crypto.randomUUID(),
            createdAt: Date.now(),
            task: input.task,
            resolve,
            reject,
            ...(input.runId ? { runId: input.runId } : {}),
            ...(input.requestGroupId ? { requestGroupId: input.requestGroupId } : {}),
            ...(input.recoveryKey ? { recoveryKey: input.recoveryKey } : {}),
        };
        state.pending.push(job);
        safeRecordQueueEvent({
            queueName: input.queueName,
            eventKind: "queued",
            actionTaken: state.running < budget.concurrency ? "run_immediately" : "wait",
            ...(input.runId ? { runId: input.runId } : {}),
            ...(input.requestGroupId ? { requestGroupId: input.requestGroupId } : {}),
            pendingCount: state.pending.length,
            ...(input.recoveryKey ? { recoveryKey: input.recoveryKey } : {}),
        });
        runNext(input.queueName, budget);
    });
}
export function recordRetryBudgetAttempt(input) {
    const budget = budgetFor(input.queueName, input.budget);
    const key = retryKey(input.queueName, input.recoveryKey);
    const current = retryStates.get(key) ?? { count: 0, deadLettered: false, updatedAt: 0 };
    if (current.deadLettered || current.count >= budget.retryCount) {
        const retryCount = current.count;
        retryStates.set(key, { count: retryCount, deadLettered: true, updatedAt: Date.now() });
        recordDeadLetter({
            queueName: input.queueName,
            recoveryKey: input.recoveryKey,
            ...(input.runId ? { runId: input.runId } : {}),
            ...(input.requestGroupId ? { requestGroupId: input.requestGroupId } : {}),
            retryCount,
            reason: input.reason ?? "retry_budget_exhausted",
        });
        return {
            allowed: false,
            retryCount,
            retryBudgetRemaining: 0,
            actionTaken: "dead_letter",
            userMessage: buildBackpressureUserMessage("retry_stopped", input.queueName),
        };
    }
    const nextCount = current.count + 1;
    const remaining = Math.max(0, budget.retryCount - nextCount);
    retryStates.set(key, { count: nextCount, deadLettered: false, updatedAt: Date.now() });
    safeRecordQueueEvent({
        queueName: input.queueName,
        eventKind: "retry_scheduled",
        actionTaken: "retry_scheduled",
        ...(input.runId ? { runId: input.runId } : {}),
        ...(input.requestGroupId ? { requestGroupId: input.requestGroupId } : {}),
        retryCount: nextCount,
        retryBudgetRemaining: remaining,
        recoveryKey: input.recoveryKey,
        detail: { reason: input.reason ?? "retry" },
    });
    return {
        allowed: true,
        retryCount: nextCount,
        retryBudgetRemaining: remaining,
        actionTaken: "retry_scheduled",
        userMessage: buildBackpressureUserMessage("recovering", input.queueName),
    };
}
export function resetRetryBudget(input) {
    const key = retryKey(input.queueName, input.recoveryKey);
    retryStates.delete(key);
    deadLetterKeys.delete(key);
    safeRecordQueueEvent({
        queueName: input.queueName,
        eventKind: "reset",
        actionTaken: "reset_retry_budget",
        ...(input.runId ? { runId: input.runId } : {}),
        ...(input.requestGroupId ? { requestGroupId: input.requestGroupId } : {}),
        recoveryKey: input.recoveryKey,
    });
}
export function buildQueueBackpressureSnapshot() {
    const persistedDeadLetters = listQueueBackpressureEvents({ eventKind: "dead_letter", limit: 500 });
    return QUEUE_NAMES.map((queueName) => {
        const state = stateFor(queueName);
        const budget = budgetFor(queueName);
        const oldest = state.pending[0]?.createdAt;
        const queueRetryPrefix = `${queueName}:`;
        const retryKeys = [...retryStates.keys()].filter((key) => key.startsWith(queueRetryPrefix)).length;
        const deadLetterCount = [...deadLetterKeys].filter((key) => key.startsWith(queueRetryPrefix)).length
            + persistedDeadLetters.filter((event) => event.queue_name === queueName).length;
        const status = deadLetterCount > 0
            ? "stopped"
            : state.pending.length >= budget.maxPending
                ? "recovering"
                : state.pending.length > 0
                    ? "waiting"
                    : "ok";
        return {
            queueName,
            ...budget,
            running: state.running,
            pending: state.pending.length,
            oldestPendingAgeMs: oldest ? Date.now() - oldest : 0,
            retryKeys,
            deadLetterCount,
            status,
        };
    });
}
export function buildBackpressureUserMessage(kind, queueName) {
    switch (kind) {
        case "waiting":
            return `${queueName} 작업이 대기 중입니다. 실패가 아니라 앞선 작업이 끝나기를 기다리는 상태입니다.`;
        case "recovering":
            return `${queueName} 작업을 복구 중입니다. 자동 재시도 예산 안에서 한 번 더 시도합니다.`;
        case "retry_stopped":
            return `${queueName} 작업의 같은 오류가 반복되어 자동 재시도를 중단했습니다. 원인을 확인한 뒤 명시적으로 다시 시도해야 합니다.`;
    }
}
export function resetQueueBackpressureState() {
    queueStates.clear();
    retryStates.clear();
    deadLetterKeys.clear();
}
//# sourceMappingURL=queue-backpressure.js.map