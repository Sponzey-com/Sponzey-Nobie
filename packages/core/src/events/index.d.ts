import type { RootRun, RunStep } from "../runs/types.js";
export type ApprovalDecision = "allow_once" | "allow_run" | "deny";
export type ApprovalKind = "approval" | "screen_confirmation";
export interface NobieEvents {
    "message.inbound": {
        source: string;
        sessionId: string;
        content: string;
        userId?: string;
    };
    "agent.start": {
        sessionId: string;
        runId: string;
    };
    "agent.stream": {
        sessionId: string;
        runId: string;
        delta: string;
    };
    "agent.end": {
        sessionId: string;
        runId: string;
        durationMs: number;
    };
    "agent.error": {
        sessionId: string;
        runId: string;
        error: string;
    };
    "run.created": {
        run: RootRun;
    };
    "run.status": {
        run: RootRun;
    };
    "run.step.started": {
        runId: string;
        step: RunStep;
        run: RootRun;
    };
    "run.step.completed": {
        runId: string;
        step: RunStep;
        run: RootRun;
    };
    "run.progress": {
        run: RootRun;
    };
    "run.summary": {
        runId: string;
        summary: string;
        run: RootRun;
    };
    "run.completed": {
        run: RootRun;
    };
    "run.failed": {
        run: RootRun;
    };
    "run.cancel.requested": {
        runId: string;
    };
    "run.cancelled": {
        run: RootRun;
    };
    "tool.before": {
        sessionId: string;
        runId: string;
        toolName: string;
        params: unknown;
    };
    "tool.after": {
        sessionId: string;
        runId: string;
        toolName: string;
        success: boolean;
        durationMs: number;
    };
    "approval.request": {
        runId: string;
        toolName: string;
        params: unknown;
        kind?: ApprovalKind;
        guidance?: string;
        resolve: (decision: ApprovalDecision) => void;
    };
    "approval.resolved": {
        runId: string;
        decision: ApprovalDecision;
        toolName: string;
        kind?: ApprovalKind;
    };
    "scheduler.trigger": {
        scheduleId: string;
        scheduleTime: Date;
    };
    "config.changed": Record<string, never>;
    "plugin.loaded": {
        pluginId: string;
    };
}
type Listener<T> = (payload: T) => void | Promise<void>;
declare class TypedEventBus {
    private listeners;
    on<K extends keyof NobieEvents>(event: K, listener: Listener<NobieEvents[K]>): () => void;
    emit<K extends keyof NobieEvents>(event: K, payload: NobieEvents[K]): void;
    once<K extends keyof NobieEvents>(event: K, listener: Listener<NobieEvents[K]>): () => void;
}
export type WizbyEvents = NobieEvents;
export type HowieEvents = NobieEvents;
export declare const eventBus: TypedEventBus;
export {};
//# sourceMappingURL=index.d.ts.map