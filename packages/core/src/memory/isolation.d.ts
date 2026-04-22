import { type JsonObject } from "../contracts/index.js";
import { type DbAgentDataExchange, type MemoryScope } from "../db/index.js";
import type { DataExchangePackage, DataExchangeRetentionPolicy, MemoryPolicy, OwnerScope } from "../contracts/sub-agent-orchestration.js";
import { type DetailedMemorySearchResult, type StoreMemoryDocumentParams } from "./store.js";
import { type MemoryWritebackCandidate, type PreparedMemoryWritebackCandidate } from "./writeback.js";
import type { PromptBundleContextMemoryRef } from "../runs/context-preflight.js";
export type MemoryVisibility = MemoryPolicy["visibility"];
export type MemoryAccessMode = "owner_direct" | "recipient_via_exchange";
export type DataExchangeValidationIssueCode = "source_owner_missing" | "recipient_owner_missing" | "purpose_missing" | "redaction_state_missing" | "provenance_refs_missing" | "payload_missing" | "data_exchange_expired" | "data_exchange_blocked" | "data_exchange_wrong_recipient" | "data_exchange_wrong_source" | "data_exchange_use_not_allowed";
export interface DataExchangeValidationIssue {
    code: DataExchangeValidationIssueCode;
    path: string;
    message: string;
}
export interface DataExchangeValidationResult {
    ok: boolean;
    issues: DataExchangeValidationIssue[];
}
export interface StoreOwnerScopedMemoryParams extends Omit<StoreMemoryDocumentParams, "scope" | "ownerId" | "metadata"> {
    owner: OwnerScope;
    visibility: MemoryVisibility;
    retentionPolicy: MemoryPolicy["retentionPolicy"];
    historyVersion?: number;
    scope?: MemoryScope;
    metadata?: Record<string, unknown>;
}
export interface CreateDataExchangePackageInput {
    sourceOwner: OwnerScope;
    recipientOwner: OwnerScope;
    purpose: string;
    allowedUse: DataExchangePackage["allowedUse"];
    retentionPolicy: DataExchangeRetentionPolicy;
    redactionState: DataExchangePackage["redactionState"];
    provenanceRefs: string[];
    payload: JsonObject;
    parentRunId?: string;
    parentSessionId?: string;
    parentSubSessionId?: string;
    parentRequestId?: string;
    auditCorrelationId?: string;
    exchangeId?: string;
    idempotencyKey?: string;
    expiresAt?: number | null;
    now?: () => number;
}
export interface OwnerScopedMemorySearchResult {
    accessMode: MemoryAccessMode;
    memoryResults: DetailedMemorySearchResult[];
    exchangeRefs: PromptBundleContextMemoryRef[];
}
export interface OwnerScopedMemorySearchParams {
    requester: OwnerScope;
    owner: OwnerScope;
    query: string;
    limit?: number;
    exchanges?: DataExchangePackage[];
    now?: number;
    filters?: {
        sessionId?: string;
        runId?: string;
        requestGroupId?: string;
        scheduleId?: string;
        includeSchedule?: boolean;
        includeArtifact?: boolean;
        includeDiagnostic?: boolean;
        includeFlashFeedback?: boolean;
    };
}
export declare class MemoryIsolationError extends Error {
    readonly reasonCode: string;
    constructor(reasonCode: string, message: string);
}
export declare function validateDataExchangePackage(input: DataExchangePackage, options?: {
    now?: number;
}): DataExchangeValidationResult;
export declare function createDataExchangePackage(input: CreateDataExchangePackageInput): DataExchangePackage;
export declare function persistDataExchangePackage(input: DataExchangePackage, options?: {
    now?: number;
    auditId?: string | null;
}): boolean;
export declare function dbAgentDataExchangeToPackage(row: DbAgentDataExchange): DataExchangePackage;
export declare function listActiveDataExchangePackagesForRecipient(recipientOwner: OwnerScope, options?: {
    now?: number;
    allowedUse?: DataExchangePackage["allowedUse"];
    limit?: number;
}): DataExchangePackage[];
export declare function getDataExchangePackage(exchangeId: string, options?: {
    now?: number;
    includeExpired?: boolean;
}): DataExchangePackage | undefined;
export declare function storeOwnerScopedMemory(params: StoreOwnerScopedMemoryParams): Promise<import("../db/index.js").StoreMemoryDocumentResult>;
export declare function isDataExchangeUsableForMemoryAccess(input: {
    exchange: DataExchangePackage;
    requester: OwnerScope;
    sourceOwner: OwnerScope;
    allowedUses?: DataExchangePackage["allowedUse"][];
    now?: number;
}): boolean;
export declare function assertMemoryAccessAllowed(input: {
    requester: OwnerScope;
    owner: OwnerScope;
    exchanges?: DataExchangePackage[];
    now?: number;
}): MemoryAccessMode;
export declare function searchOwnerScopedMemory(input: OwnerScopedMemorySearchParams): Promise<OwnerScopedMemorySearchResult>;
export declare function buildDataExchangeContextMemoryRefs(exchanges: DataExchangePackage[], options: {
    recipient: OwnerScope;
    sourceOwner?: OwnerScope;
    now?: number;
}): PromptBundleContextMemoryRef[];
export declare function buildMemorySummaryDataExchange(input: Omit<CreateDataExchangePackageInput, "payload" | "provenanceRefs"> & {
    memoryResults: DetailedMemorySearchResult[];
    maxItems?: number;
}): DataExchangePackage;
export declare function prepareAgentMemoryWritebackQueueInput(input: {
    candidate: MemoryWritebackCandidate;
    memoryPolicy: MemoryPolicy;
}): PreparedMemoryWritebackCandidate;
//# sourceMappingURL=isolation.d.ts.map