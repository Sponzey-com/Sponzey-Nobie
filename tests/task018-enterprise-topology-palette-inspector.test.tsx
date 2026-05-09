import { createRequire } from "node:module"
import { readFileSync } from "node:fs"
import { createElement } from "../packages/webui/node_modules/react/index.js"
import { renderToStaticMarkup } from "../packages/webui/node_modules/react-dom/server.js"
import { describe, expect, it } from "vitest"
import { registerTopologyRoutes } from "../packages/core/src/api/routes/topologies.ts"
import {
  EnterpriseTopologyInspector,
} from "../packages/webui/src/components/topology/EnterpriseTopologyInspector.tsx"
import {
  EnterpriseTopologyPalette,
  ENTERPRISE_TOPOLOGY_PALETTE,
  createEmptyEnterpriseTopologyForPalette,
  createEnterpriseTopologyPaletteEntity,
  nextEnterpriseEntityName,
} from "../packages/webui/src/components/topology/EnterpriseTopologyPalette.tsx"
import type { EnterpriseTopologyCanvasNodeData } from "../packages/webui/src/components/topology/EnterpriseTopologyCanvas.tsx"

const require = createRequire(import.meta.url)
const Fastify = require("../packages/core/node_modules/fastify") as (options: {
  logger: boolean
}) => {
  ready(): Promise<void>
  close(): Promise<void>
  inject(options: {
    method: string
    url: string
    payload?: unknown
  }): Promise<{ statusCode: number; json(): any }>
}

const now = Date.UTC(2026, 3, 29, 10, 0, 0)

function selectedData(kind: EnterpriseTopologyCanvasNodeData["kind"]): EnterpriseTopologyCanvasNodeData {
  return {
    kind,
    label: kind === "team" ? "새 팀 1" : kind === "org_unit" ? "새 조직 1" : "새 업무 노드 1",
    detail: "draft",
    status: "draft",
    entityId: `${kind}:1`,
    entityType: kind,
  }
}

describe("task018 enterprise topology palette and inspector", () => {
  it("generates automatic entity names without typing", () => {
    expect(nextEnterpriseEntityName("work_node", [])).toBe("새 업무 노드 1")
    expect(nextEnterpriseEntityName("work_node", ["새 업무 노드 1", "새 업무 노드 2"])).toBe("새 업무 노드 3")
    expect(nextEnterpriseEntityName("org_unit", ["새 조직 1"])).toBe("새 조직 2")
    expect(nextEnterpriseEntityName("system", [])).toBe("새 시스템 1")
    expect(nextEnterpriseEntityName("tool", [])).toBe("새 도구 1")
  })

  it("loads the topology template catalog through the API and client method", async () => {
    const app = Fastify({ logger: false })
    registerTopologyRoutes(app)
    await app.ready()
    try {
      const response = await app.inject({ method: "GET", url: "/api/topology-templates" })
      const body = response.json()
      const clientSource = readFileSync(new URL("../packages/webui/src/api/client.ts", import.meta.url), "utf-8")

      expect(response.statusCode).toBe(200)
      expect(body.ok).toBe(true)
      expect(body.catalog.nodePresets.map((preset: { fixedRoleCatalog: boolean }) => preset.fixedRoleCatalog)).toEqual([
        false,
        false,
        false,
      ])
      expect(body.catalog.nodePresets.map((preset: { labelEn: string }) => preset.labelEn)).toContain("General work")
      expect(clientSource).toContain("topologyTemplates")
      expect(clientSource).toContain("/api/topology-templates")
    } finally {
      await app.close()
    }
  })

  it("creates node, team, org unit, system, and tool entities from palette defaults", () => {
    const empty = createEmptyEnterpriseTopologyForPalette({ now })
    const withNode = createEnterpriseTopologyPaletteEntity(empty, { kind: "work_node", now })
    const withTeam = createEnterpriseTopologyPaletteEntity(withNode.topology, { kind: "team", now })
    const withOrg = createEnterpriseTopologyPaletteEntity(withTeam.topology, { kind: "org_unit", now })
    const withSystem = createEnterpriseTopologyPaletteEntity(withOrg.topology, { kind: "system", now })
    const withTool = createEnterpriseTopologyPaletteEntity(withSystem.topology, { kind: "tool", now })

    expect(withNode.name).toBe("새 업무 노드 1")
    expect(withNode.topology.nodes[0]).toEqual(expect.objectContaining({
      name: "새 업무 노드 1",
      nodeType: "function",
      template: expect.objectContaining({ fixedRoleCatalog: false }),
    }))
    expect(withTeam.topology.teams[0]).toEqual(expect.objectContaining({
      name: "새 팀 1",
      purpose: "논리 업무 그룹",
    }))
    expect(withOrg.topology.orgUnits[0]).toEqual(expect.objectContaining({
      name: "새 조직 1",
      responsibilityArea: "조직 책임 영역",
    }))
    expect(withTool.topology.systems[0]?.name).toBe("새 시스템 1")
    expect(withTool.topology.tools[0]?.name).toBe("새 도구 1")
  })

  it("keeps MVP and advanced palette groups distinct", () => {
    const core = ENTERPRISE_TOPOLOGY_PALETTE.filter((item) => item.group === "core").map((item) => item.id)
    const advanced = ENTERPRISE_TOPOLOGY_PALETTE.filter((item) => item.group === "advanced").map((item) => item.id)

    expect(core).toEqual(["task", "decision", "approval", "tool", "data", "group"])
    expect(advanced).toEqual(["org_unit", "position", "person", "process", "authority", "responsibility"])
  })

  it("keeps the Work blocks heading out of the visible palette", () => {
    const html = renderToStaticMarkup(
      createElement(EnterpriseTopologyPalette, {
        items: ENTERPRISE_TOPOLOGY_PALETTE,
      }),
    )

    expect(html).toContain('data-testid="enterprise-topology-palette"')
    expect(html).not.toContain("업무 블록")
    expect(html).not.toContain("Work blocks")
  })

  it("does not show execution permission fields in the Team inspector", () => {
    const html = renderToStaticMarkup(
      createElement(EnterpriseTopologyInspector, {
        selectedData: selectedData("team"),
      }),
    )

    expect(html).toContain("팀 필드")
    expect(html).toContain("논리 그룹")
    expect(html).not.toContain("실행 권한")
    expect(html).not.toMatch(/permission scope/i)
  })

  it("shows organization-specific controls in the OrgUnit inspector", () => {
    const html = renderToStaticMarkup(
      createElement(EnterpriseTopologyInspector, {
        selectedData: selectedData("org_unit"),
      }),
    )

    expect(html).toContain("조직 필드")
    expect(html).toContain("책임 영역")
    expect(html).toContain("상위 조직")
  })

  it("keeps long instruction editing collapsed by default", () => {
    const html = renderToStaticMarkup(
      createElement(EnterpriseTopologyInspector, {
        selectedData: selectedData("work_node"),
      }),
    )

    expect(html).toContain('data-testid="enterprise-inspector-advanced-edit"')
    expect(html).toContain("고급 편집")
    expect(html).toContain("긴 instruction")
    expect(html).not.toContain("<details open")
  })
})
