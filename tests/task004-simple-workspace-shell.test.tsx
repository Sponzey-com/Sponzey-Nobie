import { createElement } from "../packages/webui/node_modules/react/index.js"
import { renderToStaticMarkup } from "../packages/webui/node_modules/react-dom/server.js"
import { readFileSync } from "node:fs"
import { afterEach, describe, expect, it } from "vitest"
import { FeatureGate } from "../packages/webui/src/components/FeatureGate.tsx"
import { ExecutorWorkspaceShell } from "../packages/webui/src/components/topology/ExecutorWorkspaceShell.tsx"
import { TopologyWorkspaceFirstStartPanel } from "../packages/webui/src/components/topology/TopologyWorkspaceFirstStart.tsx"
import { LegacyEnterpriseTopologyPage, shouldRestoreServerTopology } from "../packages/webui/src/pages/EnterpriseTopologyPage.tsx"
import { TopologyWorkspaceRouteShell } from "../packages/webui/src/pages/TopologyWorkspacePage.tsx"
import { TOPOLOGY_WORKSPACE_STARTER_TEMPLATES } from "../packages/webui/src/lib/topology-workspace-templates.ts"
import { resolveLegacyAdvancedRoute } from "../packages/webui/src/lib/ui-mode.js"
import { useCapabilitiesStore } from "../packages/webui/src/stores/capabilities"
import type { EnterpriseTopology } from "../packages/webui/src/contracts/enterprise-topology.ts"

afterEach(() => {
  useCapabilitiesStore.getState().setItems([])
})

describe("task004 simple workspace shell", () => {
  it("restores a newer saved server draft instead of keeping an empty stale screen state", () => {
    const emptyCurrent = topologyForRestoreTest("workspace:draft", [], 100)
    const savedWithNodes = topologyForRestoreTest("workspace:draft", ["node:executor-1"], 200)
    const newerLocalEdit = topologyForRestoreTest("workspace:draft", ["node:local"], 300)

    expect(shouldRestoreServerTopology(null, savedWithNodes)).toBe(true)
    expect(shouldRestoreServerTopology(emptyCurrent, savedWithNodes)).toBe(true)
    expect(shouldRestoreServerTopology(newerLocalEdit, savedWithNodes)).toBe(false)
    expect(shouldRestoreServerTopology(topologyForRestoreTest("other", [], 300), savedWithNodes)).toBe(true)
  })

  it("uses the server draft API and DB-backed save instead of browser draft storage", () => {
    const pageSource = readFileSync("packages/webui/src/pages/EnterpriseTopologyPage.tsx", "utf8")
    const clientSource = readFileSync("packages/webui/src/api/client.ts", "utf8")
    const serverSource = readFileSync("packages/core/src/api/server.ts", "utf8")

    expect(pageSource).toContain("api.enterpriseTopologyGuiDraft(topologyId)")
    expect(pageSource).toContain("persist: true")
    expect(pageSource).toContain('importSource: "enterprise_topology_simple_builder"')
    expect(pageSource).not.toContain("readStoredEnterpriseTopologyDraft")
    expect(pageSource).not.toContain("writeStoredEnterpriseTopologyDraft")
    expect(pageSource).not.toContain("nobie_topology_workspace_draft")
    expect(clientSource).toContain("enterpriseTopologyGuiDraft: (topologyId: string)")
    expect(clientSource).toContain("/gui-draft")
    expect(serverSource.indexOf("registerTopologyRoutes(server)")).toBeLessThan(
      serverSource.indexOf("server.register(staticPlugin"),
    )
    expect(serverSource).toContain('url === "/api" || url.startsWith("/api/")')
  })

  it("locks the app root to the browser viewport instead of letting body scroll", () => {
    const css = readFileSync("packages/webui/src/index.css", "utf8")
    const layoutSource = readFileSync("packages/webui/src/components/Layout.tsx", "utf8")

    expect(css).toContain("html,\nbody,\n#root")
    expect(css).toContain("height: 100%")
    expect(css).toContain("overflow: hidden")
    expect(layoutSource).toContain("flex h-screen overflow-hidden")
  })

  it("keeps DB save available while background validation is syncing", () => {
    const html = renderToStaticMarkup(
      createElement(
        ExecutorWorkspaceShell,
        {
          selectedLayer: "build",
          validationLabel: "동기화 중",
          executorCount: 1,
          connectionCount: 0,
          validateDisabled: true,
          saveDisabled: false,
          onSaveDraft: () => undefined,
        },
        createElement("div", null, "workspace canvas"),
      ),
    )

    const saveButton = html.match(/<button[^>]+data-testid="executor-workspace-top-save"[^>]*>/)?.[0] ?? ""
    expect(saveButton).toContain('data-testid="executor-workspace-top-save"')
    expect(saveButton).not.toMatch(/\sdisabled(=| |>)/)
  })

  it("renders an executor-first top bar and left rail without advanced controls", () => {
    const html = renderToStaticMarkup(
      createElement(
        ExecutorWorkspaceShell,
        {
          selectedLayer: "build",
          validationLabel: "검증 대기",
          executorCount: 0,
          connectionCount: 0,
        },
        createElement("div", null, "workspace canvas"),
      ),
    )

    expect(html).toContain('data-testid="executor-workspace-shell"')
    expect(html).toContain('data-testid="executor-workspace-topbar"')
    expect(html).toContain('data-testid="executor-workspace-left-rail"')
    expect(html).toContain('data-testid="executor-workspace-main"')
    expect(html).toContain("grid min-h-0 flex-1 overflow-hidden")
    expect(html).toContain("overflow-y-auto")
    expect(html).toContain("overscroll-contain")
    expect(html).toContain("pb-4")
    expect(html).toContain("md:overflow-hidden")
    expect(html).toContain("md:pb-0")
    expect(html).not.toContain("pb-20")
    expect(html).not.toContain("md:pb-16")
    expect(html).toContain("업무 흐름 만들기")
    expect(html).toContain("실행자를 추가하고 노드끼리는 선으로 바로 연결하세요.")
    expect(html).toContain("1. 실행자 추가")
    expect(html).toContain("2. 노드끼리 연결")
    expect(html).toContain("3. 요청이 오면 자동 실행")
    expect(html).toContain('data-testid="executor-workspace-top-add-executor"')
    expect(html).toContain('data-testid="executor-workspace-top-delete-executor"')
    expect(html).toContain('data-testid="executor-workspace-top-save"')
    expect(html).not.toContain('data-testid="executor-workspace-advanced-entry"')
    expect(html).not.toContain("?ux=advanced")
    expect(html).not.toContain('data-testid="executor-workspace-top-connect-executor"')
    expect(html).toContain("노드 추가")
    expect(html).toContain("삭제")
    expect(html).toContain("저장")
    expect(html).not.toContain("자동 점검")
    expect(html).not.toContain("실행하기")
    expect(html).not.toContain("저장됨")
    expect(html.indexOf('data-testid="executor-workspace-add-executor"')).toBeLessThan(
      html.indexOf('data-testid="executor-workspace-add-section"'),
    )
    expect(html).toContain("+ 실행자 추가")
    expect(html).toContain("+ 영역 추가")
    expect(html).toContain("실행자 목록")
    expect(html).toContain("추천 실행자")
    expect(html).toContain("고객 접수 담당자")
    expect(html).not.toContain('data-testid="executor-workspace-layer-build"')
    expect(html).not.toContain('data-testid="executor-workspace-layer-run"')
    expect(html).not.toContain('data-testid="executor-workspace-layer-trace"')
    expect(html).not.toContain('data-testid="executor-workspace-layer-improve"')
    expect(html).not.toContain("WorkOrder Template")
    expect(html).not.toContain("Context")
    expect(html).not.toContain("Compile Preview")
    expect(html).not.toContain("JSON/YAML")
    expect(html).not.toContain("Task")
    expect(html).not.toContain("Decision")
    expect(html).not.toContain("Approval")
    expect(html).not.toContain("Tool")
    expect(html).not.toContain("Data")
    expect(html).not.toContain("Group")
  })

  it("uses the simple shell for the default enterprise topology workspace surface", () => {
    const html = renderToStaticMarkup(
      createElement(LegacyEnterpriseTopologyPage, {
        workspaceLayer: "build",
        workspaceExposureMode: "simple",
      }),
    )

    expect(html).toContain('data-testid="executor-workspace-shell"')
    expect(html).toContain("업무 흐름 만들기")
    expect(html).toContain("flex min-h-0 flex-1 overflow-hidden")
    expect(html).toContain('data-testid="executor-workspace-guide-steps"')
    expect(html).toContain('data-testid="executor-create-panel"')
    expect(html).toContain('data-testid="executor-create-name"')
    expect(html).toContain('data-testid="executor-create-description"')
    expect(html).toContain('data-testid="executor-create-waiting-understanding"')
    expect(html).toContain('data-testid="topology-workspace-simple-executor-layout"')
    expect(html).toContain("md:grid-cols-[minmax(0,1fr)_340px]")
    expect(html).toContain("md:overflow-hidden")
    expect(html).toContain("scroll-pb-4")
    expect(html).not.toContain("pb-24")
    expect(html).not.toContain("md:pb-20")
    expect(html).toContain('data-testid="executor-graph-canvas"')
    expect(html).toContain('data-testid="executor-graph-empty-canvas"')
    expect(html).toContain('data-testid="topology-workspace-simple-sidebar"')
    expect(html).toContain("md:h-full")
    expect(html).toContain("overflow-y-auto")
    expect(html).toContain("overscroll-contain")
    expect(html).toContain("pb-4")
    expect(html).toContain("md:pb-0")
    expect(html).toContain('data-testid="topology-workspace-simple-node-card"')
    expect(html).toContain('data-testid="executor-workspace-top-add-executor"')
    expect(html).toContain('data-testid="executor-workspace-top-delete-executor"')
    expect(html).toContain('data-testid="executor-workspace-top-save"')
    expect(html).not.toContain('data-testid="executor-workspace-top-connect-executor"')
    expect(html).not.toContain('data-testid="topology-workspace-simple-test-card"')
    expect(html).not.toContain('data-testid="topology-run-simple-panel"')
    expect(html).not.toContain("요청 흐름")
    expect(html).toContain("실행자 이름과 성격 정하기")
    expect(html).toContain("성격과 하는 일")
    expect(html).toContain("실행자를 추가하면 여기에 업무 흐름이 표시됩니다.")
    expect(html).not.toContain("추천 흐름으로 시작")
    expect(html).not.toContain("추천 흐름 보기")
    expect(html).not.toContain('data-testid="executor-workspace-left-rail"')
    expect(html).not.toContain('data-testid="executor-workspace-layer-build"')
    expect(html).not.toContain('data-testid="executor-workspace-layer-run"')
    expect(html).not.toContain('data-testid="executor-workspace-layer-trace"')
    expect(html).not.toContain('data-testid="executor-workspace-layer-improve"')
    expect(html).not.toContain('data-testid="executor-workspace-layer-resources"')
    expect(html).not.toContain('data-testid="topology-workspace-simple-inspector"')
    expect(html).not.toContain('data-testid="topology-simple-create-panel"')
    expect(html).not.toContain("WorkOrder Template")
    expect(html).not.toContain("Compile Preview")
  })

  it("keeps the first screen action-led and moves templates behind a recommended-flow action", () => {
    const html = renderToStaticMarkup(
      createElement(TopologyWorkspaceFirstStartPanel, {
        templates: TOPOLOGY_WORKSPACE_STARTER_TEMPLATES,
      }),
    )

    expect(html).toContain('data-testid="topology-workspace-add-first-step"')
    expect(html).toContain('data-testid="topology-workspace-start-recommended-flow"')
    expect(html).toContain('data-testid="topology-workspace-template-gallery"')
    expect(html).toContain("첫 실행자 추가")
    expect(html).toContain("추천 흐름으로 시작")
    expect(html).toContain("고객 접수 담당자")
    expect(html).toContain("고객 요청 처리 흐름")
    expect(html).not.toContain("WorkOrder Template")
  })

  it("keeps compatibility routes on the simple workspace surface", () => {
    const advancedHtml = renderToStaticMarkup(
      createElement(
        TopologyWorkspaceRouteShell,
        { initialLayer: "resources", exposureMode: "advanced" },
        createElement("div", null, "simple workspace"),
      ),
    )
    const fallbackHtml = renderToStaticMarkup(
      createElement(
        FeatureGate,
        { capabilityKey: "enterprise_topology_builder_ui", title: "토폴로지" },
        createElement("div", null, "simple workspace content"),
      ),
    )

    expect(advancedHtml).toContain('data-testid="topology-workspace-layer-build"')
    expect(advancedHtml).not.toContain('data-testid="topology-workspace-layer-resources"')
    expect(advancedHtml).toContain("업무 흐름 만들기")
    expect(advancedHtml).not.toContain("Topology Workspace")
    expect(resolveLegacyAdvancedRoute("/enterprise-topology")).toBe("/advanced/topology")
    expect(fallbackHtml).toContain("관리자 설정")
    expect(fallbackHtml).toContain("실행자 그래프")
    expect(fallbackHtml).not.toContain("simple workspace content")
  })
})

function topologyForRestoreTest(id: string, nodeIds: string[], updatedAt: number): EnterpriseTopology {
  return {
    id,
    updatedAt,
    nodes: nodeIds.map((nodeId) => ({ id: nodeId })),
  } as unknown as EnterpriseTopology
}
