import { type DbControlEventSeverity } from "../db/index.js";
export type ControlEventSeverity = DbControlEventSeverity;
export type ControlExportAudience = "user" | "developer";
export type ControlExportFormat = "json" | "markdown";
export interface ControlEventInput {
    eventType: string;
    correlationId?: string | null;
    runId?: string | null;
    requestGroupId?: string | null;
    sessionKey?: string | null;
    component: string;
    severity?: ControlEventSeverity;
    summary: string;
    detail?: Record<string, unknown>;
    createdAt?: number;
}
export interface ControlTimelineQuery {
    runId?: string;
    requestGroupId?: string;
    correlationId?: string;
    eventType?: string;
    component?: string;
    severity?: ControlEventSeverity;
    limit?: number;
}
export interface ControlTimelineEvent {
    id: string;
    at: number;
    eventType: string;
    correlationId: string;
    runId: string | null;
    requestGroupId: string | null;
    sessionKey: string | null;
    component: string;
    severity: ControlEventSeverity;
    summary: string;
    detail: unknown;
    duplicate?: {
        kind: "tool" | "answer" | "delivery" | "recovery";
        key: string;
        firstEventId: string;
        occurrence: number;
    };
}
export interface ControlTimelineSummary {
    total: number;
    duplicateToolCount: number;
    duplicateAnswerCount: number;
    deliveryRetryCount: number;
    recoveryReentryCount: number;
    severityCounts: Record<ControlEventSeverity, number>;
}
export interface ControlTimeline {
    events: ControlTimelineEvent[];
    summary: ControlTimelineSummary;
}
export interface ControlTimelineExport {
    audience: ControlExportAudience;
    format: ControlExportFormat;
    content: string;
    timeline: ControlTimeline;
}
export type RetrievalTimelineEventKind = "session" | "attempt" | "source" | "candidate" | "verdict" | "planner" | "delivery" | "dedupe" | "stop" | "diagnostic";
export interface RetrievalTimelineEvent {
    id: string;
    at: number;
    kind: RetrievalTimelineEventKind;
    eventType: string;
    component: string;
    severity: ControlEventSeverity;
    summary: string;
    detail: unknown;
    source: {
        method: string | null;
        toolName: string | null;
        url: string | null;
        domain: string | null;
    };
    verdict: {
        canAnswer: boolean | null;
        acceptedValue: string | null;
        sufficiency: string | null;
        rejectionReason: string | null;
        conflicts: string[];
    };
    diagnosticRef: {
        controlEventId: string;
        eventType: string;
        component: string;
    };
    duplicate?: ControlTimelineEvent["duplicate"];
}
export interface RetrievalTimelineSummary {
    total: number;
    sessionEvents: number;
    attempts: number;
    sources: number;
    candidates: number;
    verdicts: number;
    plannerActions: number;
    deliveryEvents: number;
    dedupeSuppressed: number;
    stops: number;
    conflicts: number;
    finalDeliveryStatus: string | null;
    stopReason: string | null;
    severityCounts: Record<ControlEventSeverity, number>;
}
export interface RetrievalTimeline {
    events: RetrievalTimelineEvent[];
    summary: RetrievalTimelineSummary;
}
export interface RetrievalTimelineExport {
    audience: ControlExportAudience;
    format: ControlExportFormat;
    content: string;
    timeline: RetrievalTimeline;
}
export declare function recordControlEvent(input: ControlEventInput): string | null;
export declare function getControlTimeline(query?: ControlTimelineQuery, audience?: ControlExportAudience): ControlTimeline;
export declare function getRetrievalEvidenceTimeline(query?: ControlTimelineQuery, audience?: ControlExportAudience): RetrievalTimeline;
export declare function exportControlTimeline(params?: ControlTimelineQuery & {
    audience?: ControlExportAudience;
    format?: ControlExportFormat;
    recordAudit?: boolean;
}): ControlTimelineExport;
export declare function exportRetrievalEvidenceTimeline(params?: ControlTimelineQuery & {
    audience?: ControlExportAudience;
    format?: ControlExportFormat;
    recordAudit?: boolean;
}): RetrievalTimelineExport;
export declare function recordControlEventFromLedger(input: {
    runId?: string | null;
    requestGroupId?: string | null;
    sessionKey?: string | null;
    channel?: string | null;
    eventKind: string;
    deliveryKey?: string | null;
    idempotencyKey?: string | null;
    status: string;
    summary: string;
    detail?: Record<string, unknown>;
}): string | null;
export declare function installControlEventProjection(): void;
export declare function resetControlEventProjectionForTest(): void;
//# sourceMappingURL=timeline.d.ts.map