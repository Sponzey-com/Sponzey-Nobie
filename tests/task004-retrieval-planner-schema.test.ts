import { describe, expect, it } from "vitest"
import {
  buildWebRetrievalPlannerPrompt,
  validateWebRetrievalPlannerOutput,
} from "../packages/core/src/runs/web-retrieval-planner.js"
import { createRetrievalTargetContract } from "../packages/core/src/runs/web-retrieval-session.js"

const target = createRetrievalTargetContract({
  kind: "finance_index",
  rawQuery: "지금 나스닥 지수",
  canonicalName: "NASDAQ Composite",
  symbols: ["IXIC"],
  locale: "ko-KR",
})

describe("task004 retrieval planner schema", () => {
  it("builds a memoryless prompt that forbids value generation", () => {
    const prompt = buildWebRetrievalPlannerPrompt({
      originalRequest: "지금 나스닥 지수 알려줘",
      targetContract: target,
      attemptedSources: [{ method: "fast_text_search", status: "succeeded", query: "NASDAQ Composite current" }],
      failureSummary: "search snippets did not expose a bound value",
      allowedMethods: ["direct_fetch", "browser_search"],
      freshnessPolicy: "latest_approximate",
      now: new Date("2026-04-17T06:00:00.000Z"),
    })

    expect(prompt).toContain("memoryless Web Retrieval Recovery Planner")
    expect(prompt).toContain("Do not generate current values")
    expect(prompt).toContain("Do not change the target contract")
    expect(prompt).toContain("NASDAQ Composite")
    expect(prompt).not.toContain("longTermMemory")
    expect(prompt).not.toContain("conversationHistory")
    expect(prompt).not.toContain("unrelatedRunResults")
  })

  it("accepts a valid action-only planner response", () => {
    const result = validateWebRetrievalPlannerOutput({
      rawOutput: JSON.stringify({
        nextActions: [{
          method: "direct_fetch",
          url: "https://www.google.com/finance/quote/.IXIC:INDEXNASDAQ",
          expectedTargetBinding: "NASDAQ Composite IXIC quote card",
          reason: "Google Finance quote page may expose the requested target quote card after direct fetch.",
          risk: "low",
        }],
      }),
      targetContract: target,
      freshnessPolicy: "latest_approximate",
      allowedMethods: ["direct_fetch", "browser_search"],
    })

    expect(result.accepted).toBe(true)
    expect(result.acceptedActions).toHaveLength(1)
    expect(result.acceptedActions[0]?.method).toBe("direct_fetch")
  })

  it("rejects values or unknown fields in planner output", () => {
    const result = validateWebRetrievalPlannerOutput({
      rawOutput: {
        nextActions: [{
          method: "direct_fetch",
          url: "https://www.google.com/finance/quote/.IXIC:INDEXNASDAQ",
          expectedTargetBinding: "NASDAQ Composite IXIC quote card",
          reason: "Use the quote card.",
          risk: "low",
          value: "24,102.31",
        }],
      },
      targetContract: target,
      freshnessPolicy: "latest_approximate",
      allowedMethods: ["direct_fetch"],
    })

    expect(result.accepted).toBe(false)
    expect(result.rejectedActions[0]?.reason).toBe("planner_action_unknown_field:value")
  })

  it("rejects markdown-wrapped JSON", () => {
    const result = validateWebRetrievalPlannerOutput({
      rawOutput: "```json\n{\"nextActions\":[]}\n```",
      targetContract: target,
      freshnessPolicy: "latest_approximate",
      allowedMethods: ["direct_fetch"],
    })

    expect(result.accepted).toBe(false)
    expect(result.errors).toContain("planner_output_must_not_use_markdown_code_fence")
  })
})
