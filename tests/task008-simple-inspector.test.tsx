import { createElement } from "../packages/webui/node_modules/react/index.js"
import { renderToStaticMarkup } from "../packages/webui/node_modules/react-dom/server.js"
import { describe, expect, it } from "vitest"
import {
  EXECUTOR_GRAPH_SOURCE_OF_TRUTH,
  compileExecutorGraphToEnterpriseTopology,
  type ExecutorConnectionDraft,
  type ExecutorDraft,
  type ExecutorGraphWorkspace,
} from "../packages/webui/src/lib/executor-graph.ts"
import {
  createExecutorDraftFromInference,
  confirmExecutorUnderstanding,
} from "../packages/webui/src/lib/executor-inference.ts"
import {
  createExecutorConnectionDraft,
} from "../packages/webui/src/lib/executor-relation-inference.ts"
import {
  ExecutorInspector,
  describeExecutorConnections,
  executorFriendlyRuntimeLabel,
  updateExecutorDraftFromInspector,
} from "../packages/webui/src/components/topology/ExecutorInspector.tsx"
import {
  buildTopologyWorkspaceExecutorMapping,
} from "../packages/webui/src/components/topology/TopologyWorkspaceInspector.tsx"
import { TopologyWorkspaceCanvas } from "../packages/webui/src/components/topology/TopologyWorkspaceCanvas.tsx"

const now = Date.UTC(2026, 4, 2, 12, 0, 0)

describe("task008 simple inspector and advanced isolation", () => {
  it("renders the basic executor inspector around Nobie's understanding and natural connections", () => {
    const graph = graphFixture()
    const executor = graph.executors[0]!
    const html = renderToStaticMarkup(
      createElement(ExecutorInspector, {
        executor,
        graph,
      }),
    )

    expect(html).toContain('data-testid="executor-inspector"')
    expect(html).toContain("노비가 이해한 내용")
    expect(html).toContain("연결된 실행자")
    expect(html).toContain("운영 담당자에게 넘김")
    expect(html).not.toContain("필요한 도구")
    expect(html).not.toContain("성공 기준")
    expect(html).not.toContain("필요해 보이는 도구")
    expect(html).not.toContain('data-testid="executor-inspector-tools"')
    expect(html).not.toContain('data-testid="executor-inspector-outputs"')
    expect(html).toContain("저장")
    expect(html).not.toContain("맞아요")
    expect(html).not.toContain("수정할래요")
    expect(html).not.toContain('data-testid="executor-understanding-revise"')
    expect(describeExecutorConnections(graph, executor.id)[0]).toEqual(expect.objectContaining({
      textKo: "운영 담당자에게 넘김",
    }))
  })

  it("keeps internal ids, WorkOrder template ids, and raw schema out of the default inspector", () => {
    const graph = graphFixture()
    const html = renderToStaticMarkup(
      createElement(ExecutorInspector, {
        executor: graph.executors[0],
        graph,
      }),
    )

    expect(html).not.toContain("Agent id")
    expect(html).not.toContain("Team id")
    expect(html).not.toContain("agent:intake")
    expect(html).not.toContain("team:support")
    expect(html).not.toContain("WorkOrder Template")
    expect(html).not.toContain("Context")
    expect(html).not.toContain("raw schema")
    expect(html).not.toContain("JSON Schema")
    expect(html).not.toContain("manual_approval")
    expect(html).not.toContain("nobie")
  })

  it("shows duplicate executor names as invalid before saving", () => {
    const graph = graphFixture()
    const duplicate = {
      ...graph.executors[1]!,
      name: graph.executors[0]!.name,
    }
    const html = renderToStaticMarkup(
      createElement(ExecutorInspector, {
        executor: duplicate,
        graph: { ...graph, executors: [graph.executors[0]!, duplicate] },
      }),
    )

    expect(html).toContain('data-testid="executor-inspector-duplicate-name"')
    expect(html).toContain("이미 사용 중인 이름입니다")
    expect(html).toContain('aria-invalid="true"')
  })

  it("keeps advanced executor mapping controls out of the selected executor card", () => {
    const graph = graphFixture()
    const executor = {
      ...graph.executors[0]!,
      advancedMapping: {
        nodeType: "function" as const,
        executorKind: "agent" as const,
        executorId: "agent:intake",
        allowedToolIds: [],
        allowedSystemIds: [],
      },
    }
    const html = renderToStaticMarkup(
      createElement(ExecutorInspector, {
        executor,
        graph: { ...graph, executors: [executor, graph.executors[1]!] },
      }),
    )

    expect(html).toContain("선택한 실행자")
    expect(html).toContain("노비가 이해한 내용")
    expect(html).not.toContain('data-testid="executor-inspector-advanced-settings"')
    expect(html).not.toContain('data-testid="executor-inspector-runtime-mode"')
    expect(html).not.toContain('data-testid="executor-inspector-advanced-contract"')
    expect(html).not.toContain('data-testid="topology-workspace-executor-picker"')
    expect(html).not.toContain("기존 Agent")
    expect(html).not.toContain("Manual/Approval only")
  })

  it("maps runtime modes to user-facing execution labels", () => {
    expect(executorFriendlyRuntimeLabel("tool_execution")).toBe("도구 실행")
    expect(executorFriendlyRuntimeLabel("approval")).toBe("최종 검토")
    expect(executorFriendlyRuntimeLabel("external")).toBe("외부 처리")
    expect(executorFriendlyRuntimeLabel("auto")).toBe("자동 처리")
  })

  it("refreshes inference and marks confirmation stale when name or description changes", () => {
    const confirmed = confirmExecutorUnderstanding(createExecutorDraftFromInference({
      id: "node:reviewer",
      name: "검토자",
      description: "처리 결과를 검토하고 의견을 남긴다.",
      now,
    }))
    const positioned = { ...confirmed, position: { x: 380, y: 160 } }
    const updated = updateExecutorDraftFromInspector(positioned, {
      description: "CRM에서 고객 정보를 검색하고 결과를 요약한다.",
      now,
    })

    expect(positioned.userConfirmed).toBe(true)
    expect(updated.userConfirmed).toBeUndefined()
    expect(updated.confirmedUnderstandingVersion).toBeUndefined()
    expect(updated.position).toEqual({ x: 380, y: 160 })
    expect(updated.inferredRuntimeMode).toBe("auto")
    expect(updated.inferredTools).toEqual([])
    expect(updated.inferredOutputs).toContain("처리 결과")
  })

  it("preserves raw spaces while editing executor name and description", () => {
    const executor = createExecutorDraftFromInference({
      id: "node:space-edit",
      name: "검토자",
      description: "처리 결과를 검토한다.",
      now,
    })
    const updated = updateExecutorDraftFromInspector(executor, {
      name: "검토자 ",
      description: "  ",
      now,
    })

    expect(updated.name).toBe("검토자 ")
    expect(updated.description).toBe("  ")
  })

  it("keeps createsAgentConfig=false while advanced mapping remains available", () => {
    const mapping = buildTopologyWorkspaceExecutorMapping({
      nodeId: "node:intake",
      executorKind: "agent",
      executorId: "agent:intake",
      selectedAt: now,
    })

    expect(mapping).toEqual(expect.objectContaining({
      sourceOfTruth: "enterprise_node",
      executorKind: "agent",
      executorId: "agent:intake",
      createsAgentConfig: false,
    }))
  })

  it("wires the simple workspace canvas to the simple executor inspector", () => {
    const graph = graphFixture()
    const compiled = compileExecutorGraphToEnterpriseTopology(graph, { now })
    expect(compiled.ok).toBe(true)
    if (!compiled.ok) return
    const html = renderToStaticMarkup(
      createElement(TopologyWorkspaceCanvas, {
        selectedLayer: "build",
        exposureMode: "simple",
        topology: compiled.topology,
      }),
    )

    expect(html).toContain('data-testid="topology-workspace-simple-executor-layout"')
    expect(html).toContain('data-testid="executor-graph-canvas"')
    expect(html).toContain('data-testid="topology-workspace-simple-sidebar"')
    expect(html).toContain('data-testid="executor-inspector"')
    expect(html).toContain("선택한 실행자")
    expect(html).toContain("성격과 하는 일")
    expect(html).not.toContain('data-testid="enterprise-topology-inspector"')
  })

  it("keeps the simple sidebar focused on the selected executor definition card", () => {
    const graph = graphFixture()
    const compiled = compileExecutorGraphToEnterpriseTopology(graph, { now })
    expect(compiled.ok).toBe(true)
    if (!compiled.ok) return
    const html = renderToStaticMarkup(
      createElement(TopologyWorkspaceCanvas, {
        selectedLayer: "build",
        exposureMode: "simple",
        topology: compiled.topology,
      }),
    )

    expect(html).not.toContain('data-testid="topology-workspace-simple-test-card"')
    expect(html).not.toContain('data-testid="mock-simple-test-card"')
    expect(html).toContain('data-testid="executor-inspector"')
  })
})

function graphFixture(): ExecutorGraphWorkspace {
  const intake = createExecutorDraftFromInference({
    id: "node:intake",
    name: "고객 접수 담당자",
    description: "고객 요청을 읽고 CRM에서 고객 정보를 확인한 뒤 요약한다.",
    now,
  })
  const operator = createExecutorDraftFromInference({
    id: "node:operator",
    name: "운영 담당자",
    description: "정리된 요청을 처리하고 결과를 남긴다.",
    now,
  })
  const connection = createExecutorConnectionDraft({
    id: "connection:intake-operator",
    source: intake,
    target: operator,
  })

  return graph([intake, operator], [connection])
}

function graph(executors: ExecutorDraft[], connections: ExecutorConnectionDraft[]): ExecutorGraphWorkspace {
  return {
    schemaVersion: 1,
    graphId: "executor-graph:task008",
    topologyId: "topology:task008",
    name: "Task008 graph",
    mode: "simple",
    executors,
    sections: [],
    connections,
    selectedId: executors[0]?.id ?? null,
    inference: {
      source: "executor_graph_compile",
      confidence: 0.8,
      executorCount: executors.length,
      connectionCount: connections.length,
      issueCount: 0,
      generatedAt: now,
    },
    compiledPreview: null,
    latestRun: null,
    issues: [],
    sourceOfTruth: EXECUTOR_GRAPH_SOURCE_OF_TRUTH,
  }
}
