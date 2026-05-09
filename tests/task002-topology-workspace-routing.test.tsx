import { readFileSync } from "node:fs"
import { createElement } from "../packages/webui/node_modules/react/index.js"
import { renderToStaticMarkup } from "../packages/webui/node_modules/react-dom/server.js"
import { afterEach, describe, expect, it } from "vitest"
import { createCapabilities } from "../packages/core/src/control-plane/index.ts"
import { FeatureGate } from "../packages/webui/src/components/FeatureGate.tsx"
import {
  TopologyWorkspaceRouteShell,
} from "../packages/webui/src/pages/TopologyWorkspacePage.tsx"
import type { FeatureCapability } from "../packages/webui/src/contracts/capabilities.ts"
import {
  getUiNavigation,
  getUiRouteInventory,
  resolveLegacyAdvancedRoute,
  resolveModeSwitchRoute,
} from "../packages/webui/src/lib/ui-mode.js"
import { useCapabilitiesStore } from "../packages/webui/src/stores/capabilities"

const previousEnterpriseBuilderFlag = process.env["NOBIE_ENTERPRISE_TOPOLOGY_BUILDER_UI"]

function capability(status: FeatureCapability["status"]): FeatureCapability {
  return {
    key: "enterprise_topology_builder_ui",
    label: "Topology Workspace",
    area: "gateway",
    status,
    implemented: true,
    enabled: status === "ready",
    reason: "disabled by task002 test",
  }
}

afterEach(() => {
  useCapabilitiesStore.getState().setItems([])
  if (previousEnterpriseBuilderFlag === undefined) {
    delete process.env["NOBIE_ENTERPRISE_TOPOLOGY_BUILDER_UI"]
  } else {
    process.env["NOBIE_ENTERPRISE_TOPOLOGY_BUILDER_UI"] = previousEnterpriseBuilderFlag
  }
})

describe("task002 topology workspace routing", () => {
  it("renders the unified workspace route shell with visible simple layer tabs", () => {
    const html = renderToStaticMarkup(
      createElement(TopologyWorkspaceRouteShell, { initialLayer: "build" }, createElement("div", null, "workspace body")),
    )

    expect(html).toContain('data-testid="topology-workspace-route-shell"')
    expect(html).toContain("업무 흐름 만들기")
    expect(html).toContain('data-testid="topology-workspace-layer-build"')
    expect(html).toContain('data-testid="topology-workspace-layer-run"')
    expect(html).toContain('data-testid="topology-workspace-layer-trace"')
    expect(html).toContain('data-testid="topology-workspace-layer-improve"')
    expect(html).not.toContain('data-testid="topology-workspace-layer-resources"')
    expect(html).toContain("만들기")
    expect(html).toContain("실행")
    expect(html).toContain("기록")
    expect(html).toContain("개선")
    expect(html).not.toContain("리소스")
  })

  it("exposes one topology navigation entry instead of separate runtime and enterprise entries", () => {
    const nav = getUiNavigation("advanced", false)
    const topologyItems = nav.filter((item) => item.path.includes("topology"))

    expect(topologyItems).toEqual([
      expect.objectContaining({
        path: "/advanced/topology",
        labelKo: "토폴로지",
        labelEn: "Topology",
        capabilityKey: "enterprise_topology_builder_ui",
      }),
    ])
  })

  it("tracks old enterprise builder bookmarks as compatibility aliases for the workspace", () => {
    const inventory = getUiRouteInventory()
    const workspace = inventory.find((item) => item.path === "/advanced/topology")
    const enterpriseAlias = inventory.find((item) => item.path === "/advanced/enterprise-topology")
    const appSource = readFileSync(new URL("../packages/webui/src/App.tsx", import.meta.url), "utf-8")

    expect(workspace).toEqual(expect.objectContaining({
      component: "TopologyWorkspacePage",
      status: "kept",
      replacementPath: null,
      apiCalls: expect.arrayContaining(["/api/topologies", "/api/agent-topology"]),
    }))
    expect(enterpriseAlias).toEqual(expect.objectContaining({
      component: "Navigate",
      status: "compatibility",
      replacementPath: "/advanced/topology?mode=build",
    }))
    expect(resolveLegacyAdvancedRoute("/enterprise-topology")).toBe("/advanced/topology")
    expect(appSource).toContain("TopologyWorkspacePage")
    expect(appSource).toContain('path="/advanced/enterprise-topology"')
    expect(appSource).toContain('to="/advanced/topology?mode=build"')
  })

  it("keeps the unified workspace behind the enterprise topology feature gate", () => {
    process.env["NOBIE_ENTERPRISE_TOPOLOGY_BUILDER_UI"] = "off"
    useCapabilitiesStore.getState().setItems([capability("disabled")])
    const apiCapability = createCapabilities().find((item) => item.key === "enterprise_topology_builder_ui")

    const html = renderToStaticMarkup(
      createElement(
        FeatureGate,
        { capabilityKey: "enterprise_topology_builder_ui", title: "토폴로지" },
        createElement("div", null, "workspace route content"),
      ),
    )

    expect(apiCapability).toEqual(expect.objectContaining({
      status: "disabled",
      enabled: false,
    }))
    expect(html).toContain("토폴로지")
    expect(html).toContain("기능 플래그")
    expect(html).not.toContain("workspace route content")
  })

  it("keeps beginner and advanced mode switch policy stable", () => {
    expect(resolveModeSwitchRoute("/advanced/topology", "beginner")).toBe("/status")
    expect(resolveModeSwitchRoute("/advanced/enterprise-topology", "beginner")).toBe("/status")
    expect(resolveModeSwitchRoute("/status", "advanced")).toBe("/advanced/dashboard")
  })
})
