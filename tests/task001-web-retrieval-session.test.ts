import { describe, expect, it } from "vitest"
import {
  buildRetrievalSessionDirective,
  createGenericTargetFromPolicy,
  createRetrievalSessionController,
  createRetrievalTargetContract,
} from "../packages/core/src/runs/web-retrieval-session.js"
import { buildWebRetrievalPolicyDecision } from "../packages/core/src/runs/web-retrieval-policy.js"

function createLatestController() {
  return createRetrievalSessionController({
    runId: "run-task001-session",
    requestGroupId: "request-task001-session",
    targetContract: createRetrievalTargetContract({
      kind: "finance_index",
      rawQuery: "지금 나스닥 지수",
      canonicalName: "NASDAQ Composite",
      symbols: ["IXIC"],
      locale: "ko-KR",
    }),
    freshnessPolicy: "latest_approximate",
  })
}

describe("task001 retrieval session controller", () => {
  it("requires a target contract and freshness policy when a session is created", () => {
    const controller = createLatestController()
    const snapshot = controller.snapshot()

    expect(snapshot.targetContract.targetId).toMatch(/^target:/)
    expect(snapshot.targetContract.kind).toBe("finance_index")
    expect(snapshot.freshnessPolicy).toBe("latest_approximate")
    expect(snapshot.status).toBe("created")
  })

  it("does not allow answer-ready or limited completion without evidence attempts", () => {
    const controller = createLatestController()

    expect(() => controller.transition("answer_ready", "no evidence yet")).toThrow(/without evidence attempts/)
    expect(() => controller.transition("limited_complete", "no attempts yet")).toThrow(/without at least one attempt/)
  })

  it("web_search only should not complete latest value request", () => {
    const controller = createLatestController()
    controller.recordAttempt({
      method: "fast_text_search",
      status: "succeeded",
      toolName: "web_search",
      detail: { query: "지금 나스닥 지수" },
    })

    const readiness = controller.limitedCompletionReadiness()
    const snapshot = controller.snapshot()

    expect(snapshot.status).toBe("discovering_sources")
    expect(readiness.ok).toBe(false)
    expect(readiness.reasons).toContain("direct_fetch_or_known_adapter_required_after_search")
    expect(readiness.nextMethods).toContain("direct_fetch")
  })

  it("builds a policy directive that blocks value-not-found completion after search discovery only", () => {
    const policy = buildWebRetrievalPolicyDecision({
      toolName: "web_search",
      params: { query: "오늘 코스피 지수 얼마야?" },
      userMessage: "오늘 코스피 지수 얼마야?",
      now: new Date("2026-04-17T05:34:32.000Z"),
    })
    expect(policy).not.toBeNull()

    const directive = buildRetrievalSessionDirective({
      policy: policy!,
      targetContract: createGenericTargetFromPolicy({ policy: policy!, query: "오늘 코스피 지수 얼마야?", locale: "ko-KR" }),
    })

    expect(directive.limitedCompletion.ok).toBe(false)
    expect(directive.directive).toContain("Do not finish as value-not-found yet")
    expect(directive.nextMethods).toContain("direct_fetch")
  })

  it("browser timeout remains a failed attempt and keeps the retrieval session recoverable", () => {
    const controller = createLatestController()
    controller.recordAttempt({ method: "fast_text_search", status: "succeeded", toolName: "web_search", detail: { query: "NASDAQ Composite" } })
    controller.recordAttempt({ method: "direct_fetch", status: "failed", toolName: "web_fetch", sourceUrl: "https://www.google.com/finance/quote/.IXIC:INDEXNASDAQ", errorKind: "value_not_found" })
    controller.recordAttempt({ method: "browser_search", status: "failed", toolName: "web_fetch", sourceUrl: "https://finance.yahoo.com/quote/%5EIXIC", errorKind: "timeout", stopReason: "browser_timeout" })

    const snapshot = controller.snapshot()

    expect(snapshot.attempts.some((attempt) => attempt.method === "browser_search" && attempt.status === "failed" && attempt.errorKind === "timeout")).toBe(true)
    expect(controller.isRecoverable()).toBe(true)
    expect(controller.nextMethods()).toContain("known_source_adapter")
  })
})
