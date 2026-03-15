import type { SearchResult } from "./brave.js"

export type { SearchResult }

interface DDGInstantAnswer {
  RelatedTopics?: Array<{
    Text?: string
    FirstURL?: string
    Result?: string
    Name?: string
  }>
  AbstractText?: string
  AbstractURL?: string
  AbstractTitle?: string
  Answer?: string
  AnswerType?: string
}

export class DuckDuckGoSearchProvider {
  async search(
    query: string,
    options: { maxResults?: number | undefined },
  ): Promise<SearchResult[]> {
    const maxResults = options.maxResults ?? 10
    const encodedQuery = encodeURIComponent(query)
    const url = `https://api.duckduckgo.com/?q=${encodedQuery}&format=json&no_html=1&skip_disambig=1`

    let data: DDGInstantAnswer
    try {
      const resp = await fetch(url, {
        headers: { "Accept": "application/json" },
      })
      if (!resp.ok) {
        throw new Error(`DuckDuckGo API error: ${resp.status} ${resp.statusText}`)
      }
      data = (await resp.json()) as DDGInstantAnswer
    } catch (err) {
      throw new Error(`DuckDuckGo fetch failed: ${err instanceof Error ? err.message : String(err)}`)
    }

    const results: SearchResult[] = []

    // Add abstract answer if present
    if (data.AbstractText && data.AbstractURL) {
      results.push({
        title: data.AbstractTitle ?? "DuckDuckGo Answer",
        url: data.AbstractURL,
        snippet: data.AbstractText,
      })
    }

    // Add instant answer if present
    if (data.Answer && results.length < maxResults) {
      results.push({
        title: `Answer (${data.AnswerType ?? "instant"})`,
        url: `https://duckduckgo.com/?q=${encodedQuery}`,
        snippet: data.Answer,
      })
    }

    // Add related topics
    if (data.RelatedTopics) {
      for (const topic of data.RelatedTopics) {
        if (results.length >= maxResults) break
        if (topic.Text && topic.FirstURL) {
          results.push({
            title: topic.Name ?? topic.Text.slice(0, 60),
            url: topic.FirstURL,
            snippet: topic.Text,
          })
        }
      }
    }

    return results
  }
}
