import { describe, expect, it } from "vitest"
import { runWebRetrievalPlanner } from "../packages/core/src/runs/web-retrieval-planner.js"
import { createRetrievalTargetContract } from "../packages/core/src/runs/web-retrieval-session.js"

const target = createRetrievalTargetContract({
  kind: "finance_index",
  rawQuery: "지금 코스피 지수",
  canonicalName: "KOSPI",
  symbols: ["KOSPI"],
  locale: "ko-KR",
})

const baseInput = {
  originalRequest: "지금 코스피 지수 얼마야?",
  targetContract: target,
  attemptedSources: [{ method: "fast_text_search" as const, status: "succeeded", query: "KOSPI current" }],
  failureSummary: "search result did not expose a bound current value",
  allowedMethods: ["direct_fetch", "browser_search"] as const,
  freshnessPolicy: "latest_approximate" as const,
}

describe("task004 retrieval planner degraded mode", () => {
  it("degrades without crashing when provider is unavailable", async () => {
    const result = await runWebRetrievalPlanner(baseInput)

    expect(result.status).toBe("degraded")
    expect(result.degradedReason).toBe("provider_unavailable")
    expect(result.actions).toEqual([])
    expect(result.userMessage).toContain("deterministic")
  })

  it("degrades when planner call budget is exhausted", async () => {
    const result = await runWebRetrievalPlanner({
      ...baseInput,
      plannerCallsUsed: 2,
      maxPlannerCalls: 2,
      callPlanner: async () => "{}",
    })

    expect(result.status).toBe("degraded")
    expect(result.degradedReason).toBe("budget_exhausted")
    expect(result.stopReason).toBe("budget_exhausted")
  })

  it("degrades on timeout within the retrieval hard budget", async () => {
    const result = await runWebRetrievalPlanner({
      ...baseInput,
      timeoutMs: 5,
      remainingHardBudgetMs: 5,
      callPlanner: () => new Promise((resolve) => setTimeout(() => resolve("{}"), 50)),
    })

    expect(result.status).toBe("degraded")
    expect(result.degradedReason).toBe("planner_timeout")
  })

  it("returns planned actions only after schema and policy validation", async () => {
    const result = await runWebRetrievalPlanner({
      ...baseInput,
      callPlanner: async () => JSON.stringify({
        nextActions: [{
          method: "direct_fetch",
          url: "https://www.google.com/finance/quote/KOSPI:KRX",
          expectedTargetBinding: "KOSPI quote card",
          reason: "Google Finance quote page can bind the KOSPI target to a quote card.",
          risk: "low",
        }],
      }),
    })

    expect(result.status).toBe("planned")
    expect(result.actions).toHaveLength(1)
    expect(result.actions[0]?.url).toBe("https://www.google.com/finance/quote/KOSPI:KRX")
  })

  it("rejects invalid provider responses without restarting the retrieval session", async () => {
    const result = await runWebRetrievalPlanner({
      ...baseInput,
      callPlanner: async () => JSON.stringify({ answer: "KOSPI is 3,000" }),
    })

    expect(result.status).toBe("rejected")
    expect(result.degradedReason).toBe("invalid_response")
    expect(result.actions).toEqual([])
    expect(result.validation?.errors).toContain("planner_output_unknown_field:answer")
  })
})
