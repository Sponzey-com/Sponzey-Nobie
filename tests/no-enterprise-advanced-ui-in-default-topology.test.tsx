import { createElement } from "../packages/webui/node_modules/react/index.js"
import { renderToStaticMarkup } from "../packages/webui/node_modules/react-dom/server.js"
import { MemoryRouter } from "../packages/webui/node_modules/react-router-dom/dist/index.mjs"
import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import { TopologyWorkspacePage } from "../packages/webui/src/pages/TopologyWorkspacePage.tsx"

describe("default topology screen excludes enterprise advanced UI", () => {
  it("does not depend on the old EnterpriseTopologyPage or advanced/manual-run widgets", () => {
    const source = readFileSync("packages/webui/src/pages/TopologyWorkspacePage.tsx", "utf8")

    expect(source).not.toContain("EnterpriseTopologyPage")
    expect(source).not.toContain("EnterpriseTopologyPalette")
    expect(source).not.toContain("EnterpriseTopologyInspector")
    expect(source).not.toContain("RelationModeToolbar")
    expect(source).not.toContain("TopologyCompilePreview")
    expect(source).not.toContain("TopologyRunLauncher")
    expect(source).not.toContain("WorkOrder Template")
    expect(source).not.toContain("Context")
  })

  it("keeps the V1 page behind a legacy name and out of the route tree", () => {
    const appSource = readFileSync("packages/webui/src/App.tsx", "utf8")
    const legacyPageSource = readFileSync("packages/webui/src/pages/EnterpriseTopologyPage.tsx", "utf8")

    expect(appSource).not.toContain("EnterpriseTopologyPage")
    expect(appSource).toContain("TopologyWorkspacePage")
    expect(appSource).toContain('path="/advanced/enterprise-topology"')
    expect(appSource).toContain('<Navigate to="/advanced/topology?mode=build" replace />')
    expect(legacyPageSource).toContain("export function LegacyEnterpriseTopologyPage")
    expect(legacyPageSource).not.toContain("export const EnterpriseTopologyPage")
  })

  it("renders only executor graph controls on the default topology page", () => {
    const html = renderToStaticMarkup(
      createElement(
        MemoryRouter,
        { initialEntries: ["/topology"] },
        createElement(TopologyWorkspacePage),
      ),
    )

    expect(html).toContain('data-testid="executor-workspace-shell"')
    expect(html).toContain('data-testid="topology-v2-workspace"')
    expect(html).toContain("grid h-full min-h-0")
    expect(html).toContain("overflow-hidden")
    expect(html).toContain("md:grid-cols-[minmax(0,1fr)_360px]")
    expect(html).toContain('data-testid="executor-graph-canvas"')
    expect(html).toContain('data-testid="topology-v2-sidebar"')
    expect(html).toContain("overflow-y-auto")
    expect(html).toContain("overscroll-contain")
    expect(html).toContain('data-testid="executor-workspace-top-add-executor"')
    expect(html).toContain('data-testid="executor-workspace-top-delete-executor"')
    expect(html).toContain('data-testid="executor-workspace-top-save"')
    expect(html).toContain('data-testid="executor-workspace-top-auto-layout"')
    expect(html).toContain("노드 추가")
    expect(html).toContain("삭제")
    expect(html).toContain("저장")
    expect(html).toContain("자동 정렬")
    expect(html).not.toContain('data-testid="executor-workspace-left-rail"')
    expect(html).not.toContain("팀")
    expect(html).not.toContain("조직")
    expect(html).not.toContain("직책")
    expect(html).not.toContain("사람")
    expect(html).not.toContain("권한")
    expect(html).not.toContain("책임")
    expect(html).not.toContain("프로세스")
    expect(html).not.toContain("WorkOrder Template")
    expect(html).not.toContain("Manual Run")
    expect(html).not.toContain("Compile Preview")
    expect(html).not.toContain("고급 설정")
    expect(html).not.toContain("사람 확인 필요")
    expect(html).not.toContain("수정할래요")
    expect(html).not.toContain("맞아요")
  })
})
