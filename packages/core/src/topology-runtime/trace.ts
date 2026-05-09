import type Database from "better-sqlite3"
import {
  ENTERPRISE_TOPOLOGY_SCHEMA_VERSION,
  type FailureReport,
  type EnterpriseMetadata,
  type EnterpriseTimestamp,
  type NodeResultReport,
  type NodeRuntimeState,
  type TraceEvent,
  type TracePhase,
  type WorkOrder,
} from "../contracts/enterprise-topology.js"
import { getDb } from "../db/index.js"
import { assertMigrationWriteAllowed } from "../db/migration-safety.js"
import {
  listObservedTopologyEdges,
  listTopologyGapFindings,
  projectTopologyRunMetricsDaily,
  type ObservedTopologyEdgeRecord,
  type TopologyGapFindingRecord,
} from "../topology/metrics.js"
import {
  attachExecutorFailureEvidence,
  buildExecutorTraceEventPayload,
} from "../topology/executor-observability.js"
import type { NodeRuntimeExecutionResult } from "./node-runtime.js"

export interface CreateNodeRuntimeTraceEventInput {
  workOrder: WorkOrder
  nodeRunId: string
  state: NodeRuntimeState
  sequence: number
  at: EnterpriseTimestamp
  component?: string
  phase?: TracePhase
  reasonCode?: string
  payload?: EnterpriseMetadata
}

export function createNodeRuntimeTraceEvent(input: CreateNodeRuntimeTraceEventInput): TraceEvent {
  const payload = buildExecutorTraceEventPayload({
    workOrder: input.workOrder,
    ...(input.payload !== undefined ? { payload: input.payload } : {}),
  })
  return {
    schemaVersion: ENTERPRISE_TOPOLOGY_SCHEMA_VERSION,
    traceEventId: `trace:${input.workOrder.topologyRunId}:${input.nodeRunId}:${input.sequence}`,
    topologyRunId: input.workOrder.topologyRunId,
    nodeRunId: input.nodeRunId,
    workOrderId: input.workOrder.workOrderId,
    parentWorkOrderId: input.workOrder.parentWorkOrderId ?? null,
    delegationPath: [...input.workOrder.delegationPath],
    phase: input.phase ?? tracePhaseForNodeRuntimeState(input.state),
    component: input.component ?? "node-runtime",
    at: input.at,
    reasonCode: input.reasonCode ?? `node_runtime_${input.state}`,
    ...(payload !== undefined ? { payload: structuredClone(payload) } : {}),
  }
}

export function tracePhaseForNodeRuntimeState(state: NodeRuntimeState): TracePhase {
  switch (state) {
    case "created":
      return "topology_run"
    case "work_order_received":
    case "analyzing":
    case "planning":
      return "work_order"
    case "permission_checking":
      return "permission"
    case "self_executing":
      return "self_execution"
    case "child_delegating":
      return "child_delegation"
    case "tool_executing":
      return "tool_execution"
    case "aggregating":
      return "aggregation"
    case "validating":
      return "validation"
    case "exhaustion_checking":
    case "failed_candidate":
      return "exhaustion"
    case "reporting":
    case "completed":
    case "partial_success":
    case "failed":
      return "reporting"
  }
}

export interface RecordTopologyRuntimeExecutionInput {
  result: NodeRuntimeExecutionResult
  db?: Database.Database
  topologyId?: string
  topologyVersion?: number
  topologyVersionId?: string
  rootRunId?: string
  startedAt?: number
  finishedAt?: number
  metadata?: Record<string, unknown>
  now?: () => number
}

export interface TopologyTracePersistenceResult {
  topologyRunId: string
  nodeRunId: string
  workOrderId: string
  traceEventCount: number
  toolCallCount: number
  observedEdgeCount: number
}

export interface TopologyRunRecord {
  topologyRunId: string
  topologyId: string
  topologyVersion?: number
  topologyVersionId?: string
  rootRunId?: string
  status: string
  entryNodeId?: string
  startedAt: number
  finishedAt?: number
  createdAt: number
  updatedAt: number
  metadata?: unknown
}

export interface TopologyNodeRunRecord {
  nodeRunId: string
  topologyRunId: string
  workOrderId?: string
  nodeId: string
  parentNodeRunId?: string
  status: string
  finalState?: string
  startedAt: number
  finishedAt?: number
  createdAt: number
  updatedAt: number
  metrics?: unknown
}

export interface TopologyWorkOrderRecord {
  workOrderId: string
  topologyRunId: string
  nodeRunId?: string
  parentWorkOrderId?: string
  fromNodeId: string
  toType: string
  toId: string
  delegationPath: string[]
  workOrder: unknown
  createdAt: number
}

export interface TopologyResultReportRecord {
  resultReportId: string
  topologyRunId: string
  nodeRunId: string
  workOrderId: string
  nodeId: string
  status: string
  report: unknown
  createdAt: number
}

export interface TopologyFailureReportRecord {
  failureReportId: string
  topologyRunId: string
  nodeRunId: string
  workOrderId: string
  nodeId: string
  failurePhase: string
  report: unknown
  createdAt: number
}

export interface TopologyTraceEventRecord {
  traceEventId: string
  topologyRunId: string
  nodeRunId: string
  workOrderId: string
  parentWorkOrderId?: string
  phase: TracePhase
  component: string
  reasonCode: string
  delegationPath: string[]
  payload?: unknown
  event: unknown
  at: number
  sequence: number
}

export interface TopologyToolCallRecord {
  toolCallId: string
  topologyRunId: string
  nodeRunId: string
  workOrderId: string
  toolId: string
  dispatcherToolName: string
  status: string
  reasonCode: string
  retryPossible: boolean
  fallbackPossible: boolean
  startedAt: number
  completedAt?: number
  result: unknown
}

export interface TopologyRunTraceProjection {
  run: TopologyRunRecord
  nodeRuns: TopologyNodeRunRecord[]
  workOrders: TopologyWorkOrderRecord[]
  resultReports: TopologyResultReportRecord[]
  failureReports: TopologyFailureReportRecord[]
  traceEvents: TopologyTraceEventRecord[]
  toolCalls: TopologyToolCallRecord[]
  observedEdges: ObservedTopologyEdgeRecord[]
  gapFindings: TopologyGapFindingRecord[]
}

export interface ListTopologyRunsOptions {
  db?: Database.Database
  topologyId?: string
  rootRunId?: string
  status?: string
  limit?: number
}

export interface ListTopologyRunChildrenOptions {
  db?: Database.Database
  limit?: number
}

interface TopologyRunRow {
  topology_run_id: string
  topology_id: string
  topology_version: number | null
  topology_version_id: string | null
  root_run_id: string | null
  status: string
  entry_node_id: string | null
  started_at: number
  finished_at: number | null
  created_at: number
  updated_at: number
  metadata_json: string | null
}

interface TopologyNodeRunRow {
  node_run_id: string
  topology_run_id: string
  work_order_id: string | null
  node_id: string
  parent_node_run_id: string | null
  status: string
  final_state: string | null
  started_at: number
  finished_at: number | null
  created_at: number
  updated_at: number
  metrics_json: string | null
}

interface TopologyWorkOrderRow {
  work_order_id: string
  topology_run_id: string
  node_run_id: string | null
  parent_work_order_id: string | null
  from_node_id: string
  to_type: string
  to_id: string
  delegation_path_json: string
  work_order_json: string
  created_at: number
}

interface TopologyResultReportRow {
  result_report_id: string
  topology_run_id: string
  node_run_id: string
  work_order_id: string
  node_id: string
  status: string
  report_json: string
  created_at: number
}

interface TopologyFailureReportRow {
  failure_report_id: string
  topology_run_id: string
  node_run_id: string
  work_order_id: string
  node_id: string
  failure_phase: string
  report_json: string
  created_at: number
}

interface TopologyTraceEventRow {
  trace_event_id: string
  topology_run_id: string
  node_run_id: string
  work_order_id: string
  parent_work_order_id: string | null
  phase: TracePhase
  component: string
  reason_code: string
  delegation_path_json: string
  payload_json: string | null
  event_json: string
  at: number
  sequence: number
}

interface TopologyToolCallRow {
  tool_call_id: string
  topology_run_id: string
  node_run_id: string
  work_order_id: string
  tool_id: string
  dispatcher_tool_name: string
  status: string
  reason_code: string
  retry_possible: number
  fallback_possible: number
  started_at: number
  completed_at: number | null
  result_json: string
}

function jsonString(value: unknown): string {
  return JSON.stringify(value)
}

function parseJson(value: string | null | undefined): unknown {
  if (value === null || value === undefined || value.trim().length === 0) return null
  try {
    return JSON.parse(value)
  } catch {
    return null
  }
}

function timestampToNumber(value: EnterpriseTimestamp | undefined, fallback: number): number {
  if (typeof value === "number" && Number.isFinite(value)) return value
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return parsed
    const date = Date.parse(value)
    if (Number.isFinite(date)) return date
  }
  return fallback
}

function optionalNumber(value: number | null): number | undefined {
  return value === null ? undefined : value
}

function optionalString(value: string | null): string | undefined {
  return value === null ? undefined : value
}

function traceEventTimeRange(events: TraceEvent[], fallbackStart: number, fallbackEnd: number): {
  startedAt: number
  finishedAt: number
} {
  const times = events
    .map((event) => timestampToNumber(event.at, Number.NaN))
    .filter((value) => Number.isFinite(value))
  if (times.length === 0) return { startedAt: fallbackStart, finishedAt: fallbackEnd }
  return {
    startedAt: Math.min(...times, fallbackStart),
    finishedAt: Math.max(...times, fallbackEnd),
  }
}

function mapTopologyRunRow(row: TopologyRunRow): TopologyRunRecord {
  const record: TopologyRunRecord = {
    topologyRunId: row.topology_run_id,
    topologyId: row.topology_id,
    status: row.status,
    startedAt: row.started_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
  const topologyVersion = optionalNumber(row.topology_version)
  const topologyVersionId = optionalString(row.topology_version_id)
  const rootRunId = optionalString(row.root_run_id)
  const entryNodeId = optionalString(row.entry_node_id)
  const finishedAt = optionalNumber(row.finished_at)
  const metadata = parseJson(row.metadata_json)
  if (topologyVersion !== undefined) record.topologyVersion = topologyVersion
  if (topologyVersionId !== undefined) record.topologyVersionId = topologyVersionId
  if (rootRunId !== undefined) record.rootRunId = rootRunId
  if (entryNodeId !== undefined) record.entryNodeId = entryNodeId
  if (finishedAt !== undefined) record.finishedAt = finishedAt
  if (metadata !== null) record.metadata = metadata
  return record
}

function mapTopologyNodeRunRow(row: TopologyNodeRunRow): TopologyNodeRunRecord {
  const record: TopologyNodeRunRecord = {
    nodeRunId: row.node_run_id,
    topologyRunId: row.topology_run_id,
    nodeId: row.node_id,
    status: row.status,
    startedAt: row.started_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
  const workOrderId = optionalString(row.work_order_id)
  const parentNodeRunId = optionalString(row.parent_node_run_id)
  const finalState = optionalString(row.final_state)
  const finishedAt = optionalNumber(row.finished_at)
  const metrics = parseJson(row.metrics_json)
  if (workOrderId !== undefined) record.workOrderId = workOrderId
  if (parentNodeRunId !== undefined) record.parentNodeRunId = parentNodeRunId
  if (finalState !== undefined) record.finalState = finalState
  if (finishedAt !== undefined) record.finishedAt = finishedAt
  if (metrics !== null) record.metrics = metrics
  return record
}

function mapTopologyWorkOrderRow(row: TopologyWorkOrderRow): TopologyWorkOrderRecord {
  const record: TopologyWorkOrderRecord = {
    workOrderId: row.work_order_id,
    topologyRunId: row.topology_run_id,
    fromNodeId: row.from_node_id,
    toType: row.to_type,
    toId: row.to_id,
    delegationPath: parseJson(row.delegation_path_json) as string[],
    workOrder: parseJson(row.work_order_json),
    createdAt: row.created_at,
  }
  const nodeRunId = optionalString(row.node_run_id)
  const parentWorkOrderId = optionalString(row.parent_work_order_id)
  if (nodeRunId !== undefined) record.nodeRunId = nodeRunId
  if (parentWorkOrderId !== undefined) record.parentWorkOrderId = parentWorkOrderId
  return record
}

function mapTopologyResultReportRow(row: TopologyResultReportRow): TopologyResultReportRecord {
  return {
    resultReportId: row.result_report_id,
    topologyRunId: row.topology_run_id,
    nodeRunId: row.node_run_id,
    workOrderId: row.work_order_id,
    nodeId: row.node_id,
    status: row.status,
    report: parseJson(row.report_json),
    createdAt: row.created_at,
  }
}

function mapTopologyFailureReportRow(row: TopologyFailureReportRow): TopologyFailureReportRecord {
  return {
    failureReportId: row.failure_report_id,
    topologyRunId: row.topology_run_id,
    nodeRunId: row.node_run_id,
    workOrderId: row.work_order_id,
    nodeId: row.node_id,
    failurePhase: row.failure_phase,
    report: parseJson(row.report_json),
    createdAt: row.created_at,
  }
}

function mapTopologyTraceEventRow(row: TopologyTraceEventRow): TopologyTraceEventRecord {
  const record: TopologyTraceEventRecord = {
    traceEventId: row.trace_event_id,
    topologyRunId: row.topology_run_id,
    nodeRunId: row.node_run_id,
    workOrderId: row.work_order_id,
    phase: row.phase,
    component: row.component,
    reasonCode: row.reason_code,
    delegationPath: parseJson(row.delegation_path_json) as string[],
    event: parseJson(row.event_json),
    at: row.at,
    sequence: row.sequence,
  }
  const parentWorkOrderId = optionalString(row.parent_work_order_id)
  const payload = parseJson(row.payload_json)
  if (parentWorkOrderId !== undefined) record.parentWorkOrderId = parentWorkOrderId
  if (payload !== null) record.payload = payload
  return record
}

function mapTopologyToolCallRow(row: TopologyToolCallRow): TopologyToolCallRecord {
  const record: TopologyToolCallRecord = {
    toolCallId: row.tool_call_id,
    topologyRunId: row.topology_run_id,
    nodeRunId: row.node_run_id,
    workOrderId: row.work_order_id,
    toolId: row.tool_id,
    dispatcherToolName: row.dispatcher_tool_name,
    status: row.status,
    reasonCode: row.reason_code,
    retryPossible: row.retry_possible === 1,
    fallbackPossible: row.fallback_possible === 1,
    startedAt: row.started_at,
    result: parseJson(row.result_json),
  }
  const completedAt = optionalNumber(row.completed_at)
  if (completedAt !== undefined) record.completedAt = completedAt
  return record
}

function failurePhaseFor(input: {
  failureReport: FailureReport
  traceEvents: TraceEvent[]
}): TracePhase {
  const matching = [...input.traceEvents]
    .reverse()
    .find((event) => event.nodeRunId === input.failureReport.nodeRunId && event.phase === "exhaustion")
  return matching?.phase ?? "reporting"
}

function workOrdersFromResult(result: NodeRuntimeExecutionResult): Array<{
  workOrder: WorkOrder
  nodeRunId?: string
}> {
  const records: Array<{ workOrder: WorkOrder; nodeRunId?: string }> = [{
    workOrder: result.envelope.workOrder,
    nodeRunId: result.nodeResultReport.nodeRunId,
  }]

  for (const child of result.childDelegation?.results ?? []) {
    records.push({
      workOrder: child.workOrder,
      ...(child.nodeResultReport?.nodeRunId !== undefined ? { nodeRunId: child.nodeResultReport.nodeRunId } : {}),
    })
  }

  return records
}

function resultReportsFromResult(result: NodeRuntimeExecutionResult): NodeResultReport[] {
  return [
    result.nodeResultReport,
    ...(result.childDelegation?.results ?? [])
      .map((child) => child.nodeResultReport)
      .filter((report): report is NodeResultReport => report !== undefined),
  ]
}

function observedEdgePairs(workOrders: WorkOrder[], traceEvents: TraceEvent[]): Array<{
  topologyRunId: string
  fromNodeId: string
  toNodeId: string
  evidence: unknown
  at: number
}> {
  const pairs = new Map<string, {
    topologyRunId: string
    fromNodeId: string
    toNodeId: string
    evidence: unknown
    at: number
  }>()

  const addPath = (topologyRunId: string, path: string[], evidence: unknown, at: number): void => {
    for (let index = 0; index < path.length - 1; index += 1) {
      const fromNodeId = path[index]
      const toNodeId = path[index + 1]
      if (fromNodeId === undefined || toNodeId === undefined) continue
      const key = `${topologyRunId}:${fromNodeId}->${toNodeId}`
      pairs.set(key, { topologyRunId, fromNodeId, toNodeId, evidence, at })
    }
  }

  for (const workOrder of workOrders) {
    const path = workOrder.delegationPath.length >= 2
      ? workOrder.delegationPath
      : [workOrder.fromNodeId, workOrder.to.id]
    addPath(
      workOrder.topologyRunId,
      path,
      { source: "work_order", workOrderId: workOrder.workOrderId },
      timestampToNumber(workOrder.createdAt, Date.now()),
    )
  }

  for (const event of traceEvents) {
    addPath(
      event.topologyRunId,
      event.delegationPath,
      { source: "trace_event", traceEventId: event.traceEventId, phase: event.phase },
      timestampToNumber(event.at, Date.now()),
    )
  }

  return [...pairs.values()]
}

export function recordTopologyRuntimeExecution(
  input: RecordTopologyRuntimeExecutionInput,
): TopologyTracePersistenceResult {
  const db = input.db ?? getDb()
  assertMigrationWriteAllowed(db, "topology_runtime_trace.record")

  const result = input.result
  const workOrder = result.envelope.workOrder
  const topologyRunId = workOrder.topologyRunId
  const topologyId = input.topologyId ?? result.profileSnapshot.topologyId
  const topologyVersion = input.topologyVersion
  const topologyVersionId = input.topologyVersionId
  const rootRunId = input.rootRunId
  const fallbackStart = timestampToNumber(workOrder.createdAt, input.now?.() ?? Date.now())
  const fallbackEnd = timestampToNumber(result.nodeResultReport.createdAt, fallbackStart)
  const eventRange = traceEventTimeRange(result.traceEvents, fallbackStart, fallbackEnd)
  const startedAt = input.startedAt ?? eventRange.startedAt
  const finishedAt = input.finishedAt ?? eventRange.finishedAt
  const now = input.now?.() ?? finishedAt
  const workOrderRecords = workOrdersFromResult(result)
  const workOrderIdToNodeRunId = new Map<string, string>()
  for (const record of workOrderRecords) {
    if (record.nodeRunId !== undefined) workOrderIdToNodeRunId.set(record.workOrder.workOrderId, record.nodeRunId)
  }
  const resultReports = resultReportsFromResult(result)
  const observedEdges = observedEdgePairs(
    workOrderRecords.map((record) => record.workOrder),
    result.traceEvents,
  )

  const tx = db.transaction(() => {
    db.prepare(
      `INSERT INTO topology_runs
       (topology_run_id, topology_id, topology_version, topology_version_id, root_run_id,
        status, entry_node_id, started_at, finished_at, created_at, updated_at, metadata_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(topology_run_id) DO UPDATE SET
         topology_id = excluded.topology_id,
         topology_version = excluded.topology_version,
         topology_version_id = excluded.topology_version_id,
         root_run_id = COALESCE(excluded.root_run_id, topology_runs.root_run_id),
         status = excluded.status,
         entry_node_id = excluded.entry_node_id,
         started_at = MIN(topology_runs.started_at, excluded.started_at),
         finished_at = excluded.finished_at,
         updated_at = excluded.updated_at,
         metadata_json = excluded.metadata_json`,
    ).run(
      topologyRunId,
      topologyId,
      topologyVersion ?? null,
      topologyVersionId ?? null,
      rootRunId ?? null,
      result.status,
      workOrder.to.type === "node" ? workOrder.to.id : null,
      startedAt,
      finishedAt,
      now,
      now,
      input.metadata !== undefined ? jsonString(input.metadata) : null,
    )

    for (const report of resultReports) {
      const reportStartedAt = result.traceEvents
        .filter((event) => event.nodeRunId === report.nodeRunId)
        .map((event) => timestampToNumber(event.at, startedAt))
        .sort((left, right) => left - right)[0] ?? startedAt
      const reportFinishedAt = timestampToNumber(report.createdAt, finishedAt)
      const parentWorkOrderId = workOrderRecords.find((record) => record.workOrder.workOrderId === report.workOrderId)
        ?.workOrder.parentWorkOrderId
      const parentNodeRunId = parentWorkOrderId ? workOrderIdToNodeRunId.get(parentWorkOrderId) : undefined
      db.prepare(
        `INSERT INTO topology_node_runs
         (node_run_id, topology_run_id, work_order_id, node_id, parent_node_run_id, status,
          final_state, started_at, finished_at, created_at, updated_at, metrics_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(node_run_id) DO UPDATE SET
           topology_run_id = excluded.topology_run_id,
           work_order_id = excluded.work_order_id,
           node_id = excluded.node_id,
           parent_node_run_id = excluded.parent_node_run_id,
           status = excluded.status,
           final_state = excluded.final_state,
           started_at = MIN(topology_node_runs.started_at, excluded.started_at),
           finished_at = excluded.finished_at,
           updated_at = excluded.updated_at,
           metrics_json = excluded.metrics_json`,
      ).run(
        report.nodeRunId,
        report.topologyRunId,
        report.workOrderId,
        report.nodeId,
        parentNodeRunId ?? null,
        report.status,
        report.nodeRunId === result.nodeResultReport.nodeRunId ? result.finalState : null,
        reportStartedAt,
        reportFinishedAt,
        now,
        now,
        jsonString({
          outputCount: report.outputs.length,
          unmetSuccessCriteriaCount: report.unmetSuccessCriteriaIds.length,
          riskOrGapCount: report.risksOrGaps.length,
        }),
      )
    }

    for (const record of workOrderRecords) {
      db.prepare(
        `INSERT INTO topology_work_orders
         (work_order_id, topology_run_id, node_run_id, parent_work_order_id, from_node_id,
          to_type, to_id, delegation_path_json, work_order_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(work_order_id) DO UPDATE SET
           topology_run_id = excluded.topology_run_id,
           node_run_id = excluded.node_run_id,
           parent_work_order_id = excluded.parent_work_order_id,
           from_node_id = excluded.from_node_id,
           to_type = excluded.to_type,
           to_id = excluded.to_id,
           delegation_path_json = excluded.delegation_path_json,
           work_order_json = excluded.work_order_json`,
      ).run(
        record.workOrder.workOrderId,
        record.workOrder.topologyRunId,
        record.nodeRunId ?? null,
        record.workOrder.parentWorkOrderId ?? null,
        record.workOrder.fromNodeId,
        record.workOrder.to.type,
        record.workOrder.to.id,
        jsonString(record.workOrder.delegationPath),
        jsonString(record.workOrder),
        timestampToNumber(record.workOrder.createdAt, startedAt),
      )
    }

    for (const report of resultReports) {
      db.prepare(
        `INSERT INTO topology_result_reports
         (result_report_id, topology_run_id, node_run_id, work_order_id, node_id, status, report_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(result_report_id) DO UPDATE SET
           status = excluded.status,
           report_json = excluded.report_json`,
      ).run(
        report.resultReportId,
        report.topologyRunId,
        report.nodeRunId,
        report.workOrderId,
        report.nodeId,
        report.status,
        jsonString(report),
        timestampToNumber(report.createdAt, finishedAt),
      )
    }

    if (result.failureReport !== undefined) {
      const failureWorkOrder = workOrderRecords.find((record) =>
        record.workOrder.workOrderId === result.failureReport?.workOrderId
      )?.workOrder
      const failureReport = attachExecutorFailureEvidence({
        failureReport: result.failureReport,
        ...(failureWorkOrder ? { workOrder: failureWorkOrder } : {}),
        traceEvents: result.traceEvents,
      })
      db.prepare(
        `INSERT INTO topology_failure_reports
         (failure_report_id, topology_run_id, node_run_id, work_order_id, node_id, failure_phase, report_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(failure_report_id) DO UPDATE SET
           failure_phase = excluded.failure_phase,
           report_json = excluded.report_json`,
      ).run(
        failureReport.failureReportId,
        failureReport.topologyRunId,
        failureReport.nodeRunId,
        failureReport.workOrderId,
        failureReport.nodeId,
        failurePhaseFor({ failureReport, traceEvents: result.traceEvents }),
        jsonString(failureReport),
        timestampToNumber(failureReport.createdAt, finishedAt),
      )
    }

    result.traceEvents.forEach((event, index) => {
      db.prepare(
        `INSERT INTO topology_trace_events
         (trace_event_id, topology_run_id, node_run_id, work_order_id, parent_work_order_id,
          phase, component, reason_code, delegation_path_json, payload_json, event_json, at, sequence)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(trace_event_id) DO UPDATE SET
           phase = excluded.phase,
           component = excluded.component,
           reason_code = excluded.reason_code,
           delegation_path_json = excluded.delegation_path_json,
           payload_json = excluded.payload_json,
           event_json = excluded.event_json,
           at = excluded.at,
           sequence = excluded.sequence`,
      ).run(
        event.traceEventId,
        event.topologyRunId,
        event.nodeRunId,
        event.workOrderId,
        event.parentWorkOrderId ?? null,
        event.phase,
        event.component,
        event.reasonCode,
        jsonString(event.delegationPath),
        event.payload !== undefined ? jsonString(event.payload) : null,
        jsonString(event),
        timestampToNumber(event.at, startedAt),
        index + 1,
      )
    })

    result.toolExecution?.results.forEach((toolResult, index) => {
      const toolCallId = `tool-call:${topologyRunId}:${result.nodeResultReport.nodeRunId}:${toolResult.toolId}:${toolResult.startedAt}:${index + 1}`
      db.prepare(
        `INSERT INTO topology_tool_calls
         (tool_call_id, topology_run_id, node_run_id, work_order_id, tool_id, dispatcher_tool_name,
          status, reason_code, retry_possible, fallback_possible, started_at, completed_at, result_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(tool_call_id) DO UPDATE SET
           status = excluded.status,
           reason_code = excluded.reason_code,
           retry_possible = excluded.retry_possible,
           fallback_possible = excluded.fallback_possible,
           completed_at = excluded.completed_at,
           result_json = excluded.result_json`,
      ).run(
        toolCallId,
        topologyRunId,
        result.nodeResultReport.nodeRunId,
        workOrder.workOrderId,
        toolResult.toolId,
        toolResult.dispatcherToolName,
        toolResult.status,
        toolResult.reasonCode,
        toolResult.retryPossible ? 1 : 0,
        toolResult.fallbackPossible ? 1 : 0,
        toolResult.startedAt,
        toolResult.completedAt,
        jsonString(toolResult),
      )
    })

    for (const edge of observedEdges) {
      db.prepare(
        `INSERT INTO observed_topology_edges
         (edge_id, topology_id, topology_run_id, from_node_id, to_node_id, edge_kind, source,
          confidence, first_seen_at, last_seen_at, evidence_json)
         VALUES (?, ?, ?, ?, ?, 'delegation_path', 'runtime_trace', 1, ?, ?, ?)
         ON CONFLICT(topology_run_id, from_node_id, to_node_id, edge_kind) DO UPDATE SET
           topology_id = excluded.topology_id,
           confidence = MAX(observed_topology_edges.confidence, excluded.confidence),
           last_seen_at = MAX(observed_topology_edges.last_seen_at, excluded.last_seen_at),
           evidence_json = excluded.evidence_json`,
      ).run(
        `observed-edge:${edge.topologyRunId}:${edge.fromNodeId}->${edge.toNodeId}:delegation_path`,
        topologyId,
        edge.topologyRunId,
        edge.fromNodeId,
        edge.toNodeId,
        edge.at,
        edge.at,
        jsonString(edge.evidence),
      )
    }
  })

  tx()
  projectTopologyRunMetricsDaily(db, {
    topologyId,
    topologyVersion: topologyVersion ?? 0,
    startedAt,
    now,
  })

  return {
    topologyRunId,
    nodeRunId: result.nodeResultReport.nodeRunId,
    workOrderId: workOrder.workOrderId,
    traceEventCount: result.traceEvents.length,
    toolCallCount: result.toolExecution?.results.length ?? 0,
    observedEdgeCount: observedEdges.length,
  }
}

export function listTopologyRuns(options: ListTopologyRunsOptions = {}): TopologyRunRecord[] {
  const db = options.db ?? getDb()
  const clauses: string[] = []
  const params: unknown[] = []
  if (options.topologyId !== undefined) {
    clauses.push("topology_id = ?")
    params.push(options.topologyId)
  }
  if (options.rootRunId !== undefined) {
    clauses.push("root_run_id = ?")
    params.push(options.rootRunId)
  }
  if (options.status !== undefined) {
    clauses.push("status = ?")
    params.push(options.status)
  }
  const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : ""
  const limit = Math.max(1, Math.min(500, Math.floor(options.limit ?? 100)))
  const rows = db.prepare(
    `SELECT *
     FROM topology_runs
     ${where}
     ORDER BY started_at DESC, topology_run_id ASC
     LIMIT ?`,
  ).all(...params, limit) as TopologyRunRow[]
  return rows.map(mapTopologyRunRow)
}

export function getTopologyRun(
  topologyRunId: string,
  options: { db?: Database.Database } = {},
): TopologyRunRecord | null {
  const db = options.db ?? getDb()
  const row = db.prepare("SELECT * FROM topology_runs WHERE topology_run_id = ?").get(topologyRunId) as
    | TopologyRunRow
    | undefined
  return row ? mapTopologyRunRow(row) : null
}

export function listTopologyNodeRuns(
  topologyRunId: string,
  options: ListTopologyRunChildrenOptions = {},
): TopologyNodeRunRecord[] {
  const db = options.db ?? getDb()
  const limit = Math.max(1, Math.min(1000, Math.floor(options.limit ?? 200)))
  const rows = db.prepare(
    `SELECT *
     FROM topology_node_runs
     WHERE topology_run_id = ?
     ORDER BY started_at ASC, node_run_id ASC
     LIMIT ?`,
  ).all(topologyRunId, limit) as TopologyNodeRunRow[]
  return rows.map(mapTopologyNodeRunRow)
}

export function listTopologyWorkOrders(
  topologyRunId: string,
  options: ListTopologyRunChildrenOptions = {},
): TopologyWorkOrderRecord[] {
  const db = options.db ?? getDb()
  const limit = Math.max(1, Math.min(1000, Math.floor(options.limit ?? 200)))
  const rows = db.prepare(
    `SELECT *
     FROM topology_work_orders
     WHERE topology_run_id = ?
     ORDER BY created_at ASC, work_order_id ASC
     LIMIT ?`,
  ).all(topologyRunId, limit) as TopologyWorkOrderRow[]
  return rows.map(mapTopologyWorkOrderRow)
}

export function listTopologyResultReports(
  topologyRunId: string,
  options: ListTopologyRunChildrenOptions = {},
): TopologyResultReportRecord[] {
  const db = options.db ?? getDb()
  const limit = Math.max(1, Math.min(1000, Math.floor(options.limit ?? 200)))
  const rows = db.prepare(
    `SELECT *
     FROM topology_result_reports
     WHERE topology_run_id = ?
     ORDER BY created_at ASC, result_report_id ASC
     LIMIT ?`,
  ).all(topologyRunId, limit) as TopologyResultReportRow[]
  return rows.map(mapTopologyResultReportRow)
}

export function listTopologyFailureReports(
  topologyRunId: string,
  options: ListTopologyRunChildrenOptions = {},
): TopologyFailureReportRecord[] {
  const db = options.db ?? getDb()
  const limit = Math.max(1, Math.min(1000, Math.floor(options.limit ?? 200)))
  const rows = db.prepare(
    `SELECT *
     FROM topology_failure_reports
     WHERE topology_run_id = ?
     ORDER BY created_at ASC, failure_report_id ASC
     LIMIT ?`,
  ).all(topologyRunId, limit) as TopologyFailureReportRow[]
  return rows.map(mapTopologyFailureReportRow)
}

export function listTopologyTraceEvents(
  topologyRunId: string,
  options: ListTopologyRunChildrenOptions = {},
): TopologyTraceEventRecord[] {
  const db = options.db ?? getDb()
  const limit = Math.max(1, Math.min(5000, Math.floor(options.limit ?? 500)))
  const rows = db.prepare(
    `SELECT *
     FROM topology_trace_events
     WHERE topology_run_id = ?
     ORDER BY at ASC, sequence ASC, trace_event_id ASC
     LIMIT ?`,
  ).all(topologyRunId, limit) as TopologyTraceEventRow[]
  return rows.map(mapTopologyTraceEventRow)
}

export function listTopologyToolCalls(
  topologyRunId: string,
  options: ListTopologyRunChildrenOptions = {},
): TopologyToolCallRecord[] {
  const db = options.db ?? getDb()
  const limit = Math.max(1, Math.min(1000, Math.floor(options.limit ?? 200)))
  const rows = db.prepare(
    `SELECT *
     FROM topology_tool_calls
     WHERE topology_run_id = ?
     ORDER BY started_at ASC, tool_call_id ASC
     LIMIT ?`,
  ).all(topologyRunId, limit) as TopologyToolCallRow[]
  return rows.map(mapTopologyToolCallRow)
}

export function getTopologyRunTraceProjection(
  topologyRunId: string,
  options: { db?: Database.Database; limit?: number } = {},
): TopologyRunTraceProjection | null {
  const db = options.db ?? getDb()
  const run = getTopologyRun(topologyRunId, { db })
  if (run === null) return null
  const limit = options.limit
  return {
    run,
    nodeRuns: listTopologyNodeRuns(topologyRunId, { db, ...(limit !== undefined ? { limit } : {}) }),
    workOrders: listTopologyWorkOrders(topologyRunId, { db, ...(limit !== undefined ? { limit } : {}) }),
    resultReports: listTopologyResultReports(topologyRunId, { db, ...(limit !== undefined ? { limit } : {}) }),
    failureReports: listTopologyFailureReports(topologyRunId, { db, ...(limit !== undefined ? { limit } : {}) }),
    traceEvents: listTopologyTraceEvents(topologyRunId, { db, ...(limit !== undefined ? { limit } : {}) }),
    toolCalls: listTopologyToolCalls(topologyRunId, { db, ...(limit !== undefined ? { limit } : {}) }),
    observedEdges: listObservedTopologyEdges({ db, topologyRunId }),
    gapFindings: listTopologyGapFindings({ db, topologyRunId }),
  }
}

export function listTopologyRunsForRootRun(
  rootRunId: string,
  options: { db?: Database.Database; limit?: number } = {},
): TopologyRunTraceProjection[] {
  const db = options.db ?? getDb()
  return listTopologyRuns({
    db,
    rootRunId,
    ...(options.limit !== undefined ? { limit: options.limit } : {}),
  })
    .map((run) => getTopologyRunTraceProjection(run.topologyRunId, {
      db,
      ...(options.limit !== undefined ? { limit: options.limit } : {}),
    }))
    .filter((projection): projection is TopologyRunTraceProjection => projection !== null)
}
