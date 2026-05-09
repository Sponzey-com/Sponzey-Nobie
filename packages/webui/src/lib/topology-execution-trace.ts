import type { TracePhase } from "../contracts/enterprise-topology"
import type { ExecutorCardExecutionStatus } from "../components/topology/ExecutorCardNode"
import type { ExecutorFlowEdgeStatus } from "../components/topology/ExecutorGraphCanvas"
import type {
  EnterpriseTopologyFailureReportRecord,
  EnterpriseTopologyRunTraceProjection,
  EnterpriseTopologyTraceEventRecord,
} from "./enterprise-topology-operations"

export type TopologyExecutionTraceEventKind =
  | "selected_node"
  | "execution_started"
  | "sub_agent_dispatch"
  | "prompt_preflight_blocked"
  | "redelegation"
  | "self_solve"
  | "self_solve_after_delegation_failure"
  | "user_confirmation"
  | "failed"
  | "completed"
  | "trace_missing"

export type TopologyExecutionTraceTone =
  | "blue"
  | "sky"
  | "amber"
  | "violet"
  | "rose"
  | "emerald"
  | "stone"

export type TopologyExecutionTraceStatus =
  | "idle"
  | "running"
  | "completed"
  | "failed"
  | "blocked"
  | "self_solved"
  | "trace_missing"

export type TopologyExecutionSelfSolveMode =
  | "self_solve"
  | "self_solve_after_delegation_failure"

export interface TopologyExecutionTraceFailedExecutor {
  executorId: string
  executorName: string
  failureCode: string
  summary: string
}

export interface TopologyExecutionTraceEventViewModel {
  id: string
  kind: TopologyExecutionTraceEventKind
  labelKo: string
  labelEn: string
  summaryKo: string
  summaryEn: string
  tone: TopologyExecutionTraceTone
  at: number
  reasonCode: string
  executorId?: string
  executorName?: string
  edgeId?: string
  executionStatus?: ExecutorCardExecutionStatus
}

export interface TopologyExecutionTraceViewModel {
  source: "topology_runs" | "none"
  status: TopologyExecutionTraceStatus
  runId?: string
  topologyRunId?: string
  events: TopologyExecutionTraceEventViewModel[]
  activeExecutorIds: string[]
  activeEdgeIds: string[]
  executorStatuses: Record<string, ExecutorCardExecutionStatus>
  edgeStatuses: Record<string, ExecutorFlowEdgeStatus>
  failedExecutors: TopologyExecutionTraceFailedExecutor[]
  selfSolveMode?: TopologyExecutionSelfSolveMode
}

export interface BuildTopologyExecutionTraceViewModelInput {
  topologyRun?: EnterpriseTopologyRunTraceProjection | null
  traceEvents?: EnterpriseTopologyTraceEventRecord[]
  failureReports?: EnterpriseTopologyFailureReportRecord[]
  executorNames?: Record<string, string>
  edgeIdsByNodePair?: Record<string, string>
}

interface TraceLoopState {
  sawDelegation: boolean
  sawDelegationFailure: boolean
}

const ACTIVE_EXECUTION_STATUSES = new Set<ExecutorCardExecutionStatus>([
  "planning",
  "delegating",
  "running",
  "recovering",
])

export function buildTopologyExecutionTraceViewModel(
  input: BuildTopologyExecutionTraceViewModelInput,
): TopologyExecutionTraceViewModel {
  const projection = input.topologyRun ?? null
  if (projection === null) {
    return {
      source: "none",
      status: "idle",
      events: [],
      activeExecutorIds: [],
      activeEdgeIds: [],
      executorStatuses: {},
      edgeStatuses: {},
      failedExecutors: [],
    }
  }

  const traceEvents = [...(input.traceEvents ?? projection.traceEvents)]
    .sort((left, right) => left.at - right.at || left.sequence - right.sequence || left.traceEventId.localeCompare(right.traceEventId))
  const failureReports = input.failureReports ?? projection.failureReports
  const executorNames = input.executorNames ?? {}
  const edgeIdsByNodePair = input.edgeIdsByNodePair ?? {}
  const events: TopologyExecutionTraceEventViewModel[] = []
  const latestExecutorStatuses: Record<string, ExecutorCardExecutionStatus> = {}
  const latestEdgeStatuses: Record<string, ExecutorFlowEdgeStatus> = {}
  const failedExecutors = failureReports.map((report) =>
    failedExecutorFromFailureReport(report, executorNames)
  )
  const loopState: TraceLoopState = {
    sawDelegation: false,
    sawDelegationFailure: false,
  }

  if (projection.run.entryNodeId) {
    events.push(selectedNodeEvent({
      topologyRunId: projection.run.topologyRunId,
      executorId: projection.run.entryNodeId,
      executorNames,
      at: projection.run.startedAt,
    }))
  }

  for (const traceEvent of traceEvents) {
    const event = traceEventToViewModel(traceEvent, {
      executorNames,
      edgeIdsByNodePair,
      loopState,
    })
    events.push(event)
    if (event.executorId && event.executionStatus) {
      latestExecutorStatuses[event.executorId] = event.executionStatus
    }
    if (event.edgeId) {
      latestEdgeStatuses[event.edgeId] = edgeStatusForEvent(event)
    }
    if (event.kind === "sub_agent_dispatch") loopState.sawDelegation = true
    if (event.kind === "failed" || event.kind === "prompt_preflight_blocked") {
      if (loopState.sawDelegation) loopState.sawDelegationFailure = true
    }
  }

  const existingFailedExecutorIds = new Set(
    events
      .filter((event) => event.kind === "failed" && event.executorId)
      .map((event) => event.executorId as string),
  )
  for (const report of failureReports) {
    if (existingFailedExecutorIds.has(report.nodeId)) continue
    const failureEvent = failureReportToViewEvent(report, executorNames)
    events.push(failureEvent)
    latestExecutorStatuses[report.nodeId] = "failed"
  }

  if (traceEvents.length === 0) {
    events.push(traceMissingEvent(projection.run.topologyRunId, projection.run.startedAt))
  }

  const selfSolveMode = selectSelfSolveMode(events)
  const runFinished = isFinishedRunStatus(projection.run.status)
  const activeExecutorIds = runFinished
    ? []
    : Object.entries(latestExecutorStatuses)
      .filter(([, status]) => ACTIVE_EXECUTION_STATUSES.has(status))
      .map(([executorId]) => executorId)
  const activeEdgeIds = runFinished
    ? []
    : Object.entries(latestEdgeStatuses)
      .filter(([, status]) => status === "running")
      .map(([edgeId]) => edgeId)

  return {
    source: "topology_runs",
    status: selectTraceStatus({
      runStatus: projection.run.status,
      traceEvents,
      events,
      selfSolveMode,
    }),
    runId: projection.run.topologyRunId,
    topologyRunId: projection.run.topologyRunId,
    events,
    activeExecutorIds,
    activeEdgeIds,
    executorStatuses: latestExecutorStatuses,
    edgeStatuses: latestEdgeStatuses,
    failedExecutors,
    ...(selfSolveMode ? { selfSolveMode } : {}),
  }
}

function selectedNodeEvent(input: {
  topologyRunId: string
  executorId: string
  executorNames: Record<string, string>
  at: number
}): TopologyExecutionTraceEventViewModel {
  const executorName = executorNameFor(input.executorId, input.executorNames)
  return {
    id: `${input.topologyRunId}:selected:${input.executorId}`,
    kind: "selected_node",
    labelKo: "선택된 노드",
    labelEn: "Selected node",
    summaryKo: `${executorName} 노드가 실행 후보로 선택되었습니다.`,
    summaryEn: `${executorName} was selected as the execution candidate.`,
    tone: "blue",
    at: input.at,
    reasonCode: "topology_entry_node_selected",
    executorId: input.executorId,
    executorName,
    executionStatus: "planning",
  }
}

function traceEventToViewModel(
  traceEvent: EnterpriseTopologyTraceEventRecord,
  context: {
    executorNames: Record<string, string>
    edgeIdsByNodePair: Record<string, string>
    loopState: TraceLoopState
  },
): TopologyExecutionTraceEventViewModel {
  const executorId = nodeIdFromTraceEvent(traceEvent)
  const executorName = executorId ? executorNameFor(executorId, context.executorNames) : undefined
  const edgeId = edgeIdFromTraceEvent(traceEvent, context.edgeIdsByNodePair)
  const kind = traceEventKind(traceEvent, context.loopState)
  const copy = traceEventCopy(kind)
  const executionStatus = executionStatusForKind(kind, traceEvent.phase)
  return {
    id: traceEvent.traceEventId,
    kind,
    labelKo: copy.labelKo,
    labelEn: copy.labelEn,
    summaryKo: traceSummaryKo(kind, traceEvent, executorName),
    summaryEn: traceSummaryEn(kind, traceEvent, executorName),
    tone: copy.tone,
    at: traceEvent.at,
    reasonCode: traceEvent.reasonCode,
    ...(executorId ? { executorId } : {}),
    ...(executorName ? { executorName } : {}),
    ...(edgeId ? { edgeId } : {}),
    ...(executionStatus ? { executionStatus } : {}),
  }
}

function traceEventKind(
  traceEvent: EnterpriseTopologyTraceEventRecord,
  loopState: TraceLoopState,
): TopologyExecutionTraceEventKind {
  const reasonCode = traceEvent.reasonCode
  if (isSelfSolveAfterDelegationReason(reasonCode)) return "self_solve_after_delegation_failure"
  if (isPromptPreflightBlocked(traceEvent.phase, reasonCode)) return "prompt_preflight_blocked"
  if (isUserConfirmation(traceEvent.phase, reasonCode)) return "user_confirmation"
  if (traceEvent.phase === "child_delegation") return "sub_agent_dispatch"
  if (traceEvent.phase === "self_execution") {
    return loopState.sawDelegationFailure ? "self_solve_after_delegation_failure" : "self_solve"
  }
  if (traceEvent.phase === "recovery" || includesCodePart(reasonCode, ["redelegation", "fallback"])) return "redelegation"
  if (isFailureReason(traceEvent.phase, reasonCode)) return "failed"
  if (isCompletedReason(traceEvent.phase, reasonCode)) return "completed"
  if (isExecutionStartedReason(traceEvent.phase, reasonCode)) return "execution_started"
  return "execution_started"
}

function isPromptPreflightBlocked(phase: TracePhase, reasonCode: string): boolean {
  return (
    reasonCode === "prompt_bundle_preflight_failed" ||
    reasonCode === "authority_preflight_denied" ||
    includesCodePart(reasonCode, [
      "sub_session_blocked_by_prompt_preflight",
      "unsafe_permission_expansion",
      "unsafe_secret_access",
      "preflight_failed",
      "preflight_denied",
    ]) ||
    phase === "permission"
  )
}

function isUserConfirmation(phase: TracePhase, reasonCode: string): boolean {
  return phase === "authority" && includesCodePart(reasonCode, [
    "approval_required",
    "ask_user",
    "user_confirmation",
  ])
}

function isSelfSolveAfterDelegationReason(reasonCode: string): boolean {
  return reasonCode === "delegated_executor_runtime_failure_direct_current_agent" ||
    reasonCode === "self_solve_after_delegation_failure" ||
    includesCodePart(reasonCode, ["after_delegation_failure"])
}

function isFailureReason(phase: TracePhase, reasonCode: string): boolean {
  return phase === "exhaustion" || includesCodePart(reasonCode, ["failed", "failure"])
}

function isCompletedReason(phase: TracePhase, reasonCode: string): boolean {
  return phase === "reporting" && includesCodePart(reasonCode, ["completed", "succeeded"])
}

function isExecutionStartedReason(phase: TracePhase, reasonCode: string): boolean {
  return phase === "topology_run" ||
    phase === "work_order" ||
    includesCodePart(reasonCode, ["started", "created", "received", "planning"])
}

function includesCodePart(reasonCode: string, parts: string[]): boolean {
  return parts.some((part) => reasonCode.includes(part))
}

function executionStatusForKind(
  kind: TopologyExecutionTraceEventKind,
  phase: TracePhase,
): ExecutorCardExecutionStatus | undefined {
  if (kind === "selected_node") return "planning"
  if (kind === "execution_started") return phase === "work_order" ? "planning" : "running"
  if (kind === "sub_agent_dispatch") return "delegating"
  if (kind === "prompt_preflight_blocked") return "recovering"
  if (kind === "redelegation") return "recovering"
  if (kind === "self_solve") return "running"
  if (kind === "self_solve_after_delegation_failure") return "recovering"
  if (kind === "user_confirmation") return "recovering"
  if (kind === "failed") return "failed"
  if (kind === "completed") return "completed"
  return undefined
}

function edgeStatusForEvent(event: TopologyExecutionTraceEventViewModel): ExecutorFlowEdgeStatus {
  if (event.kind === "failed") return "failed"
  if (event.kind === "completed") return "completed"
  if (event.kind === "prompt_preflight_blocked") return "cancelled"
  return "running"
}

function traceEventCopy(kind: TopologyExecutionTraceEventKind): {
  labelKo: string
  labelEn: string
  tone: TopologyExecutionTraceTone
} {
  switch (kind) {
    case "selected_node":
      return { labelKo: "선택된 노드", labelEn: "Selected node", tone: "blue" }
    case "execution_started":
      return { labelKo: "실행 시작", labelEn: "Execution started", tone: "blue" }
    case "sub_agent_dispatch":
      return { labelKo: "서브 에이전트 위임", labelEn: "Sub-agent dispatch", tone: "sky" }
    case "prompt_preflight_blocked":
      return { labelKo: "안전 경계 차단", labelEn: "Safety boundary blocked", tone: "amber" }
    case "redelegation":
      return { labelKo: "다른 실행자 검토", labelEn: "Redelegation", tone: "violet" }
    case "self_solve":
      return { labelKo: "처음부터 직접 처리", labelEn: "Self solve", tone: "stone" }
    case "self_solve_after_delegation_failure":
      return { labelKo: "위임 실패 후 자체 처리", labelEn: "Self solve after delegation failure", tone: "amber" }
    case "user_confirmation":
      return { labelKo: "사용자 확인 대기", labelEn: "Waiting for user confirmation", tone: "amber" }
    case "failed":
      return { labelKo: "실패", labelEn: "Failed", tone: "rose" }
    case "completed":
      return { labelKo: "완료", labelEn: "Completed", tone: "emerald" }
    case "trace_missing":
      return { labelKo: "trace 없음", labelEn: "Trace missing", tone: "amber" }
  }
}

function traceSummaryKo(
  kind: TopologyExecutionTraceEventKind,
  traceEvent: EnterpriseTopologyTraceEventRecord,
  executorName: string | undefined,
): string {
  const target = executorName ?? "노비"
  if (kind === "prompt_preflight_blocked") {
    return `${target} 실행이 안전 경계에서 멈췄습니다. 코드: ${traceEvent.reasonCode}`
  }
  if (kind === "sub_agent_dispatch") return `${target}에게 작업을 위임했습니다.`
  if (kind === "self_solve_after_delegation_failure") {
    return `위임 실패 후 현재 에이전트가 자체 처리로 전환했습니다. 코드: ${traceEvent.reasonCode}`
  }
  if (kind === "self_solve") return "현재 에이전트가 직접 처리했습니다."
  if (kind === "redelegation") return `${target} 실행 후 다른 방법을 검토하고 있습니다.`
  if (kind === "user_confirmation") return `${target} 실행에 사용자 확인이 필요합니다.`
  if (kind === "failed") return `${target} 실행이 실패했습니다. 코드: ${traceEvent.reasonCode}`
  if (kind === "completed") return `${target} 실행이 완료되었습니다.`
  return `${target} 실행이 시작되었습니다. 코드: ${traceEvent.reasonCode}`
}

function traceSummaryEn(
  kind: TopologyExecutionTraceEventKind,
  traceEvent: EnterpriseTopologyTraceEventRecord,
  executorName: string | undefined,
): string {
  const target = executorName ?? "Nobie"
  if (kind === "prompt_preflight_blocked") {
    return `${target} stopped at a safety boundary. Code: ${traceEvent.reasonCode}`
  }
  if (kind === "sub_agent_dispatch") return `Work was dispatched to ${target}.`
  if (kind === "self_solve_after_delegation_failure") {
    return `After delegation failed, the current agent switched to self solving. Code: ${traceEvent.reasonCode}`
  }
  if (kind === "self_solve") return "The current agent handled the work directly."
  if (kind === "redelegation") return `${target} is checking another execution path.`
  if (kind === "user_confirmation") return `${target} is waiting for user confirmation.`
  if (kind === "failed") return `${target} failed. Code: ${traceEvent.reasonCode}`
  if (kind === "completed") return `${target} completed.`
  return `${target} started execution. Code: ${traceEvent.reasonCode}`
}

function failureReportToViewEvent(
  report: EnterpriseTopologyFailureReportRecord,
  executorNames: Record<string, string>,
): TopologyExecutionTraceEventViewModel {
  const executorName = executorNameFor(report.nodeId, executorNames)
  const reasonCode = failureReportReasonCode(report)
  return {
    id: `failure:${report.failureReportId}`,
    kind: "failed",
    labelKo: "실패",
    labelEn: "Failed",
    summaryKo: `${executorName} 실행이 실패했습니다. 코드: ${reasonCode}`,
    summaryEn: `${executorName} failed. Code: ${reasonCode}`,
    tone: "rose",
    at: report.createdAt,
    reasonCode,
    executorId: report.nodeId,
    executorName,
    executionStatus: "failed",
  }
}

function failedExecutorFromFailureReport(
  report: EnterpriseTopologyFailureReportRecord,
  executorNames: Record<string, string>,
): TopologyExecutionTraceFailedExecutor {
  return {
    executorId: report.nodeId,
    executorName: executorNameFor(report.nodeId, executorNames),
    failureCode: failureReportReasonCode(report),
    summary: failureReportSummary(report),
  }
}

function failureReportReasonCode(report: EnterpriseTopologyFailureReportRecord): string {
  const embedded = isRecord(report.report) ? stringValue(report.report.reasonCode) : undefined
  return embedded ?? report.failurePhase
}

function failureReportSummary(report: EnterpriseTopologyFailureReportRecord): string {
  if (isRecord(report.report)) {
    const recommendedAction = stringValue(report.report.recommendedAction)
    if (recommendedAction) return recommendedAction
    const issueKind = stringValue(report.report.issueKind)
    if (issueKind) return issueKind
  }
  return report.failurePhase
}

function traceMissingEvent(topologyRunId: string, at: number): TopologyExecutionTraceEventViewModel {
  return {
    id: `${topologyRunId}:trace-missing`,
    kind: "trace_missing",
    labelKo: "trace 없음",
    labelEn: "Trace missing",
    summaryKo: "이 실행은 topology trace가 없어 진단 정보로만 표시됩니다.",
    summaryEn: "This run has no topology trace and is shown only as a diagnostic state.",
    tone: "amber",
    at,
    reasonCode: "topology_trace_missing",
  }
}

function selectTraceStatus(input: {
  runStatus: string
  traceEvents: EnterpriseTopologyTraceEventRecord[]
  events: TopologyExecutionTraceEventViewModel[]
  selfSolveMode?: TopologyExecutionSelfSolveMode
}): TopologyExecutionTraceStatus {
  if (input.traceEvents.length === 0) return "trace_missing"
  if (input.runStatus === "failed" || input.events.some((event) => event.kind === "failed")) return "failed"
  if (input.selfSolveMode) return "self_solved"
  if (input.events.some((event) => event.kind === "prompt_preflight_blocked")) return "blocked"
  if (input.runStatus === "completed" || input.events.some((event) => event.kind === "completed")) return "completed"
  return "running"
}

function isFinishedRunStatus(status: string): boolean {
  return status === "completed" || status === "failed" || status === "cancelled"
}

function selectSelfSolveMode(
  events: TopologyExecutionTraceEventViewModel[],
): TopologyExecutionSelfSolveMode | undefined {
  if (events.some((event) => event.kind === "self_solve_after_delegation_failure")) {
    return "self_solve_after_delegation_failure"
  }
  if (events.some((event) => event.kind === "self_solve")) return "self_solve"
  return undefined
}

function nodeIdFromTraceEvent(traceEvent: EnterpriseTopologyTraceEventRecord): string | undefined {
  const payload = mergedPayload(traceEvent)
  const direct = firstStringValue(payload, [
    "executorId",
    "selectedExecutorId",
    "nodeId",
    "targetNodeId",
    "toNodeId",
  ])
  if (direct) return direct
  const workOrder = recordValue(payload, "workOrder")
  const workOrderTarget = recordValue(workOrder, "to")
  const targetId = stringValue(workOrderTarget?.id)
  if (targetId) return targetId
  return traceEvent.delegationPath.at(-1)
}

function edgeIdFromTraceEvent(
  traceEvent: EnterpriseTopologyTraceEventRecord,
  edgeIdsByNodePair: Record<string, string>,
): string | undefined {
  const payload = mergedPayload(traceEvent)
  const direct = firstStringValue(payload, ["edgeId", "connectionId"])
  if (direct) return direct
  const path = traceEvent.delegationPath
  if (path.length < 2) return undefined
  const from = path[path.length - 2]
  const to = path[path.length - 1]
  if (!from || !to) return undefined
  return edgeIdsByNodePair[`${from}->${to}`]
}

function mergedPayload(traceEvent: EnterpriseTopologyTraceEventRecord): Record<string, unknown> {
  const payload = isRecord(traceEvent.payload) ? traceEvent.payload : {}
  const event = isRecord(traceEvent.event) ? traceEvent.event : {}
  const eventPayload = isRecord(event.payload) ? event.payload : {}
  return { ...eventPayload, ...payload }
}

function executorNameFor(executorId: string, executorNames: Record<string, string>): string {
  return executorNames[executorId] ?? executorId
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function recordValue(record: Record<string, unknown> | undefined, key: string): Record<string, unknown> | undefined {
  if (!record) return undefined
  const value = record[key]
  return isRecord(value) ? value : undefined
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined
}

function firstStringValue(record: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = stringValue(record[key])
    if (value) return value
  }
  return undefined
}
