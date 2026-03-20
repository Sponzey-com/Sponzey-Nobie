import { getConfig } from "../../config/index.js";
import { BraveSearchProvider } from "./search-providers/brave.js";
import { DuckDuckGoSearchProvider } from "./search-providers/duckduckgo.js";
function dateRangeToBraveFreshness(dateRange) {
    switch (dateRange) {
        case "day": return "pd";
        case "week": return "pw";
        case "month": return "pm";
        case "year": return "py";
    }
}
function formatResults(results) {
    if (results.length === 0) {
        return "(검색 결과 없음)";
    }
    return results
        .map((r, i) => {
        const lines = [
            `${i + 1}. **${r.title}**`,
            `   URL: ${r.url}`,
            `   요약: ${r.snippet}`,
        ];
        if (r.publishedDate) {
            lines.push(`   날짜: ${r.publishedDate}`);
        }
        return lines.join("\n");
    })
        .join("\n\n");
}
export const webSearchTool = {
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
    async execute(params, _ctx) {
        const config = getConfig();
        // 설정 없으면 DuckDuckGo로 폴백
        const searchCfg = config.search.web ?? { provider: "duckduckgo", maxResults: 5 };
        const maxResults = params.maxResults ?? searchCfg.maxResults ?? 5;
        let results;
        try {
            if (searchCfg.provider === "brave") {
                if (!searchCfg.apiKey) {
                    return {
                        success: false,
                        output: "Brave Search API 키가 설정되지 않았습니다. config.json5의 search.web.apiKey를 설정하세요.",
                    };
                }
                const provider = new BraveSearchProvider(searchCfg.apiKey);
                const freshness = params.dateRange ? dateRangeToBraveFreshness(params.dateRange) : undefined;
                results = await provider.search(params.query, { maxResults, dateRange: freshness });
            }
            else if (searchCfg.provider === "duckduckgo") {
                const provider = new DuckDuckGoSearchProvider();
                results = await provider.search(params.query, { maxResults });
            }
            else {
                return {
                    success: false,
                    output: `지원되지 않는 검색 공급자: "${searchCfg.provider}". 지원: brave, duckduckgo`,
                };
            }
        }
        catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            return { success: false, output: `검색 오류: ${msg}`, error: msg };
        }
        return {
            success: true,
            output: formatResults(results),
            details: { query: params.query, provider: searchCfg.provider, count: results.length },
        };
    },
};
//# sourceMappingURL=web-search.js.map