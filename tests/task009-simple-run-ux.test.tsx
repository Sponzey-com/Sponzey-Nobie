import { createElement } from "../packages/webui/node_modules/react/index.js"
import { renderToStaticMarkup } from "../packages/webui/node_modules/react-dom/server.js"
import { describe, expect, it } from "vitest"
import { WORK_ORDER_TEMPLATE_CATALOG } from "../packages/core/src/topology-runtime/work-order-templates.ts"
import {
  EXECUTOR_GRAPH_SOURCE_OF_TRUTH,
  compileExecutorGraphToEnterpriseTopology,
  type ExecutorConnectionDraft,
  type ExecutorDraft,
  type ExecutorGraphWorkspace,
} from "../packages/webui/src/lib/executor-graph.ts"
import { createExecutorDraftFromInference } from "../packages/webui/src/lib/executor-inference.ts"
import { createExecutorConnectionDraft } from "../packages/webui/src/lib/executor-relation-inference.ts"
import {
  ExecutorRunPanel,
  resolveExecutorRunState,
} from "../packages/webui/src/components/topology/ExecutorRunPanel.tsx"
import { TopologyRunLauncher } from "../packages/webui/src/components/topology/TopologyRunLauncher.tsx"
import type { EnterpriseTopologyRunRecord } from "../packages/webui/src/lib/enterprise-topology-operations.ts"

const now = Date.UTC(2026, 4, 2, 13, 0, 0)
const templates = WORK_ORDER_TEMPLATE_CATALOG.templates

describe("task009 simple run UX", () => {
  it("renders simple channel request UI without WorkOrder Template or Context selectors", () => {
    const topology = compileTopology(graph([
      executor("node:intake", "고객 접수 담당자", "고객 요청을 읽고 CRM에서 고객 정보를 확인한 뒤 요약한다."),
    ]))
    const html = renderToStaticMarkup(
      createElement(TopologyRunLauncher, {
        exposureMode: "simple",
        topology,
        templates,
        simulationMode: "success",
        advancedInstruction: "고객 요청을 처리해줘",
      }),
    )

    expect(html).toContain('data-testid="executor-run-panel"')
    expect(html).toContain('data-testid="topology-run-simple-panel"')
    expect(html).toContain('data-testid="topology-run-simple-input"')
    expect(html).toContain("채널에서 들어온 요청을 써 보세요.")
    expect(html).toContain('data-testid="topology-run-request-send"')
    expect(html).not.toContain('data-testid="topology-run-template-picker"')
    expect(html).not.toContain('data-testid="topology-run-context-picker"')
    expect(html).not.toContain("WorkOrder Template")
    expect(html).not.toContain("Context")
    expect(html).not.toContain('data-testid="topology-run-submit"')
  })

  it("auto-selects a single executor as the start executor", () => {
    const topology = compileTopology(graph([
      executor("node:single", "운영 담당자", "정해진 절차에 따라 고객 요청을 처리한다."),
    ]))
    const resolved = resolveExecutorRunState({
      topology,
      templates,
      runInput: "요청 처리",
      simulationMode: "success",
    })

    expect(resolved.startSource).toBe("single_executor")
    expect(resolved.selectedStartExecutorId).toBe("node:single")
    expect(resolved.requiresStartChoice).toBe(false)
  })

  it("renders the sidebar request card with a simple request flow preview", () => {
    const intake = executor("node:intake", "고객 접수 담당자", "고객 요청을 확인한다.")
    const reviewer = executor("node:reviewer", "검토자", "결과를 검토하고 답변한다.")
    const topology = compileTopology(graph([intake, reviewer], [connection(intake, reviewer)]))
    const html = renderToStaticMarkup(
      createElement(ExecutorRunPanel, {
        topology,
        templates,
        layout: "sidebar",
        runInput: "고객 요청을 테스트해줘",
        simulationMode: "success",
      }),
    )

    expect(html).toContain('data-testid="executor-run-panel"')
    expect(html).toContain('data-layout="sidebar"')
    expect(html).toContain("요청 흐름")
    expect(html).toContain('data-testid="executor-test-flow-preview"')
    expect(html).toContain('data-testid="executor-test-flow-step"')
    expect(html).toContain("고객 접수 담당자")
    expect(html).toContain("검토자")
    expect(html).not.toContain("WorkOrder Template")
  })

  it("asks where to start when multiple root executors exist", () => {
    const topology = compileTopology(graph([
      executor("node:intake", "고객 접수 담당자", "고객 요청을 확인한다."),
      executor("node:research", "자료 조사 담당자", "자료를 조사하고 요약한다."),
    ]))
    const html = renderToStaticMarkup(
      createElement(ExecutorRunPanel, {
        topology,
        templates,
        runInput: "고객 요청 처리",
        simulationMode: "success",
      }),
    )
    const resolved = resolveExecutorRunState({
      topology,
      templates,
      runInput: "고객 요청 처리",
      simulationMode: "success",
    })

    expect(resolved.startSource).toBe("ambiguous")
    expect(resolved.requiresStartChoice).toBe(true)
    expect(html).toContain("어디서 시작할까요?")
    expect(html).toContain('data-testid="executor-run-start-chip"')
    expect(html).toContain('data-executor-id="node:intake"')
    expect(html).toContain('data-executor-id="node:research"')
  })

  it("does not block channel request flow for low-confidence executors", () => {
    const topology = compileTopology(graph([
      executor("node:unclear", "담당자", "처리"),
    ]))
    const resolved = resolveExecutorRunState({
      topology,
      templates,
      runInput: "이 요청을 처리해줘",
      simulationMode: "success",
    })
    const html = renderToStaticMarkup(
      createElement(ExecutorRunPanel, {
        topology,
        templates,
        runInput: "이 요청을 처리해줘",
        simulationMode: "success",
      }),
    )

    expect(resolved.lowConfidenceExecutors.map((item) => item.id)).toEqual(["node:unclear"])
    expect(resolved.requiresConfirmation).toBe(false)
    expect(html).toContain('data-requires-confirmation="false"')
    expect(html).not.toContain('data-testid="executor-run-low-confidence-confirmation"')
  })

  it("keeps the internal payload on explicit/default template values instead of request keyword inference", () => {
    const topology = compileTopology(graph([
      executor("node:intake", "고객 접수 담당자", "고객 요청을 읽고 CRM에서 고객 정보를 확인한 뒤 요약한다."),
    ]))
    const resolved = resolveExecutorRunState({
      topology,
      templates,
      runInput: "긴급 오류 실패 고객 이슈를 접수하고 처리해줘",
      simulationMode: "success",
    })

    expect(resolved.payload).toEqual(expect.objectContaining({
      entryNodeId: "node:intake",
      templateId: "work-order-template:customer-request-triage",
      contextPresetId: "context:customer-general",
      simulationMode: "success",
    }))
    expect(resolved.payload?.input).toEqual(expect.objectContaining({
      launchedFrom: "executor_run_panel",
      requestText: "긴급 오류 실패 고객 이슈를 접수하고 처리해줘",
      inferredTemplateId: "work-order-template:customer-request-triage",
      inferredContextPresetId: "context:customer-general",
      executorRun: expect.objectContaining({
        source: "executor_run_panel",
        startSource: "single_executor",
      }),
    }))
    expect(resolved.payload?.advancedInstruction).toBe("긴급 오류 실패 고객 이슈를 접수하고 처리해줘")
  })

  it("uses the user's selected template and context when provided", () => {
    const topology = compileTopology(graph([
      executor("node:intake", "고객 접수 담당자", "고객 요청을 읽고 CRM에서 고객 정보를 확인한 뒤 요약한다."),
    ]))
    const resolved = resolveExecutorRunState({
      topology,
      templates,
      selectedTemplateId: "work-order-template:failure-drill",
      selectedContextPresetId: "context:tool-timeout",
      runInput: "일반 요청",
      simulationMode: "failure",
    })

    expect(resolved.payload).toEqual(expect.objectContaining({
      entryNodeId: "node:intake",
      templateId: "work-order-template:failure-drill",
      contextPresetId: "context:tool-timeout",
      simulationMode: "failure",
    }))
  })

  it("routes advanced run launcher requests to the simple run panel", () => {
    const html = renderToStaticMarkup(
      createElement(TopologyRunLauncher, {
        exposureMode: "advanced",
        templates,
        selectedTemplateId: templates[0]!.templateId,
        selectedContextPresetId: templates[0]!.contextPresets[0]!.id,
        simulationMode: "success",
        advancedInstruction: "",
        runTargetNodeId: "node:intake",
      }),
    )

    expect(html).toContain('data-testid="topology-run-simple-panel"')
    expect(html).not.toContain('data-testid="topology-run-strip-controls"')
    expect(html).not.toContain('data-layout="one-line"')
    expect(html).not.toContain('data-testid="topology-run-template-picker"')
    expect(html).not.toContain('data-testid="topology-run-context-picker"')
    expect(html).not.toContain("WorkOrder Template")
    expect(html).not.toContain("Context")
  })

  it("suggests viewing history after a recent run exists", () => {
    const topology = compileTopology(graph([
      executor("node:intake", "고객 접수 담당자", "고객 요청을 확인한다."),
    ]))
    const recentRun: EnterpriseTopologyRunRecord = {
      topologyRunId: "topology-run:task009",
      topologyId: "topology:task009",
      status: "completed",
      entryNodeId: "node:intake",
      startedAt: now,
      finishedAt: now + 1000,
      createdAt: now,
      updatedAt: now + 1000,
    }
    const html = renderToStaticMarkup(
      createElement(ExecutorRunPanel, {
        topology,
        templates,
        runInput: "고객 요청 처리",
        simulationMode: "success",
        recentRuns: [recentRun],
        selectedRunId: recentRun.topologyRunId,
      }),
    )

    expect(html).toContain('data-testid="topology-run-history"')
    expect(html).toContain('data-testid="topology-run-trace-cta"')
    expect(html).toContain("기록 보기")
    expect(html).toContain('data-testid="topology-run-history-item"')
  })
})

function executor(id: string, name: string, description: string): ExecutorDraft {
  return createExecutorDraftFromInference({
    id,
    sourceNodeId: id,
    name,
    description,
    now,
  })
}

function graph(
  executors: ExecutorDraft[],
  connections: ExecutorConnectionDraft[] = [],
): ExecutorGraphWorkspace {
  return {
    schemaVersion: 1,
    graphId: "executor-graph:task009",
    topologyId: "topology:task009",
    name: "Task009 graph",
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

function connection(source: ExecutorDraft, target: ExecutorDraft): ExecutorConnectionDraft {
  return createExecutorConnectionDraft({
    id: `connection:${source.id}:${target.id}`,
    source,
    target,
  })
}

function compileTopology(workspace: ExecutorGraphWorkspace) {
  const compiled = compileExecutorGraphToEnterpriseTopology(workspace, { now })
  expect(compiled.ok).toBe(true)
  if (!compiled.ok) throw new Error("compile failed")
  return compiled.topology
}
