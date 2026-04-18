import { describe, expect, it } from "vitest"
import { validateWebRetrievalPlannerOutput } from "../packages/core/src/runs/web-retrieval-planner.js"
import { buildRetrievalDedupeKey, createRetrievalTargetContract } from "../packages/core/src/runs/web-retrieval-session.js"

const nasdaqComposite = createRetrievalTargetContract({
  kind: "finance_index",
  rawQuery: "지금 나스닥 지수",
  canonicalName: "NASDAQ Composite",
  symbols: ["IXIC"],
  locale: "ko-KR",
})

describe("task004 retrieval planner policy", () => {
  it("rejects target mutation from NASDAQ Composite to NASDAQ-100", () => {
    const result = validateWebRetrievalPlannerOutput({
      rawOutput: {
        nextActions: [{
          method: "direct_fetch",
          url: "https://finance.yahoo.com/quote/%5ENDX",
          expectedTargetBinding: "NASDAQ-100 NDX quote card",
          reason: "Fetch the NASDAQ-100 quote card.",
          risk: "low",
        }],
      },
      targetContract: nasdaqComposite,
      freshnessPolicy: "latest_approximate",
      allowedMethods: ["direct_fetch"],
    })

    expect(result.accepted).toBe(false)
    expect(result.rejectedActions[0]?.reason).toBe("target_binding_mismatch")
  })

  it("rejects forbidden domains and blocked URL schemes", () => {
    const blockedDomain = validateWebRetrievalPlannerOutput({
      rawOutput: {
        nextActions: [{
          method: "browser_search",
          url: "https://blocked.example/quote/IXIC",
          expectedTargetBinding: "NASDAQ Composite IXIC quote card",
          reason: "Browser-render this quote page.",
          risk: "medium",
        }],
      },
      targetContract: nasdaqComposite,
      freshnessPolicy: "latest_approximate",
      allowedMethods: ["browser_search"],
      domainPolicy: { blockedDomains: ["blocked.example"] },
    })
    const blockedScheme = validateWebRetrievalPlannerOutput({
      rawOutput: {
        nextActions: [{
          method: "direct_fetch",
          url: "file:///etc/passwd",
          expectedTargetBinding: "NASDAQ Composite IXIC quote card",
          reason: "Fetch local file.",
          risk: "high",
        }],
      },
      targetContract: nasdaqComposite,
      freshnessPolicy: "latest_approximate",
      allowedMethods: ["direct_fetch"],
    })

    expect(blockedDomain.accepted).toBe(false)
    expect(blockedDomain.rejectedActions[0]?.reason).toBe("blocked_domain")
    expect(blockedScheme.accepted).toBe(false)
    expect(blockedScheme.rejectedActions[0]?.reason).toBe("planner_url_scheme_blocked")
  })

  it("rejects methods not allowed by current tool policy", () => {
    const result = validateWebRetrievalPlannerOutput({
      rawOutput: {
        nextActions: [{
          method: "browser_search",
          url: "https://www.google.com/finance/quote/.IXIC:INDEXNASDAQ",
          expectedTargetBinding: "NASDAQ Composite IXIC quote card",
          reason: "Browser-render the finance quote card.",
          risk: "low",
        }],
      },
      targetContract: nasdaqComposite,
      freshnessPolicy: "latest_approximate",
      allowedMethods: ["direct_fetch"],
    })

    expect(result.accepted).toBe(false)
    expect(result.rejectedActions[0]?.reason).toBe("planner_method_not_allowed_by_policy")
  })

  it("rejects duplicate source suggestions", () => {
    const attemptedDedupeKey = buildRetrievalDedupeKey({
      method: "direct_fetch",
      freshnessPolicy: "latest_approximate",
      sourceUrl: "https://www.google.com/finance/quote/.IXIC:INDEXNASDAQ",
    })
    const result = validateWebRetrievalPlannerOutput({
      rawOutput: {
        nextActions: [{
          method: "direct_fetch",
          url: "https://www.google.com/finance/quote/.IXIC:INDEXNASDAQ#top",
          expectedTargetBinding: "NASDAQ Composite IXIC quote card",
          reason: "Try the same quote URL again.",
          risk: "low",
        }],
      },
      targetContract: nasdaqComposite,
      freshnessPolicy: "latest_approximate",
      allowedMethods: ["direct_fetch"],
      attemptedDedupeKeys: [attemptedDedupeKey],
    })

    expect(result.accepted).toBe(false)
    expect(result.rejectedActions[0]?.reason).toBe("duplicate_planner_action")
  })

  it("rejects selector or other unsupported action fields", () => {
    const result = validateWebRetrievalPlannerOutput({
      rawOutput: {
        nextActions: [{
          method: "browser_search",
          url: "https://www.google.com/finance/quote/.IXIC:INDEXNASDAQ",
          selector: ".YMlKec",
          expectedTargetBinding: "NASDAQ Composite IXIC quote card",
          reason: "Use a CSS selector.",
          risk: "low",
        }],
      },
      targetContract: nasdaqComposite,
      freshnessPolicy: "latest_approximate",
      allowedMethods: ["browser_search"],
    })

    expect(result.accepted).toBe(false)
    expect(result.rejectedActions[0]?.reason).toBe("planner_action_unknown_field:selector")
  })
})
