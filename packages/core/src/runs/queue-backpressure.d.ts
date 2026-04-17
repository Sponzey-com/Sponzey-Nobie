import { type DbQueueBackpressureEventKind } from "../db/index.js";
export declare const QUEUE_NAMES: readonly ["fast_receipt", "interactive_run", "tool_execution", "delivery", "web_browser", "memory_index", "diagnostic", "schedule_tick"];
export type QueueName = typeof QUEUE_NAMES[number];
export interface QueueBudget {
    concurrency: number;
    timeoutMs: number;
    retryCount: number;
    backoffMs: number;
    maxPending: number;
}
export interface QueueSnapshotItem extends QueueBudget {
    queueName: QueueName;
    running: number;
    pending: number;
    oldestPendingAgeMs: number;
    retryKeys: number;
    deadLetterCount: number;
    status: "ok" | "waiting" | "recovering" | "stopped";
}
export interface RetryBudgetDecision {
    allowed: boolean;
    retryCount: number;
    retryBudgetRemaining: number;
    actionTaken: "retry_scheduled" | "dead_letter";
    userMessage: string;
}
export declare class QueueBackpressureError extends Error {
    readonly code: "queue_full" | "queue_timeout";
    readonly queueName: QueueName;
    constructor(code: QueueBackpressureError["code"], queueName: QueueName, message: string);
}
export declare const DEFAULT_QUEUE_BUDGETS: Record<QueueName, QueueBudget>;
export declare function recordQueueBackpressureEvent(input: {
    queueName: QueueName;
    eventKind: DbQueueBackpressureEventKind;
    actionTaken: string;
    runId?: string;
    requestGroupId?: string;
    pendingCount?: number;
    retryCount?: number;
    retryBudgetRemaining?: number | null;
    recoveryKey?: string;
    detail?: Record<string, unknown>;
}): void;
export declare function enqueueBackpressureTask<T>(input: {
    queueName: QueueName;
    runId?: string;
    requestGroupId?: string;
    recoveryKey?: string;
    task: () => Promise<T>;
    budget?: Partial<QueueBudget>;
}): Promise<T>;
export declare function recordRetryBudgetAttempt(input: {
    queueName: QueueName;
    recoveryKey: string;
    runId?: string;
    requestGroupId?: string;
    budget?: Partial<QueueBudget>;
    reason?: string;
}): RetryBudgetDecision;
export declare function resetRetryBudget(input: {
    queueName: QueueName;
    recoveryKey: string;
    runId?: string;
    requestGroupId?: string;
}): void;
export declare function buildQueueBackpressureSnapshot(): QueueSnapshotItem[];
export declare function buildBackpressureUserMessage(kind: "waiting" | "recovering" | "retry_stopped", queueName: QueueName): string;
export declare function resetQueueBackpressureState(): void;
//# sourceMappingURL=queue-backpressure.d.ts.map