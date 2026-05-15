import { createElement } from "../packages/webui/node_modules/react/index.js"
import { renderToStaticMarkup } from "../packages/webui/node_modules/react-dom/server.js"
import { describe, expect, it } from "vitest"
import {
  EXECUTOR_GRAPH_SOURCE_OF_TRUTH,
  compileExecutorGraphToEnterpriseTopology,
  type ExecutorConnectionDraft,
  type ExecutorDraft,
  type ExecutorGraphWorkspace,
} from "../packages/core/src/topology/executor-graph.ts"
import {
  applyExecutorConnectionRecommendation,
  createExecutorConnectionDraft,
  recommendExecutorConnectionRelations,
} from "../packages/core/src/topology/executor-relation-inference.ts"
import { WORK_ORDER_TEMPLATE_CATALOG } from "../packages/core/src/topology-runtime/work-order-templates.ts"
import {
  ENTERPRISE_TOPOLOGY_EXECUTOR_FIRST_DEFAULT_HIDDEN_CONCEPTS,
} from "../packages/core/src/release/enterprise-topology-release-gate.ts"
import {
  confirmExecutorUnderstanding,
  createExecutorDraftFromInference,
  inferExecutorFromDescription,
} from "../packages/webui/src/lib/executor-inference.ts"
import { ExecutorConnectionMenu } from "../packages/webui/src/components/topology/ExecutorConnectionMenu.tsx"
import { ExecutorCreatePanel } from "../packages/webui/src/components/topology/ExecutorCreatePanel.tsx"
import { ExecutorGraphCanvas } from "../packages/webui/src/components/topology/ExecutorGraphCanvas.tsx"
import { ExecutorInspector } from "../packages/webui/src/components/topology/ExecutorInspector.tsx"
import {
  ExecutorRunPanel,
  resolveExecutorRunState,
} from "../packages/webui/src/components/topology/ExecutorRunPanel.tsx"
import { ExecutorWorkspaceShell } from "../packages/webui/src/components/topology/ExecutorWorkspaceShell.tsx"
import {
  LegacyEnterpriseTopologyPage,
  sameTopologyRuntimeIds,
  topologyRunningStatusMap,
} from "../packages/webui/src/pages/EnterpriseTopologyPage.tsx"
import type { EnterpriseTopologyRunRecord } from "../packages/webui/src/lib/enterprise-topology-operations.ts"

const now = Date.UTC(2026, 4, 2, 16, 0, 0)
const templates = WORK_ORDER_TEMPLATE_CATALOG.templates

describe("task013 Executor-first usability", () => {
  it("covers the first-executor to run-history happy path with only three typed input kinds", () => {
    const intake = confirmedExecutor(
      "node:intake",
      "고객 접수 담당자",
      "고객 요청을 읽고 CRM에서 고객 정보를 확인한 뒤 정리한다.",
    )
    const reviewer = confirmedExecutor(
      "node:reviewer",
      "검토자",
      "정리된 답변 초안을 검토하고 의견을 남긴다.",
    )
    const connection = confirmedConnection(intake, reviewer)
    const workspace = executorGraph([intake, reviewer], [connection])
    const compiled = compileExecutorGraphToEnterpriseTopology(workspace, { now })
    expect(compiled.ok).toBe(true)
    if (!compiled.ok) return

    const runInput = "긴급 고객 요청을 접수하고 답변 초안을 만들어줘"
    const runState = resolveExecutorRunState({
      topology: compiled.topology,
      templates,
      runInput,
      simulationMode: "success",
    })
    const recentRun: EnterpriseTopologyRunRecord = {
      topologyRunId: "topology-run:task013",
      topologyId: compiled.topology.id,
      status: "completed",
      entryNodeId: "node:intake",
      startedAt: now,
      finishedAt: now + 1000,
      createdAt: now,
      updatedAt: now + 1000,
    }
    const shellHtml = renderToStaticMarkup(
      createElement(
        ExecutorWorkspaceShell,
        {
          selectedLayer: "build",
          executorCount: workspace.executors.length,
          connectionCount: workspace.connections.length,
          showFirstStart: false,
        },
        createElement("div", null, "executor canvas"),
      ),
    )
    const createHtml = renderToStaticMarkup(
      createElement(ExecutorCreatePanel, {
        initialName: intake.name,
        initialDescription: intake.description,
      }),
    )
    const graphHtml = renderToStaticMarkup(
      createElement(ExecutorGraphCanvas, {
        topology: compiled.topology,
        graph: workspace,
        selectedExecutorId: intake.id,
      }),
    )
    const inspectorHtml = renderToStaticMarkup(
      createElement(ExecutorInspector, {
        executor: intake,
        graph: workspace,
      }),
    )
    const connectionHtml = renderToStaticMarkup(
      createElement(ExecutorConnectionMenu, {
        source: intake,
        target: reviewer,
        connection,
      }),
    )
    const runHtml = renderToStaticMarkup(
      createElement(ExecutorRunPanel, {
        topology: compiled.topology,
        templates,
        runInput,
        simulationMode: "success",
        recentRuns: [recentRun],
        selectedRunId: recentRun.topologyRunId,
      }),
    )
    const combinedHtml = [shellHtml, createHtml, graphHtml, inspectorHtml, connectionHtml, runHtml].join("\n")

    expect(runState.payload).toEqual(expect.objectContaining({
      entryNodeId: "node:intake",
      templateId: "work-order-template:customer-request-triage",
      contextPresetId: "context:customer-general",
    }))
    expect(combinedHtml).toContain('data-testid="executor-workspace-add-executor"')
    expect(combinedHtml).toContain('data-testid="executor-create-name"')
    expect(combinedHtml).toContain('data-testid="executor-create-description"')
    expect(combinedHtml).toContain('data-testid="executor-understanding-panel"')
    expect(combinedHtml).toContain("노비가 이해한 내용")
    expect(combinedHtml).toContain('data-testid="executor-connection-menu"')
    expect(combinedHtml).toContain('data-testid="executor-connection-recommendation-chip"')
    expect(combinedHtml).toContain('data-testid="topology-run-simple-input"')
    expect(combinedHtml).toContain('data-testid="topology-run-history"')
    expect(combinedHtml).toContain("기록 보기")
    expect(combinedHtml).not.toContain("WorkOrder Template")
    expect(combinedHtml).not.toContain("Context")
    expect(combinedHtml).not.toContain("Compile Preview")
    expect(combinedHtml).not.toContain("JSON/YAML")
  })

  it("keeps blocked internal terms out of the Simple UI and normalizes advanced requests to the same executor-first screen", () => {
    const simpleHtml = renderToStaticMarkup(
      createElement(LegacyEnterpriseTopologyPage, {
        workspaceLayer: "build",
        workspaceExposureMode: "simple",
      }),
    )
    const advancedHtml = renderToStaticMarkup(
      createElement(LegacyEnterpriseTopologyPage, {
        workspaceLayer: "build",
        workspaceExposureMode: "advanced",
      }),
    )

    expect(simpleHtml).toContain('data-testid="executor-workspace-shell"')
    expect(simpleHtml).toContain("업무 흐름 만들기")
    expect(simpleHtml).toContain("실행자 이름과 성격 정하기")
    expect(simpleHtml).toContain("성격과 하는 일")
    expect(simpleHtml).toContain('data-testid="executor-create-name"')
    expect(simpleHtml).toContain('data-testid="executor-create-description"')
    expect(simpleHtml).toContain('data-testid="topology-workspace-simple-executor-layout"')
    expect(simpleHtml).toContain('data-testid="executor-graph-empty-canvas"')
    expect(simpleHtml).not.toContain('data-testid="topology-workspace-simple-test-card"')
    expect(simpleHtml).not.toContain('data-testid="topology-run-simple-panel"')
    expect(simpleHtml).not.toContain("먼저 실행자 1명을 추가하세요")
    expect(simpleHtml).not.toContain("첫 실행자 추가")
    expect(simpleHtml).not.toContain("추천 흐름으로 시작")
    expect(simpleHtml).not.toContain('data-testid="topology-workspace-simple-inspector"')
    for (const hiddenConcept of ENTERPRISE_TOPOLOGY_EXECUTOR_FIRST_DEFAULT_HIDDEN_CONCEPTS) {
      expect(simpleHtml).not.toContain(hiddenConcept)
    }
    expect(advancedHtml).toContain('data-testid="executor-workspace-shell"')
    expect(advancedHtml).toContain('data-testid="topology-workspace-simple-executor-layout"')
    expect(advancedHtml).not.toContain('data-testid="enterprise-topology-palette"')
    expect(advancedHtml).not.toContain('data-testid="enterprise-relation-mode-toolbar"')
    expect(advancedHtml).not.toContain('data-testid="enterprise-topology-compile-preview"')
    expect(advancedHtml).not.toContain('data-testid="topology-run-target-panel"')
  })

  it("does not block channel request flow for low-confidence executor paths", () => {
    const unclear = createExecutorDraftFromInference({
      id: "node:unclear",
      sourceNodeId: "node:unclear",
      name: "담당자",
      description: "처리",
      now,
    })
    const compiled = compileExecutorGraphToEnterpriseTopology(executorGraph([unclear]), { now })
    expect(compiled.ok).toBe(true)
    if (!compiled.ok) return
    const inference = inferExecutorFromDescription({ name: unclear.name, description: unclear.description })
    const state = resolveExecutorRunState({
      topology: compiled.topology,
      templates,
      runInput: "이 요청을 처리해줘",
      simulationMode: "success",
    })
    const html = renderToStaticMarkup(
      createElement(ExecutorRunPanel, {
        topology: compiled.topology,
        templates,
        runInput: "이 요청을 처리해줘",
        simulationMode: "success",
      }),
    )

    expect(inference.readyForAutoRun).toBe(false)
    expect(inference.requiresClarification).toBe(true)
    expect(state.lowConfidenceExecutors.map((item) => item.id)).toEqual(["node:unclear"])
    expect(state.requiresConfirmation).toBe(false)
    expect(html).not.toContain('data-testid="executor-run-low-confidence-confirmation"')
    expect(html).toContain('data-requires-confirmation="false"')
  })

  it("keeps runtime activity props stable when polling returns the same executor flow state", () => {
    const current = ["node:intake", "node:reviewer"]
    const same = ["node:intake", "node:reviewer"]
    const changedOrder = ["node:reviewer", "node:intake"]

    expect(sameTopologyRuntimeIds(current, same)).toBe(true)
    expect(sameTopologyRuntimeIds(current, changedOrder)).toBe(false)
    expect(topologyRunningStatusMap(current)).toEqual({
      "node:intake": "running",
      "node:reviewer": "running",
    })
  })
})

function confirmedExecutor(id: string, name: string, description: string): ExecutorDraft {
  return confirmExecutorUnderstanding(createExecutorDraftFromInference({
    id,
    sourceNodeId: id,
    name,
    description,
    now,
    userConfirmed: true,
  }))
}

function confirmedConnection(source: ExecutorDraft, target: ExecutorDraft): ExecutorConnectionDraft {
  const recommendation = recommendExecutorConnectionRelations({ source, target })[0]
  if (!recommendation) throw new Error("expected recommendation")
  return applyExecutorConnectionRecommendation(
    createExecutorConnectionDraft({ source, target }),
    recommendation,
  )
}

function executorGraph(
  executors: ExecutorDraft[],
  connections: ExecutorConnectionDraft[] = [],
): ExecutorGraphWorkspace {
  return {
    schemaVersion: 1,
    graphId: "executor-graph:task013",
    topologyId: "topology:task013",
    name: "Task013 Executor-first graph",
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
