import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

describe("web_fetch Playwright lifecycle guard", () => {
  it("awaits page.content before browser.close can run from finally", () => {
    const files = [
      "packages/core/src/tools/builtin/web-fetch.ts",
      "packages/core/src/tools/builtin/web-fetch.js",
      "packages/core/dist/tools/builtin/web-fetch.js",
    ]

    for (const file of files) {
      const source = readFileSync(file, "utf-8")
      expect(source, file).toContain("return await page.content()")
      expect(source, file).not.toContain("return page.content()")
    }
  })
})
