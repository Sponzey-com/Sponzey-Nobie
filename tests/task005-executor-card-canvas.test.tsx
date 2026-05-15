import { createElement } from "../packages/webui/node_modules/react/index.js"
import { renderToStaticMarkup } from "../packages/webui/node_modules/react-dom/server.js"
import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import type {
  EnterpriseRelation,
  EnterpriseTopology,
  NodeContract,
  NodeType,
} from "../packages/webui/src/contracts/enterprise-topology.ts"
import {
  EnterpriseTopologyCanvasShell,
  buildEnterpriseTopologyCanvasModel,
} from "../packages/webui/src/components/topology/EnterpriseTopologyCanvas.tsx"
import {
  ExecutorGraphCanvas,
  buildExecutorGraphCanvasModel,
} from "../packages/webui/src/components/topology/ExecutorGraphCanvas.tsx"
import {
  ExecutorCardNode,
  executorRuntimeStatusCopy,
  selectExecutorCardCapabilities,
} from "../packages/webui/src/components/topology/ExecutorCardNode.tsx"
import { buildExecutorGraphRelationInfoMap } from "../packages/webui/src/lib/executor-graph-relations.ts"
import { TopologyWorkspaceCanvas } from "../packages/webui/src/components/topology/TopologyWorkspaceCanvas.tsx"
import { buildTopologyWorkspaceStarterDraft } from "../packages/webui/src/lib/topology-workspace-templates.ts"

const now = Date.UTC(2026, 4, 2, 9, 0, 0)

describe("task005 executor card canvas", () => {
	  it("renders simple topology as executor cards without ambiguous runtime status badges", () => {
	    const topology = buildTopologyWorkspaceStarterDraft("approval-request-flow", { now })
	    const model = buildExecutorGraphCanvasModel({ topology })
	    const html = renderToStaticMarkup(createElement(ExecutorGraphCanvas, { topology }))

	    expect(html).toContain('data-testid="executor-graph-canvas"')
	    expect(html).toContain('data-testid="executor-flow-canvas"')
	    expect(html).toContain('data-testid="rf__controls"')
	    expect(html).toContain("executor-flow-controls top left")
	    expect(html).toContain("grid-rows-[auto_minmax(0,1fr)]")
	    expect(html).not.toContain('data-testid="executor-graph-connections"')
	    expect(html).not.toContain("max-h-28")
	    expect(model?.graph.executors.map((executor) => executor.name)).toEqual(["승인 요청 준비", "승인 확인"])
	    expect(model?.graph.executors.map((executor) => executor.inferredRuntimeMode)).toEqual(["auto", "approval"])
	    expect(html).not.toContain("Task")
    expect(html).not.toContain("Decision")
    expect(html).not.toContain("Approval")
    expect(html).not.toContain("Group")
    expect(html).not.toContain("Enterprise Topology")
    expect([
      executorRuntimeStatusCopy("auto").labelKo,
      executorRuntimeStatusCopy("human_check").labelKo,
      executorRuntimeStatusCopy("approval").labelKo,
      executorRuntimeStatusCopy("tool_execution").labelKo,
      executorRuntimeStatusCopy("external").labelKo,
      executorRuntimeStatusCopy("unknown").labelKo,
    ]).toEqual([
      "자동 처리",
      "최종 검토",
      "최종 검토",
      "도구 사용",
      "외부 연동",
      "최종 검토",
    ])
    expect(html).not.toContain("사람 확인 필요")
    expect(html).not.toContain("승인 필요")
  })

  it("keeps tool, data, and system resources inside executor cards instead of independent execution nodes", () => {
	    const topology = resourceTopologyFixture()
	    const model = buildExecutorGraphCanvasModel({ topology })
	    const html = renderToStaticMarkup(createElement(ExecutorGraphCanvas, { topology }))
	    const cards = [
	      ...(model?.unsectionedCards ?? []),
	      ...(model?.sections.flatMap((section) => section.cards) ?? []),
	    ]
	    const intakeResources = cards.find((card) => card.executor.id === "node:intake")?.resources ?? []

	    expect(model?.graph.executors.map((executor) => executor.id)).toEqual(["node:intake", "node:review"])
	    expect(intakeResources).toEqual(expect.arrayContaining([
	      expect.objectContaining({ kind: "tool", id: "tool:crm-search", label: "CRM Search" }),
	      expect.objectContaining({ kind: "system", id: "system:crm", label: "CRM" }),
	    ]))
	    expect(html).not.toContain('data-executor-id="tool:crm-search"')
	    expect(html).not.toContain('data-executor-id="system:crm"')
    expect(html).not.toContain('data-testid="enterprise-topology-canvas"')
  })

	  it("renders teams as non-selectable section backgrounds, not executable nodes", () => {
	    const topology = resourceTopologyFixture()
	    const html = renderToStaticMarkup(createElement(ExecutorGraphCanvas, { topology }))

	    expect(html).toContain('data-testid="executor-flow-canvas"')
	    expect(html).not.toContain('data-testid="executor-graph-section"')
	    expect(html).not.toContain('data-section-id="team:front-office"')
	    expect(html).not.toContain('data-executor-id="team:front-office"')
	  })

  it("shows Nobie direct, child, and indirect executor relations with duplicate-name disambiguation", () => {
    const topology = resourceTopologyFixture()
    topology.nodes = [
      node("node:lead", "검토자", "function", {
        description: "요청을 분류하고 필요한 실행자에게 넘긴다.",
        metadata: { roleName: "리드" },
      }),
      node("node:review-a", "검토자", "function", {
        description: "처리 결과를 검토한다.",
        metadata: { roleName: "품질 검토" },
      }),
      node("node:review-b", "검토자", "function", {
        description: "최종 요약을 정리한다.",
        metadata: { roleName: "요약 검토" },
      }),
    ]
    topology.relations = [
      relation("relation:lead-review-a", "넘김", "delegates_to", "node", "node:lead", "node", "node:review-a"),
      relation("relation:review-a-review-b", "넘김", "delegates_to", "node", "node:review-a", "node", "node:review-b"),
    ]

    const model = buildExecutorGraphCanvasModel({ topology })
    const relationInfo = buildExecutorGraphRelationInfoMap(model?.graph)

    expect(relationInfo.get("node:lead")).toEqual(expect.objectContaining({
      relationKind: "root_direct",
      relationLabelKo: "노비 직속",
      selectableWithoutPath: true,
      duplicateName: true,
      roleLabel: "리드",
      shortId: "lead",
    }))
    expect(relationInfo.get("node:review-a")).toEqual(expect.objectContaining({
      relationKind: "child",
      relationLabelKo: "검토자의 하위",
      selectableWithoutPath: false,
      duplicateName: true,
      roleLabel: "품질 검토",
      shortId: "review-a",
    }))
    expect(relationInfo.get("node:review-b")).toEqual(expect.objectContaining({
      relationKind: "indirect",
      relationLabelKo: "간접 실행자",
      selectableWithoutPath: false,
      duplicateName: true,
      roleLabel: "요약 검토",
      shortId: "review-b",
    }))

    const review = model?.graph.executors.find((executor) => executor.id === "node:review-a")
    const reviewRelation = relationInfo.get("node:review-a")
    if (!review || !reviewRelation) throw new Error("review fixture missing")
    const cardHtml = renderToStaticMarkup(createElement(ExecutorCardNode, {
      executor: review,
      relationLabel: reviewRelation.relationLabelKo,
      relationDescription: reviewRelation.relationDetailKo,
      roleLabel: reviewRelation.roleLabel,
      shortId: reviewRelation.shortId,
      duplicateName: reviewRelation.duplicateName,
      selectableWithoutPath: reviewRelation.selectableWithoutPath,
    }))

    expect(cardHtml).toContain("검토자의 하위")
    expect(cardHtml).not.toContain("경로 필요")
    expect(cardHtml).toContain("품질 검토")
    expect(cardHtml).toContain("review-a")
    expect(cardHtml).toContain('data-testid="executor-card-relation"')
    expect(cardHtml).toContain('data-selectable-without-path="false"')
  })

  it("hides duplicated long capability text from compact executor cards", () => {
    const description = "재무 관련 조언과 조사 내용을 확인하고, 중요한 판단 사항을 검토·승인하며, 해야 할 일을 나눠 진행합니다."
    const capabilities = selectExecutorCardCapabilities(description, [
      "업무 처리",
      description,
      "재무 관련 조언과 조사 내용을 확인하고, 중요한 판단 사항을 검토·승인하며, 해야 할 일을 나눠 진행합니다.",
      "검토",
    ])
    const html = renderToStaticMarkup(createElement(ExecutorCardNode, {
      executor: {
        id: "node:finance",
        name: "행랑아범",
        description,
        inferredRuntimeMode: "auto",
        inferredCapabilities: [
          "업무 처리",
          description,
          "검토",
        ],
        inferredTools: [],
        inferredOutputs: [],
        inferredSuccessCriteria: [],
        confidence: 0.9,
      },
    }))

    expect(capabilities).toEqual(["업무 처리", "검토"])
    expect(html).toContain("업무 처리")
    expect(html).toContain("검토")
    expect(html.match(/data-testid="executor-card-capability"/g)).toHaveLength(2)
  })

	  it("exposes a draggable and connectable node canvas for simple workflow editing", () => {
	    const topology = buildTopologyWorkspaceStarterDraft("customer-request-flow", { now })
	    const html = renderToStaticMarkup(
	      createElement(ExecutorGraphCanvas, {
	        topology,
	        onConnectExecutors: () => undefined,
	        onMoveExecutor: () => undefined,
	      }),
	    )

	    expect(html).toContain('data-testid="executor-flow-canvas"')
	    expect(html).toContain('data-draggable="true"')
	    expect(html).toContain('data-connectable="true"')
	    expect(html).toContain('data-executor-count="3"')
	    expect(html).toContain('data-testid="rf__controls"')
	    expect(html).toContain("executor-flow-controls top left")
	  })

  it("places node connection handles vertically for top-to-bottom workflows", () => {
    const simpleSource = readFileSync("packages/webui/src/components/topology/ExecutorGraphCanvas.tsx", "utf8")
    const advancedSource = readFileSync("packages/webui/src/components/topology/EnterpriseTopologyCanvas.tsx", "utf8")

    expect(simpleSource).toContain("position={Position.Top}")
    expect(simpleSource).toContain("position={Position.Bottom}")
    expect(simpleSource).not.toContain("position={Position.Left}")
    expect(simpleSource).not.toContain("position={Position.Right}")
    expect(advancedSource).toContain("position={Position.Top}")
    expect(advancedSource).toContain("position={Position.Bottom}")
  })

  it("marks active executor nodes with a working animation class during runs", () => {
    const topology = buildTopologyWorkspaceStarterDraft("customer-request-flow", { now })
    const activeExecutorId = topology.nodes[0]!.id
    const html = renderToStaticMarkup(
      createElement(ExecutorGraphCanvas, {
        topology,
        activeExecutorIds: [activeExecutorId],
      }),
    )
    const source = readFileSync("packages/webui/src/components/topology/ExecutorGraphCanvas.tsx", "utf8")

    expect(html).toContain('data-active-executor-count="1"')
    expect(html).toContain(`data-active-executor-ids="${activeExecutorId}"`)
    expect(source).toContain("topology-working-node")
    expect(source).toContain("data-working={working}")
  })

  it("updates ReactFlow node state during drag before persisting the final position", () => {
    const source = readFileSync("packages/webui/src/components/topology/ExecutorGraphCanvas.tsx", "utf8")

    expect(source).toContain("applyNodeChanges")
    expect(source).toContain("interactiveNodes")
    expect(source).toContain("onNodesChange={handleNodesChange}")
    expect(source).toContain("onNodeDragStop={handleNodeDragStop}")
  })

  it("uses short Korean labels for simple connections", () => {
    const topology = buildTopologyWorkspaceStarterDraft("customer-request-flow", { now })
    const model = buildExecutorGraphCanvasModel({ topology })
    const html = renderToStaticMarkup(createElement(ExecutorGraphCanvas, { topology }))

    expect(model?.connections.map((connection) => connection.label)).toContain("넘김")
    expect(html).not.toContain('data-testid="executor-graph-connections"')
    expect(html).not.toContain("delegates_to")
  })

  it("wires TopologyWorkspaceCanvas and advanced requests to the simple ExecutorGraphCanvas surface", () => {
    const topology = resourceTopologyFixture()
    const simpleHtml = renderToStaticMarkup(
      createElement(TopologyWorkspaceCanvas, {
        selectedLayer: "build",
        exposureMode: "simple",
        topology,
      }),
    )
    const advancedHtml = renderToStaticMarkup(
      createElement(TopologyWorkspaceCanvas, {
        selectedLayer: "build",
        topology,
        exposureMode: "advanced",
      }),
    )

	    expect(simpleHtml).toContain('data-testid="executor-graph-canvas"')
    expect(simpleHtml).toContain('data-testid="executor-flow-canvas"')
    expect(simpleHtml).not.toContain('data-testid="enterprise-topology-palette"')
    expect(simpleHtml).not.toContain('data-testid="enterprise-topology-compile-preview"')
    expect(advancedHtml).toContain('data-testid="executor-graph-canvas"')
    expect(advancedHtml).toContain('data-testid="executor-flow-canvas"')
    expect(advancedHtml).not.toContain('data-testid="enterprise-topology-palette"')
    expect(advancedHtml).not.toContain('data-testid="enterprise-topology-compile-preview"')
    expect(advancedHtml).not.toContain("Tool")
    expect(advancedHtml).not.toContain("Data")
  })
})

function resourceTopologyFixture(): EnterpriseTopology {
  return {
    schemaVersion: 1,
    entityType: "topology",
    id: "topology:task005",
    name: "고객 접수 흐름",
    status: "draft",
    createdAt: now,
    updatedAt: now,
    nodes: [
      node("node:intake", "고객 접수 담당자", "automation_node", {
        description: "고객 요청을 읽고 CRM에서 고객 정보를 확인한다.",
        tags: ["접수", "고객"],
        allowedToolIds: ["tool:crm-search"],
        allowedSystemIds: ["system:crm"],
      }),
      node("node:review", "검토자", "review_node", {
        description: "정리된 요청과 CRM 정보를 보고 다음 조치를 확인한다.",
        tags: ["검토"],
      }),
    ],
    teams: [{
      schemaVersion: 1,
      entityType: "team",
      id: "team:front-office",
      name: "접수 영역",
      status: "draft",
      createdAt: now,
      updatedAt: now,
      purpose: "고객 요청을 처음 처리하는 영역",
      nodeIds: ["node:intake", "node:review"],
      tags: [],
    }],
    orgUnits: [],
    positions: [],
    persons: [],
    memberships: [],
    authorityRules: [],
    responsibilities: [],
    systems: [{
      schemaVersion: 1,
      entityType: "enterprise_system",
      id: "system:crm",
      name: "CRM",
      status: "draft",
      createdAt: now,
      updatedAt: now,
      systemType: "data_store",
      dataDomainIds: [],
      criticality: "medium",
    }],
    tools: [{
      schemaVersion: 1,
      entityType: "enterprise_tool",
      id: "tool:crm-search",
      name: "CRM Search",
      status: "draft",
      createdAt: now,
      updatedAt: now,
      toolType: "read_only",
      systemId: "system:crm",
    }],
    processes: [],
    relations: [
      relation("relation:intake-review", "넘김", "delegates_to", "node", "node:intake", "node", "node:review"),
      relation("relation:intake-tool", "도구 사용", "uses_tool", "node", "node:intake", "enterprise_tool", "tool:crm-search"),
      relation("relation:intake-system", "CRM 참고", "uses_system", "node", "node:intake", "enterprise_system", "system:crm"),
    ],
  }
}

function node(
  id: string,
  name: string,
  nodeType: NodeType,
  options: {
    description?: string
    tags?: string[]
    allowedToolIds?: string[]
    allowedSystemIds?: string[]
    metadata?: NodeContract["metadata"]
  } = {},
): NodeContract {
  return {
    schemaVersion: 1,
    entityType: "node",
    id,
    name,
    status: "draft",
    createdAt: now,
    updatedAt: now,
    nodeType,
    description: options.description,
    tags: options.tags ?? [],
    children: [],
    template: {
      templateId: `template:${id}`,
      source: "system_preset",
      fixedRoleCatalog: false,
      metadata: {
        successCriteria: ["결과 확인"],
        outputs: ["처리 결과"],
      },
    },
    allowedToolIds: options.allowedToolIds ?? [],
    allowedSystemIds: options.allowedSystemIds ?? [],
    metadata: options.metadata,
  }
}

function relation(
  id: string,
  label: string,
  relationType: EnterpriseRelation["relationType"],
  fromType: EnterpriseRelation["from"]["entityType"],
  fromId: string,
  toType: EnterpriseRelation["to"]["entityType"],
  toId: string,
): EnterpriseRelation {
  return {
    schemaVersion: 1,
    entityType: "relation",
    id,
    name: label,
    label,
    status: "draft",
    createdAt: now,
    updatedAt: now,
    relationType,
    from: { entityType: fromType, id: fromId },
    to: { entityType: toType, id: toId },
  }
}
