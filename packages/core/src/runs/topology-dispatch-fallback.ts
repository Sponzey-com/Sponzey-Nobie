import type Database from "better-sqlite3"
import type { ChannelSource } from "../channels/contracts.js"
import type { TracePhase } from "../contracts/enterprise-topology.js"
import { getDb, insertDecisionTrace } from "../db/index.js"
import { assertMigrationWriteAllowed } from "../db/migration-safety.js"
import type { OrchestrationPlan } from "../contracts/sub-agent-orchestration.js"
import type {
  DelegatedTaskDispatchOutcome,
  DelegatedTaskDispatchResult,
} from "./orchestration-dispatch.js"

export const TOPOLOGY_DISPATCH_FOLLOWUP_ACTIONS = [
  "redelegate",
  "self_solve",
  "ask_user",
  "return_to_parent",
  "fail_with_reason",
] as const

export type TopologyDispatchFollowupAction = (typeof TOPOLOGY_DISPATCH_FOLLOWUP_ACTIONS)[number]

export interface TopologyDispatchFollowupDecision {
  action: TopologyDispatchFollowupAction
  reasonCode: string
  summary: string
  failedExecutorIds: string[]
  failedExecutorNames: string[]
  failedReasonCodes: string[]
  blockedByPreflight: boolean
  alternativeExecutorIds: string[]
  rootLoopContinuation: "allowed_with_trace" | "blocked"
}

export interface ResolveTopologyDispatchFollowupDecisionInput {
  dispatchResult: DelegatedTaskDispatchResult
  plan: OrchestrationPlan
  currentExecutorId?: string
  availableDirectChildExecutorIds: string[]
}

export interface RecordTopologyDispatchFollowupTraceInput {
  decision: TopologyDispatchFollowupDecision
  dispatchResult: DelegatedTaskDispatchResult
  plan: OrchestrationPlan
  runId: string
  requestGroupId: string
  sessionId?: string | undefined
  source?: ChannelSource | undefined
  topologyId: string
  entryNodeId: string
  topologyVersion?: number | undefined
  db?: Database.Database | undefined
  now?: (() => number) | undefined
}

export interface TopologyDispatchFollowupTraceRecordResult {
  topologyRunId: string
  decisionTraceId: string
  traceEventCount: number
}

interface DispatchTraceEvent {
  traceEventId: string
  topologyRunId: string
  nodeRunId: string
  workOrderId: string
  phase: TracePhase
  component: string
  reasonCode: string
  delegationPath: string[]
  payload?: Record<string, unknown>
  at: number
  sequence: number
}

const ROOT_NODE_ID = "node:nobie"

function uniqueStrings(values: Array<string | undefined>): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value?.trim())))]
}

function isTopologyOutcome(outcome: DelegatedTaskDispatchOutcome): boolean {
  return outcome.agentSource === "topology" || Boolean(outcome.topologyId?.trim() || outcome.topologyExecutorId?.trim())
}

function isPromptPreflightReason(reasonCode: string | undefined): boolean {
  return reasonCode === "prompt_bundle_preflight_failed" ||
    reasonCode?.includes("sub_session_blocked_by_prompt_preflight") === true ||
    reasonCode?.includes("unsafe_permission_expansion") === true ||
    reasonCode?.includes("unsafe_secret_access") === true
}

export function resolveTopologyDispatchFollowupDecision(
  input: ResolveTopologyDispatchFollowupDecisionInput,
): TopologyDispatchFollowupDecision | undefined {
  const topologyOutcomes = input.dispatchResult.outcomes.filter(isTopologyOutcome)
  if (input.dispatchResult.attempted <= 0 || topologyOutcomes.length === 0) return undefined
  if (topologyOutcomes.some((outcome) => outcome.status === "completed")) return undefined

  const failedOrSkipped = topologyOutcomes.filter((outcome) => outcome.status === "failed" || outcome.status === "skipped")
  if (failedOrSkipped.length === 0) return undefined

  const attemptedExecutorIds = new Set(uniqueStrings(failedOrSkipped.map((outcome) => outcome.agentId)))
  const alternativeExecutorIds = uniqueStrings(input.availableDirectChildExecutorIds)
    .filter((executorId) => !attemptedExecutorIds.has(executorId))
  const failedReasonCodes = uniqueStrings(failedOrSkipped.map((outcome) => outcome.reasonCode))
  const failedExecutorIds = uniqueStrings(failedOrSkipped.map((outcome) => outcome.agentId))
  const failedExecutorNames = uniqueStrings(failedOrSkipped.map((outcome) => outcome.agentDisplayName))
  const blockedByPreflight = failedReasonCodes.some(isPromptPreflightReason)

  if (alternativeExecutorIds.length > 0) {
    return {
      action: "redelegate",
      reasonCode: "redelegate_after_delegation_failure",
      summary: "토폴로지 위임 실패 후 대체 가능한 direct child 실행자 후보가 있어 재위임 판단이 필요합니다.",
      failedExecutorIds,
      failedExecutorNames,
      failedReasonCodes,
      blockedByPreflight,
      alternativeExecutorIds,
      rootLoopContinuation: "blocked",
    }
  }

  const currentExecutorCanSelfSolve = Boolean(input.currentExecutorId?.trim())
  if (currentExecutorCanSelfSolve) {
    return {
      action: "self_solve",
      reasonCode: "self_solve_after_delegation_failure",
      summary: "토폴로지 위임이 실패했고 대체 direct child 후보가 없어 현재 실행자가 자체 처리합니다.",
      failedExecutorIds,
      failedExecutorNames,
      failedReasonCodes,
      blockedByPreflight,
      alternativeExecutorIds,
      rootLoopContinuation: "allowed_with_trace",
    }
  }

  return {
    action: "fail_with_reason",
    reasonCode: "final_failure_after_exhaustion",
    summary: "토폴로지 위임이 실패했고 대체 위임이나 자체 처리 경로가 없습니다.",
    failedExecutorIds,
    failedExecutorNames,
    failedReasonCodes,
    blockedByPreflight,
    alternativeExecutorIds,
    rootLoopContinuation: "blocked",
  }
}

function safeId(value: string): string {
  return encodeURIComponent(value).replace(/%/g, "_")
}

function topologyNodeIdFromOutcome(input: {
  outcome: DelegatedTaskDispatchOutcome
  topologyId: string
  fallbackNodeId: string
}): string {
  if (input.outcome.topologyExecutorId?.trim()) return input.outcome.topologyExecutorId
  if (input.outcome.agentId?.startsWith(`${input.topologyId}:node:`)) {
    return `node:${input.outcome.agentId.slice(`${input.topologyId}:node:`.length)}`
  }
  return input.fallbackNodeId
}

function makeTraceEvent(input: Omit<DispatchTraceEvent, "traceEventId">): DispatchTraceEvent {
  return {
    ...input,
    traceEventId: `trace:${input.topologyRunId}:${input.nodeRunId}:${input.sequence}`,
  }
}

function insertTraceEvent(db: Database.Database, event: DispatchTraceEvent): void {
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
    null,
    event.phase,
    event.component,
    event.reasonCode,
    JSON.stringify(event.delegationPath),
    event.payload !== undefined ? JSON.stringify(event.payload) : null,
    JSON.stringify(event),
    event.at,
    event.sequence,
  )
}

export function recordTopologyDispatchFollowupTrace(
  input: RecordTopologyDispatchFollowupTraceInput,
): TopologyDispatchFollowupTraceRecordResult {
  const db = input.db ?? getDb()
  assertMigrationWriteAllowed(db, "topology_dispatch_followup.record")
  const now = input.now?.() ?? Date.now()
  const topologyRunId = `topology-dispatch:${input.runId}`
  const selectedOutcomes = input.dispatchResult.outcomes.filter(isTopologyOutcome)
  const fallbackOutcome = selectedOutcomes[0]
  const fallbackNodeId = input.entryNodeId
  const fallbackNodeRunId = `node-run:${safeId(topologyRunId)}:${safeId(fallbackNodeId)}`
  const fallbackWorkOrderId = `work-order:${safeId(topologyRunId)}:${safeId(fallbackNodeId)}`
  let sequence = 1
  const events: DispatchTraceEvent[] = [
    makeTraceEvent({
      topologyRunId,
      nodeRunId: fallbackNodeRunId,
      workOrderId: fallbackWorkOrderId,
      phase: "topology_run",
      component: "sub-agent-dispatch",
      reasonCode: "topology_dispatch_started",
      delegationPath: [ROOT_NODE_ID, fallbackNodeId],
      payload: {
        runId: input.runId,
        topologyId: input.topologyId,
        entryNodeId: input.entryNodeId,
      },
      at: now,
      sequence: sequence++,
    }),
  ]

  for (const outcome of selectedOutcomes) {
    const nodeId = topologyNodeIdFromOutcome({
      outcome,
      topologyId: input.topologyId,
      fallbackNodeId,
    })
    const nodeRunId = `node-run:${safeId(topologyRunId)}:${safeId(outcome.taskId)}`
    const workOrderId = `work-order:${safeId(topologyRunId)}:${safeId(outcome.taskId)}`
    const delegationPath = [ROOT_NODE_ID, nodeId]
    events.push(makeTraceEvent({
      topologyRunId,
      nodeRunId,
      workOrderId,
      phase: "child_delegation",
      component: "sub-agent-dispatch",
      reasonCode: "sub_agent_dispatch_started",
      delegationPath,
      payload: {
        taskId: outcome.taskId,
        nodeId,
        executorId: outcome.agentId,
        executorName: outcome.agentDisplayName,
      },
      at: now + sequence,
      sequence: sequence++,
    }))
    events.push(makeTraceEvent({
      topologyRunId,
      nodeRunId,
      workOrderId,
      phase: isPromptPreflightReason(outcome.reasonCode) ? "permission" : "child_delegation",
      component: "sub-agent-dispatch",
      reasonCode: outcome.reasonCode ?? `sub_agent_dispatch_${outcome.status}`,
      delegationPath,
      payload: {
        taskId: outcome.taskId,
        nodeId,
        executorId: outcome.agentId,
        executorName: outcome.agentDisplayName,
        failureCode: outcome.reasonCode,
        status: outcome.status,
        summary: outcome.summary,
      },
      at: now + sequence,
      sequence: sequence++,
    }))
  }

  events.push(makeTraceEvent({
    topologyRunId,
    nodeRunId: fallbackNodeRunId,
    workOrderId: fallbackWorkOrderId,
    phase: followupTracePhase(input.decision.action),
    component: "dispatch-fallback-state-machine",
    reasonCode: input.decision.reasonCode,
    delegationPath: [ROOT_NODE_ID],
    payload: {
      action: input.decision.action,
      summary: input.decision.summary,
      failedExecutorIds: input.decision.failedExecutorIds,
      failedExecutorNames: input.decision.failedExecutorNames,
      failedReasonCodes: input.decision.failedReasonCodes,
      blockedByPreflight: input.decision.blockedByPreflight,
      alternativeExecutorIds: input.decision.alternativeExecutorIds,
      rootLoopContinuation: input.decision.rootLoopContinuation,
    },
    at: now + sequence,
    sequence: sequence++,
  }))

  const topologyStatus = input.decision.action === "fail_with_reason"
    ? "failed"
    : input.decision.action === "self_solve"
      ? "completed"
      : "blocked"

  const tx = db.transaction(() => {
    db.prepare(
      `INSERT INTO topology_runs
       (topology_run_id, topology_id, topology_version, topology_version_id, root_run_id,
        status, entry_node_id, started_at, finished_at, created_at, updated_at, metadata_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(topology_run_id) DO UPDATE SET
         status = excluded.status,
         finished_at = excluded.finished_at,
         updated_at = excluded.updated_at,
         metadata_json = excluded.metadata_json`,
    ).run(
      topologyRunId,
      input.topologyId,
      input.topologyVersion ?? null,
      null,
      input.runId,
      topologyStatus,
      input.entryNodeId,
      now,
      now + events.length,
      now,
      now + events.length,
      JSON.stringify({
        source: "sub_agent_dispatch",
        followupDecision: input.decision,
      }),
    )

    for (const outcome of selectedOutcomes) {
      const nodeId = topologyNodeIdFromOutcome({
        outcome,
        topologyId: input.topologyId,
        fallbackNodeId,
      })
      const nodeRunId = `node-run:${safeId(topologyRunId)}:${safeId(outcome.taskId)}`
      const workOrderId = `work-order:${safeId(topologyRunId)}:${safeId(outcome.taskId)}`
      db.prepare(
        `INSERT INTO topology_node_runs
         (node_run_id, topology_run_id, work_order_id, node_id, parent_node_run_id, status,
          final_state, started_at, finished_at, created_at, updated_at, metrics_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(node_run_id) DO UPDATE SET
           status = excluded.status,
           final_state = excluded.final_state,
           finished_at = excluded.finished_at,
           updated_at = excluded.updated_at,
           metrics_json = excluded.metrics_json`,
      ).run(
        nodeRunId,
        topologyRunId,
        workOrderId,
        nodeId,
        null,
        outcome.status,
        outcome.status,
        now,
        now + events.length,
        now,
        now + events.length,
        JSON.stringify({
          reasonCode: outcome.reasonCode ?? null,
          executorId: outcome.agentId ?? null,
          executorName: outcome.agentDisplayName ?? null,
        }),
      )
      db.prepare(
        `INSERT INTO topology_work_orders
         (work_order_id, topology_run_id, node_run_id, parent_work_order_id, from_node_id,
          to_type, to_id, delegation_path_json, work_order_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(work_order_id) DO UPDATE SET
           node_run_id = excluded.node_run_id,
           work_order_json = excluded.work_order_json`,
      ).run(
        workOrderId,
        topologyRunId,
        nodeRunId,
        null,
        ROOT_NODE_ID,
        "node",
        nodeId,
        JSON.stringify([ROOT_NODE_ID, nodeId]),
        JSON.stringify({
          workOrderId,
          topologyRunId,
          fromNodeId: ROOT_NODE_ID,
          to: { type: "node", id: nodeId },
          delegationPath: [ROOT_NODE_ID, nodeId],
          summary: outcome.summary ?? null,
        }),
        now,
      )
      if (outcome.status === "failed") {
        db.prepare(
          `INSERT INTO topology_failure_reports
           (failure_report_id, topology_run_id, node_run_id, work_order_id, node_id, failure_phase, report_json, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(failure_report_id) DO UPDATE SET
             failure_phase = excluded.failure_phase,
             report_json = excluded.report_json`,
        ).run(
          `failure:${safeId(topologyRunId)}:${safeId(outcome.taskId)}`,
          topologyRunId,
          nodeRunId,
          workOrderId,
          nodeId,
          isPromptPreflightReason(outcome.reasonCode) ? "permission" : "child_delegation",
          JSON.stringify({
            nodeId,
            executorId: outcome.agentId,
            executorName: outcome.agentDisplayName,
            reasonCode: outcome.reasonCode,
            recommendedAction: input.decision.summary,
          }),
          now + events.length,
        )
      }
    }

    for (const event of events) insertTraceEvent(db, event)
  })

  tx()
  const decisionTraceId = insertDecisionTrace({
    runId: input.runId,
    requestGroupId: input.requestGroupId,
    ...(input.sessionId ? { sessionId: input.sessionId } : {}),
    ...(input.source ? { source: input.source, channel: input.source } : {}),
    decisionKind: "topology_dispatch_followup",
    reasonCode: input.decision.reasonCode,
    detail: {
      topologyRunId,
      topologyId: input.topologyId,
      entryNodeId: input.entryNodeId,
      decision: input.decision,
      outcomes: input.dispatchResult.outcomes,
    },
    createdAt: now + events.length,
  })
  return {
    topologyRunId,
    decisionTraceId,
    traceEventCount: events.length,
  }
}

function followupTracePhase(action: TopologyDispatchFollowupAction): TracePhase {
  switch (action) {
    case "self_solve":
      return "self_execution"
    case "ask_user":
      return "authority"
    case "fail_with_reason":
      return "exhaustion"
    case "return_to_parent":
    case "redelegate":
      return "recovery"
  }
}
