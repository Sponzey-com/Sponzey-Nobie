import { createElement } from "../packages/webui/node_modules/react/index.js"
import { renderToStaticMarkup } from "../packages/webui/node_modules/react-dom/server.js"
import { describe, expect, it } from "vitest"
import { OrchestrationLegacyOverlay } from "../packages/webui/src/components/orchestration/OrchestrationLegacyOverlay.tsx"
import { resolveOrchestrationSurfacePolicy } from "../packages/webui/src/lib/orchestration-surface-policy.ts"

describe("task008 orchestration legacy overlay", () => {
  it("moves topology and raw legacy tools into a secondary surface without hiding them", () => {
    const policy = resolveOrchestrationSurfacePolicy({
      surface: "page",
      pathname: "/advanced/agents",
      language: "en",
    })

    const html = renderToStaticMarkup(createElement(OrchestrationLegacyOverlay, {
      language: "en",
      policy,
      open: true,
      activeToolId: "topology",
      tools: [
        { id: "topology", panel: createElement("div", { "data-panel": "topology" }, "Topology body") },
        { id: "advanced_editor", panel: createElement("div", { "data-panel": "advanced" }, "Advanced editor body") },
        { id: "import_export", panel: createElement("div", { "data-panel": "import-export" }, "Import export body") },
        { id: "relationship_graph", panel: createElement("div", { "data-panel": "graph" }, "Relationship graph body") },
        { id: "profile_preview", panel: createElement("div", { "data-panel": "profile" }, "Profile preview body") },
        { id: "runtime_sub_sessions", panel: createElement("div", { "data-panel": "runtime" }, "Runtime sessions body") },
      ],
      footer: createElement("div", { "data-footer": "policy" }, "Policy parity body"),
      onToggleOpen: () => undefined,
      onSelectTool: () => undefined,
    }))

    expect(html).toContain('data-orchestration-legacy-overlay="advanced_agents_page"')
    expect(html).toContain('data-orchestration-legacy-overlay-open="true"')
    expect(html).toContain('data-orchestration-legacy-tool="topology"')
    expect(html).toContain('data-orchestration-legacy-tool="advanced_editor"')
    expect(html).toContain('data-orchestration-legacy-tool="relationship_graph"')
    expect(html).toContain('data-orchestration-legacy-tool-emphasis="true"')
    expect(html).toContain('data-orchestration-legacy-panel="topology"')
    expect(html).toContain("Topology body")
    expect(html).toContain("Advanced secondary utilities")
    expect(html).toContain("Topology / Yeonjang")
    expect(html).toContain('data-orchestration-legacy-footer=""')
    expect(html).toContain("Policy parity body")
  })

  it("can stay collapsed on the primary /agents route while preserving tool access", () => {
    const policy = resolveOrchestrationSurfacePolicy({
      surface: "page",
      pathname: "/agents",
      language: "en",
    })

    const html = renderToStaticMarkup(createElement(OrchestrationLegacyOverlay, {
      language: "en",
      policy,
      open: false,
      activeToolId: "advanced_editor",
      tools: [
        { id: "topology", panel: createElement("div", null, "Topology body") },
        { id: "advanced_editor", panel: createElement("div", null, "Advanced editor body") },
      ],
      onToggleOpen: () => undefined,
      onSelectTool: () => undefined,
    }))

    expect(html).toContain('data-orchestration-legacy-overlay="agents_page"')
    expect(html).toContain('data-orchestration-legacy-overlay-open="false"')
    expect(html).toContain("Secondary legacy utilities")
    expect(html).toContain("Open utilities")
    expect(html).not.toContain('data-orchestration-legacy-panel=')
    expect(html).toContain('data-orchestration-legacy-tool="topology"')
    expect(html).toContain('data-orchestration-legacy-tool="advanced_editor"')
  })
})
