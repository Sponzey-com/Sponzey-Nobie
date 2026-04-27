import { type JsonObject } from "../contracts/index.js";
import type { DataExchangePackage, DataExchangeRetentionPolicy, MemoryPolicy, OwnerScope } from "../contracts/sub-agent-orchestration.js";
import { type DbAgentDataExchange, type MemoryScope } from "../db/index.js";
import type { PromptBundleContextMemoryRef } from "../runs/context-preflight.js";
import { type DetailedMemorySearchResult, type StoreMemoryDocumentParams } from "./store.js";
import { type MemoryWritebackCandidate, type PreparedMemoryWritebackCandidate } from "./writeback.js";
export type MemoryVisibility = MemoryPolicy["visibility"];
export type MemoryAccessMode = "owner_direct" | "recipient_via_exchange";
export type MemoryOwnerScopeKind = "nobie" | "agent" | "run" | "system" | "team_projection";
export type ParentMemoryWritebackPolicy = "allow" | "review" | "deny";
export interface RunMemoryOwnerScope {
    ownerType: "run";
    ownerId: string;
}
export type MemoryOwnerScope = OwnerScope | RunMemoryOwnerScope;
export interface MemoryOwnerScopePolicy {
    owner: MemoryOwnerScope;
    ownerScopeKey: string;
    storageOwnerId: string;
    kind: MemoryOwnerScopeKind;
    directReadAllowed: boolean;
    writeAllowed: boolean;
    reasonCode?: "team_projection_read_only" | "memory_owner_scope_missing";
}
export type DataExchangeValidationIssueCode = "source_owner_missing" | "recipient_owner_missing" | "source_nickname_missing" | "recipient_nickname_missing" | "purpose_missing" | "allowed_use_missing" | "retention_policy_missing" | "redaction_state_missing" | "provenance_refs_missing" | "provenance_refs_unrecognized" | "payload_missing" | "data_exchange_expired" | "data_exchange_blocked" | "data_exchange_wrong_recipient" | "data_exchange_wrong_source" | "data_exchange_use_not_allowed";
export interface DataExchangeValidationIssue {
    code: DataExchangeValidationIssueCode;
    path: string;
    message: string;
}
export interface DataExchangeValidationResult {
    ok: boolean;
    issues: DataExchangeValidationIssue[];
}
export type DataExchangeRedactionCategory = "secret_token_key_password_env" | "raw_html_script_style" | "stack_trace_log_dump" | "contact_identity_payment_pii" | "private_memory_excerpt" | "external_artifact_preview";
export type DataExchangeProvenanceKind = "source_result" | "memory" | "artifact" | "tool_call" | "data_exchange" | "run" | "opaque" | "unknown";
export interface DataExchangeRedactionInspection {
    redacted: boolean;
    categories: DataExchangeRedactionCategory[];
}
export interface DataExchangeSanitizedView {
    exchangeId: string;
    sourceOwner: OwnerScope;
    recipientOwner: OwnerScope;
    sourceNicknameSnapshot: string;
    recipientNicknameSnapshot: string;
    purpose: string;
    allowedUse: DataExchangePackage["allowedUse"];
    retentionPolicy: DataExchangeRetentionPolicy;
    redactionState: DataExchangePackage["redactionState"];
    provenanceRefs: string[];
    provenanceKinds: DataExchangeProvenanceKind[];
    payloadSummary: string;
    redactionCategories: DataExchangeRedactionCategory[];
    expiresAt?: number | null;
    createdAt: number;
    isExpired: boolean;
}
export interface DataExchangeAdminRawView {
    ok: boolean;
    reasonCode?: "admin_raw_access_denied" | "admin_raw_access_reason_required";
    exchange?: DataExchangePackage;
    redactionCategories: DataExchangeRedactionCategory[];
    auditEventId?: string | null;
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
    sourceNicknameSnapshot?: string;
    recipientNicknameSnapshot?: string;
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
export interface PreparePolicyControlledMemoryWritebackInput {
    candidate: MemoryWritebackCandidate;
    memoryPolicy: MemoryPolicy;
    actorOwner?: OwnerScope;
    targetOwner?: OwnerScope;
    parentOwner?: OwnerScope;
    parentMemoryWritebackPolicy?: ParentMemoryWritebackPolicy;
}
export declare class MemoryIsolationError extends Error {
    readonly reasonCode: string;
    constructor(reasonCode: string, message: string);
}
export declare function memoryOwnerScopeKey(owner: MemoryOwnerScope): string;
export declare function resolveMemoryOwnerScopePolicy(owner: MemoryOwnerScope): MemoryOwnerScopePolicy;
export declare function inspectDataExchangePayloadRisk(payload: JsonObject): DataExchangeRedactionInspection;
export declare function validateDataExchangePackage(input: DataExchangePackage, options?: {
    now?: number;
}): DataExchangeValidationResult;
export declare function createDataExchangePackage(input: CreateDataExchangePackageInput): DataExchangePackage;
export declare function persistDataExchangePackage(input: DataExchangePackage, options?: {
    now?: number;
    auditId?: string | null;
}): boolean;
export declare function dbAgentDataExchangeToPackage(row: DbAgentDataExchange): DataExchangePackage;
export declare function buildDataExchangeSanitizedView(input: DataExchangePackage, options?: {
    now?: number;
}): DataExchangeSanitizedView;
export declare function buildDataExchangeAdminRawView(input: DataExchangePackage, options: {
    adminAccessGranted: boolean;
    reason?: string;
    requester?: string;
    now?: number;
    recordAudit?: boolean;
}): DataExchangeAdminRawView;
export declare function listActiveDataExchangePackagesForRecipient(recipientOwner: OwnerScope, options?: {
    now?: number;
    allowedUse?: DataExchangePackage["allowedUse"];
    limit?: number;
}): DataExchangePackage[];
export declare function listActiveDataExchangePackagesForSource(sourceOwner: OwnerScope, options?: {
    now?: number;
    recipientOwner?: OwnerScope;
    includeExpired?: boolean;
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
export declare function preparePolicyControlledMemoryWritebackQueueInput(input: PreparePolicyControlledMemoryWritebackInput): PreparedMemoryWritebackCandidate;
//# sourceMappingURL=isolation.d.ts.map