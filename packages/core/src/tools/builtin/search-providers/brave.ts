export interface SearchResult {
  title: string
  url: string
  snippet: string
  publishedDate?: string | undefined
}

interface BraveWebResult {
  title?: string
  url?: string
  description?: string
  age?: string
}

interface BraveApiResponse {
  web?: {
    results?: BraveWebResult[]
  }
}

export class BraveSearchProvider {
  constructor(private apiKey: string) {}

  async search(
    query: string,
    options: { maxResults?: number | undefined; dateRange?: string | undefined },
  ): Promise<SearchResult[]> {
    const count = Math.min(options.maxResults ?? 10, 20)
    const params = new URLSearchParams({ q: query, count: String(count) })
    if (options.dateRange) {
      params.set("freshness", options.dateRange)
    }

    const url = `https://api.search.brave.com/res/v1/web/search?${params.toString()}`
    const resp = await fetch(url, {
      headers: {
        "Accept": "application/json",
        "X-Subscription-Token": this.apiKey,
      },
    })

    if (!resp.ok) {
      throw new Error(`Brave Search API error: ${resp.status} ${resp.statusText}`)
    }

    const data = (await resp.json()) as BraveApiResponse
    const webResults = data.web?.results ?? []

    return webResults.map((r): SearchResult => ({
      title: r.title ?? "",
      url: r.url ?? "",
      snippet: r.description ?? "",
      publishedDate: r.age ?? undefined,
    }))
  }
}
