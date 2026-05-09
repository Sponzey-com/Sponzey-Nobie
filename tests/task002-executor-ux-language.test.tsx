import { createElement } from "../packages/webui/node_modules/react/index.js"
import { renderToStaticMarkup } from "../packages/webui/node_modules/react-dom/server.js"
import { afterEach, describe, expect, it } from "vitest"
import { FeatureGate } from "../packages/webui/src/components/FeatureGate.tsx"
import { TopologyWorkspaceFirstStartPanel } from "../packages/webui/src/components/topology/TopologyWorkspaceFirstStart.tsx"
import {
  TOPOLOGY_WORKSPACE_ADVANCED_COPY_SURFACE,
  TOPOLOGY_WORKSPACE_ADVANCED_ONLY_LABELS,
  TOPOLOGY_WORKSPACE_BEGINNER_COPY_SURFACE,
  TOPOLOGY_WORKSPACE_FEATURE_FALLBACK_COPY,
  TOPOLOGY_WORKSPACE_INTERNAL_TERMS,
  TOPOLOGY_WORKSPACE_SIMPLE_CONCEPTS,
  containsInternalTopologyTerm,
  isTopologyWorkspaceSectionVisible,
  topologyWorkspaceVisibleSections,
} from "../packages/webui/src/lib/topology-workspace-copy.ts"
import { TOPOLOGY_WORKSPACE_STARTER_TEMPLATES } from "../packages/webui/src/lib/topology-workspace-templates.ts"
import { TopologyWorkspaceRouteShell } from "../packages/webui/src/pages/TopologyWorkspacePage.tsx"
import { useCapabilitiesStore } from "../packages/webui/src/stores/capabilities"

afterEach(() => {
  useCapabilitiesStore.getState().setItems([])
})

describe("task002 executor-first UX language", () => {
  it("keeps the beginner copy surface centered on executor graph concepts", () => {
    expect(TOPOLOGY_WORKSPACE_SIMPLE_CONCEPTS).toEqual([
      "실행자",
      "연결",
      "입력",
      "실행",
      "기록",
      "고칠 점",
    ])

    const beginnerSurface = JSON.stringify(TOPOLOGY_WORKSPACE_BEGINNER_COPY_SURFACE)
    for (const concept of TOPOLOGY_WORKSPACE_SIMPLE_CONCEPTS) {
      expect(beginnerSurface).toContain(concept)
    }
    expect(beginnerSurface).not.toContain("업무유형")
    expect(beginnerSurface).not.toContain("업무 유형")
    expect(beginnerSurface).not.toContain("WorkOrder Template")
    expect(beginnerSurface).not.toContain("Context Preset")
    expect(beginnerSurface).not.toContain("Resources")
    expect(containsInternalTopologyTerm(beginnerSurface)).toBe(false)
    for (const hiddenTerm of TOPOLOGY_WORKSPACE_INTERNAL_TERMS) {
      expect(beginnerSurface).not.toContain(hiddenTerm)
    }
  })

  it("keeps only simple topology sections visible in reusable helpers", () => {
    expect(isTopologyWorkspaceSectionVisible("simple", "simpleCreatePanel")).toBe(true)
    expect(isTopologyWorkspaceSectionVisible("simple", "runInput")).toBe(true)
    expect(isTopologyWorkspaceSectionVisible("simple", "advancedPalette")).toBe(false)
    expect(isTopologyWorkspaceSectionVisible("simple", "runTemplatePicker")).toBe(false)
    expect(isTopologyWorkspaceSectionVisible("simple", "contextPicker")).toBe(false)
    expect(isTopologyWorkspaceSectionVisible("simple", "compilePreview")).toBe(false)
    expect(isTopologyWorkspaceSectionVisible("simple", "resourcesLayer")).toBe(false)

    expect(isTopologyWorkspaceSectionVisible("advanced", "advancedPalette")).toBe(false)
    expect(isTopologyWorkspaceSectionVisible("advanced", "runTemplatePicker")).toBe(false)
    expect(isTopologyWorkspaceSectionVisible("advanced", "contextPicker")).toBe(false)
    expect(isTopologyWorkspaceSectionVisible("advanced", "compilePreview")).toBe(false)
    expect(isTopologyWorkspaceSectionVisible("advanced", "resourcesLayer")).toBe(false)
    expect(isTopologyWorkspaceSectionVisible("advanced", "featureFlagStatus")).toBe(false)
    expect(isTopologyWorkspaceSectionVisible("developer", "featureFlagStatus")).toBe(false)

    expect(topologyWorkspaceVisibleSections("simple").map((item) => item.section)).toEqual([
      "simpleCreatePanel",
      "runInput",
    ])
    expect(topologyWorkspaceVisibleSections("advanced")).toEqual([])
    expect(topologyWorkspaceVisibleSections("developer")).toEqual([])
  })

  it("keeps advanced-only terms out of both beginner and removed advanced copy surfaces", () => {
    const beginnerSurface = JSON.stringify(TOPOLOGY_WORKSPACE_BEGINNER_COPY_SURFACE)
    const advancedSurface = JSON.stringify(TOPOLOGY_WORKSPACE_ADVANCED_COPY_SURFACE)

    for (const advancedLabel of TOPOLOGY_WORKSPACE_ADVANCED_ONLY_LABELS) {
      expect(beginnerSurface).not.toContain(advancedLabel)
      expect(advancedSurface).not.toContain(advancedLabel)
    }
    expect(TOPOLOGY_WORKSPACE_ADVANCED_COPY_SURFACE).toEqual({ layers: [], sections: [] })
  })

  it("renders the simple workspace title and first-start action with executor language", () => {
    const shellHtml = renderToStaticMarkup(
      createElement(
        TopologyWorkspaceRouteShell,
        { initialLayer: "build", exposureMode: "simple" },
        createElement("div", null, "workspace body"),
      ),
    )
    const firstStartHtml = renderToStaticMarkup(
      createElement(TopologyWorkspaceFirstStartPanel, {
        templates: TOPOLOGY_WORKSPACE_STARTER_TEMPLATES,
      }),
    )

    expect(shellHtml).toContain("업무 흐름 만들기")
    expect(shellHtml).not.toContain("Topology Workspace")
    expect(firstStartHtml).toContain("첫 실행자 추가")
    expect(firstStartHtml).toContain("실행자 예시")
    expect(firstStartHtml).not.toContain("업무유형")
    expect(firstStartHtml).not.toContain("WorkOrder Template")
  })

  it("uses a concrete administrator action in the topology feature fallback copy", () => {
    const html = renderToStaticMarkup(
      createElement(
        FeatureGate,
        { capabilityKey: "enterprise_topology_builder_ui", title: "토폴로지" },
        createElement("div", null, "workspace route content"),
      ),
    )

    expect(TOPOLOGY_WORKSPACE_FEATURE_FALLBACK_COPY.disabledReasonKo).toContain("관리자")
    expect(TOPOLOGY_WORKSPACE_FEATURE_FALLBACK_COPY.disabledReasonKo).toContain("기능 플래그")
    expect(TOPOLOGY_WORKSPACE_FEATURE_FALLBACK_COPY.disabledReasonKo).toContain("실행자 그래프")
    expect(html).toContain("토폴로지")
    expect(html).toContain("관리자 설정")
    expect(html).toContain("실행자 그래프")
    expect(html).not.toContain("workspace route content")
  })
})
