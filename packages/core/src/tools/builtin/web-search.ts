import { getConfig } from "../../config/index.js"
import {
  buildWebRetrievalPolicyDecision,
  evaluateSourceReliabilityGuard,
  type SourceEvidence,
} from "../../runs/web-retrieval-policy.js"
import { sanitizeUserFacingError } from "../../runs/error-sanitizer.js"
import { BraveSearchProvider } from "./search-providers/brave.js"
import { DuckDuckGoSearchProvider } from "./search-providers/duckduckgo.js"
import type { SearchResult } from "./search-providers/brave.js"
import type { AgentTool, ToolContext, ToolResult } from "../types.js"

interface WebSearchParams {
  query: string
  maxResults?: number | undefined
  dateRange?: "day" | "week" | "month" | "year" | undefined
}

function dateRangeToBraveFreshness(dateRange: "day" | "week" | "month" | "year"): string {
  switch (dateRange) {
    case "day": return "pd"
    case "week": return "pw"
    case "month": return "pm"
    case "year": return "py"
  }
}

function formatResults(results: SearchResult[]): string {
  if (results.length === 0) {
    return "(검색 결과 없음)"
  }
  return results
    .map((r, i) => {
      const lines = [
        `${i + 1}. **${r.title}**`,
        `   URL: ${r.url}`,
        `   요약: ${r.snippet}`,
      ]
      if (r.publishedDate) {
        lines.push(`   날짜: ${r.publishedDate}`)
      }
      return lines.join("\n")
    })
    .join("\n\n")
}

function domainFromUrl(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase()
  } catch {
    return null
  }
}

function buildPolicyFooter(policy: ReturnType<typeof buildWebRetrievalPolicyDecision>, guard: ReturnType<typeof evaluateSourceReliabilityGuard> | null): string {
  if (!policy) return ""
  const lines = [
    `[검색 수집: ${policy.fetchTimestamp}]`,
    `[검색 방식: ${policy.method}]`,
    `[최신성 정책: ${policy.freshnessPolicy}]`,
    `[출처 성격: ${policy.sourceKind}/${policy.reliability}]`,
    `[응답 지침: ${policy.answerDirective}]`,
  ]
  if (guard && guard.status !== "ready") {
    lines.push(`[확정성: ${guard.status} - ${guard.userMessage}]`)
  }
  if (policy.freshnessPolicy === "latest_approximate") {
    lines.push("[후속 조치: web_search 결과에 요청 값이 직접 보이지 않으면, 값 미추출로 답하기 전에 결과 URL 또는 직접 시세 URL을 web_fetch로 최소 1회 확인하세요. 같은 검색어 반복과 file_search 우회는 금지합니다.]")
  }
  return `\n\n${lines.join("\n")}`
}

export const webSearchTool: AgentTool<WebSearchParams> = {
  name: "web_search",
  description: "인터넷에서 정보를 검색합니다.",
  parameters: {
    type: "object",
    properties: {
      query: { type: "string", description: "검색 쿼리" },
      maxResults: { type: "number", description: "최대 결과 수. 기본: 공급자 설정값" },
      dateRange: {
        type: "string",
        enum: ["day", "week", "month", "year"],
        description: "날짜 범위 필터 (brave만 지원)",
      },
    },
    required: ["query"],
  },
  riskLevel: "safe",
  requiresApproval: false,

  async execute(params: WebSearchParams, ctx: ToolContext): Promise<ToolResult> {
    const config = getConfig()
    // 설정 없으면 DuckDuckGo로 폴백
    const searchCfg = config.search.web ?? { provider: "duckduckgo" as const, maxResults: 5 }
    const webRetrievalPolicy = buildWebRetrievalPolicyDecision({
      toolName: "web_search",
      params: params as unknown as Record<string, unknown>,
      userMessage: ctx.userMessage,
    })

    const maxResults = params.maxResults ?? searchCfg.maxResults ?? 5
    let results: SearchResult[]

    try {
      if (searchCfg.provider === "brave") {
        if (!searchCfg.apiKey) {
          return {
            success: false,
            output: "Brave Search API 키가 설정되지 않았습니다. config.json5의 search.web.apiKey를 설정하세요.",
          }
        }
        const provider = new BraveSearchProvider(searchCfg.apiKey)
        const freshness = params.dateRange ? dateRangeToBraveFreshness(params.dateRange) : undefined
        results = await provider.search(params.query, { maxResults, dateRange: freshness })
      } else if (searchCfg.provider === "duckduckgo") {
        const provider = new DuckDuckGoSearchProvider({
          runId: ctx.runId,
          ...(ctx.requestGroupId ? { requestGroupId: ctx.requestGroupId } : {}),
        })
        results = await provider.search(params.query, { maxResults })
      } else {
        return {
          success: false,
          output: `지원되지 않는 검색 공급자: "${searchCfg.provider}". 지원: brave, duckduckgo`,
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      const sanitized = sanitizeUserFacingError(msg)
      return { success: false, output: `검색 오류: ${sanitized.userMessage}`, error: sanitized.userMessage, details: { errorKind: sanitized.kind } }
    }

    const sourceEvidence: SourceEvidence[] = results.map((result) => ({
      method: webRetrievalPolicy?.method ?? "fast_text_search",
      sourceKind: webRetrievalPolicy?.sourceKind ?? "search_index",
      reliability: webRetrievalPolicy?.reliability ?? "medium",
      sourceUrl: result.url,
      sourceDomain: domainFromUrl(result.url),
      sourceTimestamp: result.publishedDate ?? null,
      fetchTimestamp: webRetrievalPolicy?.fetchTimestamp ?? new Date().toISOString(),
      freshnessPolicy: webRetrievalPolicy?.freshnessPolicy ?? "normal",
    }))
    const sourceGuard = evaluateSourceReliabilityGuard(sourceEvidence[0] ?? {
      method: webRetrievalPolicy?.method ?? "fast_text_search",
      sourceKind: webRetrievalPolicy?.sourceKind ?? "search_index",
      reliability: results.length > 0 ? (webRetrievalPolicy?.reliability ?? "medium") : "unknown",
      sourceUrl: null,
      sourceDomain: null,
      sourceTimestamp: null,
      fetchTimestamp: webRetrievalPolicy?.fetchTimestamp ?? new Date().toISOString(),
      freshnessPolicy: webRetrievalPolicy?.freshnessPolicy ?? "normal",
    })

    return {
      success: true,
      output: `${formatResults(results)}${buildPolicyFooter(webRetrievalPolicy, sourceGuard)}`,
      details: {
        query: params.query,
        provider: searchCfg.provider,
        count: results.length,
        sourceEvidence,
        sourceGuard,
        ...(webRetrievalPolicy ? { webRetrievalPolicy } : {}),
      },
    }
  },
}
