import { createElement } from "../packages/webui/node_modules/react/index.js"
import { renderToStaticMarkup } from "../packages/webui/node_modules/react-dom/server.js"
import { describe, expect, it } from "vitest"
import { OrchestrationContentShell } from "../packages/webui/src/components/orchestration/OrchestrationContentShell.tsx"

describe("task001 orchestration content shell layout", () => {
  it("keeps the page shell compatible with the default app sidebar content area", () => {
    const html = renderToStaticMarkup(createElement(OrchestrationContentShell, {
      surface: "page",
      children: createElement("div", null, "Page shell"),
    }))

    expect(html).toContain('data-orchestration-content-shell="page"')
    expect(html).toContain("overflow-y-auto")
    expect(html).toContain("w-full")
    expect(html).toContain("--orchestration-background:#FFFBEF")
    expect(html).toContain("font-family:&quot;Space Grotesk&quot;")
  })

  it("keeps the settings shell compact while reusing the same visual token set", () => {
    const html = renderToStaticMarkup(createElement(OrchestrationContentShell, {
      surface: "settings",
      children: createElement("div", null, "Settings shell"),
    }))

    expect(html).toContain('data-orchestration-content-shell="settings"')
    expect(html).toContain("rounded-[2rem]")
    expect(html).toContain("backdrop-blur-[2px]")
    expect(html).toContain("--orchestration-panel:#FEFCF4")
    expect(html).toContain("Settings shell")
  })
})
