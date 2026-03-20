import type { SearchResult } from "./brave.js";
export type { SearchResult };
export declare class DuckDuckGoSearchProvider {
    search(query: string, options: {
        maxResults?: number | undefined;
    }): Promise<SearchResult[]>;
}
//# sourceMappingURL=duckduckgo.d.ts.map