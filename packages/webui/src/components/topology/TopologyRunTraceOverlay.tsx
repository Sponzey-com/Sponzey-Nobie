import * as React from "react"
import type {
  EnterpriseTopologyFailureReportRecord,
  EnterpriseTopologyObservedEdgeRecord,
  EnterpriseTopologyRunRecord,
  EnterpriseTopologyToolCallRecord,
  EnterpriseTopologyTraceEventRecord,
} from "../../lib/enterprise-topology-operations"
import { useUiI18n } from "../../lib/ui-i18n"

export type TopologyTraceNodeState = "delegation_path" | "tool_call" | "failed_candidate" | "failed"
export type TopologyTraceEdgeState = "delegation_path" | "failed_path"

export interface TopologyRunTraceOverlayInput {
  run?: EnterpriseTopologyRunRecord | null
  traceEvents: EnterpriseTopologyTraceEventRecord[]
  toolCalls: EnterpriseTopologyToolCallRecord[]
  failureReports: EnterpriseTopologyFailureReportRecord[]
  observedEdges?: EnterpriseTopologyObservedEdgeRecord[]
  gapFindings?: unknown[]
}

export interface TopologyRunTraceOverlayState {
  nodeStates: Record<string, TopologyTraceNodeState>
  edgeStates: Record<string, TopologyTraceEdgeState>
  delegationPaths: string[][]
  failedNodeIds: string[]
  failedCandidateNodeIds: string[]
  toolCallNodeIds: string[]
}

export function topologyCanvasNodeIdForRuntimeNodeId(nodeId: string): string {
  return `node:${nodeId}`
}

export function topologyTraceEdgeKey(fromNodeId: string, toNodeId: string): string {
  return `${topologyCanvasNodeIdForRuntimeNodeId(fromNodeId)}->${topologyCanvasNodeIdForRuntimeNodeId(toNodeId)}`
}

function setNodeState(
  states: Record<string, TopologyTraceNodeState>,
  nodeId: string,
  state: TopologyTraceNodeState,
): void {
  const current = states[nodeId]
  if (current === "failed") return
  if (current === "failed_candidate" && state !== "failed") return
  if (current === "tool_call" && state === "delegation_path") return
  states[nodeId] = state
}

function uniquePaths(traceEvents: EnterpriseTopologyTraceEventRecord[]): string[][] {
  const seen = new Set<string>()
  const paths: string[][] = []
  for (const event of traceEvents) {
    if (event.delegationPath.length === 0) continue
    const key = event.delegationPath.join(">")
    if (seen.has(key)) continue
    seen.add(key)
    paths.push(event.delegationPath)
  }
  return paths
}

function nodeForNodeRun(
  nodeRunId: string,
  traceEvents: EnterpriseTopologyTraceEventRecord[],
): string | undefined {
  const event = [...traceEvents].reverse().find((candidate) => candidate.nodeRunId === nodeRunId)
  return event?.delegationPath[event.delegationPath.length - 1]
}

export function buildTopologyRunOverlayState(
  input: TopologyRunTraceOverlayInput | null | undefined,
): TopologyRunTraceOverlayState {
  const nodeStates: Record<string, TopologyTraceNodeState> = {}
  const edgeStates: Record<string, TopologyTraceEdgeState> = {}
  const traceEvents = input?.traceEvents ?? []
  const failureReports = input?.failureReports ?? []
  const toolCalls = input?.toolCalls ?? []
  const delegationPaths = uniquePaths(traceEvents)

  for (const path of delegationPaths) {
    path.forEach((nodeId) => setNodeState(nodeStates, topologyCanvasNodeIdForRuntimeNodeId(nodeId), "delegation_path"))
    for (let index = 0; index < path.length - 1; index += 1) {
      const from = path[index]
      const to = path[index + 1]
      if (!from || !to) continue
      edgeStates[topologyTraceEdgeKey(from, to)] = "delegation_path"
    }
  }

  for (const event of traceEvents) {
    const nodeId = event.delegationPath[event.delegationPath.length - 1]
    if (!nodeId) continue
    if (event.reasonCode.includes("failed_candidate") || event.phase === "exhaustion") {
      setNodeState(nodeStates, topologyCanvasNodeIdForRuntimeNodeId(nodeId), "failed_candidate")
    }
  }

  for (const toolCall of toolCalls) {
    const nodeId = nodeForNodeRun(toolCall.nodeRunId, traceEvents)
    if (nodeId) setNodeState(nodeStates, topologyCanvasNodeIdForRuntimeNodeId(nodeId), "tool_call")
  }

  for (const report of failureReports) {
    setNodeState(nodeStates, topologyCanvasNodeIdForRuntimeNodeId(report.nodeId), "failed")
    const failedPath = traceEvents
      .find((event) => event.nodeRunId === report.nodeRunId && event.phase === report.failurePhase)
      ?.delegationPath
    for (let index = 0; index < (failedPath?.length ?? 0) - 1; index += 1) {
      const from = failedPath?.[index]
      const to = failedPath?.[index + 1]
      if (!from || !to) continue
      edgeStates[topologyTraceEdgeKey(from, to)] = "failed_path"
    }
  }

  return {
    nodeStates,
    edgeStates,
    delegationPaths,
    failedNodeIds: Object.entries(nodeStates)
      .filter(([, state]) => state === "failed")
      .map(([nodeId]) => nodeId),
    failedCandidateNodeIds: Object.entries(nodeStates)
      .filter(([, state]) => state === "failed_candidate")
      .map(([nodeId]) => nodeId),
    toolCallNodeIds: Object.entries(nodeStates)
      .filter(([, state]) => state === "tool_call")
      .map(([nodeId]) => nodeId),
  }
}

export function TopologyRunTraceOverlay({
  overlay,
}: {
  overlay?: TopologyRunTraceOverlayInput | null
}) {
  const { text } = useUiI18n()
  const state = React.useMemo(() => buildTopologyRunOverlayState(overlay), [overlay])
  const latestPath = state.delegationPaths[state.delegationPaths.length - 1] ?? []

  return (
    <section
      className="rounded-lg border border-stone-200 bg-white p-4"
      data-testid="topology-run-trace-overlay"
    >
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-sm font-semibold text-stone-950">
            {text("Run Trace", "Run Trace")}
          </div>
          <div className="mt-1 text-xs text-stone-500">
            {overlay?.run
              ? text("실행 경로와 실패 위치를 canvas에 표시합니다.", "Shows execution path and failure location on the canvas.")
              : text("수동 실행 후 trace가 표시됩니다.", "Trace appears after a manual run.")}
          </div>
        </div>
        <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${
          overlay?.run?.status === "failed"
            ? "bg-red-100 text-red-800"
            : overlay?.run
              ? "bg-emerald-100 text-emerald-800"
              : "bg-stone-100 text-stone-700"
        }`}>
          {overlay?.run?.status ?? text("대기", "Waiting")}
        </span>
      </div>

      {overlay?.run ? (
        <div className="mt-3 grid gap-3 text-xs">
          <div
            className="rounded-lg border border-sky-100 bg-sky-50 p-3 text-sky-900"
            data-testid="topology-trace-delegation-path"
          >
            <div className="font-semibold">{text("Delegation path", "Delegation path")}</div>
            <div className="mt-1 break-words text-[11px]">
              {latestPath.join(" -> ") || overlay.run.entryNodeId || "-"}
            </div>
          </div>

          {overlay.toolCalls.length > 0 ? (
            <div className="grid gap-2" data-testid="topology-trace-tool-calls">
              {overlay.toolCalls.map((toolCall) => (
                <div
                  key={toolCall.toolCallId}
                  className="rounded-lg border border-amber-100 bg-amber-50 p-3 text-amber-900"
                  data-testid="topology-trace-tool-call"
                >
                  <div className="font-semibold">{toolCall.toolId}</div>
                  <div className="mt-1 text-[11px]">
                    {toolCall.status} / {toolCall.reasonCode}
                  </div>
                </div>
              ))}
            </div>
          ) : null}

          {state.failedCandidateNodeIds.length > 0 ? (
            <div
              className="rounded-lg border border-orange-100 bg-orange-50 p-3 text-orange-900"
              data-testid="topology-trace-failed-candidate"
            >
              <div className="font-semibold">{text("Failed candidate", "Failed candidate")}</div>
              <div className="mt-1 text-[11px]">{state.failedCandidateNodeIds.join(", ")}</div>
            </div>
          ) : null}

          {overlay.failureReports.length > 0 ? (
            <div className="grid gap-2">
              {overlay.failureReports.map((failure) => (
                <div
                  key={failure.failureReportId}
                  className="rounded-lg border border-red-100 bg-red-50 p-3 text-red-900"
                  data-testid="topology-trace-failure-report"
                >
                  <div className="font-semibold">{failure.nodeId}</div>
                  <div className="mt-1 text-[11px]">
                    {failure.failurePhase} / {failure.report.recommendedAction}
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1">
                    {failure.report.untriedOptions.map((option) => (
                      <span key={option} className="rounded-full bg-white px-2 py-0.5 text-[11px] font-semibold">
                        {option}
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          ) : null}

          {overlay.observedEdges && overlay.observedEdges.length > 0 ? (
            <div
              className="rounded-lg border border-violet-100 bg-violet-50 p-3 text-violet-900"
              data-testid="topology-trace-observed-summary"
            >
              <div className="font-semibold">{text("Observed edges", "Observed edges")}</div>
              <div className="mt-1 text-[11px]">
                {overlay.observedEdges.length} {text("실제 실행 연결", "runtime connections")} / {(overlay.gapFindings ?? []).length} {text("개선 후보", "improvement candidates")}
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  )
}
