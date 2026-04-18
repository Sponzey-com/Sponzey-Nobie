import { describe, expect, it } from "vitest"
import {
  extractRetrievedValueCandidates,
  verifyRetrievedValueCandidate,
} from "../packages/core/src/runs/web-retrieval-verification.js"
import { createRetrievalTargetContract } from "../packages/core/src/runs/web-retrieval-session.js"
import type { SourceEvidence } from "../packages/core/src/runs/web-retrieval-policy.js"

function sourceEvidence(overrides: Partial<SourceEvidence> = {}): SourceEvidence {
  return {
    method: "fast_text_search",
    sourceKind: "search_index",
    reliability: "medium",
    sourceUrl: "https://www.google.com/finance/quote/.IXIC:INDEXNASDAQ",
    sourceDomain: "www.google.com",
    sourceTimestamp: null,
    fetchTimestamp: "2026-04-17T05:55:24.000Z",
    freshnessPolicy: "latest_approximate",
    ...overrides,
  }
}

describe("task002 verification gate", () => {
  it("rejects NASDAQ-100 values for a NASDAQ Composite target", () => {
    const target = createRetrievalTargetContract({
      kind: "finance_index",
      rawQuery: "지금 나스닥 종합지수",
      canonicalName: "NASDAQ Composite",
      symbols: ["IXIC"],
    })
    const source = sourceEvidence({ sourceUrl: "https://finance.yahoo.com/quote/%5ENDX" })
    const candidate = extractRetrievedValueCandidates({
      sourceEvidenceId: "source-nasdaq100",
      sourceEvidence: source,
      target,
      inputKind: "search_snippet",
      content: "NASDAQ-100 currently 24,102.31, updated moments ago",
    }).find((item) => item.rawValue === "24,102.31")

    const verdict = verifyRetrievedValueCandidate({ candidate, target, sourceEvidence: source, policy: "latest_approximate" })

    expect(verdict.canAnswer).toBe(false)
    expect(verdict.evidenceSufficiency).toBe("insufficient_conflict")
    expect(verdict.rejectionReason).toBe("target_conflict")
    expect(verdict.conflicts).toContain("nasdaq_100")
  })

  it("rejects KOSDAQ values for a KOSPI target", () => {
    const target = createRetrievalTargetContract({ kind: "finance_index", rawQuery: "코스피 지수", canonicalName: "KOSPI", symbols: ["KOSPI"] })
    const source = sourceEvidence({ sourceUrl: "https://www.investing.com/indices/kosdaq" })
    const candidate = extractRetrievedValueCandidates({
      sourceEvidenceId: "source-kosdaq",
      sourceEvidence: source,
      target,
      inputKind: "search_snippet",
      content: "KOSDAQ 현재 지수 1,162.97 - Investing.com",
    }).find((item) => item.rawValue === "1,162.97")

    const verdict = verifyRetrievedValueCandidate({ candidate, target, sourceEvidence: source, policy: "latest_approximate" })

    expect(verdict.canAnswer).toBe(false)
    expect(verdict.evidenceSufficiency).toBe("insufficient_conflict")
    expect(verdict.conflicts).toContain("kosdaq")
  })

  it("rejects weather values without location binding", () => {
    const target = createRetrievalTargetContract({ kind: "weather_current", rawQuery: "동천동 날씨", locationName: "동천동" })
    const source = sourceEvidence({ sourceUrl: "https://weather.example/current", sourceDomain: "weather.example" })
    const [candidate] = extractRetrievedValueCandidates({
      sourceEvidenceId: "source-weather-no-location",
      sourceEvidence: source,
      target,
      inputKind: "html_text",
      content: "현재 기온 25°C, 습도 76%",
    })

    const verdict = verifyRetrievedValueCandidate({ candidate, target, sourceEvidence: source, policy: "latest_approximate" })

    expect(verdict.canAnswer).toBe(false)
    expect(verdict.bindingStrength).toBe("weak")
    expect(verdict.rejectionReason).toBe("target_binding_weak")
  })

  it("allows latest approximate values when target binding is strong even without source timestamp", () => {
    const target = createRetrievalTargetContract({ kind: "weather_current", rawQuery: "동천동 날씨", locationName: "동천동" })
    const source = sourceEvidence({ sourceUrl: "https://weather.example/current", sourceTimestamp: null })
    const [candidate] = extractRetrievedValueCandidates({
      sourceEvidenceId: "source-weather-location",
      sourceEvidence: source,
      target,
      inputKind: "browser_text",
      content: "동천동 현재 기온 25°C, 습도 76%",
    })

    const verdict = verifyRetrievedValueCandidate({ candidate, target, sourceEvidence: source, policy: "latest_approximate" })

    expect(verdict.canAnswer).toBe(true)
    expect(verdict.bindingStrength).toBe("strong")
    expect(verdict.evidenceSufficiency).toBe("sufficient_approximate")
    expect(verdict.caveats).toContain("collection-time approximate value")
  })
})
