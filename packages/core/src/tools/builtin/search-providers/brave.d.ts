export interface SearchResult {
    title: string;
    url: string;
    snippet: string;
    publishedDate?: string | undefined;
}
export declare class BraveSearchProvider {
    private apiKey;
    constructor(apiKey: string);
    search(query: string, options: {
        maxResults?: number | undefined;
        dateRange?: string | undefined;
    }): Promise<SearchResult[]>;
}
//# sourceMappingURL=brave.d.ts.map