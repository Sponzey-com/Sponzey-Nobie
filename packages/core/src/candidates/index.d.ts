export type CandidateKind = "schedule" | "run" | "artifact" | "memory";
export type CandidateReason = "explicit_id" | "structured_key" | "schedule_identity_key" | "schedule_delivery_key" | "schedule_payload_hash" | "run_contract_projection" | "artifact_id" | "artifact_path" | "semantic_candidate";
export type CandidateSource = "explicit_id" | "structured_key" | "schedule_store" | "run_store" | "artifact_store" | "memory_vector";
export type CandidateProviderStage = "fast" | "store" | "slow";
export interface CandidateScore {
    kind: "candidate_score";
    metric: "store" | "fts" | "vector" | "hybrid";
    value: number;
}
export interface DecisionConfidence {
    kind: "decision_confidence";
    level: "exact" | "strong" | "weak" | "clarify";
}
export interface CandidateResult<TPayload = unknown> {
    candidateId: string;
    candidateKind: CandidateKind;
    candidateReason: CandidateReason;
    source: CandidateSource;
    payload: TPayload;
    matchedKeys: string[];
    requiresFinalDecision: boolean;
    score?: CandidateScore;
}
export interface CandidateSearchInput {
    runId?: string;
    explicitIds?: {
        runId?: string;
        requestGroupId?: string;
        approvalId?: string;
        scheduleId?: string;
        artifactId?: string;
    };
    structuredKeys?: Record<string, string | null | undefined>;
    semanticQuery?: string;
    sessionId?: string;
    requestGroupId?: string;
    source?: string;
    limit?: number;
}
export interface CandidateProviderContext {
    signal: AbortSignal;
    now: () => number;
}
export interface CandidateProvider<TInput extends CandidateSearchInput = CandidateSearchInput, TPayload = unknown> {
    id: string;
    source: CandidateSource;
    stage: CandidateProviderStage;
    find(input: TInput, context: CandidateProviderContext): Promise<Array<CandidateResult<TPayload>>> | Array<CandidateResult<TPayload>>;
}
export interface CandidateProviderTrace<TPayload = unknown> {
    providerId: string;
    source: CandidateSource;
    stage: CandidateProviderStage;
    durationMs: number;
    candidateCount: number;
    skipped?: boolean;
    timedOut?: boolean;
    error?: string;
    candidates: Array<CandidateResult<TPayload>>;
}
export interface CandidateSearchResult<TPayload = unknown> {
    candidates: Array<CandidateResult<TPayload>>;
    traces: Array<CandidateProviderTrace<TPayload>>;
    skippedSlowProviders: boolean;
}
export type CandidateFinalDecisionKind = "same" | "cancel" | "update" | "new" | "clarify";
export type CandidateFinalDecisionSource = "explicit_id" | "structured_key" | "contract_key" | "contract_ai" | "user_choice" | "safe_fallback";
export interface CandidateFinalDecision<TPayload = unknown> {
    kind: CandidateFinalDecisionKind;
    finalDecisionSource: CandidateFinalDecisionSource;
    reasonCode: string;
    selectedCandidate?: CandidateResult<TPayload>;
}
export declare function runCandidateProviders<TInput extends CandidateSearchInput, TPayload>(input: TInput, providers: Array<CandidateProvider<TInput, TPayload>>, options?: {
    providerTimeoutMs?: number;
    skipSlowOnFastPath?: boolean;
    now?: () => number;
}): Promise<CandidateSearchResult<TPayload>>;
export declare function createExplicitIdProvider<TInput extends CandidateSearchInput, TPayload>(params: {
    id: string;
    candidateKind: CandidateKind;
    ids: (input: TInput) => Array<string | undefined>;
    resolve: (id: string, input: TInput) => TPayload | undefined | Promise<TPayload | undefined>;
    candidateId?: (payload: TPayload, id: string) => string;
}): CandidateProvider<TInput, TPayload>;
export declare function createStructuredKeyProvider<TInput extends CandidateSearchInput, TPayload>(params: {
    id: string;
    candidateKind: CandidateKind;
    keys: (input: TInput) => Array<{
        key: string;
        value: string | undefined;
    }>;
    resolve: (key: string, value: string, input: TInput) => TPayload | undefined | Promise<TPayload | undefined>;
    candidateId?: (payload: TPayload, key: string, value: string) => string;
}): CandidateProvider<TInput, TPayload>;
export declare function createStoreCandidateProvider<TInput extends CandidateSearchInput, TPayload>(params: {
    id: string;
    source: "schedule_store" | "run_store" | "artifact_store";
    candidateKind: Exclude<CandidateKind, "memory">;
    candidateReason: Exclude<CandidateReason, "explicit_id" | "structured_key" | "semantic_candidate">;
    find: (input: TInput) => Array<TPayload> | Promise<Array<TPayload>>;
    candidateId: (payload: TPayload) => string;
    matchedKeys?: (payload: TPayload) => string[];
    requiresFinalDecision?: boolean;
}): CandidateProvider<TInput, TPayload>;
export declare function createMemoryVectorProvider<TInput extends CandidateSearchInput, TPayload>(params: {
    id?: string;
    enabled?: boolean;
    search: (input: TInput, signal: AbortSignal) => Promise<Array<{
        id: string;
        payload: TPayload;
        score?: number;
    }>>;
}): CandidateProvider<TInput, TPayload>;
export declare function decideCandidateFinal<TPayload>(params: {
    requested: Exclude<CandidateFinalDecisionKind, "new" | "clarify">;
    candidate?: CandidateResult<TPayload>;
    finalDecisionSource: CandidateFinalDecisionSource;
}): CandidateFinalDecision<TPayload>;
export declare function buildCandidateDecisionAuditDetails<TPayload>(params: {
    candidates: Array<CandidateResult<TPayload>>;
    decision: CandidateFinalDecision<TPayload>;
}): Record<string, unknown>;
//# sourceMappingURL=index.d.ts.map