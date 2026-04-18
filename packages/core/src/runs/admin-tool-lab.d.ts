import type { ControlTimeline } from "../control-plane/timeline.js";
import type { DbMessageLedgerEvent } from "../db/index.js";
import type { SourceFreshnessPolicy, SourceKind, SourceReliability, WebRetrievalMethod } from "./web-retrieval-policy.js";
import { type RetrievalCacheStatus } from "./web-retrieval-cache.js";
import type { RetrievalTargetContract } from "./web-retrieval-session.js";
import type { RetrievalEvidenceSufficiency } from "./web-retrieval-verification.js";
import type { WebSourceAdapterMetadata } from "./web-source-adapters/types.js";
import { type WebRetrievalFixtureRegressionSummary } from "./web-retrieval-smoke.js";
export type AdminToolCallStatus = "started" | "succeeded" | "failed" | "skipped" | "unknown";
export type AdminToolApprovalState = "not_required" | "requested" | "approved" | "denied";
export interface AdminToolCallView {
    id: string;
    toolName: string;
    status: AdminToolCallStatus;
    approvalState: AdminToolApprovalState;
    runId: string | null;
    requestGroupId: string | null;
    sessionKey: string | null;
    startedAt: number | null;
    finishedAt: number | null;
    durationMs: number | null;
    retryCount: number;
    eventCount: number;
    paramsRedacted: unknown;
    outputRedacted: unknown;
    redactionApplied: boolean;
    resultSummary: string | null;
    lifecycle: Array<{
        at: number;
        source: "ledger" | "control";
        eventKind: string;
        status: string;
        summary: string;
    }>;
}
export interface AdminToolCallsInspector {
    summary: {
        total: number;
        failed: number;
        waitingApproval: number;
        redacted: number;
    };
    calls: AdminToolCallView[];
}
export interface AdminWebRetrievalKnownSourceView {
    method: string;
    url: string;
    sourceDomain: string;
    sourceKind: SourceKind;
    reliability: SourceReliability;
    sourceLabel: string;
    expectedTargetBinding: string;
}
export interface AdminWebRetrievalAttemptView {
    id: string;
    toolName: string;
    status: AdminToolCallStatus;
    method: WebRetrievalMethod | string;
    sourceKind: SourceKind | "unknown";
    reliability: SourceReliability;
    freshnessPolicy: SourceFreshnessPolicy;
    sourceUrl: string | null;
    sourceDomain: string | null;
    fetchTimestamp: string | null;
    sourceTimestamp: string | null;
    durationMs: number | null;
    retryCount: number;
}
export interface AdminWebRetrievalVerificationView {
    canAnswer: boolean | null;
    evidenceSufficiency: RetrievalEvidenceSufficiency | string | null;
    acceptedValue: string | null;
    rejectionReason: string | null;
    mustAvoidGuessing: boolean | null;
    policy: SourceFreshnessPolicy | string | null;
    completionStrict: true;
    semanticComparisonAllowed: false;
    verificationMode: "contract_fields";
}
export interface AdminWebRetrievalCacheView {
    status: RetrievalCacheStatus | "not_loaded";
    entryCount: number;
    entries: Array<{
        status: RetrievalCacheStatus;
        canUseForFinalAnswer: boolean;
        canUseAsDiscoveryHint: boolean;
        cacheAgeMs: number | null;
        reason: string;
        value: string | null;
        unit: string | null;
        sourceDomain: string | null;
    }>;
}
export interface AdminWebRetrievalSessionView {
    id: string;
    requestGroupId: string | null;
    runId: string | null;
    sessionKey: string | null;
    target: RetrievalTargetContract | null;
    sourceLadder: AdminWebRetrievalKnownSourceView[];
    queryVariants: string[];
    fetchAttempts: AdminWebRetrievalAttemptView[];
    candidateExtraction: {
        eventCount: number;
        candidateCount: number;
        lastSummary: string | null;
    };
    verification: AdminWebRetrievalVerificationView;
    conflictResolver: {
        status: string | null;
        conflicts: string[];
    };
    cache: AdminWebRetrievalCacheView;
    adapterMetadata: Array<Pick<WebSourceAdapterMetadata, "adapterId" | "adapterVersion" | "parserVersion" | "checksum" | "status" | "degradedReason">>;
    degradedState: {
        degraded: boolean;
        reasons: string[];
    };
    policySeparation: {
        discovery: "loose_search";
        completion: "strict_contract_fields";
        semanticComparisonAllowed: false;
    };
}
export interface AdminWebRetrievalLab {
    summary: {
        sessions: number;
        attempts: number;
        degraded: number;
        answerable: number;
    };
    sessions: AdminWebRetrievalSessionView[];
}
export interface AdminToolRetrievalLab {
    toolCalls: AdminToolCallsInspector;
    webRetrieval: AdminWebRetrievalLab;
}
export interface AdminFixtureReplayResultView {
    fixtureId: string;
    title: string;
    status: string;
    attempts: number;
    candidateCount: number;
    canAnswer: boolean;
    acceptedValue: string | null;
    evidenceSufficiency: string;
    failures: string[];
}
export interface AdminFixtureReplayResponse {
    ok: true;
    generatedAt: number;
    networkUsed: false;
    semanticComparisonAllowed: false;
    verificationMode: "contract_fields";
    fixtureCount: number;
    summary: Pick<WebRetrievalFixtureRegressionSummary, "kind" | "policyVersion" | "status" | "counts">;
    results: AdminFixtureReplayResultView[];
}
interface LabInput {
    timeline: ControlTimeline;
    ledgerEvents: DbMessageLedgerEvent[];
    query?: string;
    limit?: number;
}
export declare function buildAdminToolCallsInspector(input: Pick<LabInput, "timeline" | "ledgerEvents" | "limit">): AdminToolCallsInspector;
export declare function buildAdminWebRetrievalLab(input: Pick<LabInput, "timeline" | "ledgerEvents" | "query" | "limit">): AdminWebRetrievalLab;
export declare function buildAdminToolRetrievalLab(input: LabInput): AdminToolRetrievalLab;
export declare function runAdminWebRetrievalFixtureReplay(input?: {
    fixtureIds?: string[];
    fixtureDir?: string;
    now?: Date;
}): AdminFixtureReplayResponse;
export {};
//# sourceMappingURL=admin-tool-lab.d.ts.map