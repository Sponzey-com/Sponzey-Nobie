import type { SourceEvidence, SourceFreshnessPolicy } from "./web-retrieval-policy.js";
import type { RetrievalTargetContract } from "./web-retrieval-session.js";
import type { RetrievalVerificationVerdict } from "./web-retrieval-verification.js";
export type RetrievalCacheStatus = "usable_final" | "usable_discovery_hint" | "expired" | "miss";
export type RetrievalCacheScope = "same_session" | "cross_session_hint";
export interface RetrievalCacheTtlPolicy {
    normalMs: number;
    latestFinanceMs: number;
    latestWeatherMs: number;
    latestGeneralMs: number;
    strictTimestampMs: number;
}
export interface RetrievalCacheEntry {
    cacheKey: string;
    targetHash: string;
    sourceEvidenceId: string;
    verdictId: string;
    freshnessPolicy: SourceFreshnessPolicy;
    ttlMs: number;
    fetchTimestamp: string;
    createdAt: string;
    expiresAt: string;
    value: string;
    unit: string | null;
    target: RetrievalTargetContract;
    sourceEvidence: SourceEvidence;
    verdict: RetrievalVerificationVerdict;
}
export interface RetrievalCacheEvaluation {
    status: RetrievalCacheStatus;
    canUseForFinalAnswer: boolean;
    canUseAsDiscoveryHint: boolean;
    cacheAgeMs: number | null;
    reason: string;
    entry: RetrievalCacheEntry | null;
}
export interface BuildRetrievalCacheEntryInput {
    target: RetrievalTargetContract;
    sourceEvidence: SourceEvidence;
    verdict: RetrievalVerificationVerdict;
    now?: Date;
    ttlMs?: number;
    ttlPolicy?: Partial<RetrievalCacheTtlPolicy>;
}
export interface EvaluateRetrievalCacheEntryInput {
    entry: RetrievalCacheEntry | null | undefined;
    now?: Date;
    sameSession?: boolean;
    userRequestedLatest?: boolean;
    allowCrossSessionFinalAnswer?: boolean;
}
export declare const DEFAULT_RETRIEVAL_CACHE_TTL_POLICY: RetrievalCacheTtlPolicy;
export declare function resolveRetrievalCacheTtlMs(target: RetrievalTargetContract, freshnessPolicy: SourceFreshnessPolicy, input?: Partial<RetrievalCacheTtlPolicy>): number;
export declare function buildRetrievalTargetHash(target: RetrievalTargetContract): string;
export declare function buildRetrievalCacheKey(input: {
    target: RetrievalTargetContract;
    freshnessPolicy: SourceFreshnessPolicy;
    sourceEvidenceId: string;
    acceptedUnit?: string | null;
}): string;
export declare function buildRetrievalCacheEntry(input: BuildRetrievalCacheEntryInput): RetrievalCacheEntry;
export declare function evaluateRetrievalCacheEntry(input: EvaluateRetrievalCacheEntryInput): RetrievalCacheEvaluation;
export declare class InMemoryRetrievalCache {
    private readonly entries;
    put(entry: RetrievalCacheEntry): RetrievalCacheEntry;
    get(cacheKey: string): RetrievalCacheEntry | null;
    findByTargetHash(targetHash: string): RetrievalCacheEntry[];
}
export declare function createInMemoryRetrievalCache(): InMemoryRetrievalCache;
export declare function putPersistentRetrievalCacheEntry(entry: RetrievalCacheEntry): RetrievalCacheEntry;
export declare function getPersistentRetrievalCacheEntry(cacheKey: string): RetrievalCacheEntry | null;
export declare function listPersistentRetrievalCacheEntriesForTarget(input: {
    targetHash: string;
    freshnessPolicy?: SourceFreshnessPolicy;
    now?: Date;
    limit?: number;
}): RetrievalCacheEntry[];
//# sourceMappingURL=web-retrieval-cache.d.ts.map