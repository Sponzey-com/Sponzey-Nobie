import { createElement } from "../packages/webui/node_modules/react/index.js"
import { renderToStaticMarkup } from "../packages/webui/node_modules/react-dom/server.js"
import { describe, expect, it } from "vitest"
import type {
  OrchestrationDashboardActivityItem,
  OrchestrationDashboardFallback,
  OrchestrationDashboardInspectorModel,
} from "../packages/webui/src/lib/orchestration-dashboard-projection.ts"
import { createDefaultOrchestrationViewportState } from "../packages/webui/src/lib/orchestration-viewport.ts"
import type { OrchestrationSummaryCard } from "../packages/webui/src/lib/orchestration-ui.ts"
import { OrchestrationDashboardShell } from "../packages/webui/src/components/orchestration/OrchestrationDashboardShell.tsx"
import { OrchestrationTopBar } from "../packages/webui/src/components/orchestration/OrchestrationTopBar.tsx"

const summary: OrchestrationSummaryCard[] = [
  { id: "mode", label: "Mode", value: "Orchestration", description: "Delegation is active.", tone: "ready" },
  { id: "agents", label: "Agents", value: "2/3", description: "Two enabled agents are ready.", tone: "ready" },
  { id: "teams", label: "Teams", value: "1", description: "One active team is configured.", tone: "ready" },
]

const fallback: OrchestrationDashboardFallback = {
  state: "registry_only",
  tone: "warning",
  title: "Registry-first preview",
  description: "Registry data is present while the runtime graph catches up.",
  sourceBadges: ["registry", "summary"],
}

const inspector: OrchestrationDashboardInspectorModel = {
  id: "agent:agent-alpha-a1",
  tone: "ready",
  eyebrow: "Agent",
  title: "Agent Alpha",
  summary: "Structured worker",
  configBadges: ["enabled", "moderate"],
  runtimeBadges: ["Running"],
  details: ["Teams 1", "Delegation enabled"],
}

const activityItems: OrchestrationDashboardActivityItem[] = [
  {
    id: "activity:running:agent-alpha-a1",
    tab: "activity",
    tone: "ready",
    title: "Agent Alpha running",
    description: "1 session is active.",
    badge: "running",
  },
  {
    id: "approval:agent-beta-b2",
    tab: "approvals",
    tone: "warning",
    title: "Agent Beta awaiting approval",
    description: "Screen control requires approval.",
    badge: "safe -> sensitive",
  },
]

describe("task002 orchestration dashboard shell", () => {
  it("renders the topbar, map toolbar, viewport, inspector, and activity rail in one command-center shell", () => {
    const html = renderToStaticMarkup(createElement("div", {}, [
      createElement(OrchestrationTopBar, {
        key: "topbar",
        language: "en",
        activeTab: "map",
        onChange: () => undefined,
        summary,
        fallback,
      }),
      createElement(OrchestrationDashboardShell, {
        key: "shell",
        language: "en",
        activeTab: "map",
        viewport: createDefaultOrchestrationViewportState(),
        nodeMode: "card",
        inspector,
        activityItems,
        mapView: createElement("div", { "data-map-view": "demo" }, "Map"),
        onZoomIn: () => undefined,
        onZoomOut: () => undefined,
        onFitSelection: () => undefined,
        onFitAll: () => undefined,
        onReset: () => undefined,
      }),
    ]))

    expect(html).toContain('data-orchestration-topbar="map"')
    expect(html).toContain('data-orchestration-topbar-tab="utilities"')
    expect(html).toContain('data-orchestration-dashboard-shell="map"')
    expect(html).toContain('data-orchestration-map-toolbar="card"')
    expect(html).toContain('data-orchestration-dashboard-viewport=""')
    expect(html).toContain('data-orchestration-dashboard-canvas=""')
    expect(html).toContain('data-orchestration-floating-inspector="agent:agent-alpha-a1"')
    expect(html).toContain('data-orchestration-activity-bar="activity"')
    expect(html).toContain('data-orchestration-activity-variant="strip"')
    expect(html).toContain("Agent Alpha")
  })

  it("switches the shell body to the approval rail when the approvals tab is active", () => {
    const html = renderToStaticMarkup(createElement(OrchestrationDashboardShell, {
      language: "en",
      activeTab: "approvals",
      viewport: createDefaultOrchestrationViewportState(),
      nodeMode: "card",
      inspector,
      activityItems: activityItems.filter((item) => item.tab === "approvals"),
      mapView: createElement("div", { "data-map-view": "demo" }, "Map"),
      onZoomIn: () => undefined,
      onZoomOut: () => undefined,
      onFitSelection: () => undefined,
      onFitAll: () => undefined,
      onReset: () => undefined,
    }))

    expect(html).toContain('data-orchestration-dashboard-shell="approvals"')
    expect(html).toContain('data-orchestration-activity-bar="approvals"')
    expect(html).toContain('data-orchestration-activity-variant="grid"')
    expect(html).toContain("Agent Beta awaiting approval")
    expect(html).not.toContain('data-orchestration-dashboard-viewport=""')
  })
})
