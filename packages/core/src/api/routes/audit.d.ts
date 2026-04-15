import type { FastifyInstance } from "fastify";
type AuditEventKind = "tool_call" | "diagnostic" | "run_event" | "artifact" | "delivery";
interface AuditQuery {
    page?: string;
    limit?: string;
    toolName?: string;
    result?: string;
    status?: string;
    kind?: string;
    channel?: string;
    runId?: string;
    requestGroupId?: string;
    sessionId?: string;
    from?: string;
    to?: string;
    q?: string;
}
interface AuditEvent {
    id: string;
    at: number;
    kind: AuditEventKind;
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
export declare function registerAuditRoute(app: FastifyInstance): void;
//# sourceMappingURL=audit.d.ts.map
