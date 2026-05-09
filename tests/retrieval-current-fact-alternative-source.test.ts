import { describe, expect, it } from "vitest"
import {
  aggregateSubSessionResultsForParent,
  type ParentAggregationChildInput,
} from "../packages/core/src/agent/sub-agent-result-review.ts"
import {
  buildRetrievalVerificationPlan,
  evaluateRetrievalVerificationPlan,
  formatCurrentFactVerificationAnswer,
  sourceCandidateFromEvidence,
  type CurrentFactSourceCandidate,
} from "../packages/core/src/runs/current-fact-retrieval.ts"
import {
  buildFinanceKnownSources,
  createFinanceIndexTargetContract,
  resolveFinanceIndexTarget,
  type FinanceIndexKey,
} from "../packages/core/src/runs/web-source-adapters/finance.ts"

describe("current-fact parent aggregation alternative source", () => {
  it("treats an unverified child result as an alternative-search trigger, not final success", () => {
    const child: ParentAggregationChildInput = {
      subSessionId: "sub:current-fact",
      review: {
        accepted: false,
        status: "needs_revision",
        verdict: "insufficient_evidence",
        parentIntegrationStatus: "blocked_insufficient_evidence",
        missingItems: ["missing_evidence:answer:source"],
        risksOrGaps: ["primary source did not confirm one requested value"],
        canRetry: true,
      },
      attemptedMethods: ["primary_source_fetch"],
      remainingAlternatives: ["fetch another concrete source path"],
    }

    const trace = aggregateSubSessionResultsForParent({
      parentRunId: "run:current-fact",
      originalRequest: "현재 시장 지수를 확인해줘",
      successCriteria: ["every requested value has explicit source evidence"],
      childResults: [child],
    })

    expect(trace.finalDeliveryAllowed).toBe(false)
    expect(trace.nextAction).toBe("augment_same_child")
    expect(trace.reasonCodes).toEqual(expect.arrayContaining([
      "child_result_blocked",
      "child_result_unverified",
      "same_child_augmentation_available",
      "next_action:augment_same_child",
    ]))
  })
})

describe("task009 current-fact retrieval alternative source", () => {
  function financeSources(key: FinanceIndexKey = "kospi"): CurrentFactSourceCandidate[] {
    return buildFinanceKnownSources(key).map((source) => ({
      sourceId: `source:${source.sourceDomain}:${source.url}`,
      role: "verification_source",
      method: source.method,
      sourceUrl: source.url,
      sourceDomain: source.sourceDomain,
      sourceLabel: source.sourceLabel,
      sourceKind: source.sourceKind,
      reliability: source.reliability,
    }))
  }

  it("tries the next concrete source when Google Finance fetch returns no value", () => {
    const plan = buildRetrievalVerificationPlan({
      target: createFinanceIndexTargetContract("kospi", "현재 코스피 지수"),
      freshnessPolicy: "latest_approximate",
      sources: financeSources(),
      now: new Date("2026-05-07T08:00:00.000Z"),
    })
    const [google, next] = plan.sources
    const decision = evaluateRetrievalVerificationPlan({
      plan,
      results: [{
        sourceId: google!.sourceId,
        status: "dynamic_blocked",
        sourceState: "dynamic_blocked",
        attemptedAt: "2026-05-07T08:00:00.000Z",
        failureReason: "fetch returned HTML without a bound KOSPI value",
      }],
    })

    expect(decision.kind).toBe("continue_verification")
    expect(decision.nextSource).toEqual(next)
    expect(decision.nextSource?.sourceUrl).not.toBe(google?.sourceUrl)
    expect(decision.reasonCodes).toContain("next_verification_source_available")
  })

  it("keeps KOSPI and generic Nasdaq verification as separate current-fact targets with alternative sources", () => {
    const kospi = resolveFinanceIndexTarget("현재 시점의 코스피 지수")
    const nasdaq = resolveFinanceIndexTarget("미국 나스닥 지수")
    if (!kospi || !nasdaq) throw new Error("finance target resolution failed")

    expect(kospi.key).toBe("kospi")
    expect(nasdaq.key).toBe("nasdaq_composite")
    expect(nasdaq.caveats).toContain("generic_nasdaq_defaults_to_nasdaq_composite")

    const kospiPlan = buildRetrievalVerificationPlan({
      target: kospi.targetContract,
      freshnessPolicy: "latest_approximate",
      sources: financeSources(kospi.key),
    })
    const nasdaqPlan = buildRetrievalVerificationPlan({
      target: nasdaq.targetContract,
      freshnessPolicy: "latest_approximate",
      sources: financeSources(nasdaq.key),
    })

    const kospiDecision = evaluateRetrievalVerificationPlan({
      plan: kospiPlan,
      results: [{
        sourceId: kospiPlan.sources[0]!.sourceId,
        status: "no_value",
        attemptedAt: "2026-05-07T08:00:00.000Z",
        failureReason: "primary KOSPI source did not expose a bound value",
      }],
    })
    const nasdaqDecision = evaluateRetrievalVerificationPlan({
      plan: nasdaqPlan,
      results: [{
        sourceId: nasdaqPlan.sources[0]!.sourceId,
        status: "no_value",
        attemptedAt: "2026-05-07T08:00:00.000Z",
        failureReason: "primary Nasdaq source did not expose a bound value",
      }],
    })

    expect(kospiPlan.target.targetId).not.toBe(nasdaqPlan.target.targetId)
    expect(kospiDecision.kind).toBe("continue_verification")
    expect(nasdaqDecision.kind).toBe("continue_verification")
    expect(kospiDecision.nextSource?.sourceDomain).not.toBe(kospiPlan.sources[0]?.sourceDomain)
    expect(nasdaqDecision.nextSource?.sourceDomain).not.toBe(nasdaqPlan.sources[0]?.sourceDomain)
  })

  it("does not confirm a current value from search candidates alone", () => {
    const [direct] = financeSources()
    const plan = buildRetrievalVerificationPlan({
      target: createFinanceIndexTargetContract("kospi", "현재 코스피 지수"),
      freshnessPolicy: "latest_approximate",
      sources: [
        {
          role: "search_candidate",
          method: "fast_text_search",
          sourceUrl: "https://search.example/result",
          sourceDomain: "search.example",
          sourceLabel: "search snippet candidate",
          sourceKind: "search_index",
          reliability: "medium",
        },
        direct!,
      ],
    })
    const search = plan.sources[0]!
    const decision = evaluateRetrievalVerificationPlan({
      plan,
      results: [{
        sourceId: search.sourceId,
        status: "candidate_only",
        attemptedAt: "2026-05-07T08:00:00.000Z",
        notes: ["search snippet showed a numeric candidate"],
      }],
    })

    expect(decision.kind).toBe("continue_verification")
    expect(decision.confirmedResults).toHaveLength(0)
    expect(decision.nextSource?.role).toBe("verification_source")
    expect(decision.reasonCodes).toEqual(expect.arrayContaining([
      "search_candidate_is_discovery_only",
      "next_verification_source_available",
    ]))
  })

  it("classifies search evidence as discovery even when it carries an answerable verdict", () => {
    const [direct] = financeSources()
    const target = createFinanceIndexTargetContract("kospi", "현재 코스피 지수")
    const search = sourceCandidateFromEvidence({
      method: "fast_text_search",
      sourceKind: "search_index",
      reliability: "medium",
      sourceUrl: "https://search.example/kospi",
      sourceDomain: "search.example",
      sourceLabel: "search snippet candidate",
      fetchTimestamp: "2026-05-07T08:00:00.000Z",
      freshnessPolicy: "latest_approximate",
    })
    const plan = buildRetrievalVerificationPlan({
      target,
      freshnessPolicy: "latest_approximate",
      sources: [search, direct!],
    })
    const decision = evaluateRetrievalVerificationPlan({
      plan,
      results: [{
        sourceId: search.sourceId,
        status: "verified",
        attemptedAt: "2026-05-07T08:00:00.000Z",
        verdict: {
          candidateId: "candidate:search-snippet",
          canAnswer: true,
          bindingStrength: "strong",
          evidenceSufficiency: "sufficient_approximate",
          rejectionReason: null,
          policy: "latest_approximate",
          sourceEvidenceId: search.sourceId,
          targetId: target.targetId,
          acceptedValue: "2700",
          acceptedUnit: "point",
          bindingSignals: [],
          conflicts: [],
          caveats: ["search snippet candidate"],
        },
      }],
    })

    expect(search.role).toBe("search_candidate")
    expect(decision.kind).toBe("continue_verification")
    expect(decision.confirmedResults).toHaveLength(0)
    expect(decision.unverifiedResults).toHaveLength(1)
    expect(decision.nextSource?.sourceId).toBe(direct?.sourceId)
  })

  it("treats market closed or delayed state as an explainable state, not generic failure", () => {
    const [source] = financeSources()
    const plan = buildRetrievalVerificationPlan({
      target: createFinanceIndexTargetContract("kospi", "현재 코스피 지수"),
      freshnessPolicy: "latest_approximate",
      sources: [source!],
    })
    const decision = evaluateRetrievalVerificationPlan({
      plan,
      results: [{
        sourceId: source!.sourceId,
        status: "market_closed_or_delayed",
        sourceState: "market_closed",
        attemptedAt: "2026-05-07T08:00:00.000Z",
        failureReason: "market is closed; live quote is not updating",
      }],
    })

    expect(decision.kind).toBe("explain_market_state")
    expect(decision.reasonCodes).toContain("source_reports_market_state")
  })

  it("summarizes attempted sources and reasons only after every verification source is exhausted", () => {
    const sources = financeSources().slice(0, 2)
    const plan = buildRetrievalVerificationPlan({
      target: createFinanceIndexTargetContract("kospi", "현재 코스피 지수"),
      freshnessPolicy: "latest_approximate",
      sources,
    })
    const decision = evaluateRetrievalVerificationPlan({
      plan,
      results: sources.map((source) => ({
        sourceId: source.sourceId,
        status: "no_value",
        attemptedAt: "2026-05-07T08:00:00.000Z",
        failureReason: `${source.sourceDomain} did not expose a bound KOSPI value`,
      })),
    })
    const summary = formatCurrentFactVerificationAnswer({ plan, decision })

    expect(decision.kind).toBe("unable_after_exhausting_sources")
    expect(decision.reasonCodes).toContain("all_verification_sources_exhausted")
    expect(summary.unverified).toHaveLength(2)
    expect(summary.text).toContain("미확인 항목")
    expect(summary.text).toContain("출처와 기준 시각")
  })
})
