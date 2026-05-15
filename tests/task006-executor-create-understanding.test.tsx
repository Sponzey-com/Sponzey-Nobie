import { createElement } from "../packages/webui/node_modules/react/index.js"
import { renderToStaticMarkup } from "../packages/webui/node_modules/react-dom/server.js"
import { describe, expect, it } from "vitest"
import {
  EXECUTOR_GRAPH_SOURCE_OF_TRUTH,
  compileExecutorGraphToEnterpriseTopology,
  readExecutorGraphMetadata,
  type ExecutorGraphWorkspace,
} from "../packages/core/src/topology/executor-graph.ts"
import {
  EXECUTOR_UNDERSTANDING_VERSION,
  confirmExecutorUnderstanding,
  createExecutorDraftFromInference,
  inferExecutorFromDescription,
} from "../packages/webui/src/lib/executor-inference.ts"
import { ExecutorCreatePanel } from "../packages/webui/src/components/topology/ExecutorCreatePanel.tsx"
import { ExecutorUnderstandingPanel } from "../packages/webui/src/components/topology/ExecutorUnderstandingPanel.tsx"

const now = Date.UTC(2026, 4, 2, 10, 0, 0)

describe("task006 executor create and understanding", () => {
  it("creates an ExecutorDraft from only name and description", () => {
    const executor = createExecutorDraftFromInference({
      id: "node:customer-intake",
      name: "고객 접수 담당자",
      description: "고객 요청을 읽고 CRM에서 고객 정보를 확인한 뒤 정리한다.",
      now,
    })

    expect(executor).toEqual(expect.objectContaining({
      id: "node:customer-intake",
      name: "고객 접수 담당자",
      description: "고객 요청을 읽고 CRM에서 고객 정보를 확인한 뒤 정리한다.",
      inferredRuntimeMode: "unknown",
      inferredTools: [],
      inferredOutputs: expect.arrayContaining(["처리 결과"]),
      inferredCapabilities: expect.arrayContaining(["고객 요청을 읽고 CRM에서 고객 정보를 확인한 뒤 정리한다."]),
      confidence: expect.any(Number),
    }))
    expect(JSON.stringify(executor)).not.toContain("WorkOrder Template")
    expect(JSON.stringify(executor)).not.toContain("Context")
  })

  it("keeps name and description inference profile-first without language keyword routing", () => {
    expect(inferExecutorFromDescription({
      name: "CRM 확인",
      description: "CRM에서 고객 정보를 검색하고 정리한다.",
    })).toEqual(expect.objectContaining({
      runtimeMode: "unknown",
      toolHints: [],
      outputHints: expect.arrayContaining(["처리 결과"]),
    }))
    expect(inferExecutorFromDescription({
      name: "승인자",
      description: "승인 여부를 확인하고 결과를 남긴다.",
    })).toEqual(expect.objectContaining({
      runtimeMode: "unknown",
      outputHints: expect.arrayContaining(["처리 결과"]),
    }))
    expect(inferExecutorFromDescription({
      name: "검토자",
      description: "처리 결과를 검토하고 의견을 남긴다.",
    })).toEqual(expect.objectContaining({
      runtimeMode: "unknown",
      outputHints: expect.arrayContaining(["처리 결과"]),
    }))
    expect(inferExecutorFromDescription({
      name: "예외 처리",
      description: "실패나 예외 상황을 정리하고 다음 조치를 보고한다.",
    })).toEqual(expect.objectContaining({
      runtimeMode: "unknown",
      capabilityHints: expect.arrayContaining(["실패나 예외 상황을 정리하고 다음 조치를 보고한다."]),
      successCriteria: expect.arrayContaining(["처리 결과가 기록됨"]),
    }))
    expect(inferExecutorFromDescription({
      name: "자료 조사",
      description: "자료를 조사하고 핵심 내용을 요약해 보고한다.",
    })).toEqual(expect.objectContaining({
      runtimeMode: "unknown",
      toolHints: [],
      outputHints: expect.arrayContaining(["처리 결과"]),
    }))
  })

  it("renders create and understanding panels with only name, work description, examples, and natural-language understanding", () => {
    const createHtml = renderToStaticMarkup(
      createElement(ExecutorCreatePanel, {
        initialName: "고객 접수 담당자",
        initialDescription: "고객 요청을 읽고 CRM에서 고객 정보를 확인한 뒤 정리한다.",
      }),
    )
    const understandingHtml = renderToStaticMarkup(
      createElement(ExecutorUnderstandingPanel, {
        name: "고객 접수 담당자",
        description: "고객 요청을 읽고 CRM에서 고객 정보를 확인한 뒤 정리한다.",
      }),
    )

    expect(createHtml).toContain('data-testid="executor-create-panel"')
    expect(createHtml).toContain("이름")
    expect(createHtml).toContain("하는 일")
    expect(createHtml).toContain('data-testid="executor-create-example-chip"')
    expect(createHtml).not.toContain("WorkOrder Template")
    expect(createHtml).not.toContain("Context")
    expect(createHtml).not.toContain("업무유형")
    expect(understandingHtml).toContain('data-testid="executor-understanding-panel"')
    expect(understandingHtml).toContain("노비가 이해한 내용")
    expect(understandingHtml).toContain("저장")
    expect(understandingHtml).not.toContain("필요한 도구")
    expect(understandingHtml).not.toContain("성공 기준")
    expect(understandingHtml).not.toContain("맞아요")
    expect(understandingHtml).not.toContain("수정할래요")
    expect(understandingHtml).not.toContain('data-testid="executor-understanding-revise"')
  })

  it("stores confirmed understanding in topology metadata after compile", () => {
    const executor = confirmExecutorUnderstanding(createExecutorDraftFromInference({
      id: "node:confirmed",
      name: "승인 확인",
      description: "승인 여부를 확인하고 결과를 남긴다.",
      now,
    }))
    const graph = executorGraph([executor])
    const result = compileExecutorGraphToEnterpriseTopology(graph, { now })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    const metadata = readExecutorGraphMetadata(result.topology)
    expect(metadata?.confirmedExecutorIds).toEqual(["node:confirmed"])
    expect(metadata?.workspace.executors[0]).toEqual(expect.objectContaining({
      userConfirmed: true,
      confirmedUnderstandingVersion: EXECUTOR_UNDERSTANDING_VERSION,
    }))
    expect(result.topology.nodes[0]?.metadata?.executorGraph).toEqual(expect.objectContaining({
      userConfirmed: true,
      confirmedUnderstandingVersion: EXECUTOR_UNDERSTANDING_VERSION,
      sourceOfTruth: "executor_topology_v2",
      projectionOnly: true,
    }))
  })

  it("marks low-confidence descriptions as not ready for auto run", () => {
    const inference = inferExecutorFromDescription({
      name: "담당자",
      description: "처리",
    })
    const executor = createExecutorDraftFromInference({
      id: "node:unclear",
      name: "담당자",
      description: "처리",
      now,
    })
    const html = renderToStaticMarkup(
      createElement(ExecutorUnderstandingPanel, {
        name: "담당자",
        description: "처리",
      }),
    )

    expect(inference.confidence).toBeLessThan(0.58)
    expect(inference.readyForAutoRun).toBe(false)
    expect(inference.requiresClarification).toBe(true)
    expect(executor.inferredRuntimeMode).toBe("unknown")
    expect(html).toContain('data-testid="executor-understanding-low-confidence"')
    expect(html).toContain('data-ready-for-auto-run="false"')
  })
})

function executorGraph(executors: ExecutorGraphWorkspace["executors"]): ExecutorGraphWorkspace {
  return {
    schemaVersion: 1,
    graphId: "executor-graph:task006",
    topologyId: "topology:task006",
    name: "Task006 graph",
    mode: "simple",
    executors,
    sections: [],
    connections: [],
    selectedId: executors[0]?.id ?? null,
    inference: {
      source: "executor_graph_compile",
      confidence: executors[0]?.confidence ?? 0,
      executorCount: executors.length,
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
