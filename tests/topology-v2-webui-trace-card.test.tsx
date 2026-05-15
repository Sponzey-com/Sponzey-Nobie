import { createElement } from "../packages/webui/node_modules/react/index.js"
import { renderToStaticMarkup } from "../packages/webui/node_modules/react-dom/server.js"
import { describe, expect, it } from "vitest"
import {
  TopologyV2FlowStatusCard,
  selectLatestTaskRootRunIdForTopologyTrace,
} from "../packages/webui/src/pages/TopologyWorkspacePage.tsx"
import type { TaskModel } from "../packages/webui/src/contracts/tasks.ts"
import type {
  TopologyExecutionTraceEventViewModel,
  TopologyExecutionTraceViewModel,
} from "../packages/webui/src/lib/topology-execution-trace.ts"

const text = (ko: string, _en: string) => ko
const now = Date.UTC(2026, 4, 8, 15, 0, 0)

describe("topology V2 trace status card", () => {
  it("renders topology execution trace events and failed executor details", () => {
    const html = normalized(renderToStaticMarkup(
      createElement(TopologyV2FlowStatusCard, {
        loadStatus: "ready",
        saveStatus: "saved",
        errorMessage: null,
        selectedExecutor: null,
        executorCount: 2,
        connectionCount: 1,
        traceLoadStatus: "ready",
        traceErrorMessage: null,
        traceView: traceView({
          status: "failed",
          events: [
            traceEvent("selected_node", "선택된 노드", "행랑아범", "topology_entry_node_selected"),
            traceEvent("sub_agent_dispatch", "서브 에이전트 위임", "행랑아범", "sub_agent_dispatch_started"),
            traceEvent("prompt_preflight_blocked", "안전 경계 차단", "행랑아범", "prompt_bundle_preflight_failed"),
            traceEvent("failed", "실패", "행랑아범", "final_failure_after_exhaustion"),
          ],
          failedExecutors: [{
            executorId: "node:finance",
            executorName: "행랑아범",
            failureCode: "exhaustion",
            summary: "다른 금융 실행자에게 재위임해야 합니다.",
          }],
        }),
        text,
      }),
    ))

    expect(html).toContain('data-testid="topology-v2-flow-status-card"')
    expect(html).toContain("최근 요청/실행 흐름")
    expect(html).toContain('data-testid="topology-v2-trace-status"')
    expect(html).toContain('data-trace-status="failed"')
    expect(html).toContain('data-testid="topology-v2-trace-event"')
    expect(html).toContain('data-trace-kind="prompt_preflight_blocked"')
    expect(html).toContain("안전 경계 차단")
    expect(html).toContain('data-testid="topology-v2-trace-failure"')
    expect(html).toContain('data-failure-code="exhaustion"')
    expect(html).toContain("다른 금융 실행자에게 재위임해야 합니다.")
  })

  it("shows self-solve mode and trace-missing diagnostic state", () => {
    const html = normalized(renderToStaticMarkup(
      createElement(TopologyV2FlowStatusCard, {
        loadStatus: "ready",
        saveStatus: "idle",
        errorMessage: null,
        selectedExecutor: null,
        executorCount: 1,
        connectionCount: 0,
        traceLoadStatus: "ready",
        traceErrorMessage: null,
        traceView: traceView({
          status: "trace_missing",
          selfSolveMode: "self_solve_after_delegation_failure",
          events: [
            traceEvent("trace_missing", "trace 없음", undefined, "topology_trace_missing"),
          ],
          failedExecutors: [],
        }),
        text,
      }),
    ))

    expect(html).toContain('data-trace-status="trace_missing"')
    expect(html).toContain("trace 없음")
    expect(html).toContain('data-testid="topology-v2-self-solve-mode"')
    expect(html).toContain('data-self-solve-mode="self_solve_after_delegation_failure"')
    expect(html).toContain("위임 실패 후 자체 처리")
  })

  it("uses the latest activity-monitor request as the trace anchor", () => {
    const rootRunId = selectLatestTaskRootRunIdForTopologyTrace([
      taskForTrace({ createdAt: now - 1_000, updatedAt: now + 8_000, rootRunId: "run:older" }),
      taskForTrace({ createdAt: now, updatedAt: now, rootRunId: "run:latest" }),
    ])

    expect(rootRunId).toBe("run:latest")
  })

  it("explains when the latest activity request has no topology trace", () => {
    const html = normalized(renderToStaticMarkup(
      createElement(TopologyV2FlowStatusCard, {
        loadStatus: "ready",
        saveStatus: "idle",
        errorMessage: null,
        selectedExecutor: null,
        executorCount: 2,
        connectionCount: 1,
        traceLoadStatus: "ready",
        traceEmptyReason: "no_topology_run_for_latest_task",
        traceErrorMessage: null,
        traceView: traceView({
          status: "idle",
          events: [],
          failedExecutors: [],
        }),
        text,
      }),
    ))

    expect(html).toContain("실행 현황의 최근 요청에 연결된 토폴로지 실행 기록이 없습니다.")
  })
})

function taskForTrace(input: {
  createdAt: number
  updatedAt: number
  rootRunId?: string
  anchorRunId?: string
}): Pick<TaskModel, "createdAt" | "updatedAt" | "rootRunId" | "anchorRunId" | "requestIdentity"> {
  return {
    createdAt: input.createdAt,
    updatedAt: input.updatedAt,
    ...(input.rootRunId ? { rootRunId: input.rootRunId } : {}),
    anchorRunId: input.anchorRunId ?? input.rootRunId ?? "run:anchor",
  }
}

function traceView(input: {
  status: TopologyExecutionTraceViewModel["status"]
  events: TopologyExecutionTraceEventViewModel[]
  failedExecutors: TopologyExecutionTraceViewModel["failedExecutors"]
  selfSolveMode?: TopologyExecutionTraceViewModel["selfSolveMode"]
}): TopologyExecutionTraceViewModel {
  return {
    source: "topology_runs",
    status: input.status,
    runId: "topology-run:test",
    topologyRunId: "topology-run:test",
    events: input.events,
    activeExecutorIds: [],
    activeEdgeIds: [],
    executorStatuses: {},
    edgeStatuses: {},
    failedExecutors: input.failedExecutors,
    ...(input.selfSolveMode ? { selfSolveMode: input.selfSolveMode } : {}),
  }
}

function traceEvent(
  kind: TopologyExecutionTraceEventViewModel["kind"],
  labelKo: string,
  executorName: string | undefined,
  reasonCode: string,
): TopologyExecutionTraceEventViewModel {
  return {
    id: `trace:${kind}`,
    kind,
    labelKo,
    labelEn: labelKo,
    summaryKo: `${labelKo} 요약`,
    summaryEn: `${labelKo} summary`,
    tone: kind === "failed" ? "rose" : kind === "prompt_preflight_blocked" ? "amber" : "blue",
    at: Date.UTC(2026, 4, 8, 15, 0, 0),
    reasonCode,
    ...(executorName ? {
      executorId: "node:finance",
      executorName,
      executionStatus: kind === "failed" ? "failed" : "running",
    } : {}),
  }
}

function normalized(value: string): string {
  return value.replace(/\s+/g, " ")
}
