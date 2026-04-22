import { createElement } from "../packages/webui/node_modules/react/index.js"
import { renderToStaticMarkup } from "../packages/webui/node_modules/react-dom/server.js"
import { describe, expect, it } from "vitest"
import { OrchestrationDashboardShell } from "../packages/webui/src/components/orchestration/OrchestrationDashboardShell.tsx"
import { OrchestrationMapToolbar } from "../packages/webui/src/components/orchestration/OrchestrationMapToolbar.tsx"
import { OrchestrationMobileSheet } from "../packages/webui/src/components/orchestration/OrchestrationMobileSheet.tsx"
import { OrchestrationStudioShell } from "../packages/webui/src/components/orchestration/OrchestrationStudioShell.tsx"
import { resolveOrchestrationShortcut } from "../packages/webui/src/lib/orchestration-shortcuts.ts"
import { createDefaultOrchestrationViewportState } from "../packages/webui/src/lib/orchestration-viewport.ts"

describe("task009 orchestration shortcuts and mobile shell", () => {
  it("maps the required orchestration shortcuts", () => {
    expect(resolveOrchestrationShortcut({ key: "=" })).toBe("zoom_in")
    expect(resolveOrchestrationShortcut({ key: "-" })).toBe("zoom_out")
    expect(resolveOrchestrationShortcut({ key: "0" })).toBe("reset_view")
    expect(resolveOrchestrationShortcut({ key: "Escape" })).toBe("close_overlay")
    expect(resolveOrchestrationShortcut({ key: "s", metaKey: true })).toBe("save_draft")
    expect(resolveOrchestrationShortcut({ key: "S", ctrlKey: true })).toBe("save_draft")
  })

  it("renders a mobile bottom sheet and keeps the desktop quick sheet in a separate trap", () => {
    const html = renderToStaticMarkup(createElement(OrchestrationStudioShell, {
      language: "en",
      surface: "page",
      sheetOpen: true,
      topBar: createElement("div", null, "Top bar"),
      mapToolbar: createElement(OrchestrationMapToolbar, {
        language: "en",
        viewport: createDefaultOrchestrationViewportState(),
        nodeMode: "card",
        canEdit: true,
        onCreateAgent: () => undefined,
        onCreateTeam: () => undefined,
        onZoomIn: () => undefined,
        onZoomOut: () => undefined,
        onFitSelection: () => undefined,
        onFitAll: () => undefined,
        onReset: () => undefined,
      }),
      validationRibbon: createElement("div", null, "Validation"),
      mapView: createElement("div", null, "Map view"),
      quickEditSheet: createElement("div", null, "Quick edit body"),
      mobileSheet: createElement(OrchestrationMobileSheet, {
        language: "en",
        open: true,
        title: "Quick sheet",
        onClose: () => undefined,
      }, createElement("div", null, "Mobile quick edit")),
      saveFooter: createElement("div", null, "Save footer"),
      viewportTransform: "translate(0px, 0px) scale(1)",
      onCloseQuickEdit: () => undefined,
    }))

    expect(html).toContain('data-orchestration-studio-mobile-sheet=""')
    expect(html).toContain('data-orchestration-mobile-sheet="open"')
    expect(html).toContain('data-orchestration-focus-trap="mobile-sheet"')
    expect(html).toContain('data-orchestration-focus-trap="quick-sheet"')
    expect(html).toContain("Mobile quick edit")
  })

  it("adds mobile inspector and shortcut legend to the dashboard shell", () => {
    const html = renderToStaticMarkup(createElement(OrchestrationDashboardShell, {
      language: "en",
      activeTab: "map",
      viewport: createDefaultOrchestrationViewportState(),
      nodeMode: "card",
      inspector: {
        id: "agent-alpha",
        eyebrow: "Agent",
        title: "Agent Alpha",
        summary: "Selected summary.",
        configBadges: ["enabled"],
        runtimeBadges: ["idle"],
        details: ["detail"],
      },
      activityItems: [],
      mapView: createElement("div", null, "Map view"),
      mobileInspector: createElement("div", null, "Mobile inspector"),
      onZoomIn: () => undefined,
      onZoomOut: () => undefined,
      onFitSelection: () => undefined,
      onFitAll: () => undefined,
      onReset: () => undefined,
    }))

    expect(html).toContain('data-orchestration-dashboard-mobile-inspector=""')
    expect(html).toContain("Mobile inspector")
    expect(html).not.toContain('data-orchestration-map-node-mode="character"')
    expect(html).toContain('data-orchestration-activity-variant="strip"')
  })
})
