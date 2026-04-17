import type { SearchResult } from "./brave.js";
export type { SearchResult };
interface SearchEvidenceContext {
    runId?: string | null;
    requestGroupId?: string | null;
    directFetchSearch?: ((searchUrl: string, maxResults: number) => Promise<SearchResult[]>) | undefined;
    seleniumSearch?: ((query: string, maxResults: number) => Promise<SearchResult[]>) | undefined;
}
export declare class DuckDuckGoSearchProvider {
    private readonly evidenceContext;
    constructor(evidenceContext?: SearchEvidenceContext);
    search(query: string, options: {
        maxResults?: number | undefined;
    }): Promise<SearchResult[]>;
}
//# sourceMappingURL=duckduckgo.d.ts.map