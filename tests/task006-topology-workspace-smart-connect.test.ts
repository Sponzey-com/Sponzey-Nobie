import { createElement } from "../packages/webui/node_modules/react/index.js"
import { renderToStaticMarkup } from "../packages/webui/node_modules/react-dom/server.js"
import { describe, expect, it } from "vitest"
import {
  planTopologySmartConnect,
  recommendTopologySmartConnectRelation,
  TOPOLOGY_RELATION_TEMPLATE_CATALOG,
} from "../packages/core/src/topology/relation-templates.ts"
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
} from "../packages/webui/src/components/topology/RelationModeToolbar.tsx"
import { TOPOLOGY_TEMPLATE_CATALOG } from "../packages/core/src/topology/templates.ts"

const now = Date.UTC(2026, 3, 30, 18, 0, 0)

function topologyForSmartConnect() {
  const empty = createEmptyEnterpriseTopologyForPalette({ now })
  const task = createEnterpriseTopologyPaletteEntity(empty, { kind: "task", now }, TOPOLOGY_TEMPLATE_CATALOG)
  const secondTask = createEnterpriseTopologyPaletteEntity(task.topology, { kind: "task", now }, TOPOLOGY_TEMPLATE_CATALOG)
  const approval = createEnterpriseTopologyPaletteEntity(secondTask.topology, { kind: "approval", now }, TOPOLOGY_TEMPLATE_CATALOG)
  const tool = createEnterpriseTopologyPaletteEntity(approval.topology, { kind: "tool", now }, TOPOLOGY_TEMPLATE_CATALOG)
  const data = createEnterpriseTopologyPaletteEntity(tool.topology, { kind: "data", now }, TOPOLOGY_TEMPLATE_CATALOG)
  return createEnterpriseTopologyPaletteEntity(data.topology, { kind: "group", now }, TOPOLOGY_TEMPLATE_CATALOG).topology
}

describe("task006 topology workspace smart connect", () => {
  it("recommends easy Smart Connect modes from endpoint types", () => {
    const taskToTask = recommendTopologySmartConnectRelation({
      source: { entityType: "node", nodeType: "function" },
      target: { entityType: "node", nodeType: "function" },
      catalog: TOPOLOGY_RELATION_TEMPLATE_CATALOG,
    })
    const taskToApproval = recommendTopologySmartConnectRelation({
      source: { entityType: "node", nodeType: "function" },
      target: { entityType: "node", nodeType: "approval_node" },
      catalog: TOPOLOGY_RELATION_TEMPLATE_CATALOG,
    })
    const taskToTool = recommendTopologySmartConnectRelation({
      source: { entityType: "node", nodeType: "automation_node" },
      target: { entityType: "enterprise_tool" },
      catalog: TOPOLOGY_RELATION_TEMPLATE_CATALOG,
    })
    const taskToData = recommendTopologySmartConnectRelation({
      source: { entityType: "node", nodeType: "function" },
      target: { entityType: "enterprise_system" },
      catalog: TOPOLOGY_RELATION_TEMPLATE_CATALOG,
    })

    expect(taskToTask).toEqual(expect.objectContaining({
      easyMode: "next",
      relationType: "delegates_to",
      labelKo: "다음 업무로 연결",
    }))
    expect(taskToApproval).toEqual(expect.objectContaining({
      easyMode: "approve",
      relationType: "delegates_to",
      labelKo: "승인 단계로 연결",
    }))
    expect(taskToTool).toEqual(expect.objectContaining({
      easyMode: "use",
      relationType: "uses_tool",
      labelKo: "도구 사용으로 연결",
    }))
    expect(taskToData).toEqual(expect.objectContaining({
      easyMode: "use",
      relationType: "uses_system",
      labelKo: "시스템 사용으로 연결",
    }))
  })

  it("returns a blocked Smart Connect plan when no valid relation exists", () => {
    const plan = planTopologySmartConnect({
      source: { entityType: "enterprise_tool" },
      target: { entityType: "team" },
      catalog: TOPOLOGY_RELATION_TEMPLATE_CATALOG,
    })

    expect(plan.ok).toBe(false)
    if (plan.ok) throw new Error("expected blocked plan")
    expect(plan.issue).toEqual(expect.objectContaining({
      reasonCode: "no_valid_relation",
      sourceEntityType: "enterprise_tool",
      targetEntityType: "team",
    }))
  })

  it("creates Smart Connect edges without typing labels and blocks invalid explicit modes", () => {
    const topology = topologyForSmartConnect()
    const model = buildEnterpriseTopologyCanvasModel(topology)
    const tasks = model.nodes.filter((node) => node.data.kind === "task")
    const tool = model.nodes.find((node) => node.data.kind === "tool")!
    const smartTask = buildEnterpriseTopologyRelationDraft({
      topology,
      sourceNodeId: tasks[0]!.id,
      targetNodeId: tasks[1]!.id,
      relationMode: "smart_connect",
      catalog: FALLBACK_RELATION_TEMPLATE_CATALOG,
      now,
    })
    if (!smartTask.ok) throw new Error("expected smart task relation")

    expect(smartTask.relation).toEqual(expect.objectContaining({
      relationType: "delegates_to",
      label: "다음 업무로 연결",
      scope: expect.objectContaining({
        relationMode: "next",
        smartConnect: true,
      }),
    }))

    const invalid = buildEnterpriseTopologyRelationDraft({
      topology,
      sourceNodeId: tasks[0]!.id,
      targetNodeId: tool.id,
      relationMode: "delegate",
      catalog: FALLBACK_RELATION_TEMPLATE_CATALOG,
      now,
    })
    expect(invalid.ok).toBe(false)
    if (invalid.ok) throw new Error("expected invalid relation")
    expect(invalid.issue).toEqual(expect.objectContaining({
      reasonCode: "invalid_relation_endpoint",
      severity: "blocked",
      relationMode: "delegate",
    }))
    expect(invalid.issue.suggestedModes).toContain("use")
    expect(topology.relations).toHaveLength(0)
  })

  it("renders Smart Connect as the default relation mode with five easy relation choices", () => {
    const html = renderToStaticMarkup(
      createElement(RelationModeToolbar, {
        catalog: FALLBACK_RELATION_TEMPLATE_CATALOG,
        selectedRelationMode: "smart_connect",
      }),
    )

    expect(html).toContain('data-testid="relation-mode-smart-connect"')
    expect(html).toContain('data-testid="relation-mode-next"')
    expect(html).toContain('data-testid="relation-mode-delegate"')
    expect(html).toContain('data-testid="relation-mode-approve"')
    expect(html).toContain('data-testid="relation-mode-use"')
    expect(html).toContain('data-testid="relation-mode-report"')
    expect(html).toContain('data-testid="enterprise-relation-more-select"')
    expect(html).toContain("추천 연결")
    expect(html).toContain("Next와 Delegate")
  })
})
