import { createElement } from "../packages/webui/node_modules/react/index.js"
import { renderToStaticMarkup } from "../packages/webui/node_modules/react-dom/server.js"
import { describe, expect, it } from "vitest"
import {
  buildTopologyFlowTemplateDraft,
  compileTopology,
  TOPOLOGY_TEMPLATE_CATALOG,
  validateTopology,
} from "../packages/core/src/index.ts"
import {
  EnterpriseTopologyPalette,
  ENTERPRISE_TOPOLOGY_PALETTE,
  createEmptyEnterpriseTopologyForPalette,
  createEnterpriseTopologyPaletteEntity,
} from "../packages/webui/src/components/topology/EnterpriseTopologyPalette.tsx"
import {
  TOPOLOGY_WORKSPACE_STARTER_TEMPLATES,
  buildTopologyWorkspaceStarterDraft,
} from "../packages/webui/src/lib/topology-workspace-templates.ts"

const now = Date.UTC(2026, 3, 30, 17, 0, 0)

describe("task005 topology workspace palette and templates", () => {
  it("shows only six beginner blocks by default and keeps advanced entities collapsed", () => {
    const core = ENTERPRISE_TOPOLOGY_PALETTE.filter((item) => item.group === "core")
    const advanced = ENTERPRISE_TOPOLOGY_PALETTE.filter((item) => item.group === "advanced")
    const html = renderToStaticMarkup(
      createElement(EnterpriseTopologyPalette, {
        templateCatalog: TOPOLOGY_TEMPLATE_CATALOG,
      }),
    )

    expect(core.map((item) => item.id)).toEqual(["task", "decision", "approval", "tool", "data", "group"])
    expect(core.map((item) => item.labelEn)).toEqual(["Task", "Decision", "Approval", "Tool", "Data", "Group"])
    expect(advanced.map((item) => item.id)).toEqual(["org_unit", "position", "person", "process", "authority", "responsibility"])
    expect(html).toContain('data-testid="enterprise-palette-create-task"')
    expect(html).toContain('data-testid="enterprise-palette-create-group"')
    expect(html).toContain('data-testid="enterprise-palette-advanced"')
    expect(html).not.toContain('data-testid="enterprise-palette-advanced" open')
    expect(html).not.toContain("필수 입력")
  })

  it("creates Task, Approval, Tool, Data, and Group without free-form names", () => {
    const empty = createEmptyEnterpriseTopologyForPalette({ now })
    const taskOne = createEnterpriseTopologyPaletteEntity(empty, { kind: "task", now }, TOPOLOGY_TEMPLATE_CATALOG)
    const taskTwo = createEnterpriseTopologyPaletteEntity(taskOne.topology, { kind: "task", now }, TOPOLOGY_TEMPLATE_CATALOG)
    const approval = createEnterpriseTopologyPaletteEntity(taskTwo.topology, { kind: "approval", now }, TOPOLOGY_TEMPLATE_CATALOG)
    const tool = createEnterpriseTopologyPaletteEntity(approval.topology, { kind: "tool", now }, TOPOLOGY_TEMPLATE_CATALOG)
    const data = createEnterpriseTopologyPaletteEntity(tool.topology, { kind: "data", now }, TOPOLOGY_TEMPLATE_CATALOG)
    const group = createEnterpriseTopologyPaletteEntity(data.topology, { kind: "group", now }, TOPOLOGY_TEMPLATE_CATALOG)

    expect([taskOne.name, taskTwo.name, approval.name]).toEqual(["새 업무 1", "새 업무 2", "새 승인 1"])
    expect(taskTwo.topology.nodes.map((node) => node.name)).toEqual(["새 업무 1", "새 업무 2"])
    expect(approval.topology.nodes.at(-1)).toEqual(expect.objectContaining({
      nodeType: "approval_node",
      template: expect.objectContaining({
        metadata: expect.objectContaining({
          successCriteria: ["승인 기준 확인", "승인 여부 기록"],
          outputPreset: "concise_result_summary",
        }),
      }),
    }))
    expect(tool.topology.tools.at(-1)).toEqual(expect.objectContaining({
      name: "새 도구 1",
      toolType: "read_only",
    }))
    expect(data.topology.systems.at(-1)).toEqual(expect.objectContaining({
      name: "새 데이터 1",
      systemType: "data_store",
    }))
    expect(group.topology.teams.at(-1)).toEqual(expect.objectContaining({
      name: "새 그룹 1",
      purpose: "업무 흐름 그룹",
    }))
  })

  it("keeps core flow template catalog executable and tied to default WorkOrder choices", () => {
    expect(TOPOLOGY_TEMPLATE_CATALOG.flowTemplates.map((template) => template.id)).toEqual([
      "customer-request-flow",
      "approval-request-flow",
      "research-review-flow",
      "tool-assisted-flow",
      "escalation-flow",
      "blank-graph",
    ])
    expect(TOPOLOGY_TEMPLATE_CATALOG.flowTemplates.every((template) => template.noTypingRequired)).toBe(true)

    for (const template of TOPOLOGY_TEMPLATE_CATALOG.flowTemplates) {
      const topology = buildTopologyFlowTemplateDraft(template.id, {
        topologyId: `topology:${template.id}`,
        now,
      })
      const validation = validateTopology(topology)
      const compiled = compileTopology(topology)

      expect(topology.metadata).toEqual(expect.objectContaining({
        flowTemplateId: template.id,
        defaultWorkOrderTemplateId: template.defaultWorkOrderTemplateId,
        defaultContextPresetId: template.defaultContextPresetId,
      }))
      expect(validation.issueCounts.blocked).toBe(0)
      expect(validation.issueCounts.invalid).toBe(0)
      expect(compiled.ok).toBe(true)
      if (template.id !== "blank-graph") {
        expect(topology.nodes.every((node) => Array.isArray(node.template?.metadata?.successCriteria))).toBe(true)
        expect(topology.responsibilities).toHaveLength(topology.nodes.length)
        if (compiled.ok) {
          expect(compiled.snapshot.runtimeExecutionContext.entryNodeId).toBeNull()
          expect(compiled.snapshot.runtimeExecutionContext.rootChildNodeIds).toContain(topology.nodes[0]?.id)
        }
      }
    }
  })

  it("builds WebUI starter flows that compile without blocking validation errors", () => {
    expect(TOPOLOGY_WORKSPACE_STARTER_TEMPLATES.map((template) => template.defaultWorkOrderTemplateId)).toEqual([
      "work-order-template:customer-request-triage",
      "work-order-template:customer-request-triage",
      "work-order-template:customer-request-triage",
      "work-order-template:customer-request-triage",
      "work-order-template:failure-drill",
      "work-order-template:customer-request-triage",
    ])

    const approval = buildTopologyWorkspaceStarterDraft("approval-request-flow", {
      topologyId: "topology:webui-approval",
      now,
    })
    const validation = validateTopology(approval)
    const compiled = compileTopology(approval)

    expect(approval.relations.map((relation) => relation.relationType)).toEqual([
      "delegates_to",
      "approves",
      "informs",
    ])
    expect(validation.issueCounts.blocked).toBe(0)
    expect(validation.issueCounts.invalid).toBe(0)
    expect(compiled.ok).toBe(true)
  })
})
