import type { AgentTool } from "../types.js";
interface WebSearchParams {
    query: string;
    maxResults?: number | undefined;
    dateRange?: "day" | "week" | "month" | "year" | undefined;
}
export declare const webSearchTool: AgentTool<WebSearchParams>;
export {};
//# sourceMappingURL=web-search.d.ts.map