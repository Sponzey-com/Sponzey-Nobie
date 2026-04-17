import { describe, expect, it } from "vitest"
import { DuckDuckGoSearchProvider } from "../packages/core/src/tools/builtin/search-providers/duckduckgo.js"
import type { SearchResult } from "../packages/core/src/tools/builtin/search-providers/duckduckgo.js"

const seleniumResult: SearchResult[] = [
  { title: "Selenium result", url: "https://example.com/selenium", snippet: "browser path" },
]

const duckDuckGoLiteResult: SearchResult[] = [
  { title: "DuckDuckGo Lite result", url: "https://example.com/direct", snippet: "direct fallback" },
]

describe("DuckDuckGoSearchProvider search order", () => {
  it("uses Selenium first before DuckDuckGo Lite direct fetch", async () => {
    const calls: string[] = []
    const provider = new DuckDuckGoSearchProvider({
      seleniumSearch: async () => {
        calls.push("selenium")
        return seleniumResult
      },
      directFetchSearch: async () => {
        calls.push("duckduckgo_lite")
        return duckDuckGoLiteResult
      },
    })

    const results = await provider.search("동천동 날씨", { maxResults: 3 })

    expect(results).toEqual(seleniumResult)
    expect(calls).toEqual(["selenium"])
  })

  it("falls back to DuckDuckGo Lite direct fetch when Selenium fails", async () => {
    const calls: string[] = []
    const provider = new DuckDuckGoSearchProvider({
      seleniumSearch: async () => {
        calls.push("selenium")
        throw new Error("browser unavailable")
      },
      directFetchSearch: async (searchUrl) => {
        calls.push(searchUrl.includes("lite.duckduckgo.com") ? "duckduckgo_lite" : "unexpected_direct")
        return duckDuckGoLiteResult
      },
    })

    const results = await provider.search("동천동 날씨", { maxResults: 3 })

    expect(results).toEqual(duckDuckGoLiteResult)
    expect(calls).toEqual(["selenium", "duckduckgo_lite"])
  })
})
