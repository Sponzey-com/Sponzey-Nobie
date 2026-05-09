import { describe, expect, it } from "vitest"
import type { TracePhase } from "../packages/webui/src/contracts/enterprise-topology.ts"
import {
  buildTopologyExecutionTraceViewModel,
} from "../packages/webui/src/lib/topology-execution-trace.ts"
import type {
  EnterpriseTopologyFailureReportRecord,
  EnterpriseTopologyRunTraceProjection,
  EnterpriseTopologyTraceEventRecord,
} from "../packages/webui/src/lib/enterprise-topology-operations.ts"

const now = Date.UTC(2026, 4, 8, 15, 0, 0)

describe("topology dispatch preflight failure trace", () => {
  it("shows selected node, dispatch, prompt preflight block, and self-solve after delegation failure", () => {
    const model = buildTopologyExecutionTraceViewModel({
      topologyRun: projection({
        status: "completed",
        entryNodeId: "node:finance",
        traceEvents: [
          traceEvent({
            id: "trace:work-order",
            phase: "work_order",
            reasonCode: "work_order_created",
            delegationPath: ["node:nobie", "node:finance"],
            sequence: 1,
          }),
          traceEvent({
            id: "trace:dispatch",
            phase: "child_delegation",
            reasonCode: "sub_agent_dispatch_started",
            delegationPath: ["node:nobie", "node:finance"],
            sequence: 2,
          }),
          traceEvent({
            id: "trace:preflight",
            phase: "permission",
            reasonCode: "prompt_bundle_preflight_failed",
            delegationPath: ["node:nobie", "node:finance"],
            sequence: 3,
            payload: {
              nodeId: "node:finance",
              issueCodes: ["unsafe_permission_expansion", "unsafe_secret_access"],
            },
          }),
          traceEvent({
            id: "trace:self-solve-after",
            phase: "self_execution",
            reasonCode: "delegated_executor_runtime_failure_direct_current_agent",
            delegationPath: ["node:nobie"],
            sequence: 4,
            payload: { nodeId: "node:nobie" },
          }),
        ],
      }),
      executorNames: {
        "node:nobie": "노비",
        "node:finance": "행랑아범",
      },
      edgeIdsByNodePair: {
        "node:nobie->node:finance": "edge:nobie:finance",
      },
    })

    expect(model.source).toBe("topology_runs")
    expect(model.status).toBe("self_solved")
    expect(model.selfSolveMode).toBe("self_solve_after_delegation_failure")
    expect(model.events.map((event) => event.kind)).toEqual([
      "selected_node",
      "execution_started",
      "sub_agent_dispatch",
      "prompt_preflight_blocked",
      "self_solve_after_delegation_failure",
    ])
    expect(model.events.find((event) => event.kind === "prompt_preflight_blocked")).toMatchObject({
      tone: "amber",
      executorId: "node:finance",
      executorName: "행랑아범",
      executionStatus: "recovering",
      reasonCode: "prompt_bundle_preflight_failed",
    })
    expect(model.events.find((event) => event.kind === "failed")).toBeUndefined()
    expect(model.executorStatuses["node:finance"]).toBe("recovering")
    expect(model.edgeStatuses["edge:nobie:finance"]).toBe("cancelled")
  })

  it("marks failed nodes with failure code and summary", () => {
    const model = buildTopologyExecutionTraceViewModel({
      topologyRun: projection({
        status: "failed",
        entryNodeId: "node:finance",
        traceEvents: [
          traceEvent({
            id: "trace:dispatch",
            phase: "child_delegation",
            reasonCode: "sub_agent_dispatch_started",
            delegationPath: ["node:nobie", "node:finance"],
            sequence: 1,
          }),
          traceEvent({
            id: "trace:failed",
            phase: "exhaustion",
            reasonCode: "final_failure_after_exhaustion",
            delegationPath: ["node:nobie", "node:finance"],
            sequence: 2,
          }),
        ],
        failureReports: [
          failureReport({
            nodeId: "node:finance",
            failurePhase: "exhaustion",
            recommendedAction: "다른 금융 실행자에게 재위임하거나 외부 조회 도구를 허용해야 합니다.",
          }),
        ],
      }),
      executorNames: {
        "node:finance": "행랑아범",
      },
    })

    expect(model.status).toBe("failed")
    expect(model.executorStatuses["node:finance"]).toBe("failed")
    expect(model.failedExecutors).toEqual([
      expect.objectContaining({
        executorId: "node:finance",
        executorName: "행랑아범",
        failureCode: "exhaustion",
        summary: "다른 금융 실행자에게 재위임하거나 외부 조회 도구를 허용해야 합니다.",
      }),
    ])
  })

  it("exposes active executor and edge ids only while the topology run is still running", () => {
    const model = buildTopologyExecutionTraceViewModel({
      topologyRun: projection({
        status: "running",
        entryNodeId: "node:finance",
        traceEvents: [
          traceEvent({
            id: "trace:dispatch-running",
            phase: "child_delegation",
            reasonCode: "sub_agent_dispatch_started",
            delegationPath: ["node:nobie", "node:finance"],
            sequence: 1,
          }),
        ],
      }),
      executorNames: {
        "node:finance": "행랑아범",
      },
      edgeIdsByNodePair: {
        "node:nobie->node:finance": "edge:nobie:finance",
      },
    })

    expect(model.activeExecutorIds).toEqual(["node:finance"])
    expect(model.activeEdgeIds).toEqual(["edge:nobie:finance"])
    expect(model.executorStatuses["node:finance"]).toBe("delegating")
    expect(model.edgeStatuses["edge:nobie:finance"]).toBe("running")
  })

  it("keeps legacy topology runs without trace in a diagnostic state", () => {
    const model = buildTopologyExecutionTraceViewModel({
      topologyRun: projection({
        status: "completed",
        entryNodeId: "node:legacy",
        traceEvents: [],
      }),
      executorNames: {
        "node:legacy": "레거시 실행자",
      },
    })

    expect(model.status).toBe("trace_missing")
    expect(model.events.map((event) => event.kind)).toContain("trace_missing")
    expect(model.events.find((event) => event.kind === "trace_missing")?.summaryKo).toContain("진단 정보")
  })

  it("distinguishes self-solve from self-solve after delegation failure", () => {
    const direct = buildTopologyExecutionTraceViewModel({
      topologyRun: projection({
        status: "completed",
        entryNodeId: "node:nobie",
        traceEvents: [
          traceEvent({
            id: "trace:self",
            phase: "self_execution",
            reasonCode: "node_runtime_self_executing",
            delegationPath: ["node:nobie"],
            sequence: 1,
          }),
        ],
      }),
      executorNames: {
        "node:nobie": "노비",
      },
    })

    expect(direct.status).toBe("self_solved")
    expect(direct.selfSolveMode).toBe("self_solve")
    expect(direct.events.find((event) => event.kind === "self_solve")?.labelKo).toBe("처음부터 직접 처리")
  })
})

function projection(input: {
  status: string
  entryNodeId?: string
  traceEvents: EnterpriseTopologyTraceEventRecord[]
  failureReports?: EnterpriseTopologyFailureReportRecord[]
}): EnterpriseTopologyRunTraceProjection {
  return {
    run: {
      topologyRunId: "topology-run:trace",
      topologyId: "workspace:draft",
      status: input.status,
      ...(input.entryNodeId ? { entryNodeId: input.entryNodeId } : {}),
      startedAt: now,
      createdAt: now,
      updatedAt: now + input.traceEvents.length,
    },
    nodeRuns: [],
    workOrders: [],
    resultReports: [],
    failureReports: input.failureReports ?? [],
    traceEvents: input.traceEvents,
    toolCalls: [],
    observedEdges: [],
    gapFindings: [],
  }
}

function traceEvent(input: {
  id: string
  phase: TracePhase
  reasonCode: string
  delegationPath: string[]
  sequence: number
  payload?: Record<string, unknown>
}): EnterpriseTopologyTraceEventRecord {
  const event = {
    schemaVersion: 1 as const,
    traceEventId: input.id,
    topologyRunId: "topology-run:trace",
    nodeRunId: `node-run:${input.sequence}`,
    workOrderId: `work-order:${input.sequence}`,
    delegationPath: input.delegationPath,
    phase: input.phase,
    component: "node-runtime",
    at: now + input.sequence,
    reasonCode: input.reasonCode,
    ...(input.payload ? { payload: input.payload } : {}),
  }
  return {
    traceEventId: input.id,
    topologyRunId: "topology-run:trace",
    nodeRunId: `node-run:${input.sequence}`,
    workOrderId: `work-order:${input.sequence}`,
    phase: input.phase,
    component: "node-runtime",
    reasonCode: input.reasonCode,
    delegationPath: input.delegationPath,
    ...(input.payload ? { payload: input.payload } : {}),
    event,
    at: now + input.sequence,
    sequence: input.sequence,
  }
}

function failureReport(input: {
  nodeId: string
  failurePhase: string
  recommendedAction: string
}): EnterpriseTopologyFailureReportRecord {
  return {
    failureReportId: `failure:${input.nodeId}`,
    topologyRunId: "topology-run:trace",
    nodeRunId: `node-run:${input.nodeId}`,
    workOrderId: `work-order:${input.nodeId}`,
    nodeId: input.nodeId,
    failurePhase: input.failurePhase,
    report: {
      schemaVersion: 1,
      failureReportId: `failure:${input.nodeId}`,
      topologyRunId: "topology-run:trace",
      nodeRunId: `node-run:${input.nodeId}`,
      workOrderId: `work-order:${input.nodeId}`,
      nodeId: input.nodeId,
      exhaustionSummary: {
        selfExecutionAttempted: true,
        childDelegationAttempted: true,
        toolExecutionAttempted: false,
        retryAttempted: true,
        fallbackAttempted: true,
        partialSuccessChecked: true,
        parentRecoveryPossibleChecked: true,
        successCriteriaStillNotMet: true,
        complete: true,
      },
      attempts: [],
      untriedOptions: [],
      recommendedAction: input.recommendedAction,
      createdAt: now,
    },
    createdAt: now,
  }
}
