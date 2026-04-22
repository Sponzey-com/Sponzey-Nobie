import type { FastifyInstance } from "fastify";
type AuditEventKind = "tool_call" | "diagnostic" | "run_event" | "artifact" | "delivery" | "decision_trace" | "message_ledger" | "queue_backpressure";
type AuditTimelineKind = "ingress" | "intake" | "contract" | "memory" | "tool" | "delivery" | "recovery" | "completion";
interface AuditQuery {
    page?: string;
    limit?: string;
    toolName?: string;
    result?: string;
    status?: string;
    kind?: string;
    timelineKind?: string;
    channel?: string;
    runId?: string;
    requestGroupId?: string;
    sessionId?: string;
    subSessionId?: string;
    agentId?: string;
    teamId?: string;
    deliveryKind?: string;
    from?: string;
    to?: string;
    q?: string;
}
interface AuditEvent {
    id: string;
    at: number;
    kind: AuditEventKind;
    timelineKind: AuditTimelineKind;
    status: string;
    summary: string;
    source: string | null;
    sessionId: string | null;
    runId: string | null;
    requestGroupId: string | null;
    channel: string | null;
    toolName: string | null;
    params: unknown;
    output: string | null;
    durationMs: number | null;
    approvalRequired: boolean;
    approvedBy: string | null;
    errorCode: string | null;
    retryCount: number | null;
    stopReason: string | null;
    detail: unknown;
}
export declare function listAuditEvents(query: AuditQuery): {
    items: AuditEvent[];
    total: number;
    page: number;
    pages: number;
    limit: number;
};
export declare function getAuditEventById(id: string): AuditEvent | null;
export declare function promoteAuditEventToErrorCorpusCandidate(eventId: string, note?: string): {
    diagnosticEventId: string;
    event: AuditEvent;
} | null;
export declare function registerAuditRoute(app: FastifyInstance): void;
export {};
//# sourceMappingURL=audit.d.ts.map