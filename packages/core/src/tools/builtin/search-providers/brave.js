export class BraveSearchProvider {
    apiKey;
    constructor(apiKey) {
        this.apiKey = apiKey;
    }
    async search(query, options) {
        const count = Math.min(options.maxResults ?? 10, 20);
        const params = new URLSearchParams({ q: query, count: String(count) });
        if (options.dateRange) {
            params.set("freshness", options.dateRange);
        }
        const url = `https://api.search.brave.com/res/v1/web/search?${params.toString()}`;
        const resp = await fetch(url, {
            headers: {
                "Accept": "application/json",
                "X-Subscription-Token": this.apiKey,
            },
        });
        if (!resp.ok) {
            throw new Error(`Brave Search API error: ${resp.status} ${resp.statusText}`);
        }
        const data = (await resp.json());
        const webResults = data.web?.results ?? [];
        return webResults.map((r) => ({
            title: r.title ?? "",
            url: r.url ?? "",
            snippet: r.description ?? "",
            publishedDate: r.age ?? undefined,
        }));
    }
}
//# sourceMappingURL=brave.js.map