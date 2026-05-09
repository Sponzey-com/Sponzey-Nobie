import crypto from "node:crypto";
import { insertQueueBackpressureEvent } from "../db/index.js";
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
    fast_receipt: { concurrency: 8, timeoutMs: 500, backoffMs: 0, maxPending: 100 },
    interactive_run: { concurrency: 2, timeoutMs: 120_000, backoffMs: 500, maxPending: 50 },
    tool_execution: { concurrency: 4, timeoutMs: 60_000, backoffMs: 1_000, maxPending: 80 },
    delivery: { concurrency: 3, timeoutMs: 30_000, backoffMs: 1_500, maxPending: 100 },
    web_browser: { concurrency: 1, timeoutMs: 20_000, backoffMs: 2_000, maxPending: 10 },
    memory_index: { concurrency: 1, timeoutMs: 90_000, backoffMs: 2_000, maxPending: 500 },
    diagnostic: { concurrency: 1, timeoutMs: 30_000, backoffMs: 1_000, maxPending: 20 },
    schedule_tick: { concurrency: 2, timeoutMs: 30_000, backoffMs: 1_000, maxPending: 200 },
};
const queueStates = new Map();
const recoveryStates = new Map();
function budgetFor(queueName, override) {
    const base = DEFAULT_QUEUE_BUDGETS[queueName];
    return {
        concurrency: Math.max(1, Math.floor(override?.concurrency ?? base.concurrency)),
        timeoutMs: Math.max(1, Math.floor(override?.timeoutMs ?? base.timeoutMs)),
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
function recoveryStateKey(queueName, recoveryKey) {
    return `${queueName}:${recoveryKey}`;
}
function safeRecordQueueEvent(input) {
    const signalCount = input.signalCount ?? 0;
    try {
        insertQueueBackpressureEvent({
            queueName: input.queueName,
            eventKind: input.eventKind,
            actionTaken: input.actionTaken,
            ...(input.runId ? { runId: input.runId } : {}),
            ...(input.requestGroupId ? { requestGroupId: input.requestGroupId } : {}),
            pendingCount: input.pendingCount ?? 0,
            retryCount: signalCount,
            ...(input.recoveryKey ? { recoveryKey: input.recoveryKey } : {}),
            detail: {
                ...(input.detail ?? {}),
                signalCount,
            },
        });
    }
    catch {
        // Queue diagnostics must not block user-facing execution.
    }
}
export function recordQueueBackpressureEvent(input) {
    safeRecordQueueEvent(input);
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
export function recordQueueRecoveryAttempt(input) {
    const key = recoveryStateKey(input.queueName, input.recoveryKey);
    const current = recoveryStates.get(key) ?? { count: 0, updatedAt: 0 };
    const nextCount = current.count + 1;
    recoveryStates.set(key, { count: nextCount, updatedAt: Date.now() });
    safeRecordQueueEvent({
        queueName: input.queueName,
        eventKind: "recovery_scheduled",
        actionTaken: "recovery_scheduled",
        ...(input.runId ? { runId: input.runId } : {}),
        ...(input.requestGroupId ? { requestGroupId: input.requestGroupId } : {}),
        signalCount: nextCount,
        recoveryKey: input.recoveryKey,
        detail: { reason: input.reason ?? "recovery" },
    });
    return {
        allowed: true,
        signalCount: nextCount,
        actionTaken: "recovery_scheduled",
        userMessage: buildBackpressureUserMessage("recovering", input.queueName),
    };
}
export function resetQueueRecoveryAttempt(input) {
    const key = recoveryStateKey(input.queueName, input.recoveryKey);
    recoveryStates.delete(key);
    safeRecordQueueEvent({
        queueName: input.queueName,
        eventKind: "reset",
        actionTaken: "reset_recovery_attempt",
        ...(input.runId ? { runId: input.runId } : {}),
        ...(input.requestGroupId ? { requestGroupId: input.requestGroupId } : {}),
        recoveryKey: input.recoveryKey,
    });
}
export function buildQueueBackpressureSnapshot() {
    return QUEUE_NAMES.map((queueName) => {
        const state = stateFor(queueName);
        const budget = budgetFor(queueName);
        const oldest = state.pending[0]?.createdAt;
        const queueRecoveryPrefix = `${queueName}:`;
        const recoveryKeys = [...recoveryStates.keys()].filter((key) => key.startsWith(queueRecoveryPrefix)).length;
        const status = state.pending.length >= budget.maxPending
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
            recoveryKeys,
            status,
        };
    });
}
export function buildBackpressureUserMessage(kind, queueName) {
    switch (kind) {
        case "waiting":
            return `${queueName} 작업이 대기 중입니다. 실패가 아니라 앞선 작업이 끝나기를 기다리는 상태입니다.`;
        case "recovering":
            return `${queueName} 작업을 복구 중입니다. 실패 원인을 기록하고 다음 복구 시도를 이어갑니다.`;
    }
}
export function resetQueueBackpressureState() {
    queueStates.clear();
    recoveryStates.clear();
}
//# sourceMappingURL=queue-backpressure.js.map
