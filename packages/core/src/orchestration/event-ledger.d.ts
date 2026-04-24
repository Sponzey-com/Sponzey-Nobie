import { type DbOrchestrationEventSeverity } from "../db/index.js";
export type OrchestrationEventKind = "agent_registered" | "team_registered" | "hierarchy_changed" | "orchestration_planned" | "team_execution_planned" | "command_requested" | "named_handoff_created" | "data_exchange_created" | "sub_session_queued" | "sub_session_started" | "sub_session_progress_reported" | "sub_session_completed" | "sub_session_failed" | "sub_session_cancelled" | "capability_called" | "approval_requested" | "result_reported" | "result_reviewed" | "control_action" | "resource_lock_wait" | "resource_lock_released" | "resource_lock_timeout" | "budget_blocked" | "model_resolved" | "model_fallback" | "model_budget_blocked" | "feedback_requested" | "redelegation_requested" | "retry_started" | "final_delivery_completed" | "named_delivery_attributed" | "learning_recorded" | "history_restored";
export type OrchestrationEventSeverity = DbOrchestrationEventSeverity;
export interface OrchestrationEventInput {
    eventKind: OrchestrationEventKind;
    runId?: string | null;
    parentRunId?: string | null;
    requestGroupId?: string | null;
    subSessionId?: string | null;
    agentId?: string | null;
    teamId?: string | null;
    exchangeId?: string | null;
    approvalId?: string | null;
    correlationId?: string | null;
    dedupeKey?: string | null;
    source?: string;
    severity?: OrchestrationEventSeverity;
    summary: string;
    payload?: Record<string, unknown>;
    payloadRawRef?: string | null;
    producerTask?: string | null;
    createdAt?: number;
    emittedAt?: number;
}
export interface OrchestrationEvent {
    sequence: number;
    cursor: string;
    id: string;
    createdAt: number;
    emittedAt: number;
    eventKind: OrchestrationEventKind;
    runId: string | null;
    parentRunId: string | null;
    requestGroupId: string | null;
    subSessionId: string | null;
    agentId: string | null;
    teamId: string | null;
    exchangeId: string | null;
    approvalId: string | null;
    correlationId: string;
    dedupeKey: string | null;
    source: string;
    severity: OrchestrationEventSeverity;
    summary: string;
    payload: Record<string, unknown>;
    payloadRawRef: string | null;
    producerTask: string | null;
}
export interface OrchestrationEventAppendResult {
    event: OrchestrationEvent;
    inserted: boolean;
}
export interface OrchestrationEventQuery {
    runId?: string;
    requestGroupId?: string;
    subSessionId?: string;
    agentId?: string;
    teamId?: string;
    exchangeId?: string;
    approvalId?: string;
    correlationId?: string;
    eventKind?: OrchestrationEventKind;
    afterCursor?: string;
    limit?: number;
}
export interface OrchestrationMonitoringSnapshot {
    generatedAt: number;
    runId: string | null;
    requestGroupId: string | null;
    latestCursor: string | null;
    eventCount: number;
    summary: {
        total: number;
        activeSubSessionCount: number;
        completedSubSessionCount: number;
        failedSubSessionCount: number;
        approvalPendingCount: number;
        budgetBlockedCount: number;
        modelFallbackCount: number;
        duplicateSuppressedCount: number;
    };
    agents: Array<{
        agentId: string;
        eventCount: number;
        latestEventKind: OrchestrationEventKind;
    }>;
    teams: Array<{
        teamId: string;
        eventCount: number;
        latestEventKind: OrchestrationEventKind;
    }>;
    subSessions: Array<{
        subSessionId: string;
        agentId: string | null;
        status: "queued" | "running" | "completed" | "failed" | "cancelled" | "unknown";
        latestEventKind: OrchestrationEventKind;
        updatedAt: number;
    }>;
    dataExchanges: Array<{
        exchangeId: string;
        eventCount: number;
        latestEventKind: OrchestrationEventKind;
    }>;
    approvals: Array<{
        approvalId: string;
        status: "requested" | "resolved" | "unknown";
        latestEventKind: OrchestrationEventKind;
    }>;
    models: Array<{
        subSessionId: string | null;
        modelId: string | null;
        fallbackApplied: boolean;
    }>;
    locks: Array<{
        subSessionId: string | null;
        eventKind: OrchestrationEventKind;
        summary: string;
    }>;
    budgets: Array<{
        subSessionId: string | null;
        reasonCode: string | null;
        summary: string;
    }>;
    events: OrchestrationEvent[];
}
export declare const ORCHESTRATION_EVENT_KINDS: readonly ["agent_registered", "team_registered", "hierarchy_changed", "orchestration_planned", "team_execution_planned", "command_requested", "named_handoff_created", "data_exchange_created", "sub_session_queued", "sub_session_started", "sub_session_progress_reported", "sub_session_completed", "sub_session_failed", "sub_session_cancelled", "capability_called", "approval_requested", "result_reported", "result_reviewed", "control_action", "resource_lock_wait", "resource_lock_released", "resource_lock_timeout", "budget_blocked", "model_resolved", "model_fallback", "model_budget_blocked", "feedback_requested", "redelegation_requested", "retry_started", "final_delivery_completed", "named_delivery_attributed", "learning_recorded", "history_restored"];
export declare function parseOrchestrationReplayCursor(cursor: string | null | undefined): number;
export declare function validateOrchestrationEventInput(input: OrchestrationEventInput): {
    ok: boolean;
    issueCodes: string[];
};
export declare function recordOrchestrationEvent(input: OrchestrationEventInput): OrchestrationEventAppendResult | null;
export declare function listOrchestrationEventLedger(query?: OrchestrationEventQuery): OrchestrationEvent[];
export declare function buildOrchestrationMonitoringSnapshot(query?: OrchestrationEventQuery): OrchestrationMonitoringSnapshot;
export declare function buildRestartResumeProjection(query?: OrchestrationEventQuery): {
    latestCursor: string | null;
    activeSubSessionIds: string[];
    activeSubSessions: OrchestrationMonitoringSnapshot["subSessions"];
};
export declare function formatOrchestrationEventSse(event: OrchestrationEvent): string;
export declare function openOrchestrationEventRawPayload(input: {
    eventId: string;
    admin: boolean;
    requester?: string;
}): {
    ok: boolean;
    reasonCode?: string;
    event?: OrchestrationEvent;
    rawRef?: string | null;
};
export declare function installOrchestrationEventProjection(): void;
export declare function resetOrchestrationEventProjectionForTest(): void;
//# sourceMappingURL=event-ledger.d.ts.map