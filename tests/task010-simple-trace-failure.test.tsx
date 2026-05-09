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
import { createExecutorDraftFromInference } from "../packages/webui/src/lib/executor-inference.ts"
import { createExecutorConnectionDraft } from "../packages/webui/src/lib/executor-relation-inference.ts"
import {
  ExecutorRunResultPanel,
  buildExecutorRunResultModel,
} from "../packages/webui/src/components/topology/ExecutorRunResultPanel.tsx"
import { TopologyWorkspaceCanvas } from "../packages/webui/src/components/topology/TopologyWorkspaceCanvas.tsx"
import type { TopologyRunTraceOverlayInput } from "../packages/webui/src/components/topology/TopologyRunTraceOverlay.tsx"
import type {
  EnterpriseTopologyFailureReportRecord,
  EnterpriseTopologyToolCallRecord,
  EnterpriseTopologyTraceEventRecord,
} from "../packages/webui/src/lib/enterprise-topology-operations.ts"
import type { TracePhase } from "../packages/webui/src/contracts/enterprise-topology.ts"

const now = Date.UTC(2026, 4, 2, 14, 0, 0)

describe("task010 simple trace and failure explanation", () => {
  it("renders a failure trace as location, reason, tried actions, and next action", () => {
    const { topology, graph, overlay } = fixture()
    const html = normalized(renderToStaticMarkup(
      createElement(ExecutorRunResultPanel, {
        topology,
        graph,
        overlay,
      }),
    ))

    expect(html).toContain('data-testid="executor-run-result-panel"')
    expect(html).toContain("실패 위치")
    expect(html).toContain("고객 접수 담당자 -> CRM 조회")
    expect(html).toContain("실패 이유")
    expect(html).toContain("완료 기준을 만족하지 못해 실패했습니다.")
    expect(html).toContain("노비가 시도한 것")
    expect(html).toContain("도구 실행")
    expect(html).toContain("tool:crm-search 실행")
    expect(html).toContain("다음 조치")
    expect(html).toContain("예외 처리 경로를 추가해 실패 시 넘길 곳을 정하세요.")
  })

  it("keeps raw work order, node run, and trace ids out of the default result screen", () => {
    const { topology, graph, overlay } = fixture()
    const html = renderToStaticMarkup(
      createElement(ExecutorRunResultPanel, {
        topology,
        graph,
        overlay,
      }),
    )

    expect(html).not.toContain("work-order:crm")
    expect(html).not.toContain("node-run:crm")
    expect(html).not.toContain("trace:failure:crm")
    expect(html).not.toContain("failure:crm")
  })

  it("normalizes executor statuses into success, waiting, partial success, and failed", () => {
    const { topology, graph, overlay } = fixture()
    const model = buildExecutorRunResultModel({ topology, graph, overlay })

    expect(statusByName(model.nodeResults)).toEqual({
      "고객 접수 담당자": "success",
      "CRM 조회": "failed",
      "검토자": "partial_success",
      "승인자": "waiting",
    })
  })

  it("shows quick action buttons with GUI operation previews instead of applying changes immediately", () => {
    const { topology, graph, overlay } = fixture()
    const model = buildExecutorRunResultModel({ topology, graph, overlay })
    const html = normalized(renderToStaticMarkup(
      createElement(ExecutorRunResultPanel, {
        topology,
        graph,
        overlay,
      }),
    ))

    expect(model.quickActions.map((action) => action.labelKo)).toEqual([
      "권한 추가",
      "부분 정보로 넘기기",
      "예외 처리로 이동",
      "설명 수정",
    ])
    expect(model.quickActions.every((action) => action.operations.length > 0)).toBe(true)
    expect(html).toContain('data-testid="executor-result-quick-action-preview"')
    expect(html).toContain("node 수정: node:crm")
    expect(html).toContain("권한 추가")
    expect(html).toContain("부분 정보로 넘기기")
    expect(html).toContain("예외 처리로 이동")
    expect(html).toContain("설명 수정")
  })

  it("keeps the existing trace overlay and raw ids available inside advanced details", () => {
    const { topology, graph, overlay } = fixture()
    const html = renderToStaticMarkup(
      createElement(ExecutorRunResultPanel, {
        topology,
        graph,
        overlay,
        advancedOpen: true,
      }),
    )

    expect(html).toContain('data-testid="executor-result-raw-trace"')
    expect(html).toContain('data-testid="topology-run-trace-overlay"')
    expect(html).toContain("work-order:crm")
    expect(html).toContain("node-run:crm")
    expect(html).toContain("trace:failure:crm")
    expect(html).toContain("failure:crm")
  })

  it("wires the simple workspace canvas to the simple result panel when a run exists", () => {
    const { topology, overlay } = fixture()
    const html = renderToStaticMarkup(
      createElement(TopologyWorkspaceCanvas, {
        selectedLayer: "build",
        exposureMode: "simple",
        topology,
        traceOverlay: overlay,
      }),
    )

    expect(html).toContain('data-testid="topology-workspace-simple-executor-layout"')
    expect(html).toContain('data-testid="executor-run-result-panel"')
    expect(html).toContain('data-testid="executor-inspector"')
  })
})

function fixture() {
  const intake = executor("node:intake", "고객 접수 담당자", "고객 요청을 접수하고 CRM 조회 담당자에게 넘긴다.")
  const crm = executor("node:crm", "CRM 조회", "CRM에서 고객 계정과 최근 이슈를 조회한다.")
  const reviewer = executor("node:reviewer", "검토자", "조회된 내용을 검토하고 부분 정보라도 요약한다.")
  const approver = executor("node:approver", "승인자", "검토 결과를 승인한다.")
  const graph = graphFixture(
    [intake, crm, reviewer, approver],
    [
      connection(intake, crm),
      connection(crm, reviewer),
      connection(reviewer, approver),
    ],
  )
  const compiled = compileExecutorGraphToEnterpriseTopology(graph, { now })
  expect(compiled.ok).toBe(true)
  if (!compiled.ok) throw new Error("compile failed")
  return {
    graph,
    topology: compiled.topology,
    overlay: overlayFixture(),
  }
}

function overlayFixture(): TopologyRunTraceOverlayInput {
  return {
    run: {
      topologyRunId: "topology-run:task010",
      topologyId: "topology:task010",
      status: "failed",
      entryNodeId: "node:intake",
      startedAt: now,
      finishedAt: now + 3000,
      createdAt: now,
      updatedAt: now + 3000,
    },
    traceEvents: [
      traceEvent({
        traceEventId: "trace:success:intake",
        nodeRunId: "node-run:intake",
        workOrderId: "work-order:intake",
        phase: "reporting",
        reasonCode: "node_runtime_completed",
        delegationPath: ["node:intake"],
        sequence: 1,
      }),
      traceEvent({
        traceEventId: "trace:partial:reviewer",
        nodeRunId: "node-run:reviewer",
        workOrderId: "work-order:reviewer",
        phase: "reporting",
        reasonCode: "node_runtime_reported",
        delegationPath: ["node:intake", "node:crm", "node:reviewer"],
        sequence: 2,
        payload: { nodeResultStatus: "partial_success" },
      }),
      traceEvent({
        traceEventId: "trace:failure:crm",
        nodeRunId: "node-run:crm",
        workOrderId: "work-order:crm",
        phase: "exhaustion",
        reasonCode: "final_failure_after_exhaustion",
        delegationPath: ["node:intake", "node:crm"],
        sequence: 3,
      }),
    ],
    toolCalls: [toolCall()],
    failureReports: [failureReport()],
    observedEdges: [],
    gapFindings: [],
  }
}

function executor(id: string, name: string, description: string): ExecutorDraft {
  return createExecutorDraftFromInference({
    id,
    sourceNodeId: id,
    name,
    description,
    now,
  })
}

function graphFixture(
  executors: ExecutorDraft[],
  connections: ExecutorConnectionDraft[],
): ExecutorGraphWorkspace {
  return {
    schemaVersion: 1,
    graphId: "executor-graph:task010",
    topologyId: "topology:task010",
    name: "Task010 graph",
    mode: "simple",
    executors,
    sections: [],
    connections,
    selectedId: executors[0]?.id ?? null,
    inference: {
      source: "executor_graph_compile",
      confidence: 0.86,
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

function traceEvent(input: {
  traceEventId: string
  nodeRunId: string
  workOrderId: string
  phase: TracePhase
  reasonCode: string
  delegationPath: string[]
  sequence: number
  payload?: Record<string, unknown>
}): EnterpriseTopologyTraceEventRecord {
  return {
    ...input,
    topologyRunId: "topology-run:task010",
    component: "runtime",
    event: {
      schemaVersion: 1,
      traceEventId: input.traceEventId,
      topologyRunId: "topology-run:task010",
      nodeRunId: input.nodeRunId,
      workOrderId: input.workOrderId,
      parentWorkOrderId: null,
      delegationPath: input.delegationPath,
      phase: input.phase,
      component: "runtime",
      at: now + input.sequence,
      reasonCode: input.reasonCode,
      ...(input.payload ? { payload: input.payload } : {}),
    },
    ...(input.payload ? { payload: input.payload } : {}),
    at: now + input.sequence,
  }
}

function toolCall(): EnterpriseTopologyToolCallRecord {
  return {
    toolCallId: "tool-call:crm",
    topologyRunId: "topology-run:task010",
    nodeRunId: "node-run:crm",
    workOrderId: "work-order:crm",
    toolId: "tool:crm-search",
    dispatcherToolName: "crm.search",
    status: "failed",
    reasonCode: "tool_permission_missing",
    retryPossible: true,
    fallbackPossible: true,
    startedAt: now + 10,
    completedAt: now + 20,
    result: {
      ok: false,
      reason: "permission missing",
    },
  }
}

function failureReport(): EnterpriseTopologyFailureReportRecord {
  return {
    failureReportId: "failure:crm",
    topologyRunId: "topology-run:task010",
    nodeRunId: "node-run:crm",
    workOrderId: "work-order:crm",
    nodeId: "node:crm",
    failurePhase: "exhaustion",
    report: {
      schemaVersion: 1,
      failureReportId: "failure:crm",
      topologyRunId: "topology-run:task010",
      nodeRunId: "node-run:crm",
      workOrderId: "work-order:crm",
      nodeId: "node:crm",
      exhaustionSummary: {
        selfExecutionAttempted: true,
        childDelegationAttempted: false,
        toolExecutionAttempted: true,
        retryAttempted: true,
        fallbackAttempted: false,
        partialSuccessChecked: true,
        parentRecoveryPossibleChecked: true,
        successCriteriaStillNotMet: true,
        complete: true,
      },
      attempts: [{
        attemptId: "attempt:crm-tool",
        kind: "tool_execution",
        status: "failed",
        at: now + 30,
        reasonCode: "tool_permission_missing",
        summary: "CRM search permission was missing.",
      }],
      untriedOptions: ["fallback"],
      issueKind: "success_criteria_unmet",
      recoveryActionKind: "add_fallback_path",
      nextActionKind: "add_fallback",
      recommendedAction: "Review retry and fallback candidates",
      createdAt: now + 40,
    },
    createdAt: now + 40,
  }
}

function statusByName(results: ReturnType<typeof buildExecutorRunResultModel>["nodeResults"]) {
  return Object.fromEntries(results.map((result) => [result.name, result.status]))
}

function normalized(html: string): string {
  return html.replace(/&gt;/g, ">")
}
