import { createElement } from "../packages/webui/node_modules/react/index.js"
import { renderToStaticMarkup } from "../packages/webui/node_modules/react-dom/server.js"
import { describe, expect, it } from "vitest"
import { TOPOLOGY_TEMPLATE_CATALOG } from "../packages/core/src/index.ts"
import type { NodeContract } from "../packages/webui/src/contracts/enterprise-topology.ts"
import type { EnterpriseTopologyCanvasNodeData } from "../packages/webui/src/components/topology/EnterpriseTopologyCanvas.tsx"
import {
  TopologyWorkspaceInspector,
  applyTopologyWorkspaceExecutorMappingToNode,
  buildTopologyWorkspaceExecutorMapping,
  readTopologyWorkspaceExecutorMappingFromNode,
} from "../packages/webui/src/components/topology/TopologyWorkspaceInspector.tsx"

const now = Date.UTC(2026, 3, 30, 19, 0, 0)

function selectedData(
  kind: EnterpriseTopologyCanvasNodeData["kind"],
  entityType = kind === "tool" ? "enterprise_tool" : kind === "data" ? "enterprise_system" : "node",
): EnterpriseTopologyCanvasNodeData {
  return {
    kind,
    label: kind === "approval" ? "승인 확인" : kind === "tool" ? "CRM Search" : "요청 접수",
    detail: "draft",
    status: "draft",
    entityId: kind === "tool" ? "tool:crm-search" : kind === "data" ? "system:crm" : `node:${kind}`,
    entityType,
  }
}

function nodeContract(overrides: Partial<NodeContract> = {}): NodeContract {
  return {
    schemaVersion: 1,
    entityType: "node",
    id: "node:task",
    name: "요청 접수",
    status: "draft",
    createdAt: now,
    updatedAt: now,
    nodeType: "function",
    tags: [],
    children: [],
    allowedToolIds: [],
    allowedSystemIds: [],
    ...overrides,
  }
}

describe("task007 topology workspace inspector and executor mapping", () => {
  it("shows task template, executor, output preset, checklist, and allowed resource choices", () => {
    const html = renderToStaticMarkup(
      createElement(TopologyWorkspaceInspector, {
        selectedData: selectedData("task"),
        templateCatalog: TOPOLOGY_TEMPLATE_CATALOG,
      }),
    )

    expect(html).toContain('data-testid="topology-workspace-inspector"')
    expect(html).toContain('data-testid="topology-workspace-task-settings"')
    expect(html).toContain('data-testid="topology-workspace-executor-picker"')
    expect(html).toContain("Nobie")
    expect(html).toContain("기존 Agent")
    expect(html).toContain("Team")
    expect(html).toContain("Tool")
    expect(html).toContain("Manual/Approval only")
    expect(html).toContain("Template picker")
    expect(html).toContain("Output preset")
    expect(html).toContain("완료 기준")
    expect(html).toContain("허용 도구/데이터")
  })

  it("shows tool/data controls as pickers instead of raw permission fields", () => {
    const html = renderToStaticMarkup(
      createElement(TopologyWorkspaceInspector, {
        selectedData: selectedData("tool"),
      }),
    )

    expect(html).toContain('data-testid="topology-workspace-tool-settings"')
    expect(html).toContain("Tool picker")
    expect(html).toContain("Permission mode")
    expect(html).toContain("Retry preset")
    expect(html).toContain("Timeout preset")
    expect(html).not.toContain("permission scope")
  })

  it("shows decision condition and branch label presets", () => {
    const html = renderToStaticMarkup(
      createElement(TopologyWorkspaceInspector, {
        selectedData: selectedData("decision"),
      }),
    )

    expect(html).toContain('data-testid="topology-workspace-decision-settings"')
    expect(html).toContain("Condition preset")
    expect(html).toContain("Branch label preset")
    expect(html).toContain("정보 충분")
    expect(html).toContain("통과 / 보류")
  })

  it("shows approval approver and threshold presets", () => {
    const html = renderToStaticMarkup(
      createElement(TopologyWorkspaceInspector, {
        selectedData: selectedData("approval"),
      }),
    )

    expect(html).toContain('data-testid="topology-workspace-approval-settings"')
    expect(html).toContain("Approver position picker")
    expect(html).toContain("Threshold preset")
    expect(html).toContain("담당 리드")
    expect(html).toContain("1명 승인")
  })

  it("stores an existing Agent executor as a runtime profile reference without making AgentConfig the source of truth", () => {
    const node = nodeContract()
    const mapping = buildTopologyWorkspaceExecutorMapping({
      nodeId: node.id,
      executorKind: "agent",
      executorId: "agent:alpha",
      selectedAt: now,
    })
    const mapped = applyTopologyWorkspaceExecutorMappingToNode(node, mapping)

    expect(mapped.id).toBe(node.id)
    expect(mapped.owner).toBeUndefined()
    expect(mapped.metadata?.runtimeProfileRef).toBe(mapping.runtimeProfileRef)
    expect(mapped.metadata?.runtimeSourceOfTruth).toBe("enterprise_node")
    expect(mapped.metadata?.runtimeExecutor).toEqual(expect.objectContaining({
      sourceOfTruth: "enterprise_node",
      executorKind: "agent",
      executorId: "agent:alpha",
      createsAgentConfig: false,
    }))
    expect(mapped.metadata?.agentConfigId).toBeUndefined()
    expect(mapped.metadata?.runtimeExecutor).not.toEqual(expect.objectContaining({
      sourceType: "AgentConfig",
      sourceOfTruth: "AgentConfig",
    }))
    expect(readTopologyWorkspaceExecutorMappingFromNode(mapped)).toEqual(mapping)
  })

  it("keeps advanced instruction and raw contract editing collapsed by default", () => {
    const html = renderToStaticMarkup(
      createElement(TopologyWorkspaceInspector, {
        selectedData: selectedData("task"),
      }),
    )

    expect(html).toContain('data-testid="topology-workspace-advanced"')
    expect(html).toContain('data-testid="enterprise-inspector-advanced-edit"')
    expect(html).toContain("고급 편집")
    expect(html).toContain("긴 instruction")
    expect(html).toContain("Raw contract")
    expect(html).not.toContain("<details open")
  })
})
