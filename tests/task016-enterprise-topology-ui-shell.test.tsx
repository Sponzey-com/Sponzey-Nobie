import { readFileSync } from "node:fs"
import { createElement } from "../packages/webui/node_modules/react/index.js"
import { renderToStaticMarkup } from "../packages/webui/node_modules/react-dom/server.js"
import { afterEach, describe, expect, it } from "vitest"
import { createCapabilities } from "../packages/core/src/control-plane/index.ts"
import { FeatureGate } from "../packages/webui/src/components/FeatureGate.tsx"
import {
  EnterpriseTopologyCanvasShell,
  buildEnterpriseTopologyCanvasModel,
} from "../packages/webui/src/components/topology/EnterpriseTopologyCanvas.tsx"
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
    label: "Enterprise Topology Builder",
    area: "gateway",
    status,
    implemented: true,
    enabled: status === "ready",
    reason: "disabled by task016 test",
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

describe("task016 enterprise topology UI shell", () => {
  it("unifies Runtime Resource Topology and Enterprise Builder behind the Topology workspace route", () => {
    const nav = getUiNavigation("advanced", false)
    const topologyNav = nav.find((item) => item.path === "/advanced/topology")
    const oldBuilderNav = nav.find((item) => item.path === "/advanced/enterprise-topology")
    const inventory = getUiRouteInventory()
    const workspaceRoute = inventory.find((item) => item.path === "/advanced/topology")
    const builderAlias = inventory.find((item) => item.path === "/advanced/enterprise-topology")

    expect(topologyNav).toEqual(expect.objectContaining({
      labelEn: "Topology",
      capabilityKey: "enterprise_topology_builder_ui",
    }))
    expect(oldBuilderNav).toBeUndefined()
    expect(workspaceRoute).toEqual(expect.objectContaining({
      component: "TopologyWorkspacePage",
      apiCalls: expect.arrayContaining(["/api/topologies", "/api/agent-topology"]),
    }))
    expect(builderAlias).toEqual(expect.objectContaining({
      component: "Navigate",
      status: "compatibility",
      replacementPath: "/advanced/topology?mode=build",
    }))
    expect(resolveLegacyAdvancedRoute("/enterprise-topology")).toBe("/advanced/topology")
    expect(resolveModeSwitchRoute("/advanced/enterprise-topology", "beginner")).toBe("/status")
  })

  it("keeps the Enterprise Builder route behind its feature gate", () => {
    process.env["NOBIE_ENTERPRISE_TOPOLOGY_BUILDER_UI"] = "off"
    useCapabilitiesStore.getState().setItems([capability("disabled")])
    const apiCapability = createCapabilities().find((item) => item.key === "enterprise_topology_builder_ui")

    const html = renderToStaticMarkup(
      createElement(
        FeatureGate,
        { capabilityKey: "enterprise_topology_builder_ui", title: "Enterprise Topology Builder" },
        createElement("div", null, "builder route content"),
      ),
    )
    const appSource = readFileSync(new URL("../packages/webui/src/App.tsx", import.meta.url), "utf-8")

    expect(apiCapability).toEqual(expect.objectContaining({
      status: "disabled",
      enabled: false,
    }))
    expect(appSource).toContain('path="/advanced/topology"')
    expect(appSource).toContain('capabilityKey="enterprise_topology_builder_ui"')
    expect(html).toContain("Enterprise Topology Builder")
    expect(html).toContain("기능 플래그")
    expect(html).not.toContain("builder route content")
  })

  it("renders the GUI-first builder shell without the old advanced palette surface", () => {
    const model = buildEnterpriseTopologyCanvasModel()
    const html = renderToStaticMarkup(
      createElement(EnterpriseTopologyCanvasShell, {
        model,
        selectedNodeId: model.nodes[0]?.id ?? null,
      }),
    )

    expect(model.palette.map((item) => item.id)).toEqual([
      "task",
      "decision",
      "approval",
      "tool",
      "data",
      "group",
      "org_unit",
      "position",
      "person",
      "process",
      "authority",
      "responsibility",
    ])
    expect(html).toContain('data-testid="topology-simple-create-panel"')
    expect(html).toContain('data-testid="enterprise-topology-canvas"')
    expect(html).not.toContain('data-testid="enterprise-topology-palette"')
    expect(html).toContain('data-testid="topology-workspace-inspector"')
    expect(html).toContain('data-testid="enterprise-topology-validation"')
    expect(html).not.toContain('data-testid="enterprise-topology-compile-preview"')
    expect(html).toContain('data-testid="topology-run-trace-overlay"')
    expect(html).toContain("Customer Intake")
    expect(html).toContain("CRM Search")
    expect(html).not.toContain('data-testid="topology-advanced-import-export"')
  })

  it("keeps the existing TopologyPage scoped to runtime resources", () => {
    const source = readFileSync(new URL("../packages/webui/src/pages/TopologyPage.tsx", import.meta.url), "utf-8")

    expect(source).toContain("api.agentTopology")
    expect(source).toContain("Runtime Resource Topology")
    expect(source).toContain("Agent와 Team의 실행 리소스")
    expect(source).not.toContain("EnterpriseTopologyCanvas")
  })
})
