import * as cheerio from "cheerio"
import type { SearchResult } from "./brave.js"

export type { SearchResult }

const LITE_URL = "https://lite.duckduckgo.com/lite/"
const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"

export class DuckDuckGoSearchProvider {
  async search(
    query: string,
    options: { maxResults?: number | undefined },
  ): Promise<SearchResult[]> {
    const maxResults = options.maxResults ?? 10

    // Try fast fetch first (works most of the time with DuckDuckGo Lite)
    try {
      const html = await fetchHtml(query)
      const results = parseWithCheerio(html, maxResults)
      if (results.length > 0) return results
    } catch {
      // fall through to Playwright
    }

    // Fallback: Playwright headless browser (handles bot challenges / JS-rendered pages)
    return searchWithPlaywright(query, maxResults)
  }
}

async function fetchHtml(query: string): Promise<string> {
  const encodedQuery = encodeURIComponent(query)
  const resp = await fetch(`${LITE_URL}?q=${encodedQuery}&kl=wt-wt`, {
    headers: { "Accept": "text/html,application/xhtml+xml", "User-Agent": USER_AGENT },
    redirect: "follow",
  })
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
  return resp.text()
}

function parseWithCheerio(html: string, maxResults: number): SearchResult[] {
  const $ = cheerio.load(html)
  const results: SearchResult[] = []

  // DuckDuckGo Lite result structure:
  //   <a class="result-link" href="//duckduckgo.com/l/?uddg=ENCODED_URL&...">Title</a>
  //   <td class="result-snippet">Snippet text</td>
  const snippets: string[] = []
  $("td.result-snippet").each((_, el) => {
    snippets.push($(el).text().replace(/\s+/g, " ").trim())
  })

  let idx = 0
  $("a.result-link").each((_, el) => {
    if (results.length >= maxResults) return false
    const title = $(el).text().trim()
    const rawHref = $(el).attr("href") ?? ""
    const url = decodeUddg(rawHref)
    if (!title || !url) return
    results.push({ title, url, snippet: snippets[idx] ?? title })
    idx++
  })

  return results
}

function decodeUddg(href: string): string {
  try {
    const m = href.match(/[?&]uddg=([^&]+)/)
    if (m?.[1]) return decodeURIComponent(m[1])
    if (href.startsWith("http")) return href
  } catch { /* ignore */ }
  return ""
}

async function searchWithPlaywright(query: string, maxResults: number): Promise<SearchResult[]> {
  const { chromium } = await import("playwright")
  const browser = await chromium.launch({ headless: true })
  try {
    const page = await browser.newPage()
    await page.setExtraHTTPHeaders({ "User-Agent": USER_AGENT })
    await page.goto(`${LITE_URL}?q=${encodeURIComponent(query)}&kl=wt-wt`, {
      waitUntil: "domcontentloaded",
      timeout: 15_000,
    })
    const html = await page.content()
    return parseWithCheerio(html, maxResults)
  } finally {
    await browser.close()
  }
}
