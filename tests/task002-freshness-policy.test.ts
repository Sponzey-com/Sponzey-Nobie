import { describe, expect, it } from "vitest"
import {
  extractRetrievedValueCandidates,
  sourceKindSatisfiesOfficialRequired,
  verifyRetrievedValueCandidate,
  verifyRetrievedValueCandidates,
} from "../packages/core/src/runs/web-retrieval-verification.js"
import { createRetrievalTargetContract } from "../packages/core/src/runs/web-retrieval-session.js"
import type { SourceEvidence } from "../packages/core/src/runs/web-retrieval-policy.js"

const target = createRetrievalTargetContract({
  kind: "finance_index",
  rawQuery: "코스피 지수",
  canonicalName: "KOSPI",
  symbols: ["KOSPI"],
  market: "KRX",
})

function evidence(overrides: Partial<SourceEvidence> = {}): SourceEvidence {
  return {
    method: "direct_fetch",
    sourceKind: "third_party",
    reliability: "medium",
    sourceUrl: "https://www.investing.com/indices/kospi",
    sourceDomain: "www.investing.com",
    sourceTimestamp: null,
    fetchTimestamp: "2026-04-17T05:34:32.679Z",
    freshnessPolicy: "latest_approximate",
    ...overrides,
  }
}

function kospiCandidate(source: SourceEvidence, sourceEvidenceId = "source-kospi") {
  return extractRetrievedValueCandidates({
    sourceEvidenceId,
    sourceEvidence: source,
    target,
    inputKind: "plain_text",
    content: "KOSPI 현재 지수 6,226.05",
  }).find((item) => item.rawValue === "6,226.05")
}

describe("task002 freshness and evidence sufficiency policy", () => {
  it("latest approximate can answer from fetch timestamp when target binding is strong", () => {
    const source = evidence({ sourceTimestamp: null })
    const candidate = kospiCandidate(source)
    const verdict = verifyRetrievedValueCandidate({ candidate, target, sourceEvidence: source, policy: "latest_approximate" })

    expect(verdict.canAnswer).toBe(true)
    expect(verdict.evidenceSufficiency).toBe("sufficient_approximate")
    expect(verdict.rejectionReason).toBeNull()
  })

  it("strict timestamp blocks confirmation when source timestamp is missing", () => {
    const source = evidence({ sourceTimestamp: null })
    const candidate = kospiCandidate(source)
    const verdict = verifyRetrievedValueCandidate({ candidate, target, sourceEvidence: source, policy: "strict_timestamp" })

    expect(verdict.canAnswer).toBe(false)
    expect(verdict.evidenceSufficiency).toBe("blocked")
    expect(verdict.rejectionReason).toBe("source_timestamp_required")
  })

  it("strict timestamp can answer when source timestamp is present", () => {
    const source = evidence({ sourceTimestamp: "2026-04-17T14:50:00+09:00" })
    const candidate = kospiCandidate(source)
    const verdict = verifyRetrievedValueCandidate({ candidate, target, sourceEvidence: source, policy: "strict_timestamp" })

    expect(verdict.canAnswer).toBe(true)
    expect(verdict.evidenceSufficiency).toBe("sufficient_exact")
  })

  it("official required policy rejects third-party final answer sources", () => {
    const source = evidence({ sourceKind: "third_party", sourceDomain: "www.investing.com" })
    const candidate = kospiCandidate(source)
    const verdict = verifyRetrievedValueCandidate({ candidate, target, sourceEvidence: source, policy: "official_required" })

    expect(sourceKindSatisfiesOfficialRequired(source.sourceKind)).toBe(false)
    expect(verdict.canAnswer).toBe(false)
    expect(verdict.evidenceSufficiency).toBe("blocked")
    expect(verdict.rejectionReason).toBe("official_source_required")
  })

  it("official required policy allows official or first-party evidence after binding passes", () => {
    const source = evidence({ sourceKind: "official", sourceDomain: "data.krx.co.kr", sourceTimestamp: "2026-04-17T14:50:00+09:00" })
    const candidate = kospiCandidate(source)
    const verdict = verifyRetrievedValueCandidate({ candidate, target, sourceEvidence: source, policy: "official_required" })

    expect(sourceKindSatisfiesOfficialRequired(source.sourceKind)).toBe(true)
    expect(verdict.canAnswer).toBe(true)
    expect(verdict.evidenceSufficiency).toBe("sufficient_exact")
  })

  it("returns candidate-missing separately from weak binding or policy blocks", () => {
    const verdict = verifyRetrievedValueCandidates({
      candidates: [],
      target,
      sourceEvidenceById: {},
      policy: "latest_approximate",
    })

    expect(verdict.canAnswer).toBe(false)
    expect(verdict.evidenceSufficiency).toBe("insufficient_candidate_missing")
    expect(verdict.rejectionReason).toBe("candidate_missing")
  })
})
