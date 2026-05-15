import { createElement } from "../packages/webui/node_modules/react/index.js"
import { renderToStaticMarkup } from "../packages/webui/node_modules/react-dom/server.js"
import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import { ExecutorCardNode } from "../packages/webui/src/components/topology/ExecutorCardNode.tsx"
import {
  executorFlowPositionMap,
  mergeInteractiveExecutorFlowNodes,
} from "../packages/webui/src/components/topology/ExecutorGraphCanvas.tsx"
import {
  addExecutorNodeV2,
  applyExecutorDraftToExecutorTopologyV2,
  connectExecutorNodesV2,
  createEmptyExecutorTopologyV2,
  deleteExecutorNodeV2,
  enterpriseTopologyFromExecutorTopologyV2,
  executorGraphFromExecutorTopologyV2,
  moveExecutorNodeV2,
} from "../packages/webui/src/pages/TopologyWorkspacePage.tsx"
import {
  buildExecutorTopologyV2RuntimeReadModelFromEnterpriseTopology,
  validateExecutorTopologyV2,
} from "../packages/webui/src/lib/executor-topology-v2.ts"

const now = Date.UTC(2026, 4, 8, 10, 0, 0)

describe("topology V2 default WebUI basic flow", () => {
  it("adds, edits, moves, connects, saves, reloads, and deletes executor nodes through the V2 model", () => {
    const empty = createEmptyExecutorTopologyV2(now)
    const first = addExecutorNodeV2(empty, now + 1)
    const second = addExecutorNodeV2(first.topology, now + 2)
    const moved = moveExecutorNodeV2(second.topology, first.node.id, { x: 450.4, y: 180.6 }, now + 3)
    const connected = connectExecutorNodesV2(moved, first.node.id, second.node.id, now + 4)
    const graph = executorGraphFromExecutorTopologyV2(connected)
    const editedExecutor = {
      ...graph.executors[0]!,
      name: "CTO",
      description: "개발 요청을 분석하고 적절한 실행자에게 작은 작업으로 위임한다.",
      definitionQuickChips: ["분석자", "협업하기 좋게"],
      executorProfile: {
        ...graph.executors[0]!.executorProfile!,
        displayName: "CTO",
        roleName: "기술 책임자",
        definition: "개발 요청을 분석하고 위임 가능한 단위로 정리한다.",
        does: ["개발 요청 분석", "실행자 위임", "결과 취합"],
      },
    }
    const edited = applyExecutorDraftToExecutorTopologyV2(connected, editedExecutor, now + 5)
    const persisted = enterpriseTopologyFromExecutorTopologyV2(edited)
    const reloaded = buildExecutorTopologyV2RuntimeReadModelFromEnterpriseTopology(persisted).topology
    const deleted = deleteExecutorNodeV2(reloaded, second.node.id, now + 6)

    expect(validateExecutorTopologyV2(edited).ok).toBe(true)
    expect(edited.nodes.find((node) => node.id === first.node.id)).toEqual(expect.objectContaining({
      name: "CTO",
      roleName: "기술 책임자",
      definitionQuickChips: ["분석자", "협업하기 좋게"],
      position: { x: 450, y: 181 },
    }))
    expect(edited.edges).toEqual([
      expect.objectContaining({
        sourceNodeId: first.node.id,
        targetNodeId: second.node.id,
        type: "delegates_to",
      }),
    ])
    expect(reloaded.nodes.find((node) => node.id === first.node.id)).toEqual(expect.objectContaining({
      name: "CTO",
      roleName: "기술 책임자",
      definitionQuickChips: ["분석자", "협업하기 좋게"],
      position: { x: 450, y: 181 },
    }))
    expect(reloaded.edges).toHaveLength(1)
    expect(deleted.nodes.map((node) => node.id)).toEqual([first.node.id])
    expect(deleted.edges).toHaveLength(0)
  })

  it("keeps the card title as the node name and exposes role name only as a small badge", () => {
    const topology = addExecutorNodeV2(createEmptyExecutorTopologyV2(now), now + 1).topology
    const graph = executorGraphFromExecutorTopologyV2(topology)
    const executor = {
      ...graph.executors[0]!,
      name: "삼식이",
      executorProfile: {
        ...graph.executors[0]!.executorProfile!,
        roleName: "백엔드 실행자",
      },
    }
    const html = renderToStaticMarkup(createElement(ExecutorCardNode, { executor }))

    expect(html).toContain("삼식이")
    expect(html).toContain('data-testid="executor-card-role-name"')
    expect(html).toContain("백엔드 실행자")
    expect(html).not.toContain("경로 필요")
    expect(html).not.toContain("사람 확인 필요")
  })

  it("uses top and bottom React Flow handles for executor delegation links", () => {
    const source = readFileSync("packages/webui/src/components/topology/ExecutorGraphCanvas.tsx", "utf8")

    expect(source).toContain("position={Position.Top}")
    expect(source).toContain("position={Position.Bottom}")
    expect(source).toContain("onConnectExecutors")
    expect(source).toContain("onMoveExecutor")
  })

  it("keeps the live drag position when selection or execution state refreshes the same graph", () => {
    const sourceNodes = [
      { id: "node:cto", position: { x: 120, y: 80 }, data: { selected: false } },
    ]
    const draggedNodes = [
      { id: "node:cto", position: { x: 280, y: 160 }, data: { selected: false } },
    ]
    const refreshedNodes = [
      { id: "node:cto", position: { x: 120, y: 80 }, data: { selected: true } },
    ]
    const merged = mergeInteractiveExecutorFlowNodes({
      current: draggedNodes,
      next: refreshedNodes,
      previousSourcePositions: executorFlowPositionMap(sourceNodes),
    })

    expect(merged).toEqual([
      { id: "node:cto", position: { x: 280, y: 160 }, data: { selected: true } },
    ])
  })

  it("accepts persisted position changes such as auto layout or saved reloads", () => {
    const sourceNodes = [
      { id: "node:cto", position: { x: 120, y: 80 }, data: { selected: false } },
    ]
    const draggedNodes = [
      { id: "node:cto", position: { x: 280, y: 160 }, data: { selected: false } },
    ]
    const autoLayoutNodes = [
      { id: "node:cto", position: { x: 460, y: 210 }, data: { selected: true } },
    ]
    const merged = mergeInteractiveExecutorFlowNodes({
      current: draggedNodes,
      next: autoLayoutNodes,
      previousSourcePositions: executorFlowPositionMap(sourceNodes),
    })

    expect(merged).toEqual(autoLayoutNodes)
  })
})
