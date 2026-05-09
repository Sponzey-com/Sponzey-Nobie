import { describe, expect, it } from "vitest"
import {
  EXECUTOR_TOPOLOGY_V2_SCHEMA_VERSION,
  NOBIE_ROOT_AGENT_ID,
  buildExecutorRuntimeGraphSnapshotV2,
  type ExecutorEdgeV2,
  type ExecutorNodeV2,
  type ExecutorTopologyV2,
} from "../packages/core/src/topology/executor-topology-v2.ts"

const now = Date.UTC(2026, 4, 8, 10, 30, 0)

function node(id: string, status: ExecutorNodeV2["status"] = "active"): ExecutorNodeV2 {
  return {
    id,
    name: id,
    roleName: id.replace("node:", ""),
    description: `${id} executor`,
    position: { x: 0, y: 0 },
    status,
  }
}

function edge(
  id: string,
  sourceNodeId: string,
  targetNodeId: string,
  status: ExecutorEdgeV2["status"] = "active",
): ExecutorEdgeV2 {
  return {
    id,
    sourceNodeId,
    targetNodeId,
    type: "delegates_to",
    status,
  }
}

function topology(input: {
  nodes: ExecutorNodeV2[]
  edges: ExecutorEdgeV2[]
  metadata?: ExecutorTopologyV2["metadata"]
}): ExecutorTopologyV2 {
  return {
    schemaVersion: EXECUTOR_TOPOLOGY_V2_SCHEMA_VERSION,
    id: "workspace:draft",
    name: "Draft workspace",
    status: "active",
    createdAt: now,
    updatedAt: now,
    nodes: input.nodes,
    edges: input.edges,
    ...(input.metadata ? { metadata: input.metadata } : {}),
  }
}

describe("ExecutorTopologyV2 root direct children", () => {
  it("projects incoming-edge-free active nodes as Nobie direct children", () => {
    const snapshot = buildExecutorRuntimeGraphSnapshotV2(topology({
      nodes: [
        node("node:lead"),
        node("node:worker"),
        node("node:finance"),
        node("node:archived", "archived"),
      ],
      edges: [
        edge("edge:lead-worker", "node:lead", "node:worker"),
        edge("edge:finance-archived", "node:finance", "node:archived"),
      ],
    }))

    expect(snapshot.rootAgentId).toBe(NOBIE_ROOT_AGENT_ID)
    expect(snapshot.rootDirectChildIds).toEqual(["node:lead", "node:finance"])
    expect(snapshot.directChildrenByNodeId).toEqual({
      "node:lead": ["node:worker"],
      "node:worker": [],
      "node:finance": [],
    })
    expect(snapshot.nodes.map((item) => item.id)).toEqual(["node:lead", "node:worker", "node:finance"])
    expect(snapshot.edges.map((item) => item.id)).toEqual(["edge:lead-worker"])
  })

  it("ignores archived edges when calculating root direct children", () => {
    const snapshot = buildExecutorRuntimeGraphSnapshotV2(topology({
      nodes: [node("node:lead"), node("node:worker")],
      edges: [edge("edge:lead-worker", "node:lead", "node:worker", "archived")],
    }))

    expect(snapshot.rootDirectChildIds).toEqual(["node:lead", "node:worker"])
    expect(snapshot.directChildrenByNodeId).toEqual({
      "node:lead": [],
      "node:worker": [],
    })
    expect(snapshot.edges).toEqual([])
  })

  it("does not use first node, selected node, or recommended entry metadata as runtime entry", () => {
    const snapshot = buildExecutorRuntimeGraphSnapshotV2(topology({
      nodes: [
        node("node:worker"),
        node("node:lead"),
        node("node:finance"),
      ],
      edges: [edge("edge:lead-worker", "node:lead", "node:worker")],
      metadata: {
        selectedNodeId: "node:worker",
        recommendedEntry: "node:worker",
        active_default_workflow_candidate: "node:worker",
      },
    }))

    expect(snapshot.rootDirectChildIds).toEqual(["node:lead", "node:finance"])
    expect(snapshot.directChildrenByNodeId["node:lead"]).toEqual(["node:worker"])
  })
})

