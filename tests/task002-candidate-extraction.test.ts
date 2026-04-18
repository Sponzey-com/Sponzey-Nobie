import { describe, expect, it } from "vitest"
import {
  buildCandidateExtractionFailureEvent,
  extractRetrievedValueCandidates,
} from "../packages/core/src/runs/web-retrieval-verification.js"
import { createRetrievalTargetContract } from "../packages/core/src/runs/web-retrieval-session.js"
import type { SourceEvidence } from "../packages/core/src/runs/web-retrieval-policy.js"

const kospiTarget = createRetrievalTargetContract({
  kind: "finance_index",
  rawQuery: "지금 코스피 지수 얼마야",
  canonicalName: "KOSPI",
  symbols: ["KOSPI"],
  market: "KRX",
  locale: "ko-KR",
})

const sourceEvidence: SourceEvidence = {
  method: "fast_text_search",
  sourceKind: "search_index",
  reliability: "medium",
  sourceUrl: "https://www.investing.com/indices/kospi",
  sourceDomain: "www.investing.com",
  sourceTimestamp: null,
  fetchTimestamp: "2026-04-17T05:20:23.000Z",
  freshnessPolicy: "latest_approximate",
}

describe("task002 candidate extraction", () => {
  it("extracts numeric candidates from search snippets with source and target binding details", () => {
    const candidates = extractRetrievedValueCandidates({
      sourceEvidenceId: "source-kospi-snippet",
      sourceEvidence,
      target: kospiTarget,
      inputKind: "search_snippet",
      content: "KOSPI 현재 지수 6,226.05 - Investing.com 검색 결과 스니펫",
    })
    const candidate = candidates.find((item) => item.rawValue === "6,226.05")

    expect(candidate).toBeDefined()
    expect(candidate?.sourceEvidenceId).toBe("source-kospi-snippet")
    expect(candidate?.targetId).toBe(kospiTarget.targetId)
    expect(candidate?.normalizedValue).toBe("6226.05")
    expect(candidate?.labelNearValue).toContain("KOSPI")
    expect(candidate?.targetLabelNearValue).toBe("KOSPI")
    expect(candidate?.bindingSignals.some((signal) => signal.kind === "symbol" || signal.kind === "canonical_name")).toBe(true)
  })

  it("keeps target label and nearby value label as separate fields", () => {
    const [candidate] = extractRetrievedValueCandidates({
      sourceEvidenceId: "source-kospi-label",
      sourceEvidence,
      target: kospiTarget,
      inputKind: "plain_text",
      content: "한국 시장 요약: KOSPI 종가 부근 6,226.05 포인트",
    })

    expect(candidate?.labelNearValue).toContain("KOSPI")
    expect(candidate?.labelNearValue).toContain("포인트")
    expect(candidate?.targetLabelNearValue).toBe("KOSPI")
    expect(candidate?.unit).toBe("point")
  })

  it("does not create candidates without source evidence identity", () => {
    expect(() => extractRetrievedValueCandidates({
      sourceEvidenceId: " ",
      sourceEvidence,
      target: kospiTarget,
      inputKind: "search_snippet",
      content: "KOSPI 6,226.05",
    })).toThrow(/sourceEvidenceId/)
  })

  it("represents extraction failure as a structured event without failing retrieval", () => {
    const candidates = extractRetrievedValueCandidates({
      sourceEvidenceId: "source-empty",
      sourceEvidence,
      target: kospiTarget,
      inputKind: "html_text",
      content: "값이 없는 페이지 본문",
    })
    const event = buildCandidateExtractionFailureEvent({
      sourceEvidenceId: "source-empty",
      targetId: kospiTarget.targetId,
      reason: "no_numeric_candidate",
      inputKind: "html_text",
    })

    expect(candidates).toEqual([])
    expect(event).toMatchObject({
      eventType: "web_retrieval.candidate_extraction_failed",
      sourceEvidenceId: "source-empty",
      targetId: kospiTarget.targetId,
      reason: "no_numeric_candidate",
    })
  })
})
