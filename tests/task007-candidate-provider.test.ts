import { describe, expect, it } from "vitest"
import {
  buildCandidateDecisionAuditDetails,
  createExplicitIdProvider,
  createMemoryVectorProvider,
  createStoreCandidateProvider,
  createStructuredKeyProvider,
  decideCandidateFinal,
  runCandidateProviders,
  type CandidateSearchInput,
} from "../packages/core/src/candidates/index.ts"

interface CandidatePayload {
  id: string
  label: string
}

describe("task007 candidate provider boundary", () => {
  it("runs explicit id as a fast path and skips store/vector providers", async () => {
    let storeCalled = false
    let vectorCalled = false
    const explicit = createExplicitIdProvider<CandidateSearchInput, CandidatePayload>({
      id: "explicit-run",
      candidateKind: "run",
      ids: (input) => [input.explicitIds?.runId],
      resolve: (id) => id === "run-1" ? { id, label: "active run" } : undefined,
      candidateId: (payload) => payload.id,
    })
    const store = createStoreCandidateProvider<CandidateSearchInput, CandidatePayload>({
      id: "run-store",
      source: "run_store",
      candidateKind: "run",
      candidateReason: "run_contract_projection",
      find: () => {
        storeCalled = true
        return [{ id: "run-store-1", label: "store run" }]
      },
      candidateId: (payload) => payload.id,
    })
    const vector = createMemoryVectorProvider<CandidateSearchInput, CandidatePayload>({
      id: "memory-vector",
      search: async () => {
        vectorCalled = true
        return [{ id: "memory-1", payload: { id: "memory-1", label: "semantic memory" }, score: 0.99 }]
      },
    })

    const result = await runCandidateProviders({
      explicitIds: { runId: "run-1" },
      semanticQuery: "이 작업 이어서 해줘",
    }, [store, vector, explicit], {
      providerTimeoutMs: 20,
      skipSlowOnFastPath: true,
    })

    expect(result.candidates).toHaveLength(1)
    expect(result.candidates[0]?.source).toBe("explicit_id")
    expect(result.candidates[0]?.requiresFinalDecision).toBe(false)
    expect(storeCalled).toBe(false)
    expect(vectorCalled).toBe(false)
    expect(result.skippedSlowProviders).toBe(true)
    expect(result.traces.filter((trace) => trace.skipped).map((trace) => trace.providerId)).toEqual(["run-store", "memory-vector"])
  })

  it("uses structured keys without invoking vector search", async () => {
    let vectorCalled = false
    const structured = createStructuredKeyProvider<CandidateSearchInput, CandidatePayload>({
      id: "schedule-key",
      candidateKind: "schedule",
      keys: (input) => [
        { key: "schedule.identity", value: input.structuredKeys?.identityKey },
      ],
      resolve: (_key, value) => value === "identity:daily-weather"
        ? { id: "schedule-1", label: "daily weather" }
        : undefined,
      candidateId: (payload) => payload.id,
    })
    const vector = createMemoryVectorProvider<CandidateSearchInput, CandidatePayload>({
      search: async () => {
        vectorCalled = true
        return [{ id: "memory-1", payload: { id: "memory-1", label: "semantic memory" }, score: 0.8 }]
      },
    })

    const result = await runCandidateProviders({
      structuredKeys: { identityKey: "identity:daily-weather" },
      semanticQuery: "날씨 예약",
    }, [vector, structured], {
      providerTimeoutMs: 20,
      skipSlowOnFastPath: true,
    })

    expect(result.candidates).toHaveLength(1)
    expect(result.candidates[0]?.candidateReason).toBe("structured_key")
    expect(result.candidates[0]?.source).toBe("structured_key")
    expect(vectorCalled).toBe(false)
  })

  it("returns store candidates with stable provider source and reason", async () => {
    const store = createStoreCandidateProvider<CandidateSearchInput, CandidatePayload>({
      id: "schedule-store",
      source: "schedule_store",
      candidateKind: "schedule",
      candidateReason: "schedule_identity_key",
      find: () => [{ id: "schedule-1", label: "morning weather" }],
      candidateId: (payload) => payload.id,
      matchedKeys: (payload) => [`identity:${payload.id}`],
      requiresFinalDecision: true,
    })

    const result = await runCandidateProviders({ limit: 5 }, [store])

    expect(result.candidates).toEqual([
      {
        candidateId: "schedule-1",
        candidateKind: "schedule",
        candidateReason: "schedule_identity_key",
        source: "schedule_store",
        payload: { id: "schedule-1", label: "morning weather" },
        matchedKeys: ["identity:schedule-1"],
        requiresFinalDecision: true,
      },
    ])
  })

  it("returns vector results only as semantic candidates with candidate scores", async () => {
    const vector = createMemoryVectorProvider<CandidateSearchInput, CandidatePayload>({
      search: async () => [
        { id: "memory-1", payload: { id: "memory-1", label: "similar request" }, score: 0.99 },
      ],
    })

    const result = await runCandidateProviders({ semanticQuery: "비슷한 요청" }, [vector], {
      providerTimeoutMs: 20,
    })

    const candidate = result.candidates[0]
    expect(candidate?.source).toBe("memory_vector")
    expect(candidate?.candidateKind).toBe("memory")
    expect(candidate?.candidateReason).toBe("semantic_candidate")
    expect(candidate?.requiresFinalDecision).toBe(true)
    expect(candidate?.score).toEqual({ kind: "candidate_score", metric: "vector", value: 0.99 })
  })

  it("does not fail candidate search when vector provider times out", async () => {
    const vector = createMemoryVectorProvider<CandidateSearchInput, CandidatePayload>({
      search: () => new Promise(() => undefined),
    })

    const result = await runCandidateProviders({ semanticQuery: "느린 벡터 조회" }, [vector], {
      providerTimeoutMs: 5,
    })

    expect(result.candidates).toEqual([])
    expect(result.traces[0]?.timedOut).toBe(true)
    expect(result.traces[0]?.candidateCount).toBe(0)
  })

  it("requires contract AI or user choice before semantic candidates become final decisions", async () => {
    const vector = createMemoryVectorProvider<CandidateSearchInput, CandidatePayload>({
      search: async () => [
        { id: "memory-1", payload: { id: "memory-1", label: "high score semantic match" }, score: 1 },
      ],
    })
    const result = await runCandidateProviders({ semanticQuery: "취소해" }, [vector])
    const candidate = result.candidates[0]
    expect(candidate).toBeDefined()

    const unsafeDecision = decideCandidateFinal({
      requested: "cancel",
      candidate,
      finalDecisionSource: "structured_key",
    })
    const contractDecision = decideCandidateFinal({
      requested: "cancel",
      candidate,
      finalDecisionSource: "contract_ai",
    })
    const userDecision = decideCandidateFinal({
      requested: "cancel",
      candidate,
      finalDecisionSource: "user_choice",
    })

    expect(unsafeDecision.kind).toBe("clarify")
    expect(unsafeDecision.finalDecisionSource).toBe("safe_fallback")
    expect(unsafeDecision.reasonCode).toBe("semantic_candidate_requires_contract_or_user_choice")
    expect(contractDecision.kind).toBe("cancel")
    expect(contractDecision.finalDecisionSource).toBe("contract_ai")
    expect(userDecision.kind).toBe("cancel")
    expect(userDecision.finalDecisionSource).toBe("user_choice")
  })

  it("keeps candidate source and final decision source separate in audit details", async () => {
    const explicit = createExplicitIdProvider<CandidateSearchInput, CandidatePayload>({
      id: "explicit-artifact",
      candidateKind: "artifact",
      ids: (input) => [input.explicitIds?.artifactId],
      resolve: (id) => id === "artifact-1" ? { id, label: "capture artifact" } : undefined,
    })
    const vector = createMemoryVectorProvider<CandidateSearchInput, CandidatePayload>({
      search: async () => [
        { id: "memory-1", payload: { id: "memory-1", label: "semantic memory" }, score: 0.7 },
      ],
    })
    const result = await runCandidateProviders({
      explicitIds: { artifactId: "artifact-1" },
      semanticQuery: "이 파일 보여줘",
    }, [explicit, vector], {
      skipSlowOnFastPath: false,
    })
    const semanticCandidate = result.candidates.find((candidate) => candidate.candidateReason === "semantic_candidate")
    expect(semanticCandidate).toBeDefined()

    const decision = decideCandidateFinal({
      requested: "same",
      candidate: semanticCandidate,
      finalDecisionSource: "contract_ai",
    })
    const audit = buildCandidateDecisionAuditDetails({ candidates: result.candidates, decision })

    expect(audit).toEqual({
      candidateSources: ["explicit_id", "memory_vector"],
      candidateReasons: ["explicit_id", "semantic_candidate"],
      finalDecisionSource: "contract_ai",
      finalDecisionKind: "same",
      selectedCandidateId: "memory-1",
      selectedCandidateSource: "memory_vector",
      selectedCandidateReason: "semantic_candidate",
    })
  })
})
