import { readFileSync } from "node:fs"
import { createElement } from "../packages/webui/node_modules/react/index.js"
import { renderToStaticMarkup } from "../packages/webui/node_modules/react-dom/server.js"
import { afterEach, describe, expect, it } from "vitest"
import { FeatureGate } from "../packages/webui/src/components/FeatureGate.tsx"
import {
  isTopologyWorkspaceSectionVisible,
  resolveTopologyWorkspaceExposureModeForRoute,
  shouldShowTopologyWorkspaceAdvancedSurface,
  topologyWorkspaceVisibleSections,
} from "../packages/webui/src/lib/topology-workspace-copy.ts"
import { resolveLegacyAdvancedRoute } from "../packages/webui/src/lib/ui-mode.js"
import { EnterpriseTopologyPage } from "../packages/webui/src/pages/EnterpriseTopologyPage.tsx"
import {
  TopologyWorkspaceRouteShell,
  resolveTopologyWorkspaceInitialLayer,
} from "../packages/webui/src/pages/TopologyWorkspacePage.tsx"
import { useCapabilitiesStore } from "../packages/webui/src/stores/capabilities"

afterEach(() => {
  useCapabilitiesStore.getState().setItems([])
})

describe("task012 removed advanced topology surfaces", () => {
  it("routes advanced, developer, and resources requests back to the simple workspace", () => {
    const advancedShell = renderToStaticMarkup(
      createElement(
        TopologyWorkspaceRouteShell,
        { initialLayer: resolveTopologyWorkspaceInitialLayer("?mode=resources", "advanced"), exposureMode: "advanced" },
        createElement("div", null, "workspace body"),
      ),
    )
    const advancedPage = renderToStaticMarkup(
      createElement(EnterpriseTopologyPage, {
        workspaceLayer: resolveTopologyWorkspaceInitialLayer("?mode=resources", "advanced"),
        workspaceExposureMode: "advanced",
      }),
    )
    const developerPage = renderToStaticMarkup(
      createElement(EnterpriseTopologyPage, {
        workspaceLayer: "build",
        workspaceExposureMode: "developer",
      }),
    )

    expect(resolveTopologyWorkspaceExposureModeForRoute({
      search: "",
      pathname: "/advanced/topology",
    })).toBe("simple")
    expect(resolveTopologyWorkspaceExposureModeForRoute({
      search: "?ux=advanced",
      pathname: "/advanced/topology",
    })).toBe("simple")
    expect(resolveTopologyWorkspaceExposureModeForRoute({
      search: "?ux=developer",
      pathname: "/advanced/topology",
    })).toBe("simple")
    expect(resolveTopologyWorkspaceExposureModeForRoute({
      search: "?mode=resources",
      pathname: "/advanced/topology",
    })).toBe("simple")
    expect(resolveTopologyWorkspaceInitialLayer("?mode=resources", "simple")).toBe("build")
    expect(resolveTopologyWorkspaceInitialLayer("?mode=resources", "advanced")).toBe("build")
    expect(advancedShell).not.toContain('data-testid="topology-workspace-layer-resources"')
    expect(advancedShell).toContain("업무 흐름 만들기")
    expect(advancedPage).toContain('data-testid="executor-workspace-shell"')
    expect(advancedPage).toContain('data-testid="executor-graph-canvas"')
    expect(advancedPage).not.toContain('data-testid="topology-workspace-resources-layer"')
    expect(advancedPage).not.toContain("Resource projection")
    expect(developerPage).not.toContain('data-testid="topology-developer-escape-hatch"')
  })

  it("removes compile preview, palette, import-export, and debug entry points from topology UI", () => {
    const html = renderToStaticMarkup(
      createElement(EnterpriseTopologyPage, {
        workspaceLayer: "build",
        workspaceExposureMode: "developer",
      }),
    )

    expect(html).toContain('data-testid="executor-workspace-shell"')
    expect(html).not.toContain('data-testid="enterprise-topology-compile-preview"')
    expect(html).not.toContain('data-testid="enterprise-topology-palette"')
    expect(html).not.toContain('data-testid="enterprise-relation-mode-toolbar"')
    expect(html).not.toContain('data-testid="topology-run-target-panel"')
    expect(html).not.toContain('data-testid="topology-developer-escape-hatch"')
    expect(html).not.toContain('data-testid="topology-advanced-import-export"')
    expect(html).not.toContain("JSON/YAML")
    expect(html).not.toContain("WorkOrder Template")
    expect(html).not.toContain("Compile Preview")
  })

  it("keeps only simple section visibility for topology exposure helpers", () => {
    expect(shouldShowTopologyWorkspaceAdvancedSurface("simple")).toBe(false)
    expect(shouldShowTopologyWorkspaceAdvancedSurface("advanced")).toBe(false)
    expect(shouldShowTopologyWorkspaceAdvancedSurface("developer")).toBe(false)
    expect(isTopologyWorkspaceSectionVisible("simple", "resourcesLayer")).toBe(false)
    expect(isTopologyWorkspaceSectionVisible("simple", "compilePreview")).toBe(false)
    expect(isTopologyWorkspaceSectionVisible("simple", "importExport")).toBe(false)
    expect(isTopologyWorkspaceSectionVisible("advanced", "resourcesLayer")).toBe(false)
    expect(isTopologyWorkspaceSectionVisible("advanced", "compilePreview")).toBe(false)
    expect(isTopologyWorkspaceSectionVisible("advanced", "importExport")).toBe(false)
    expect(isTopologyWorkspaceSectionVisible("developer", "featureFlagStatus")).toBe(false)
    expect(topologyWorkspaceVisibleSections("developer")).toEqual([])
  })

  it("keeps compatibility route and feature flag fallback intact", () => {
    useCapabilitiesStore.getState().setItems([{
      key: "enterprise_topology_builder_ui",
      label: "Topology Workspace",
      area: "gateway",
      status: "disabled",
      implemented: true,
      enabled: false,
      reason: "task012 feature fallback",
    }])
    const fallbackHtml = renderToStaticMarkup(
      createElement(
        FeatureGate,
        { capabilityKey: "enterprise_topology_builder_ui", title: "토폴로지" },
        createElement("div", null, "workspace body"),
      ),
    )

    expect(resolveLegacyAdvancedRoute("/enterprise-topology")).toBe("/advanced/topology")
    expect(fallbackHtml).toContain("기능 플래그")
    expect(fallbackHtml).toContain("관리자 설정")
    expect(fallbackHtml).not.toContain("workspace body")
  })

  it("documents removed advanced topology surfaces in the release runbook", () => {
    const runbook = readFileSync(new URL("../docs/release-runbook.md", import.meta.url), "utf-8")

    expect(runbook).toContain("Removed surface rollback check")
    expect(runbook).toContain("/advanced/topology?ux=developer&mode=build")
    expect(runbook).toContain("must stay on the simple Executor Graph surface")
    expect(runbook).not.toContain("Advanced escape hatch regression")
  })
})
