import type { ControlTimeline } from "../control-plane/timeline.js";
import { type DbMessageLedgerEvent } from "../db/index.js";
export type AdminMemoryOwnerKind = "user" | "diagnostic";
export type AdminSchedulerQueueState = "disabled" | "waiting" | "missed" | "running" | "retrying" | "idle";
export interface AdminMemoryDocumentView {
    id: string;
    scope: string;
    ownerId: string;
    ownerKind: AdminMemoryOwnerKind;
    sourceType: string;
    sourceRef: string | null;
    title: string | null;
    chunkCount: number;
    ftsCount: number;
    embeddingCount: number;
    ftsStatus: "available" | "missing" | "empty";
    vectorStatus: "available" | "missing" | "empty";
    indexStatus: string | null;
    indexRetryCount: number;
    indexLastError: string | null;
    runId: string | null;
    requestGroupId: string | null;
    updatedAt: number;
}
export interface AdminMemoryWritebackView {
    id: string;
    scope: string;
    ownerId: string;
    ownerKind: AdminMemoryOwnerKind;
    sourceType: string;
    status: string;
    retryCount: number;
    lastError: string | null;
    runId: string | null;
    requestGroupId: string | null;
    contentPreview: string;
    updatedAt: number;
}
export interface AdminMemoryRetrievalTraceView {
    id: string;
    runId: string | null;
    requestGroupId: string | null;
    sessionKey: string | null;
    documentId: string | null;
    chunkId: string | null;
    scope: string | null;
    resultSource: string;
    score: number | null;
    latencyMs: number | null;
    reason: string | null;
    queryPreview: string;
    createdAt: number;
}
export interface AdminMemoryInspector {
    summary: {
        documents: number;
        userDocuments: number;
        diagnosticDocuments: number;
        writebackPending: number;
        writebackFailed: number;
        retrievalTraces: number;
        linkedFailures: number;
    };
    documents: {
        items: AdminMemoryDocumentView[];
        degradedReasons: string[];
    };
    writebackQueue: {
        items: AdminMemoryWritebackView[];
        degradedReasons: string[];
    };
    retrievalTrace: {
        items: AdminMemoryRetrievalTraceView[];
        degradedReasons: string[];
    };
    linkedFailures: Array<{
        at: number;
        source: "timeline" | "ledger";
        component: string;
        summary: string;
        runId: string | null;
        requestGroupId: string | null;
    }>;
}
export interface AdminSchedulerContractView {
    hasContract: boolean;
    schemaVersion: number | null;
    identityKey: string | null;
    payloadHash: string | null;
    deliveryKey: string | null;
    payloadKind: string | null;
    deliveryChannel: string | null;
    missedPolicy: string | null;
    timeKind: "one_time" | "recurring" | "unknown";
}
export interface AdminSchedulerScheduleView {
    id: string;
    name: string;
    enabled: boolean;
    cronExpression: string;
    timezone: string | null;
    targetChannel: string;
    targetSessionId: string | null;
    executionDriver: string;
    nextRunAt: number | null;
    lastRunAt: number | null;
    queueState: AdminSchedulerQueueState;
    contract: AdminSchedulerContractView;
    latestRun: {
        id: string;
        startedAt: number;
        finishedAt: number | null;
        success: boolean | null;
        executionSuccess: boolean | null;
        deliverySuccess: boolean | null;
        deliveryDedupeKey: string | null;
        error: string | null;
    } | null;
    receipts: Array<{
        dedupeKey: string;
        runId: string;
        dueAt: string;
        targetChannel: string;
        status: string;
        summary: string | null;
        error: string | null;
        updatedAt: number;
    }>;
}
export interface AdminSchedulerInspector {
    summary: {
        schedules: number;
        enabled: number;
        missed: number;
        retrying: number;
        receipts: number;
    };
    schedules: AdminSchedulerScheduleView[];
    timelineLinks: Array<{
        at: number;
        eventType: string;
        component: string;
        summary: string;
        runId: string | null;
        requestGroupId: string | null;
    }>;
    fieldChecks: {
        comparisonMode: "contract_fields";
        naturalLanguageMatchingAllowed: false;
        requiredKeys: string[];
    };
    degradedReasons: string[];
}
export interface AdminChannelMappingView {
    channel: string;
    inboundCount: number;
    outboundCount: number;
    approvalCount: number;
    receiptCount: number;
    latestAt: number | null;
    refs: Array<{
        id: string;
        sessionKey: string;
        rootRunId: string;
        requestGroupId: string;
        chatId: string;
        threadId: string | null;
        messageId: string;
        role: string;
        createdAt: number;
    }>;
}
export interface AdminChannelReceiptView {
    id: string;
    channel: string;
    eventKind: string;
    status: string;
    summary: string;
    deliveryKey: string | null;
    idempotencyKey: string | null;
    runId: string | null;
    requestGroupId: string | null;
    sessionKey: string | null;
    threadKey: string | null;
    chatId: string | null;
    threadId: string | null;
    userId: string | null;
    messageId: string | null;
    createdAt: number;
}
export interface AdminApprovalCallbackView {
    id: string;
    channel: string;
    eventKind: string;
    status: string;
    summary: string;
    runId: string | null;
    requestGroupId: string | null;
    approvalId: string | null;
    callbackId: string | null;
    buttonPayload: string | null;
    userId: string | null;
    chatId: string | null;
    createdAt: number;
}
export interface AdminChannelInspector {
    summary: {
        channels: number;
        inbound: number;
        outbound: number;
        approvals: number;
        receipts: number;
    };
    mappings: AdminChannelMappingView[];
    ledgerReceipts: AdminChannelReceiptView[];
    approvalCallbacks: AdminApprovalCallbackView[];
    degradedReasons: string[];
}
export interface AdminRuntimeInspectors {
    memory: AdminMemoryInspector;
    scheduler: AdminSchedulerInspector;
    channels: AdminChannelInspector;
}
interface InspectorInput {
    timeline: ControlTimeline;
    ledgerEvents: DbMessageLedgerEvent[];
    limit?: number;
    filters?: {
        runId?: string;
        requestGroupId?: string;
        sessionKey?: string;
        channel?: string;
    };
}
export declare function buildAdminRuntimeInspectors(input: InspectorInput): AdminRuntimeInspectors;
export {};
//# sourceMappingURL=admin-runtime-inspectors.d.ts.map