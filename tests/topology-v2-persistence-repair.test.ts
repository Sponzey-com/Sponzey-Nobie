import { describe, expect, it } from "vitest"
import {
  EXECUTOR_TOPOLOGY_V2_SCHEMA_VERSION,
  buildExecutorRuntimeGraphSnapshotV2,
  repairExecutorTopologyV2ForPersistence,
  validateExecutorTopologyV2,
  type ExecutorTopologyV2,
} from "../packages/core/src/topology/executor-topology-v2.ts"

const now = Date.UTC(2026, 4, 8, 15, 0, 0)

function dirtyTopology(): ExecutorTopologyV2 {
  return {
    schemaVersion: EXECUTOR_TOPOLOGY_V2_SCHEMA_VERSION,
    id: "workspace:draft",
    name: "Draft workspace",
    status: "active",
    createdAt: now,
    updatedAt: now,
    nodes: [
      {
        id: "node:lead",
        name: "리더",
        roleName: "업무 리더",
        description: "업무를 나누고 위임합니다.",
        position: { x: 20, y: 30 },
        status: "active",
        metadata: {
          executorGraph: {
            workspace: {
              executors: [{ id: "node:lead", inferredTools: ["tool:web-research"] }],
            },
            inferredRuntimeMode: "auto",
            inferredTools: ["tool:web-research"],
            advancedMapping: { allowedToolIds: ["tool:web-research"] },
          },
          suggestionHistory: [{
            suggestionRunId: "node-definition-suggestion:1",
            userPrompt: "리더처럼",
            alternativeSummaries: ["상세 제안 본문"],
            selectedAlternativeId: "alt-1",
            rejectedAlternativeIds: [],
          }],
          aiSuggestionState: {
            suggestionRunId: "node-definition-suggestion:2",
            selectedAlternativeId: "alt-2",
            appliedFieldNames: ["description"],
          },
        },
        children: ["node:worker"],
        allowedToolIds: ["tool:web-research"],
        allowedSystemIds: ["system:legacy"],
      } as unknown as ExecutorTopologyV2["nodes"][number],
      {
        id: "node:worker",
        name: "실행자",
        roleName: "실행자",
        description: "위임받은 일을 실행합니다.",
        position: { x: 20, y: 200 },
        status: "active",
      },
    ],
    edges: [
      {
        id: "edge:lead-worker",
        sourceNodeId: "node:lead",
        targetNodeId: "node:worker",
        type: "delegates_to",
        status: "active",
      },
      {
        id: "edge:bad",
        sourceNodeId: "node:lead",
        targetNodeId: "node:missing",
        type: "delegates_to",
        status: "active",
      },
    ],
    metadata: {
      executorGraph: {
        workspace: {
          executors: [{ id: "node:lead", inferredTools: ["tool:web-research"] }],
        },
      },
      inferredTools: ["tool:web-research"],
      inferredRuntimeMode: "auto",
      advancedMapping: { allowedToolIds: ["tool:web-research"] },
      recommendedEntry: "node:lead",
      lastSelectedNodeId: "node:lead",
      active_default_workflow_candidate: "node:lead",
    },
    relations: [],
    teams: [],
  } as unknown as ExecutorTopologyV2
}

describe("ExecutorTopologyV2 persistence repair", () => {
  it("removes stale metadata, legacy node caches, and invalid edges before persistence", () => {
    const repaired = repairExecutorTopologyV2ForPersistence(dirtyTopology())
    const validation = validateExecutorTopologyV2(repaired.topology)
    const json = JSON.stringify(repaired.topology)
    const lead = repaired.topology.nodes.find((node) => node.id === "node:lead")

    expect(validation).toEqual({ ok: true, issues: [] })
    expect(repaired.topology.edges.map((edge) => edge.id)).toEqual(["edge:lead-worker"])
    expect(json).not.toContain("tool:web-research")
    expect(json).not.toContain('"workspace":')
    expect(json).not.toContain("inferredRuntimeMode")
    expect(json).not.toContain("advancedMapping")
    expect(json).not.toContain("recommendedEntry")
    expect(json).not.toContain("lastSelectedNodeId")
    expect(json).not.toContain("active_default_workflow_candidate")
    expect(json).not.toContain("allowedToolIds")
    expect(json).not.toContain("allowedSystemIds")
    expect(json).not.toContain("children")
    expect(lead?.metadata?.aiSuggestionAuditRefs).toEqual([
      {
        kind: "node_definition_suggestion",
        suggestionRunId: "node-definition-suggestion:2",
        selectedAlternativeId: "alt-2",
      },
      {
        kind: "node_definition_suggestion",
        suggestionRunId: "node-definition-suggestion:1",
        selectedAlternativeId: "alt-1",
      },
    ])
    expect(repaired.issues.map((issue) => issue.code)).toEqual(expect.arrayContaining([
      "executor_topology_v2_stale_topology_field_removed",
      "executor_topology_v2_stale_node_field_removed",
      "executor_topology_v2_stale_metadata_removed",
      "executor_topology_v2_invalid_edge_removed",
    ]))
  })

  it("restores the same runtime graph after JSON persistence and reload", () => {
    const repaired = repairExecutorTopologyV2ForPersistence(dirtyTopology()).topology
    const reloaded = JSON.parse(JSON.stringify(repaired)) as ExecutorTopologyV2

    expect(buildExecutorRuntimeGraphSnapshotV2(reloaded)).toMatchObject({
      rootDirectChildIds: ["node:lead"],
      directChildrenByNodeId: {
        "node:lead": ["node:worker"],
        "node:worker": [],
      },
    })
  })
})
