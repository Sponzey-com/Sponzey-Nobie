import { createElement } from "../packages/webui/node_modules/react/index.js"
import { renderToStaticMarkup } from "../packages/webui/node_modules/react-dom/server.js"
import { describe, expect, it } from "vitest"
import { OrchestrationMapToolbar } from "../packages/webui/src/components/orchestration/OrchestrationMapToolbar.tsx"
import { OrchestrationStudioShell } from "../packages/webui/src/components/orchestration/OrchestrationStudioShell.tsx"
import { OrchestrationStudioTopBar } from "../packages/webui/src/components/orchestration/OrchestrationStudioTopBar.tsx"
import { OrchestrationValidationRibbon } from "../packages/webui/src/components/orchestration/OrchestrationValidationRibbon.tsx"
import { createDefaultOrchestrationViewportState } from "../packages/webui/src/lib/orchestration-viewport.ts"

describe("task003 orchestration studio shell", () => {
  it("renders studio chrome, map stage, quick sheet, and an in-map validation notification without a duplicated bottom save bar", () => {
    const html = renderToStaticMarkup(createElement(OrchestrationStudioShell, {
      language: "en",
      surface: "page",
      sheetOpen: true,
      topBar: createElement(OrchestrationStudioTopBar, {
        language: "en",
        dirty: true,
        selectionLabel: "Agent Alpha",
      }),
      mapToolbar: createElement(OrchestrationMapToolbar, {
        language: "en",
        viewport: createDefaultOrchestrationViewportState(),
        nodeMode: "card",
        canEdit: true,
        dirty: true,
        running: false,
        showArchived: false,
        hiddenArchivedCount: 2,
        onCreateAgent: () => undefined,
        onCreateTeam: () => undefined,
        onToggleShowArchived: () => undefined,
        onValidateBoard: () => undefined,
        onSaveBoard: () => undefined,
        onRevert: () => undefined,
        onZoomIn: () => undefined,
        onZoomOut: () => undefined,
        onFitSelection: () => undefined,
        onFitAll: () => undefined,
        onReset: () => undefined,
      }),
      validationRibbon: createElement(OrchestrationValidationRibbon, {
        language: "en",
        validationSummary: { errorCount: 0, warningCount: 2 },
        saveResult: { status: "validated", summary: "Validated", effects: [], entities: [] },
      }),
      mapView: createElement("div", { "data-studio-map-demo": "true" }, "Board"),
      quickEditSheet: createElement("div", { "data-studio-sheet-demo": "true" }, "Sheet"),
      viewportTransform: "translate(12px, -8px) scale(1.08)",
      onCloseQuickEdit: () => undefined,
    }))

    expect(html).toContain('data-orchestration-studio-shell="page"')
    expect(html).toContain('data-orchestration-studio-sheet-open="true"')
    expect(html).toContain('data-orchestration-studio-sheet-mode="floating-desktop"')
    expect(html).toContain('data-orchestration-studio-topbar=""')
    expect(html).toContain('data-orchestration-map-actions=""')
    expect(html).toContain('data-orchestration-map-create="agent"')
    expect(html).toContain('data-orchestration-map-create="team"')
    expect(html).not.toContain('data-orchestration-validation-ribbon=""')
    expect(html).toContain('data-orchestration-studio-map-stage=""')
    expect(html).toContain('data-orchestration-studio-map-canvas=""')
    expect(html).toContain("xl:min-h-[46rem]")
    expect(html).toContain("pt-24")
    expect(html).toContain('data-orchestration-studio-sheet="open"')
    expect(html).not.toContain('data-orchestration-save-footer=""')
    expect(html).toContain("translate(12px, -8px) scale(1.08)")
  })

  it("keeps the quick sheet mounted in a closed state so the map remains primary when nothing is selected", () => {
    const html = renderToStaticMarkup(createElement(OrchestrationStudioShell, {
      language: "en",
      surface: "page",
      sheetOpen: false,
      topBar: createElement("div", {}, "Top"),
      mapToolbar: createElement("div", {}, "Toolbar"),
      mapView: createElement("div", { "data-studio-map-demo": "true" }, "Board"),
      quickEditSheet: createElement("div", {}, "Empty sheet"),
      viewportTransform: "translate(0px, 0px) scale(1)",
    }))

    expect(html).toContain('data-orchestration-studio-sheet-open="false"')
    expect(html).toContain('data-orchestration-studio-sheet="closed"')
    expect(html).not.toContain(">Close<")
  })
})
