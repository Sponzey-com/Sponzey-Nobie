import { recordLatencyMetric } from "../observability/latency.js";
const STAGE_ORDER = {
    fast: 0,
    store: 1,
    slow: 2,
};
function normalizeId(value) {
    const normalized = value?.trim();
    return normalized || undefined;
}
function timeoutSignal(timeoutMs) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), Math.max(50, timeoutMs));
    return { signal: controller.signal, clear: () => clearTimeout(timer) };
}
function isFastPathCandidate(candidate) {
    return (candidate.source === "explicit_id" || candidate.source === "structured_key")
        && candidate.requiresFinalDecision === false;
}
async function runProviderWithTimeout(provider, input, params) {
    const started = params.now();
    const timeout = timeoutSignal(params.timeoutMs);
    try {
        const candidates = await Promise.race([
            Promise.resolve(provider.find(input, { signal: timeout.signal, now: params.now })),
            new Promise((_, reject) => {
                timeout.signal.addEventListener("abort", () => reject(new Error("candidate provider timeout")), { once: true });
            }),
        ]);
        return {
            providerId: provider.id,
            source: provider.source,
            stage: provider.stage,
            durationMs: params.now() - started,
            candidateCount: candidates.length,
            candidates,
        };
    }
    catch (error) {
        return {
            providerId: provider.id,
            source: provider.source,
            stage: provider.stage,
            durationMs: params.now() - started,
            candidateCount: 0,
            candidates: [],
            ...(error instanceof Error && error.message === "candidate provider timeout"
                ? { timedOut: true }
                : { error: error instanceof Error ? error.message : String(error) }),
        };
    }
    finally {
        timeout.clear();
    }
}
export async function runCandidateProviders(input, providers, options = {}) {
    const now = options.now ?? Date.now;
    const providerTimeoutMs = options.providerTimeoutMs ?? 200;
    const ordered = [...providers].sort((a, b) => STAGE_ORDER[a.stage] - STAGE_ORDER[b.stage]);
    const traces = [];
    const candidates = new Map();
    let foundFastPath = false;
    let skippedSlowProviders = false;
    for (const provider of ordered) {
        if (foundFastPath && provider.stage !== "fast" && options.skipSlowOnFastPath !== false) {
            skippedSlowProviders = true;
            traces.push({
                providerId: provider.id,
                source: provider.source,
                stage: provider.stage,
                durationMs: 0,
                candidateCount: 0,
                skipped: true,
                candidates: [],
            });
            continue;
        }
        const trace = await runProviderWithTimeout(provider, input, { timeoutMs: providerTimeoutMs, now });
        recordLatencyMetric({
            name: "candidate_search_latency_ms",
            durationMs: trace.durationMs,
            timeout: trace.timedOut === true,
            ...(input.runId ? { runId: input.runId } : {}),
            ...(input.sessionId ? { sessionId: input.sessionId } : {}),
            ...(input.requestGroupId ? { requestGroupId: input.requestGroupId } : {}),
            ...(input.source ? { source: input.source } : {}),
            detail: {
                providerId: trace.providerId,
                providerSource: trace.source,
                providerStage: trace.stage,
                candidateCount: trace.candidateCount,
                skipped: trace.skipped === true,
                timedOut: trace.timedOut === true,
            },
        });
        traces.push(trace);
        for (const candidate of trace.candidates) {
            if (!candidates.has(candidate.candidateId))
                candidates.set(candidate.candidateId, candidate);
        }
        foundFastPath = [...candidates.values()].some(isFastPathCandidate);
    }
    const limit = Math.max(1, Math.min(input.limit ?? 20, 100));
    return {
        candidates: [...candidates.values()].slice(0, limit),
        traces,
        skippedSlowProviders,
    };
}
export function createExplicitIdProvider(params) {
    return {
        id: params.id,
        source: "explicit_id",
        stage: "fast",
        async find(input) {
            const results = [];
            for (const rawId of params.ids(input)) {
                const id = normalizeId(rawId);
                if (!id)
                    continue;
                const payload = await params.resolve(id, input);
                if (!payload)
                    continue;
                results.push({
                    candidateId: params.candidateId?.(payload, id) ?? id,
                    candidateKind: params.candidateKind,
                    candidateReason: "explicit_id",
                    source: "explicit_id",
                    payload,
                    matchedKeys: [`explicit:${id}`],
                    requiresFinalDecision: false,
                });
            }
            return results;
        },
    };
}
export function createStructuredKeyProvider(params) {
    return {
        id: params.id,
        source: "structured_key",
        stage: "fast",
        async find(input) {
            const results = [];
            for (const item of params.keys(input)) {
                const value = normalizeId(item.value);
                if (!value)
                    continue;
                const payload = await params.resolve(item.key, value, input);
                if (!payload)
                    continue;
                results.push({
                    candidateId: params.candidateId?.(payload, item.key, value) ?? `${item.key}:${value}`,
                    candidateKind: params.candidateKind,
                    candidateReason: "structured_key",
                    source: "structured_key",
                    payload,
                    matchedKeys: [`${item.key}:${value}`],
                    requiresFinalDecision: false,
                });
            }
            return results;
        },
    };
}
export function createStoreCandidateProvider(params) {
    return {
        id: params.id,
        source: params.source,
        stage: "store",
        async find(input) {
            const payloads = await params.find(input);
            return payloads.map((payload) => ({
                candidateId: params.candidateId(payload),
                candidateKind: params.candidateKind,
                candidateReason: params.candidateReason,
                source: params.source,
                payload,
                matchedKeys: params.matchedKeys?.(payload) ?? [],
                requiresFinalDecision: params.requiresFinalDecision ?? true,
            }));
        },
    };
}
export function createMemoryVectorProvider(params) {
    return {
        id: params.id ?? "memory-vector-provider",
        source: "memory_vector",
        stage: "slow",
        async find(input, context) {
            if (params.enabled === false)
                return [];
            const query = input.semanticQuery?.trim();
            if (!query)
                return [];
            const results = await params.search(input, context.signal);
            return results.map((result) => ({
                candidateId: result.id,
                candidateKind: "memory",
                candidateReason: "semantic_candidate",
                source: "memory_vector",
                payload: result.payload,
                matchedKeys: ["semantic_candidate"],
                requiresFinalDecision: true,
                score: {
                    kind: "candidate_score",
                    metric: "vector",
                    value: result.score ?? 0,
                },
            }));
        },
    };
}
export function decideCandidateFinal(params) {
    if (!params.candidate) {
        return {
            kind: "new",
            finalDecisionSource: "safe_fallback",
            reasonCode: "no_candidate",
        };
    }
    if (params.candidate.candidateReason === "semantic_candidate" && params.finalDecisionSource !== "contract_ai" && params.finalDecisionSource !== "user_choice") {
        return {
            kind: "clarify",
            finalDecisionSource: "safe_fallback",
            selectedCandidate: params.candidate,
            reasonCode: "semantic_candidate_requires_contract_or_user_choice",
        };
    }
    return {
        kind: params.requested,
        finalDecisionSource: params.finalDecisionSource,
        selectedCandidate: params.candidate,
        reasonCode: "final_decision_source_allowed",
    };
}
export function buildCandidateDecisionAuditDetails(params) {
    return {
        candidateSources: [...new Set(params.candidates.map((candidate) => candidate.source))],
        candidateReasons: [...new Set(params.candidates.map((candidate) => candidate.candidateReason))],
        finalDecisionSource: params.decision.finalDecisionSource,
        finalDecisionKind: params.decision.kind,
        selectedCandidateId: params.decision.selectedCandidate?.candidateId ?? null,
        selectedCandidateSource: params.decision.selectedCandidate?.source ?? null,
        selectedCandidateReason: params.decision.selectedCandidate?.candidateReason ?? null,
    };
}
//# sourceMappingURL=index.js.map