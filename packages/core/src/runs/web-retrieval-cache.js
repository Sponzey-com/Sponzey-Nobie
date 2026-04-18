import crypto from "node:crypto";
import { getWebRetrievalCacheEntry, listWebRetrievalCacheEntries, upsertWebRetrievalCacheEntry, } from "../db/index.js";
export const DEFAULT_RETRIEVAL_CACHE_TTL_POLICY = {
    normalMs: 5 * 60_000,
    latestFinanceMs: 20_000,
    latestWeatherMs: 60_000,
    latestGeneralMs: 30_000,
    strictTimestampMs: 0,
};
function stableStringify(value) {
    if (value === undefined)
        return "null";
    if (value === null || typeof value !== "object")
        return JSON.stringify(value);
    if (Array.isArray(value))
        return `[${value.map((item) => stableStringify(item)).join(",")}]`;
    const entries = Object.entries(value)
        .filter(([, nested]) => nested !== undefined)
        .sort(([left], [right]) => left.localeCompare(right));
    return `{${entries.map(([key, nested]) => `${JSON.stringify(key)}:${stableStringify(nested)}`).join(",")}}`;
}
function hash(value, length = 24) {
    return crypto.createHash("sha256").update(stableStringify(value)).digest("hex").slice(0, length);
}
function ttlPolicy(input) {
    return { ...DEFAULT_RETRIEVAL_CACHE_TTL_POLICY, ...(input ?? {}) };
}
export function resolveRetrievalCacheTtlMs(target, freshnessPolicy, input) {
    const policy = ttlPolicy(input);
    if (freshnessPolicy === "strict_timestamp")
        return policy.strictTimestampMs;
    if (freshnessPolicy !== "latest_approximate")
        return policy.normalMs;
    if (target.kind === "finance_index")
        return policy.latestFinanceMs;
    if (target.kind === "weather_current")
        return policy.latestWeatherMs;
    return policy.latestGeneralMs;
}
export function buildRetrievalTargetHash(target) {
    return hash({
        kind: target.kind,
        canonicalName: target.canonicalName ?? null,
        symbols: target.symbols ?? [],
        market: target.market ?? null,
        locationName: target.locationName ?? null,
        locale: target.locale ?? null,
    });
}
export function buildRetrievalCacheKey(input) {
    return `web-cache:${hash({
        targetHash: buildRetrievalTargetHash(input.target),
        freshnessPolicy: input.freshnessPolicy,
        sourceEvidenceId: input.sourceEvidenceId,
        acceptedUnit: input.acceptedUnit ?? null,
    }, 32)}`;
}
export function buildRetrievalCacheEntry(input) {
    if (!input.verdict.canAnswer || input.verdict.acceptedValue === null) {
        throw new Error("Only answerable retrieval verdicts can be cached as final-answer entries");
    }
    const now = input.now ?? new Date();
    const ttlMs = input.ttlMs ?? resolveRetrievalCacheTtlMs(input.target, input.sourceEvidence.freshnessPolicy ?? input.verdict.policy, input.ttlPolicy);
    const createdAt = now.toISOString();
    const fetchTimestamp = input.sourceEvidence.fetchTimestamp;
    return {
        cacheKey: buildRetrievalCacheKey({
            target: input.target,
            freshnessPolicy: input.sourceEvidence.freshnessPolicy ?? input.verdict.policy,
            sourceEvidenceId: input.verdict.sourceEvidenceId ?? input.sourceEvidence.sourceUrl ?? input.sourceEvidence.sourceLabel ?? "unknown_source",
            acceptedUnit: input.verdict.acceptedUnit,
        }),
        targetHash: buildRetrievalTargetHash(input.target),
        sourceEvidenceId: input.verdict.sourceEvidenceId ?? "unknown_source",
        verdictId: input.verdict.candidateId ?? `verdict:${hash(input.verdict, 16)}`,
        freshnessPolicy: input.sourceEvidence.freshnessPolicy ?? input.verdict.policy,
        ttlMs,
        fetchTimestamp,
        createdAt,
        expiresAt: new Date(now.getTime() + ttlMs).toISOString(),
        value: input.verdict.acceptedValue,
        unit: input.verdict.acceptedUnit,
        target: input.target,
        sourceEvidence: input.sourceEvidence,
        verdict: input.verdict,
    };
}
export function evaluateRetrievalCacheEntry(input) {
    const entry = input.entry ?? null;
    if (!entry) {
        return { status: "miss", canUseForFinalAnswer: false, canUseAsDiscoveryHint: false, cacheAgeMs: null, reason: "cache_miss", entry: null };
    }
    const nowMs = (input.now ?? new Date()).getTime();
    const fetchMs = Date.parse(entry.fetchTimestamp);
    const expiresMs = Date.parse(entry.expiresAt);
    const cacheAgeMs = Number.isFinite(fetchMs) ? Math.max(0, nowMs - fetchMs) : Math.max(0, nowMs - Date.parse(entry.createdAt));
    const expired = !Number.isFinite(expiresMs) || nowMs > expiresMs || entry.ttlMs <= 0;
    if (expired) {
        return { status: "expired", canUseForFinalAnswer: false, canUseAsDiscoveryHint: true, cacheAgeMs, reason: "cache_ttl_expired", entry };
    }
    const sameSession = input.sameSession === true;
    const crossSessionAllowed = input.allowCrossSessionFinalAnswer === true && input.userRequestedLatest !== true;
    if (sameSession || crossSessionAllowed) {
        return { status: "usable_final", canUseForFinalAnswer: true, canUseAsDiscoveryHint: true, cacheAgeMs, reason: sameSession ? "same_session_ttl_valid" : "cross_session_ttl_valid", entry };
    }
    return { status: "usable_discovery_hint", canUseForFinalAnswer: false, canUseAsDiscoveryHint: true, cacheAgeMs, reason: "latest_cache_requires_same_session_for_final_answer", entry };
}
export class InMemoryRetrievalCache {
    entries = new Map();
    put(entry) {
        this.entries.set(entry.cacheKey, entry);
        return entry;
    }
    get(cacheKey) {
        return this.entries.get(cacheKey) ?? null;
    }
    findByTargetHash(targetHash) {
        return [...this.entries.values()].filter((entry) => entry.targetHash === targetHash);
    }
}
export function createInMemoryRetrievalCache() {
    return new InMemoryRetrievalCache();
}
function millis(value) {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : 0;
}
function parseJson(value) {
    return JSON.parse(value);
}
export function putPersistentRetrievalCacheEntry(entry) {
    upsertWebRetrievalCacheEntry({
        cacheKey: entry.cacheKey,
        targetHash: entry.targetHash,
        sourceEvidenceId: entry.sourceEvidenceId,
        verdictId: entry.verdictId,
        freshnessPolicy: entry.freshnessPolicy,
        ttlMs: entry.ttlMs,
        fetchTimestamp: entry.fetchTimestamp,
        createdAt: millis(entry.createdAt),
        expiresAt: millis(entry.expiresAt),
        value: { value: entry.value, unit: entry.unit, target: entry.target },
        evidence: entry.sourceEvidence,
        verdict: entry.verdict,
        metadata: { createdAt: entry.createdAt, expiresAt: entry.expiresAt },
    });
    return entry;
}
export function getPersistentRetrievalCacheEntry(cacheKey) {
    const row = getWebRetrievalCacheEntry(cacheKey);
    if (!row)
        return null;
    const value = parseJson(row.value_json);
    const metadata = row.metadata_json ? parseJson(row.metadata_json) : {};
    return {
        cacheKey: row.cache_key,
        targetHash: row.target_hash,
        sourceEvidenceId: row.source_evidence_id,
        verdictId: row.verdict_id,
        freshnessPolicy: row.freshness_policy,
        ttlMs: row.ttl_ms,
        fetchTimestamp: row.fetch_timestamp,
        createdAt: metadata.createdAt ?? new Date(row.created_at).toISOString(),
        expiresAt: metadata.expiresAt ?? new Date(row.expires_at).toISOString(),
        value: value.value,
        unit: value.unit,
        target: value.target,
        sourceEvidence: parseJson(row.evidence_json),
        verdict: parseJson(row.verdict_json),
    };
}
export function listPersistentRetrievalCacheEntriesForTarget(input) {
    const query = {
        targetHash: input.targetHash,
    };
    if (input.freshnessPolicy !== undefined)
        query.freshnessPolicy = input.freshnessPolicy;
    if (input.now !== undefined)
        query.now = input.now.getTime();
    if (input.limit !== undefined)
        query.limit = input.limit;
    return listWebRetrievalCacheEntries(query).map((row) => getPersistentRetrievalCacheEntry(row.cache_key)).filter((entry) => entry !== null);
}
//# sourceMappingURL=web-retrieval-cache.js.map