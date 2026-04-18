import { describe, expect, it } from "vitest"
import {
  buildFinanceKnownSources,
  parseFinanceQuoteCandidates,
  resolveFinanceIndexTarget,
} from "../packages/core/src/runs/web-source-adapters/finance.js"
import { verifyRetrievedValueCandidate } from "../packages/core/src/runs/web-retrieval-verification.js"

describe("task005 finance source adapter", () => {
  it("canonicalizes KOSPI and KOSDAQ without swapping targets", () => {
    const kospi = resolveFinanceIndexTarget("지금 코스피 지수 얼마야?")
    const kosdaq = resolveFinanceIndexTarget("지금 코스닥 지수 알려줘")

    expect(kospi?.key).toBe("kospi")
    expect(kospi?.targetContract.canonicalName).toBe("KOSPI")
    expect(kospi?.targetContract.market).toBe("KRX")
    expect(kosdaq?.key).toBe("kosdaq")
    expect(kosdaq?.targetContract.canonicalName).toBe("KOSDAQ")
    expect(kosdaq?.targetContract.market).toBe("KOSDAQ")
  })

  it("defaults generic NASDAQ to Composite while keeping NASDAQ-100 separate", () => {
    const generic = resolveFinanceIndexTarget("지금 나스닥 지수는 얼마야?")
    const ndx = resolveFinanceIndexTarget("오늘 나스닥 100 지수")

    expect(generic?.key).toBe("nasdaq_composite")
    expect(generic?.targetContract.symbols).toEqual([".IXIC", "^IXIC", "IXIC"].sort())
    expect(generic?.caveats).toContain("generic_nasdaq_defaults_to_nasdaq_composite")
    expect(ndx?.key).toBe("nasdaq_100")
    expect(ndx?.targetContract.symbols).toContain("NDX")
  })

  it("builds known source URLs for finance indexes", () => {
    const sources = buildFinanceKnownSources("nasdaq_composite")

    expect(sources.map((source) => source.sourceDomain)).toContain("www.google.com")
    expect(sources.map((source) => source.sourceDomain)).toContain("finance.yahoo.com")
    expect(sources.every((source) => source.expectedTargetBinding.includes("NASDAQ Composite"))).toBe(true)
  })

  it("parses quote-card values with target binding signals", () => {
    const parsed = parseFinanceQuoteCandidates({
      targetKey: "kospi",
      content: "KOSPI quote card 현재 3,125.42 포인트 상승",
      sourceUrl: "https://www.google.com/finance/quote/KOSPI:KRX",
      fetchTimestamp: "2026-04-17T06:00:00.000Z",
    })
    const candidate = parsed.candidates.find((item) => item.normalizedValue === "3125.42")
    const verdict = verifyRetrievedValueCandidate({
      candidate,
      target: parsed.targetContract,
      sourceEvidence: parsed.sourceEvidence,
      policy: "latest_approximate",
    })

    expect(candidate).toBeTruthy()
    expect(candidate?.bindingSignals.some((signal) => signal.kind === "canonical_name" || signal.kind === "quote_card")).toBe(true)
    expect(parsed.sourceEvidence.adapterId).toBe("finance-index-known-source")
    expect(parsed.sourceEvidence.parserVersion).toBe("finance-parser-1")
    expect(verdict.canAnswer).toBe(true)
  })

  it("keeps NASDAQ Composite parser evidence separate from NASDAQ-100", () => {
    const composite = parseFinanceQuoteCandidates({
      targetKey: "nasdaq_composite",
      content: "NASDAQ Composite IXIC 18,250.33 points",
      sourceUrl: "https://www.google.com/finance/quote/.IXIC:INDEXNASDAQ",
    })
    const ndx = parseFinanceQuoteCandidates({
      targetKey: "nasdaq_100",
      content: "NASDAQ-100 NDX 24,102.31 points",
      sourceUrl: "https://www.google.com/finance/quote/NDX:INDEXNASDAQ",
    })

    expect(composite.targetDefinition.key).toBe("nasdaq_composite")
    expect(composite.targetContract.symbols).toContain("IXIC")
    expect(ndx.targetDefinition.key).toBe("nasdaq_100")
    expect(ndx.targetContract.symbols).toContain("NDX")
  })
})
