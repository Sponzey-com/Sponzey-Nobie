import { describe, expect, it } from "vitest"
import {
  buildRetrievalDedupeKey,
  createRetrievalSessionController,
  createRetrievalTargetContract,
} from "../packages/core/src/runs/web-retrieval-session.js"

function createController() {
  return createRetrievalSessionController({
    runId: "run-task001-dedupe",
    requestGroupId: "request-task001-dedupe",
    targetContract: createRetrievalTargetContract({ kind: "general_latest", rawQuery: "현재 지수", locale: "ko-KR" }),
    freshnessPolicy: "latest_approximate",
  })
}

describe("task001 retrieval session dedupe", () => {
  it("dedupes equivalent same source fetch attempts by canonical URL", () => {
    const controller = createController()
    const firstUrl = "https://EXAMPLE.com/quote?b=2&utm_source=telegram&a=1#top"
    const secondUrl = "https://example.com/quote?a=1&b=2&utm_medium=slack"

    const firstKey = buildRetrievalDedupeKey({ method: "direct_fetch", freshnessPolicy: "latest_approximate", sourceUrl: firstUrl })
    const secondKey = buildRetrievalDedupeKey({ method: "direct_fetch", freshnessPolicy: "latest_approximate", sourceUrl: secondUrl })
    const first = controller.recordAttempt({ method: "direct_fetch", status: "succeeded", sourceUrl: firstUrl })
    const duplicate = controller.recordAttempt({ method: "direct_fetch", status: "succeeded", sourceUrl: secondUrl })
    const attempts = controller.snapshot().attempts

    expect(firstKey).toBe(secondKey)
    expect(first.status).toBe("succeeded")
    expect(duplicate.status).toBe("skipped")
    expect(duplicate.stopReason).toBe("dedupe_suppressed")
    expect(attempts.filter((attempt) => attempt.status !== "skipped")).toHaveLength(1)
  })

  it("dedupes repeated search queries without using semantic comparison", () => {
    const controller = createController()
    const firstKey = buildRetrievalDedupeKey({ method: "fast_text_search", freshnessPolicy: "latest_approximate", query: "NASDAQ   지수" })
    const secondKey = buildRetrievalDedupeKey({ method: "fast_text_search", freshnessPolicy: "latest_approximate", query: " nasdaq 지수 " })

    const first = controller.recordAttempt({ method: "fast_text_search", status: "succeeded", toolName: "web_search", dedupeKey: firstKey })
    const duplicate = controller.recordAttempt({ method: "fast_text_search", status: "succeeded", toolName: "web_search", dedupeKey: secondKey })

    expect(firstKey).toBe(secondKey)
    expect(first.status).toBe("succeeded")
    expect(duplicate.status).toBe("skipped")
  })

  it("allows concrete query variants because target sameness is not inferred semantically", () => {
    const controller = createController()
    const firstKey = buildRetrievalDedupeKey({ method: "fast_text_search", freshnessPolicy: "latest_approximate", query: "나스닥 지수" })
    const variantKey = buildRetrievalDedupeKey({ method: "fast_text_search", freshnessPolicy: "latest_approximate", query: "나스닥 종합지수" })

    const first = controller.recordAttempt({ method: "fast_text_search", status: "succeeded", toolName: "web_search", dedupeKey: firstKey })
    const variant = controller.recordAttempt({ method: "fast_text_search", status: "succeeded", toolName: "web_search", dedupeKey: variantKey })

    expect(firstKey).not.toBe(variantKey)
    expect(first.status).toBe("succeeded")
    expect(variant.status).toBe("succeeded")
    expect(controller.snapshot().attempts.filter((attempt) => attempt.status !== "skipped")).toHaveLength(2)
  })
})
