import { describe, expect, it } from "vitest"
import { getOrchestrationStudioShellLayout } from "../packages/webui/src/lib/orchestration-shell-layout.ts"

describe("task003 orchestration sticky layout", () => {
  it("uses a floating quick sheet layout for the page studio surface", () => {
    const layout = getOrchestrationStudioShellLayout({ surface: "page", sheetOpen: true })

    expect(layout.sheetMode).toBe("floating-desktop")
    expect(layout.chromeStack).not.toContain("sticky")
    expect(layout.footer).not.toContain("sticky")
    expect(layout.sheetColumn).not.toContain("xl:sticky")
  })

  it("keeps settings preview stacked and non-sticky", () => {
    const layout = getOrchestrationStudioShellLayout({ surface: "settings", sheetOpen: false })

    expect(layout.sheetMode).toBe("stacked")
    expect(layout.chromeStack).not.toContain("sticky")
    expect(layout.footer).not.toContain("sticky")
  })
})
