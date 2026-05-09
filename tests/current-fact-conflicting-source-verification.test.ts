import { describe, expect, it } from "vitest"
import {
  buildFinancialInformationBoundaryNotice,
  buildRetrievalVerificationPlan,
  evaluateRetrievalVerificationPlan,
  formatCurrentFactVerificationAnswer,
  sourceCandidateFromEvidence,
} from "../packages/core/src/runs/current-fact-retrieval.ts"
import {
  parseFinanceQuoteCandidates,
} from "../packages/core/src/runs/web-source-adapters/finance.ts"
import {
  verifyRetrievedValueCandidate,
  verifyRetrievedValueCandidates,
} from "../packages/core/src/runs/web-retrieval-verification.ts"

describe("task009 conflicting current-fact source verification", () => {
  it("does not arbitrarily pick one value when finance sources conflict outside tolerance", () => {
    const google = parseFinanceQuoteCandidates({
      targetKey: "kospi",
      sourceUrl: "https://www.google.com/finance/quote/KOSPI:KRX",
      fetchTimestamp: "2026-05-07T08:00:00.000Z",
      sourceTimestamp: "2026-05-07T07:59:00.000Z",
      content: "KOSPI 2,700.00",
    })
    const investing = parseFinanceQuoteCandidates({
      targetKey: "kospi",
      sourceUrl: "https://www.investing.com/indices/kospi",
      fetchTimestamp: "2026-05-07T08:01:00.000Z",
      sourceTimestamp: "2026-05-07T08:00:00.000Z",
      content: "KOSPI 2,750.50",
    })
    const candidates = [...google.candidates, ...investing.candidates]
    const sourceEvidenceById = {
      [google.sourceEvidenceId]: google.sourceEvidence,
      [investing.sourceEvidenceId]: investing.sourceEvidence,
    }
    const conflictVerdict = verifyRetrievedValueCandidates({
      candidates,
      target: google.targetContract,
      sourceEvidenceById,
      policy: "latest_approximate",
    })
    const plan = buildRetrievalVerificationPlan({
      target: google.targetContract,
      freshnessPolicy: "latest_approximate",
      sources: [
        sourceCandidateFromEvidence(google.sourceEvidence),
        sourceCandidateFromEvidence(investing.sourceEvidence),
      ],
    })
    const decision = evaluateRetrievalVerificationPlan({
      plan,
      results: plan.sources.map((source) => ({
        sourceId: source.sourceId,
        status: "conflict",
        verdict: conflictVerdict,
        evidence: source.sourceDomain === "www.google.com"
          ? google.sourceEvidence
          : investing.sourceEvidence,
        attemptedAt: source.sourceDomain === "www.google.com"
          ? google.sourceEvidence.fetchTimestamp
          : investing.sourceEvidence.fetchTimestamp,
      })),
    })
    const summary = formatCurrentFactVerificationAnswer({ plan, decision })

    expect(conflictVerdict.canAnswer).toBe(false)
    expect(conflictVerdict.evidenceSufficiency).toBe("insufficient_conflict")
    expect(conflictVerdict.conflicts).toEqual(expect.arrayContaining([
      expect.stringContaining("2700"),
      expect.stringContaining("2750.5"),
    ]))
    expect(decision.kind).toBe("explain_conflict")
    expect(summary.text).toContain("verified_sources_conflict")
    expect(summary.text).toContain("출처와 기준 시각")
  })

  it("allows small delayed quote variance within finance tolerance and keeps source time caveat", () => {
    const google = parseFinanceQuoteCandidates({
      targetKey: "kospi",
      sourceUrl: "https://www.google.com/finance/quote/KOSPI:KRX",
      fetchTimestamp: "2026-05-07T08:00:00.000Z",
      sourceTimestamp: "2026-05-07T07:59:00.000Z",
      content: "KOSPI 2,700.00",
    })
    const naver = parseFinanceQuoteCandidates({
      targetKey: "kospi",
      sourceUrl: "https://finance.naver.com/sise/sise_index.naver?code=KOSPI",
      fetchTimestamp: "2026-05-07T08:01:00.000Z",
      sourceTimestamp: "2026-05-07T07:58:30.000Z",
      content: "KOSPI 2,700.70",
    })
    const verdict = verifyRetrievedValueCandidates({
      candidates: [...google.candidates, ...naver.candidates],
      target: google.targetContract,
      sourceEvidenceById: {
        [google.sourceEvidenceId]: google.sourceEvidence,
        [naver.sourceEvidenceId]: naver.sourceEvidence,
      },
      policy: "latest_approximate",
    })

    expect(verdict.canAnswer).toBe(true)
    expect(verdict.caveats).toContain("candidate_value_variance_within_tolerance")
  })

  it("adds a risk notice only for structured investment-advice boundary", () => {
    const factNotice = buildFinancialInformationBoundaryNotice({
      boundary: "market_fact",
      checkedAt: "2026-05-07T08:00:00.000Z",
    })
    const adviceNotice = buildFinancialInformationBoundaryNotice({
      boundary: "investment_advice",
      checkedAt: "2026-05-07T08:00:00.000Z",
    })

    expect(factNotice.mustIncludeRiskNotice).toBe(false)
    expect(factNotice.notice).toContain("확인 시각")
    expect(adviceNotice.mustIncludeRiskNotice).toBe(true)
    expect(adviceNotice.notice).toContain("손실 위험")
    expect(adviceNotice.notice).toContain("개인 맞춤 투자 권유")
  })

  it("keeps search snippets as candidates even when they contain numbers", () => {
    const parsed = parseFinanceQuoteCandidates({
      targetKey: "kospi",
      sourceUrl: "https://search.example/kospi",
      fetchTimestamp: "2026-05-07T08:00:00.000Z",
      content: "검색 결과: KOSPI 2,700.00",
    })
    const verdict = verifyRetrievedValueCandidate({
      candidate: parsed.candidates[0],
      target: parsed.targetContract,
      sourceEvidence: {
        ...parsed.sourceEvidence,
        method: "fast_text_search",
        sourceKind: "search_index",
        reliability: "medium",
      },
      policy: "latest_approximate",
    })
    const plan = buildRetrievalVerificationPlan({
      target: parsed.targetContract,
      freshnessPolicy: "latest_approximate",
      sources: [{
        role: "search_candidate",
        method: "fast_text_search",
        sourceUrl: "https://search.example/kospi",
        sourceDomain: "search.example",
        sourceLabel: "search snippet",
        sourceKind: "search_index",
        reliability: "medium",
      }],
    })
    const decision = evaluateRetrievalVerificationPlan({
      plan,
      results: [{
        sourceId: plan.sources[0]!.sourceId,
        status: "candidate_only",
        verdict,
        attemptedAt: "2026-05-07T08:00:00.000Z",
      }],
    })

    expect(verdict.canAnswer).toBe(true)
    expect(decision.kind).toBe("unable_after_exhausting_sources")
    expect(decision.confirmedResults).toHaveLength(0)
    expect(decision.reasonCodes).toContain("search_candidate_is_discovery_only")
  })
})
