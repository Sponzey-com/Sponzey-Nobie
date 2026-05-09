import { describe, expect, it } from "vitest"
import type {
  EnterpriseTopology,
  NodeContract,
} from "../packages/core/src/contracts/enterprise-topology.ts"
import {
  EXECUTOR_GRAPH_METADATA_KEY,
  attachExecutorGraphMetadata,
  buildExecutorGraphFromEnterpriseTopology,
  buildExecutorGraphGuiOperations,
  compileExecutorGraphToEnterpriseTopology,
  readExecutorGraphMetadata,
  type ExecutorGraphWorkspace,
} from "../packages/core/src/topology/executor-graph.ts"
import {
  buildExecutorGraphFromEnterpriseTopology as buildExecutorGraphFromWebuiHelper,
} from "../packages/webui/src/lib/executor-graph.ts"

const now = Date.UTC(2026, 4, 1, 12, 0, 0)

function node(input: Partial<NodeContract> & Pick<NodeContract, "id" | "name">): NodeContract {
  return {
    schemaVersion: 1,
    entityType: "node",
    id: input.id,
    name: input.name,
    status: input.status ?? "draft",
    createdAt: input.createdAt ?? now,
    updatedAt: input.updatedAt ?? now,
    nodeType: input.nodeType ?? "function",
    description: input.description,
    tags: input.tags ?? ["고객"],
    children: input.children ?? [],
    template: input.template ?? {
      templateId: `template:${input.id}`,
      source: "system_preset",
      fixedRoleCatalog: false,
      metadata: {
        successCriteria: ["요청 정리"],
        outputPreset: "concise_result_summary",
      },
    },
    allowedToolIds: input.allowedToolIds ?? [],
    allowedSystemIds: input.allowedSystemIds ?? [],
    failurePolicy: input.failurePolicy ?? {
      failureReportRequired: true,
      allowPartialSuccess: true,
      fallbackNodeIds: [],
    },
    recoveryPolicy: input.recoveryPolicy ?? {
      retryAllowed: false,
      redelegationAllowed: true,
      fallbackAllowed: false,
      partialSuccessAllowed: true,
    },
    metadata: input.metadata,
  }
}

function topologyFixture(): EnterpriseTopology {
  return {
    schemaVersion: 1,
    entityType: "topology",
    id: "topology:executor-fixture",
    name: "고객 요청 처리",
    status: "draft",
    createdAt: now,
    updatedAt: now,
    nodes: [
      node({
        id: "node:intake",
        name: "고객 접수 담당자",
        description: "고객 요청을 읽고 정리한다.",
        allowedToolIds: ["tool:crm-search"],
        metadata: {
          importedFromAgentConfigId: "agent:legacy-intake",
        },
      }),
      node({
        id: "node:ops",
        name: "운영 담당자",
        description: "정리된 요청을 처리한다.",
      }),
      node({
        id: "node:lead",
        name: "운영 리드",
        description: "처리 결과를 승인한다.",
        nodeType: "approval_node",
      }),
    ],
    teams: [{
      schemaVersion: 1,
      entityType: "team",
      id: "team:front-office",
      name: "Front Office",
      status: "draft",
      createdAt: now,
      updatedAt: now,
      purpose: "고객 요청 처리 영역",
      nodeIds: ["node:intake", "node:ops"],
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
      {
        schemaVersion: 1,
        entityType: "relation",
        id: "relation:intake-ops",
        name: "intake delegates ops",
        status: "draft",
        createdAt: now,
        updatedAt: now,
        relationType: "delegates_to",
        from: { entityType: "node", id: "node:intake" },
        to: { entityType: "node", id: "node:ops" },
      },
      {
        schemaVersion: 1,
        entityType: "relation",
        id: "relation:ops-lead",
        name: "ops approval",
        status: "draft",
        createdAt: now,
        updatedAt: now,
        relationType: "delegates_to",
        from: { entityType: "node", id: "node:ops" },
        to: { entityType: "node", id: "node:lead" },
      },
      {
        schemaVersion: 1,
        entityType: "relation",
        id: "relation:intake-tool",
        name: "intake uses CRM",
        status: "draft",
        createdAt: now,
        updatedAt: now,
        relationType: "uses_tool",
        from: { entityType: "node", id: "node:intake" },
        to: { entityType: "enterprise_tool", id: "tool:crm-search" },
      },
    ],
  }
}

function executorGraphFixture(): ExecutorGraphWorkspace {
  return {
    schemaVersion: 1,
    graphId: "executor-graph:test",
    topologyId: "topology:compiled-from-executors",
    name: "간단 고객 요청 흐름",
    mode: "simple",
    executors: [
      {
        id: "node:intake",
        name: "고객 접수 담당자",
        description: "고객 요청을 읽고 정리한다.",
        inferredRuntimeMode: "tool_execution",
        inferredCapabilities: ["고객 요청", "정리"],
        inferredTools: ["tool:crm-search"],
        inferredOutputs: ["정리된 요청"],
        inferredSuccessCriteria: ["요청 내용 정리", "다음 담당자 지정"],
        confidence: 0.82,
        userConfirmed: true,
        confirmedUnderstandingVersion: "understanding:v1",
      },
      {
        id: "node:ops",
        name: "운영 담당자",
        description: "정리된 요청을 처리한다.",
        inferredRuntimeMode: "auto",
        inferredCapabilities: ["처리"],
        inferredTools: [],
        inferredOutputs: ["처리 결과"],
        inferredSuccessCriteria: ["처리 결과 기록"],
        confidence: 0.76,
      },
    ],
    sections: [{
      id: "section:intake",
      name: "접수 영역",
      description: "실행자 배치용 영역",
      executorIds: ["node:intake", "node:ops"],
    }],
    connections: [{
      id: "connection:intake-ops",
      fromExecutorId: "node:intake",
      toExecutorId: "node:ops",
      inferredRelation: "handoff",
      label: "넘김",
      confidence: 0.79,
      userConfirmed: true,
    }],
    selectedId: null,
    inference: {
      source: "executor_graph_compile",
      confidence: 0.79,
      executorCount: 2,
      connectionCount: 1,
      issueCount: 0,
      generatedAt: now,
    },
    compiledPreview: null,
    latestRun: null,
    issues: [],
    sourceOfTruth: {
      editableProjection: "executor_graph",
      runtimeSourceOfTruth: "enterprise_topology",
      nodeContractBoundary: "node_contract",
      workOrderBoundary: "work_order",
      agentConfigRole: "runtime_option",
      projectionOnly: true,
    },
  }
}

describe("task003 executor graph viewmodel", () => {
  it("projects EnterpriseTopology nodes, sections, and executor connections into ExecutorGraph", () => {
    const topology = topologyFixture()
    const graph = buildExecutorGraphFromEnterpriseTopology(topology, { now })

    expect(graph).toEqual(expect.objectContaining({
      schemaVersion: 1,
      graphId: "executor-graph:topology:executor-fixture",
      topologyId: topology.id,
      name: topology.name,
      mode: "simple",
    }))
    expect(graph.sourceOfTruth).toEqual(expect.objectContaining({
      editableProjection: "executor_graph",
      runtimeSourceOfTruth: "enterprise_topology",
      agentConfigRole: "runtime_option",
      projectionOnly: true,
    }))
    expect(graph.executors.map((executor) => executor.name)).toEqual([
      "고객 접수 담당자",
      "운영 담당자",
      "운영 리드",
    ])
    expect(graph.executors[0]).toEqual(expect.objectContaining({
      id: "node:intake",
      sourceNodeId: "node:intake",
      inferredRuntimeMode: "auto",
      inferredTools: ["tool:crm-search"],
      confidence: 0.55,
    }))
    expect(graph.executors[2]).toEqual(expect.objectContaining({
      inferredRuntimeMode: "approval",
    }))
    expect(graph.sections).toEqual([
      expect.objectContaining({
        id: "team:front-office",
        executorIds: ["node:intake", "node:ops"],
        sourceTeamId: "team:front-office",
      }),
    ])
    expect(graph.connections).toEqual([
      expect.objectContaining({
        id: "relation:intake-ops",
        inferredRelation: "handoff",
        advancedRelationType: "delegates_to",
      }),
      expect.objectContaining({
        id: "relation:ops-lead",
        inferredRelation: "approval_request",
        label: "승인 요청",
      }),
    ])
    expect(graph.connections.map((connection) => connection.id)).not.toContain("relation:intake-tool")
    expect(graph.inference).toEqual(expect.objectContaining({
      source: "enterprise_topology_projection",
      executorCount: 3,
      connectionCount: 2,
      issueCount: 0,
    }))
  })

  it("compiles ExecutorGraph into EnterpriseTopology without replacing the source-of-truth boundary", () => {
    const graph = executorGraphFixture()
    const result = compileExecutorGraphToEnterpriseTopology(graph, { now })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.operations.map((operation) => operation.op)).toEqual([
      "createNode",
      "updateNode",
      "createNode",
      "updateNode",
      "createRelation",
    ])
    expect(result.topology.id).toBe("topology:compiled-from-executors")
    expect(result.topology.nodes.map((node) => node.id)).toEqual(["node:intake", "node:ops"])
    expect(result.topology.nodes[0]).toEqual(expect.objectContaining({
      nodeType: "automation_node",
      allowedToolIds: [],
      children: ["node:ops"],
    }))
    expect(result.topology.relations).toEqual([
      expect.objectContaining({
        id: "relation:connection:intake-ops",
        relationType: "delegates_to",
        label: "넘김",
      }),
    ])
    expect(result.metadata).toEqual(expect.objectContaining({
      graphId: graph.graphId,
      sourceOfTruth: "enterprise_topology",
      projectionOnly: true,
      executorIds: ["node:intake", "node:ops"],
      confirmedExecutorIds: ["node:intake"],
    }))
    expect(readExecutorGraphMetadata(result.topology)).toEqual(result.metadata)
    expect(result.topology.nodes[0]?.metadata?.[EXECUTOR_GRAPH_METADATA_KEY]).toEqual(expect.objectContaining({
      executorId: "node:intake",
      graphId: graph.graphId,
      userConfirmed: true,
      sourceOfTruth: "enterprise_topology",
      projectionOnly: true,
    }))
  })

  it("keeps inferred tool hints out of persisted node permissions unless the tool exists in the topology", () => {
    const graph = executorGraphFixture()
    const inferredOnly = compileExecutorGraphToEnterpriseTopology(graph, { now })
    const validToolBase = topologyFixture()
    const withDeclaredTool = compileExecutorGraphToEnterpriseTopology(graph, {
      baseTopology: validToolBase,
      now,
    })

    expect(inferredOnly.ok).toBe(true)
    if (!inferredOnly.ok) return
    expect(inferredOnly.topology.tools).toEqual([])
    expect(inferredOnly.topology.nodes.find((candidate) => candidate.id === "node:intake")?.allowedToolIds).toEqual([])

    expect(withDeclaredTool.ok).toBe(true)
    if (!withDeclaredTool.ok) return
    expect(withDeclaredTool.topology.tools.map((tool) => tool.id)).toContain("tool:crm-search")
    expect(withDeclaredTool.topology.nodes.find((candidate) => candidate.id === "node:intake")?.allowedToolIds).toEqual([
      "tool:crm-search",
    ])
  })

  it("preserves existing EnterpriseTopology resources and updates existing nodes through GUI operations", () => {
    const base = topologyFixture()
    const graph = executorGraphFixture()
    const result = compileExecutorGraphToEnterpriseTopology(graph, {
      baseTopology: base,
      now,
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.operations.map((operation) => operation.op)).toEqual([
      "updateNode",
      "updateNode",
      "createRelation",
    ])
    expect(result.topology.systems).toEqual(base.systems)
    expect(result.topology.tools).toEqual(base.tools)
    expect(result.topology.nodes.find((candidate) => candidate.id === "node:lead")).toBeDefined()
    expect(result.topology.nodes.find((candidate) => candidate.id === "node:intake")?.description)
      .toBe("고객 요청을 읽고 정리한다.")
  })

  it("preserves an intentionally emptied executor description instead of falling back to node type", () => {
    const base = topologyFixture()
    const graph = buildExecutorGraphFromEnterpriseTopology(base, { mode: "simple", now })
    const nextGraph: ExecutorGraphWorkspace = {
      ...graph,
      executors: graph.executors.map((executor) =>
        executor.id === "node:ops"
          ? {
            ...executor,
            description: "",
            advancedMapping: {
              ...(executor.advancedMapping ?? { executorKind: "manual_approval", allowedToolIds: [], allowedSystemIds: [] }),
              nodeType: "review_node",
            },
          }
          : executor
      ),
    }
    const result = compileExecutorGraphToEnterpriseTopology(nextGraph, {
      baseTopology: base,
      now,
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    const updatedNode = result.topology.nodes.find((candidate) => candidate.id === "node:ops")
    const projectedGraph = buildExecutorGraphFromEnterpriseTopology(result.topology, { mode: "simple", now })
    const projectedExecutor = projectedGraph.executors.find((candidate) => candidate.id === "node:ops")

    expect(updatedNode?.description).toBe("")
    expect(updatedNode?.nodeType).toBe("review_node")
    expect(projectedExecutor?.description).toBe("")
    expect(projectedExecutor?.description).not.toBe("review_node")
  })

  it("allows an executor name to be temporarily blank while the user is editing", () => {
    const base = topologyFixture()
    const graph = buildExecutorGraphFromEnterpriseTopology(base, { mode: "simple", now })
    const nextGraph: ExecutorGraphWorkspace = {
      ...graph,
      executors: graph.executors.map((executor) =>
        executor.id === "node:ops"
          ? {
            ...executor,
            name: " ",
          }
          : executor
      ),
    }
    const result = compileExecutorGraphToEnterpriseTopology(nextGraph, {
      baseTopology: base,
      now,
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    const updatedNode = result.topology.nodes.find((candidate) => candidate.id === "node:ops")
    const projectedGraph = buildExecutorGraphFromEnterpriseTopology(result.topology, { mode: "simple", now })
    const projectedExecutor = projectedGraph.executors.find((candidate) => candidate.id === "node:ops")

    expect(result.metadata.executorIds).toContain("node:ops")
    expect(updatedNode?.name).toBe(" ")
    expect(projectedExecutor?.name).toBe(" ")
    expect(projectedGraph.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({
        severity: "warning",
        code: "blank_executor_name",
        targetId: "node:ops",
      }),
    ]))
  })

  it("persists executor canvas positions through EnterpriseTopology metadata", () => {
    const base = topologyFixture()
    const graph = buildExecutorGraphFromEnterpriseTopology(base, { mode: "simple", now })
    const nextGraph: ExecutorGraphWorkspace = {
      ...graph,
      executors: graph.executors.map((executor) =>
        executor.id === "node:ops"
          ? {
            ...executor,
            position: { x: 420, y: 180 },
          }
          : executor
      ),
    }
    const result = compileExecutorGraphToEnterpriseTopology(nextGraph, {
      baseTopology: base,
      now,
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    const updatedNode = result.topology.nodes.find((candidate) => candidate.id === "node:ops")
    const projectedGraph = buildExecutorGraphFromEnterpriseTopology(result.topology, { mode: "simple", now })
    const projectedExecutor = projectedGraph.executors.find((candidate) => candidate.id === "node:ops")

    expect(updatedNode?.metadata?.[EXECUTOR_GRAPH_METADATA_KEY]).toEqual(expect.objectContaining({
      position: { x: 420, y: 180 },
    }))
    expect(result.metadata.workspace.executors.find((executor) => executor.id === "node:ops")?.position)
      .toEqual({ x: 420, y: 180 })
    expect(projectedExecutor?.position).toEqual({ x: 420, y: 180 })
  })

  it("returns validation issues without mutating the base topology when graph conversion fails", () => {
    const base = topologyFixture()
    const before = structuredClone(base)
    const graph = executorGraphFixture()
    graph.connections = [{
      id: "connection:missing",
      fromExecutorId: "node:intake",
      toExecutorId: "node:missing",
      inferredRelation: "handoff",
      label: "넘김",
      confidence: 0.2,
      userConfirmed: false,
    }]

    const result = compileExecutorGraphToEnterpriseTopology(graph, {
      baseTopology: base,
      now,
    })

    expect(result.ok).toBe(false)
    expect(result.issues).toEqual([
      expect.objectContaining({
        code: "missing_connection_endpoint",
        targetId: "connection:missing",
      }),
    ])
    expect(base).toEqual(before)
    expect(result.topology).toEqual(before)
  })

  it("stores and restores ExecutorGraph metadata without making AgentConfig the source of truth", () => {
    const topology = topologyFixture()
    const graph = buildExecutorGraphFromEnterpriseTopology(topology, { now })
    const withMetadata = attachExecutorGraphMetadata(topology, graph, { now })
    const restored = readExecutorGraphMetadata(withMetadata)

    expect(restored).toEqual(expect.objectContaining({
      schemaVersion: 1,
      graphId: graph.graphId,
      topologyId: topology.id,
      sourceOfTruth: "enterprise_topology",
      projectionOnly: true,
      executorIds: graph.executors.map((executor) => executor.id),
      connectionIds: graph.connections.map((connection) => connection.id),
      sectionIds: graph.sections.map((section) => section.id),
    }))
    expect(JSON.stringify(restored)).not.toContain("sourceOfTruth\":\"agent")
    expect(JSON.stringify(withMetadata.metadata?.[EXECUTOR_GRAPH_METADATA_KEY])).toContain("enterprise_topology")
    expect(topology.metadata).toBeUndefined()
  })

  it("exposes the same projection helper from the WebUI layer for future simple screens", () => {
    const topology = topologyFixture()
    const fromCore = buildExecutorGraphFromEnterpriseTopology(topology, { now })
    const fromWebui = buildExecutorGraphFromWebuiHelper(topology, { now })

    expect(fromWebui.executors.map((executor) => executor.id)).toEqual(fromCore.executors.map((executor) => executor.id))
    expect(fromWebui.connections.map((connection) => connection.id)).toEqual(fromCore.connections.map((connection) => connection.id))
    expect(fromWebui.sourceOfTruth).toEqual(fromCore.sourceOfTruth)
  })

  it("creates deterministic GUI operations for ExecutorGraph changes", () => {
    const graph = executorGraphFixture()
    const operations = buildExecutorGraphGuiOperations(graph, null, { now })

    expect(operations.map((operation) => operation.operationId)).toEqual([
      "executor-graph:create-node:node:intake:1777636800000",
      "executor-graph:update-node:node:intake:1777636800000",
      "executor-graph:create-node:node:ops:1777636800000",
      "executor-graph:update-node:node:ops:1777636800000",
      "executor-graph:create-relation:relation:connection:intake-ops:1777636800000",
    ])
  })
})
