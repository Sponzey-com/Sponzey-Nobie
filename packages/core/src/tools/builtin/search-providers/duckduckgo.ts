import * as cheerio from "cheerio"
import { Browser, Builder, By, until } from "selenium-webdriver"
import chrome from "selenium-webdriver/chrome.js"
import edge from "selenium-webdriver/edge.js"
import firefox from "selenium-webdriver/firefox.js"
import { recordBrowserSearchEvidence } from "../../../runs/web-retrieval-policy.js"
import { sanitizeUserFacingError } from "../../../runs/error-sanitizer.js"
import type { SearchResult } from "./brave.js"

export type { SearchResult }

const LITE_URL = "https://lite.duckduckgo.com/lite/"
const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
const PAGE_LOAD_TIMEOUT_MS = 30_000
const RESULT_WAIT_TIMEOUT_MS = 10_000

type SupportedBrowser = "chrome" | "MicrosoftEdge" | "firefox"

interface BrowserSpec {
  browser: SupportedBrowser
  label: string
}

interface SearchEvidenceContext {
  runId?: string | null
  requestGroupId?: string | null
  directFetchSearch?: ((searchUrl: string, maxResults: number) => Promise<SearchResult[]>) | undefined
  seleniumSearch?: ((query: string, maxResults: number) => Promise<SearchResult[]>) | undefined
}

export class DuckDuckGoSearchProvider {
  constructor(private readonly evidenceContext: SearchEvidenceContext = {}) {}

  async search(
    query: string,
    options: { maxResults?: number | undefined },
  ): Promise<SearchResult[]> {
    const maxResults = options.maxResults ?? 10
    const searchUrl = buildSearchUrl(query)
    const directFetchSearch = this.evidenceContext.directFetchSearch ?? searchWithDirectFetch
    const seleniumSearch = this.evidenceContext.seleniumSearch ?? searchWithSelenium

    try {
      return await seleniumSearch(query, maxResults)
    } catch (seleniumError) {
      try {
        return await directFetchSearch(searchUrl, maxResults)
      } catch (directError) {
        const directMessage = sanitizeUserFacingError(directError instanceof Error ? directError.message : String(directError)).userMessage
        const seleniumMessage = sanitizeUserFacingError(seleniumError instanceof Error ? seleniumError.message : String(seleniumError)).userMessage
        recordBrowserSearchEvidence({
          query,
          url: searchUrl,
          extractedText: `selenium_error=${seleniumMessage}\nduckduckgo_lite_error=${directMessage}`,
          timeoutReason: "selenium_first_duckduckgo_lite_fallback_failed",
          error: directError,
          runId: this.evidenceContext.runId ?? null,
          requestGroupId: this.evidenceContext.requestGroupId ?? null,
        })
        throw new Error(`DuckDuckGo search failed. browser=${seleniumMessage}; duckduckgo_lite=${directMessage}`)
      }
    }
  }
}

function buildSearchUrl(query: string): string {
  return `${LITE_URL}?q=${encodeURIComponent(query)}&kl=wt-wt`
}

async function searchWithDirectFetch(searchUrl: string, maxResults: number): Promise<SearchResult[]> {
  const response = await fetch(searchUrl, {
    headers: {
      "Accept": "text/html,application/xhtml+xml,*/*",
      "User-Agent": USER_AGENT,
    },
    redirect: "follow",
    signal: AbortSignal.timeout(8_000),
  })
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} ${response.statusText}`)
  }
  const html = await response.text()
  const results = parseWithCheerio(html, maxResults)
  if (results.length === 0) {
    throw new Error("no search results parsed")
  }
  return results
}

function parseWithCheerio(html: string, maxResults: number): SearchResult[] {
  const $ = cheerio.load(html)
  const results: SearchResult[] = []

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

function getBrowserSpecs(): BrowserSpec[] {
  const preferred = process.env.NOBIE_SELENIUM_BROWSER?.trim()
  const windowsOrder: BrowserSpec[] = [
    { browser: "MicrosoftEdge", label: "Microsoft Edge" },
    { browser: "chrome", label: "Google Chrome" },
    { browser: "firefox", label: "Firefox" },
  ]
  const defaultOrder: BrowserSpec[] = [
    { browser: "chrome", label: "Google Chrome" },
    { browser: "MicrosoftEdge", label: "Microsoft Edge" },
    { browser: "firefox", label: "Firefox" },
  ]
  const ordered = process.platform === "win32" ? windowsOrder : defaultOrder
  if (!preferred) return ordered

  const matched = ordered.find((spec) => (
    spec.browser.toLowerCase() === preferred.toLowerCase()
    || spec.label.toLowerCase() === preferred.toLowerCase()
  ))
  return matched ? [matched, ...ordered.filter((spec) => spec.browser !== matched.browser)] : ordered
}

async function buildDriver(spec: BrowserSpec) {
  const builder = new Builder().forBrowser(spec.browser)

  if (spec.browser === Browser.CHROME) {
    const options = new chrome.Options()
    options.addArguments(
      "--headless=new",
      "--disable-gpu",
      "--no-sandbox",
      "--disable-dev-shm-usage",
      "--window-size=1440,1200",
      `--user-agent=${USER_AGENT}`,
    )
    builder.setChromeOptions(options)
  } else if (spec.browser === Browser.EDGE) {
    const options = new edge.Options()
    options.addArguments(
      "--headless=new",
      "--disable-gpu",
      "--no-sandbox",
      "--disable-dev-shm-usage",
      "--window-size=1440,1200",
      `--user-agent=${USER_AGENT}`,
    )
    builder.setEdgeOptions(options)
  } else {
    const options = new firefox.Options()
    options.addArguments("-headless")
    options.setPreference("general.useragent.override", USER_AGENT)
    builder.setFirefoxOptions(options)
  }

  const driver = await builder.build()
  await driver.manage().setTimeouts({
    pageLoad: PAGE_LOAD_TIMEOUT_MS,
    implicit: 0,
    script: PAGE_LOAD_TIMEOUT_MS,
  })
  return driver
}

async function searchWithSelenium(query: string, maxResults: number): Promise<SearchResult[]> {
  const searchUrl = buildSearchUrl(query)
  const errors: string[] = []

  for (const spec of getBrowserSpecs()) {
    let driver: Awaited<ReturnType<typeof buildDriver>> | undefined
    try {
      driver = await buildDriver(spec)
      await driver.get(searchUrl)

      try {
        await driver.wait(until.elementLocated(By.css("a.result-link")), RESULT_WAIT_TIMEOUT_MS)
      } catch {
        // The final DOM can still be useful even if the result link did not appear before timeout.
      }

      const html = await driver.getPageSource()
      const results = parseWithCheerio(html, maxResults)
      if (results.length > 0) return results
      errors.push(`${spec.label}: no search results parsed`)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      errors.push(`${spec.label}: ${message}`)
    } finally {
      if (driver) {
        await driver.quit().catch(() => {})
      }
    }
  }

  throw new Error(`Selenium search failed. ${errors.join(" | ")}`)
}
