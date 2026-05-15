import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import type {
  EnterpriseTopology,
} from "../packages/core/src/contracts/enterprise-topology.ts"
import {
  EXECUTOR_GRAPH_SOURCE_OF_TRUTH,
  compileExecutorGraphToEnterpriseTopology,
  type ExecutorGraphWorkspace,
} from "../packages/core/src/topology/executor-graph.ts"
import {
  EXECUTOR_TOPOLOGY_V2_PROJECTION_FIELDS,
  EXECUTOR_TOPOLOGY_V2_SOURCE_FIELDS,
  EXECUTOR_TOPOLOGY_V2_SCHEMA_VERSION,
  repairExecutorTopologyV2ForPersistence,
  validateExecutorTopologyV2,
  type ExecutorTopologyV2,
} from "../packages/core/src/topology/executor-topology-v2.ts"

const now = Date.UTC(2026, 4, 9, 9, 0, 0)

function topology(overrides: Partial<ExecutorTopologyV2> = {}): ExecutorTopologyV2 {
  return {
    schemaVersion: EXECUTOR_TOPOLOGY_V2_SCHEMA_VERSION,
    id: "workspace:draft",
    name: "업무 흐름",
    status: "draft",
    createdAt: now,
    updatedAt: now,
    nodes: [
      {
        id: "node:lead",
        name: "리더",
        roleName: "분석 실행자",
        description: "요청을 분석해 실행 가능한 작업으로 나눕니다.",
        position: { x: 100, y: 100 },
        status: "active",
        metadata: {
          executorGraph: {
            inferredTools: ["tool:web"],
          },
          understanding: { summary: "노비가 이해한 내용" },
          definitionQuickChips: ["분석"],
        },
      },
      {
        id: "node:worker",
        name: "실행자",
        roleName: "작업 실행자",
        description: "위임받은 작업을 처리합니다.",
        position: { x: 100, y: 260 },
        status: "archived",
      },
    ],
    edges: [
      {
        id: "edge:self",
        sourceNodeId: "node:lead",
        targetNodeId: "node:lead",
        type: "delegates_to",
        status: "active",
      },
      {
        id: "edge:archived",
        sourceNodeId: "node:lead",
        targetNodeId: "node:worker",
        type: "delegates_to",
        status: "active",
      },
    ],
    metadata: {
      executorGraph: {
        workspace: {
          executors: [{
            id: "node:lead",
            advancedMapping: { allowedToolIds: ["tool:web"] },
            inferredOutputs: ["보고서"],
            inferredSuccessCriteria: ["완료"],
          }],
        },
      },
      runtimeDiagnostic: { lastRunId: "run:1" },
      aiSuggestionAlternatives: [{ id: "alt:1" }],
    },
    ...overrides,
  } as unknown as ExecutorTopologyV2
}

function baseTopology(): EnterpriseTopology {
  return {
    schemaVersion: 1,
    entityType: "topology",
    id: "workspace:draft",
    name: "업무 흐름",
    status: "draft",
    createdAt: now,
    updatedAt: now,
    nodes: [],
    teams: [],
    orgUnits: [],
    positions: [],
    persons: [],
    memberships: [],
    authorityRules: [],
    responsibilities: [],
    systems: [{
      schemaVersion: 1,
      entityType: "enterprise_system",
      id: "system:web",
      name: "Web",
      status: "active",
      createdAt: now,
      updatedAt: now,
      systemType: "external",
      dataDomainIds: [],
      criticality: "medium",
    }],
    tools: [{
      schemaVersion: 1,
      entityType: "enterprise_tool",
      id: "tool:web",
      name: "Web Search",
      status: "active",
      createdAt: now,
      updatedAt: now,
      toolType: "read_only",
      systemId: "system:web",
    }],
    processes: [],
    relations: [],
  }
}

function graph(): ExecutorGraphWorkspace {
  return {
    schemaVersion: 1,
    graphId: "executor-graph:test",
    topologyId: "workspace:draft",
    name: "업무 흐름",
    mode: "simple",
    executors: [{
      id: "node:lead",
      name: "리더",
      description: "요청을 분석합니다.",
      inferredRuntimeMode: "tool_execution",
      inferredCapabilities: ["분석"],
      inferredTools: ["tool:web"],
      inferredOutputs: ["분석 결과"],
      inferredSuccessCriteria: ["결과 확인"],
      confidence: 0.8,
      advancedMapping: {
        nodeType: "automation_node",
        executorKind: "tool",
        allowedToolIds: ["tool:web"],
        allowedSystemIds: ["system:web"],
      },
    }],
    sections: [],
    connections: [],
    selectedId: null,
    inference: {
      source: "executor_graph_compile",
      confidence: 0.8,
      executorCount: 1,
      connectionCount: 0,
      issueCount: 0,
      generatedAt: now,
    },
    compiledPreview: null,
    latestRun: null,
    issues: [],
    sourceOfTruth: EXECUTOR_GRAPH_SOURCE_OF_TRUTH,
  }
}

describe("executor graph domain contract", () => {
  it("documents source fields separately from projection-only fields", () => {
    expect(EXECUTOR_TOPOLOGY_V2_SOURCE_FIELDS).toEqual(expect.arrayContaining([
      "node.id",
      "node.name",
      "node.roleName",
      "node.description",
      "node.definitionQuickChips",
      "node.position",
      "node.status",
      "edge.sourceNodeId",
      "edge.targetNodeId",
      "edge.type",
      "edge.status",
    ]))
    expect(EXECUTOR_TOPOLOGY_V2_PROJECTION_FIELDS).toEqual(expect.arrayContaining([
      "node.profile",
      "node.metadata",
      "topology.metadata",
    ]))
  })

  it("removes projection-only metadata and invalid delegation edges before V2 persistence", () => {
    const validation = validateExecutorTopologyV2(topology())
    const repair = repairExecutorTopologyV2ForPersistence(topology())
    const repairedJson = JSON.stringify(repair.topology)

    expect(validation.ok).toBe(false)
    expect(validation.issues.map((issue) => issue.code)).toEqual(expect.arrayContaining([
      "stale_metadata_field",
      "self_loop_edge",
      "archived_edge_endpoint",
    ]))
    expect(validateExecutorTopologyV2(repair.topology)).toEqual({ ok: true, issues: [] })
    expect(repair.topology.edges).toEqual([])
    expect(repairedJson).not.toContain("advancedMapping")
    expect(repairedJson).not.toContain("inferredTools")
    expect(repairedJson).not.toContain("inferredOutputs")
    expect(repairedJson).not.toContain("inferredSuccessCriteria")
    expect(repairedJson).not.toContain("definitionQuickChips")
    expect(repairedJson).not.toContain("understanding")
    expect(repairedJson).not.toContain("runtimeDiagnostic")
    expect(repairedJson).not.toContain("aiSuggestionAlternatives")
  })

  it("preserves node definition quick chips only as V2 source data", () => {
    const sourceTopology = topology({
      nodes: [
        {
          ...topology().nodes[0]!,
          definitionQuickChips: ["분석자", "협업하기 좋게"],
        },
      ],
      edges: [],
    })
    const repair = repairExecutorTopologyV2ForPersistence(sourceTopology)

    expect(validateExecutorTopologyV2(repair.topology)).toEqual({ ok: true, issues: [] })
    expect(repair.topology.nodes[0]).toEqual(expect.objectContaining({
      definitionQuickChips: ["분석자", "협업하기 좋게"],
    }))
    expect(repair.topology.nodes[0]?.metadata).not.toEqual(expect.objectContaining({
      definitionQuickChips: expect.anything(),
    }))
  })

  it("keeps advanced and inferred hints out of persisted execution authority", () => {
    const compiled = compileExecutorGraphToEnterpriseTopology(graph(), {
      baseTopology: baseTopology(),
      now,
    })

    expect(compiled.ok).toBe(true)
    if (!compiled.ok) return
    const node = compiled.topology.nodes.find((candidate) => candidate.id === "node:lead")

    expect(node?.allowedToolIds).toEqual([])
    expect(node?.allowedSystemIds).toEqual([])
    expect(compiled.topology.tools.map((tool) => tool.id)).toContain("tool:web")
    expect(compiled.metadata.sourceOfTruth).toBe("executor_topology_v2")
    expect(compiled.metadata.projectionOnly).toBe(true)
  })

  it("keeps the WebUI V2 contract local instead of re-exporting core domain types", () => {
    const source = readFileSync("packages/webui/src/lib/executor-topology-v2.ts", "utf8")

    expect(source).toContain("from \"../contracts/topology\"")
    expect(source).not.toContain("type ExecutorNodeV2,\n} from \"../../../core/src/topology/executor-topology-v2\"")
    expect(source).not.toContain("type ExecutorRuntimeGraphSnapshotV2,\n} from \"../../../core/src/topology/executor-topology-v2\"")
  })
})
