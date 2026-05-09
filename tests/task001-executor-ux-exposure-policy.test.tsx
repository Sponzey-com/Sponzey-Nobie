import { createElement } from "../packages/webui/node_modules/react/index.js"
import { renderToStaticMarkup } from "../packages/webui/node_modules/react-dom/server.js"
import { afterEach, describe, expect, it } from "vitest"
import { createCapabilities } from "../packages/core/src/control-plane/index.ts"
import { WORK_ORDER_TEMPLATE_CATALOG } from "../packages/core/src/topology-runtime/work-order-templates.ts"
import {
  EnterpriseTopologyCanvasShell,
  buildEnterpriseTopologyCanvasModel,
} from "../packages/webui/src/components/topology/EnterpriseTopologyCanvas.tsx"
import {
  TopologyRunLauncher,
  resolveTopologyRunTargetState,
} from "../packages/webui/src/components/topology/TopologyRunLauncher.tsx"
import { FeatureGate } from "../packages/webui/src/components/FeatureGate.tsx"
import type { FeatureCapability } from "../packages/webui/src/contracts/capabilities.ts"
import {
  TOPOLOGY_WORKSPACE_ADVANCED_ONLY_LABELS,
  TOPOLOGY_WORKSPACE_SIMPLE_BLOCKED_PALETTE_LABELS,
  TOPOLOGY_WORKSPACE_SIMPLE_CONCEPTS,
  resolveTopologyWorkspaceExposureMode,
  shouldShowTopologyWorkspaceAdvancedSurface,
  topologyWorkspaceVisibleLayers,
} from "../packages/webui/src/lib/topology-workspace-copy.ts"
import { buildTopologyWorkspaceStarterDraft } from "../packages/webui/src/lib/topology-workspace-templates.ts"
import {
  TopologyWorkspaceRouteShell,
  resolveTopologyWorkspaceInitialLayer,
} from "../packages/webui/src/pages/TopologyWorkspacePage.tsx"
import { useCapabilitiesStore } from "../packages/webui/src/stores/capabilities"

const now = Date.UTC(2026, 4, 1, 9, 0, 0)
const previousEnterpriseBuilderFlag = process.env["NOBIE_ENTERPRISE_TOPOLOGY_BUILDER_UI"]

function disabledBuilderCapability(): FeatureCapability {
  return {
    key: "enterprise_topology_builder_ui",
    label: "Topology Workspace",
    area: "gateway",
    status: "disabled",
    implemented: true,
    enabled: false,
    reason: "task001 exposure policy fallback",
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

describe("task001 executor-first UX exposure policy", () => {
  it("defines simple concepts and keeps advanced surfaces out of the simple layer list", () => {
    expect(TOPOLOGY_WORKSPACE_SIMPLE_CONCEPTS).toEqual([
      "실행자",
      "연결",
      "입력",
      "실행",
      "기록",
      "고칠 점",
    ])
    expect(topologyWorkspaceVisibleLayers("simple").map((item) => item.layer)).toEqual([
      "build",
      "run",
      "trace",
      "improve",
    ])
    expect(topologyWorkspaceVisibleLayers("advanced").map((item) => item.layer)).toEqual([
      "build",
      "run",
      "trace",
      "improve",
    ])
    expect(shouldShowTopologyWorkspaceAdvancedSurface("simple")).toBe(false)
    expect(shouldShowTopologyWorkspaceAdvancedSurface("advanced")).toBe(false)
    expect(shouldShowTopologyWorkspaceAdvancedSurface("developer")).toBe(false)
    expect(resolveTopologyWorkspaceExposureMode("?ux=advanced")).toBe("simple")
    expect(resolveTopologyWorkspaceExposureMode("?view=developer")).toBe("simple")
    expect(resolveTopologyWorkspaceExposureMode("")).toBe("simple")
    expect(resolveTopologyWorkspaceInitialLayer("?mode=resources", "simple")).toBe("build")
    expect(resolveTopologyWorkspaceInitialLayer("?mode=resources", "advanced")).toBe("build")
  })

  it("renders the default simple route shell without the Resources tab", () => {
    const html = renderToStaticMarkup(
      createElement(
        TopologyWorkspaceRouteShell,
        { initialLayer: "build", exposureMode: "simple" },
        createElement("div", null, "workspace body"),
      ),
    )

    expect(html).toContain('data-testid="topology-workspace-route-shell"')
    expect(html).toContain('data-exposure-mode="simple"')
    expect(html).toContain('data-testid="topology-workspace-layer-build"')
    expect(html).toContain('data-testid="topology-workspace-layer-run"')
    expect(html).toContain('data-testid="topology-workspace-layer-trace"')
    expect(html).toContain('data-testid="topology-workspace-layer-improve"')
    expect(html).not.toContain('data-testid="topology-workspace-layer-resources"')
    expect(html).not.toContain("Resources")
  })

  it("hides the internal node-type palette and compile preview from simple canvas mode", () => {
    const topology = buildTopologyWorkspaceStarterDraft("customer-request-flow", { now })
    const model = buildEnterpriseTopologyCanvasModel(topology)
    const html = renderToStaticMarkup(
      createElement(EnterpriseTopologyCanvasShell, {
        model,
        topology,
        exposureMode: "simple",
      }),
    )

    expect(html).toContain('data-testid="topology-simple-create-panel"')
    expect(html).toContain('data-testid="topology-simple-add-executor"')
    expect(html).toContain('data-testid="topology-simple-add-section"')
    for (const blockedLabel of TOPOLOGY_WORKSPACE_SIMPLE_BLOCKED_PALETTE_LABELS) {
      expect(html).not.toContain(`data-testid="enterprise-palette-create-${blockedLabel.toLowerCase()}"`)
    }
    expect(html).not.toContain('data-testid="enterprise-topology-palette"')
    expect(html).not.toContain('data-testid="enterprise-topology-compile-preview"')
    expect(html).not.toContain('data-testid="topology-run-target-panel"')
  })

  it("treats advanced canvas mode as the simple topology surface", () => {
    const topology = buildTopologyWorkspaceStarterDraft("customer-request-flow", { now })
    const model = buildEnterpriseTopologyCanvasModel(topology)
    const canvasHtml = renderToStaticMarkup(
      createElement(EnterpriseTopologyCanvasShell, {
        model,
        topology,
        exposureMode: "advanced",
      }),
    )

    expect(canvasHtml).toContain('data-testid="topology-simple-create-panel"')
    expect(canvasHtml).not.toContain('data-testid="enterprise-topology-palette"')
    expect(canvasHtml).not.toContain('data-testid="enterprise-palette-create-task"')
    expect(canvasHtml).not.toContain('data-testid="enterprise-topology-compile-preview"')
    expect(canvasHtml).not.toContain('data-testid="topology-run-target-panel"')
  })

  it("hides WorkOrder Template and Context from run UX even when advanced is requested", () => {
    const template = WORK_ORDER_TEMPLATE_CATALOG.templates[0]!
    const topology = buildTopologyWorkspaceStarterDraft("tool-assisted-flow", { now })
    const targetState = resolveTopologyRunTargetState({ topology })
    const simpleHtml = renderToStaticMarkup(
      createElement(TopologyRunLauncher, {
        exposureMode: "simple",
        templates: WORK_ORDER_TEMPLATE_CATALOG.templates,
        selectedTemplateId: template.templateId,
        selectedContextPresetId: template.contextPresets[0]!.id,
        simulationMode: template.defaultSimulationMode,
        advancedInstruction: "",
        runTargetNodeId: targetState.targetNodeId,
        targetState,
      }),
    )
    const advancedHtml = renderToStaticMarkup(
      createElement(TopologyRunLauncher, {
        exposureMode: "advanced",
        templates: WORK_ORDER_TEMPLATE_CATALOG.templates,
        selectedTemplateId: template.templateId,
        selectedContextPresetId: template.contextPresets[0]!.id,
        simulationMode: template.defaultSimulationMode,
        advancedInstruction: "",
        runTargetNodeId: targetState.targetNodeId,
        targetState,
      }),
    )

    expect(simpleHtml).toContain('data-testid="topology-run-simple-panel"')
    expect(simpleHtml).toContain('data-testid="topology-run-simple-input"')
    expect(simpleHtml).not.toContain('data-testid="topology-run-template-picker"')
    expect(simpleHtml).not.toContain('data-testid="topology-run-context-picker"')
    for (const advancedLabel of TOPOLOGY_WORKSPACE_ADVANCED_ONLY_LABELS.slice(0, 2)) {
      expect(simpleHtml).not.toContain(advancedLabel)
    }
    expect(advancedHtml).toContain('data-testid="topology-run-simple-panel"')
    expect(advancedHtml).not.toContain('data-testid="topology-run-template-picker"')
    expect(advancedHtml).not.toContain('data-testid="topology-run-context-picker"')
    expect(advancedHtml).not.toContain("WorkOrder Template")
    expect(advancedHtml).not.toContain("Context")
  })

  it("keeps the feature-flag fallback outside the simple workspace content", () => {
    process.env["NOBIE_ENTERPRISE_TOPOLOGY_BUILDER_UI"] = "off"
    useCapabilitiesStore.getState().setItems([disabledBuilderCapability()])
    const apiCapability = createCapabilities().find((item) => item.key === "enterprise_topology_builder_ui")
    const html = renderToStaticMarkup(
      createElement(
        FeatureGate,
        { capabilityKey: "enterprise_topology_builder_ui", title: "토폴로지" },
        createElement("div", null, "simple workspace content"),
      ),
    )

    expect(apiCapability).toEqual(expect.objectContaining({
      enabled: false,
      status: "disabled",
    }))
    expect(html).toContain("토폴로지")
    expect(html).toContain("기능 플래그")
    expect(html).not.toContain("simple workspace content")
  })
})
