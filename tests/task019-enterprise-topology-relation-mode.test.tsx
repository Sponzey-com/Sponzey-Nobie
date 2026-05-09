import { createRequire } from "node:module"
import { readFileSync } from "node:fs"
import { createElement } from "../packages/webui/node_modules/react/index.js"
import { renderToStaticMarkup } from "../packages/webui/node_modules/react-dom/server.js"
import { describe, expect, it } from "vitest"
import { registerTopologyRoutes } from "../packages/core/src/api/routes/topologies.ts"
import { TOPOLOGY_RELATION_ENDPOINT_RULES } from "../packages/core/src/topology/schema.ts"
import {
  buildEnterpriseTopologyCanvasModel,
} from "../packages/webui/src/components/topology/EnterpriseTopologyCanvas.tsx"
import {
  createEmptyEnterpriseTopologyForPalette,
  createEnterpriseTopologyPaletteEntity,
} from "../packages/webui/src/components/topology/EnterpriseTopologyPalette.tsx"
import {
  FALLBACK_RELATION_TEMPLATE_CATALOG,
  RelationModeToolbar,
  buildEnterpriseTopologyRelationDraft,
  splitRelationTemplateCatalog,
} from "../packages/webui/src/components/topology/RelationModeToolbar.tsx"

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

const now = Date.UTC(2026, 3, 30, 9, 0, 0)

function topologyWithCoreEntities() {
  const empty = createEmptyEnterpriseTopologyForPalette({ now })
  const nodeOne = createEnterpriseTopologyPaletteEntity(empty, { kind: "work_node", now })
  const nodeTwo = createEnterpriseTopologyPaletteEntity(nodeOne.topology, { kind: "work_node", now })
  const tool = createEnterpriseTopologyPaletteEntity(nodeTwo.topology, { kind: "tool", now })
  const positionOne = createEnterpriseTopologyPaletteEntity(tool.topology, { kind: "position", now })
  return createEnterpriseTopologyPaletteEntity(positionOne.topology, { kind: "position", now }).topology
}

describe("task019 enterprise topology relation mode", () => {
  it("creates relation edges from the selected relation mode without typing labels", () => {
    const topology = topologyWithCoreEntities()
    const model = buildEnterpriseTopologyCanvasModel(topology)
    const nodes = model.nodes.filter((node) => node.data.kind === "task")
    const result = buildEnterpriseTopologyRelationDraft({
      topology,
      sourceNodeId: nodes[0]!.id,
      targetNodeId: nodes[1]!.id,
      relationType: "delegates_to",
      catalog: FALLBACK_RELATION_TEMPLATE_CATALOG,
      now,
    })

    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error("expected relation draft")
    expect(result.relation).toEqual(expect.objectContaining({
      relationType: "delegates_to",
      label: "위임",
    }))
    expect(result.runtimeCandidate).toBe(true)
    expect(result.topology.relations).toHaveLength(1)
  })

  it("loads relation template catalog with the same endpoint matrix as the core validator", async () => {
    const app = Fastify({ logger: false })
    registerTopologyRoutes(app)
    await app.ready()
    try {
      const response = await app.inject({ method: "GET", url: "/api/relation-templates" })
      const body = response.json()
      const delegatesTo = body.catalog.presets.find((preset: { relationType: string }) => preset.relationType === "delegates_to")
      const primary = body.catalog.presets
        .filter((preset: { group: string }) => preset.group === "primary")
        .map((preset: { relationType: string }) => preset.relationType)
      const clientSource = readFileSync(new URL("../packages/webui/src/api/client.ts", import.meta.url), "utf-8")

      expect(response.statusCode).toBe(200)
      expect(body.ok).toBe(true)
      expect(primary).toEqual(["delegates_to", "reports_to", "approves", "uses_tool", "uses_system"])
      expect(delegatesTo.allowedPairs).toEqual(TOPOLOGY_RELATION_ENDPOINT_RULES.delegates_to.allowedPairs)
      expect(clientSource).toContain("relationTemplates")
      expect(clientSource).toContain("/api/relation-templates")
    } finally {
      await app.close()
    }
  })

  it("blocks invalid endpoints before saving and proposes alternative relation modes", () => {
    const topology = topologyWithCoreEntities()
    const model = buildEnterpriseTopologyCanvasModel(topology)
    const source = model.nodes.find((node) => node.data.kind === "task")!
    const target = model.nodes.find((node) => node.data.kind === "tool")!
    const result = buildEnterpriseTopologyRelationDraft({
      topology,
      sourceNodeId: source.id,
      targetNodeId: target.id,
      relationType: "delegates_to",
      catalog: FALLBACK_RELATION_TEMPLATE_CATALOG,
      now,
    })

    expect(result.ok).toBe(false)
    if (result.ok) throw new Error("expected blocked relation draft")
    expect(result.issue.reasonCode).toBe("invalid_relation_endpoint")
    expect(result.issue.suggestedRelationTypes).toContain("uses_tool")
    expect(result.issue.suggestedModes).toContain("use")
    expect(topology.relations).toHaveLength(0)
  })

  it("styles delegates_to as runtime path and keeps reports_to out of delegation style", () => {
    const topology = topologyWithCoreEntities()
    const model = buildEnterpriseTopologyCanvasModel(topology)
    const workNodes = model.nodes.filter((node) => node.data.kind === "task")
    const positions = model.nodes.filter((node) => node.data.kind === "position")
    const delegated = buildEnterpriseTopologyRelationDraft({
      topology,
      sourceNodeId: workNodes[0]!.id,
      targetNodeId: workNodes[1]!.id,
      relationType: "delegates_to",
      catalog: FALLBACK_RELATION_TEMPLATE_CATALOG,
      now,
    })
    if (!delegated.ok) throw new Error("expected delegation relation")
    const reported = buildEnterpriseTopologyRelationDraft({
      topology: delegated.topology,
      sourceNodeId: positions[0]!.id,
      targetNodeId: positions[1]!.id,
      relationType: "reports_to",
      catalog: FALLBACK_RELATION_TEMPLATE_CATALOG,
      now,
    })
    if (!reported.ok) throw new Error("expected reporting relation")

    const styled = buildEnterpriseTopologyCanvasModel(reported.topology, [], FALLBACK_RELATION_TEMPLATE_CATALOG)
    const runtimeEdge = styled.edges.find((edge) => edge.data?.relationType === "delegates_to")
    const reportEdge = styled.edges.find((edge) => edge.data?.relationType === "reports_to")

    expect(runtimeEdge).toEqual(expect.objectContaining({
      animated: true,
      className: "enterprise-relation-runtime-path",
    }))
    expect(runtimeEdge?.data?.runtimeCandidate).toBe(true)
    expect(reportEdge?.animated).not.toBe(true)
    expect(reportEdge?.className).toBe("enterprise-relation-analysis")
    expect(reportEdge?.data?.runtimeCandidate).toBe(false)
  })

  it("renders primary relation modes and keeps less common modes in the more selector", () => {
    const groups = splitRelationTemplateCatalog(FALLBACK_RELATION_TEMPLATE_CATALOG)
    const html = renderToStaticMarkup(
      createElement(RelationModeToolbar, {
        catalog: FALLBACK_RELATION_TEMPLATE_CATALOG,
        selectedRelationType: "owns",
      }),
    )

    expect(groups.primary.map((preset) => preset.relationType)).toEqual([
      "delegates_to",
      "reports_to",
      "approves",
      "uses_tool",
      "uses_system",
    ])
    expect(groups.more.map((preset) => preset.relationType)).toContain("owns")
    expect(html).toContain('data-testid="enterprise-relation-mode-toolbar"')
    expect(html).toContain('data-testid="relation-mode-smart-connect"')
    expect(html).toContain('data-testid="relation-mode-next"')
    expect(html).toContain('data-testid="relation-mode-delegate"')
    expect(html).toContain('data-testid="enterprise-relation-more-select"')
    expect(html).toContain('data-testid="relation-mode-compile-note"')
    expect(html).toContain("소유")
  })
})
