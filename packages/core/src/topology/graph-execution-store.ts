import type Database from "better-sqlite3"
import { getDb } from "../db/index.js"
import { assertMigrationWriteAllowed } from "../db/migration-safety.js"
import {
  recoveryStrategyFingerprint,
  type RecoveryStrategyAttempt,
  type RecoveryStrategyKey,
} from "../runs/recovery-strategy-ledger.js"
import type { GraphExecutionPlan } from "./graph-execution-plan.js"
import {
  normalizeGraphExecutionOutcome,
  type GraphExecutionEvent,
  type GraphExecutionOutcome,
} from "./graph-execution-runner.js"

export interface GraphExecutionPlanRecord {
  graphExecutionPlanId: string
  topologyId: string
  workspaceId: string
  status: GraphExecutionOutcome["status"] | "planned"
  plan: GraphExecutionPlan
  outcome: GraphExecutionOutcome | null
  createdAt: number
  updatedAt: number
}

export interface GraphExecutionEventRecord {
  eventId: string
  graphExecutionPlanId: string
  eventType: string
  executorId?: string
  edgeId?: string
  status?: string
  terminalReason?: string
  recoveryReason?: string
  cancellationReason?: string
  event: GraphExecutionEvent
  at: number
  sequence: number
}

export interface RecoveryStrategyLedgerRecord {
  attemptId: string
  graphExecutionPlanId: string
  scopeId: string
  strategyFingerprint: string
  reason: string
  accepted: boolean
  attempt: RecoveryStrategyAttempt
  createdAt: number
}

export function persistGraphExecutionPlan(input: {
  db?: Database.Database
  plan: GraphExecutionPlan
  outcome?: GraphExecutionOutcome
  now?: number
}): GraphExecutionPlanRecord {
  const db = input.db ?? getDb()
  assertMigrationWriteAllowed(db, "graph_execution.persist_plan")
  const now = input.now ?? Date.now()
  const normalizedOutcome = input.outcome ? normalizeGraphExecutionOutcome(input.outcome) : null
  const status = normalizedOutcome?.status ?? "planned"
  const tx = db.transaction(() => {
    db.prepare(
      `INSERT INTO graph_execution_plans
       (graph_execution_plan_id, topology_id, workspace_id, status, entry_executor_ids_json,
        plan_json, outcome_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(graph_execution_plan_id) DO UPDATE SET
         topology_id = excluded.topology_id,
         workspace_id = excluded.workspace_id,
         status = excluded.status,
         entry_executor_ids_json = excluded.entry_executor_ids_json,
         plan_json = excluded.plan_json,
         outcome_json = excluded.outcome_json,
         updated_at = excluded.updated_at`,
    ).run(
      input.plan.graphExecutionPlanId,
      input.plan.topologyId,
      input.plan.workspaceId,
      status,
      JSON.stringify(input.plan.entryExecutorIds),
      JSON.stringify(input.plan),
      normalizedOutcome ? JSON.stringify(normalizedOutcome) : null,
      now,
      now,
    )

    for (const node of input.plan.nodePlans) {
      db.prepare(
        `INSERT INTO node_task_analyses
         (analysis_id, graph_execution_plan_id, executor_id, source, analysis_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(analysis_id) DO UPDATE SET
           graph_execution_plan_id = excluded.graph_execution_plan_id,
           executor_id = excluded.executor_id,
           source = excluded.source,
           analysis_json = excluded.analysis_json,
           updated_at = excluded.updated_at`,
      ).run(
        node.taskAnalysis.analysisId,
        input.plan.graphExecutionPlanId,
        node.executorId,
        node.taskAnalysis.source,
        JSON.stringify(node.taskAnalysis),
        now,
        now,
      )

      db.prepare(
        `INSERT INTO node_delegation_resolutions
         (resolution_id, graph_execution_plan_id, executor_id, node_contract_id, selected_route,
          selected_target_id, visibility, resolution_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(resolution_id) DO UPDATE SET
           graph_execution_plan_id = excluded.graph_execution_plan_id,
           executor_id = excluded.executor_id,
           node_contract_id = excluded.node_contract_id,
           selected_route = excluded.selected_route,
           selected_target_id = excluded.selected_target_id,
           visibility = excluded.visibility,
           resolution_json = excluded.resolution_json,
           updated_at = excluded.updated_at`,
      ).run(
        node.delegationResolution.resolutionId,
        input.plan.graphExecutionPlanId,
        node.executorId,
        node.nodeContractId,
        node.delegationResolution.selectedRoute,
        node.delegationResolution.selectedTargetId,
        node.delegationResolution.visibility,
        JSON.stringify(node.delegationResolution),
        now,
        now,
      )
    }
  })
  tx()
  return getGraphExecutionPlan(input.plan.graphExecutionPlanId, { db }) ?? {
    graphExecutionPlanId: input.plan.graphExecutionPlanId,
    topologyId: input.plan.topologyId,
    workspaceId: input.plan.workspaceId,
    status,
    plan: input.plan,
    outcome: normalizedOutcome,
    createdAt: now,
    updatedAt: now,
  }
}

export function persistGraphExecutionEvents(input: {
  db?: Database.Database
  graphExecutionPlanId: string
  events: GraphExecutionEvent[]
}): GraphExecutionEventRecord[] {
  const db = input.db ?? getDb()
  assertMigrationWriteAllowed(db, "graph_execution.persist_events")
  const tx = db.transaction(() => {
    input.events.forEach((event, index) => {
      const terminalReason = event.terminalReason !== undefined
        ? normalizeGraphExecutionOutcome({
          status: "failed",
          terminalReason: event.terminalReason,
        }).terminalReason
        : undefined
      db.prepare(
        `INSERT INTO graph_execution_events
         (event_id, graph_execution_plan_id, event_type, executor_id, edge_id, status,
          terminal_reason, recovery_reason, cancellation_reason, user_work, event_json, at, sequence)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(event_id) DO UPDATE SET
           event_type = excluded.event_type,
           executor_id = excluded.executor_id,
           edge_id = excluded.edge_id,
           status = excluded.status,
           terminal_reason = excluded.terminal_reason,
           recovery_reason = excluded.recovery_reason,
           cancellation_reason = excluded.cancellation_reason,
           user_work = excluded.user_work,
           event_json = excluded.event_json,
           at = excluded.at,
           sequence = excluded.sequence`,
      ).run(
        event.eventId,
        input.graphExecutionPlanId,
        event.type,
        event.executorId ?? null,
        event.edgeId ?? null,
        event.status ?? null,
        terminalReason ?? null,
        event.recoveryReason ?? null,
        event.cancellationReason ?? null,
        event.executorId ? 1 : 0,
        JSON.stringify(event),
        Date.parse(event.at),
        index + 1,
      )
    })
  })
  tx()
  return listGraphExecutionEvents(input.graphExecutionPlanId, { db })
}

export function persistRecoveryStrategyAttempt(input: {
  db?: Database.Database
  graphExecutionPlanId: string
  scopeId: string
  key: RecoveryStrategyKey
  reason: string
  accepted?: boolean
  now?: number
}): RecoveryStrategyLedgerRecord {
  const db = input.db ?? getDb()
  assertMigrationWriteAllowed(db, "graph_execution.persist_recovery_strategy")
  const now = input.now ?? Date.now()
  const strategyFingerprint = recoveryStrategyFingerprint(input.key)
  const attempt: RecoveryStrategyAttempt & { attemptId: string; accepted: boolean } = {
    attemptId: `recovery-attempt:${input.graphExecutionPlanId}:${input.scopeId}:${strategyFingerprint}`,
    scopeId: input.scopeId,
    key: input.key,
    reason: input.reason,
    accepted: input.accepted ?? true,
    createdAt: now,
  }
  db.prepare(
    `INSERT INTO recovery_strategy_ledger
     (attempt_id, graph_execution_plan_id, scope_id, strategy_fingerprint, reason, accepted,
      attempt_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    attempt.attemptId,
    input.graphExecutionPlanId,
    input.scopeId,
    strategyFingerprint,
    input.reason,
    attempt.accepted ? 1 : 0,
    JSON.stringify(attempt),
    now,
  )
  return {
    attemptId: attempt.attemptId,
    graphExecutionPlanId: input.graphExecutionPlanId,
    scopeId: input.scopeId,
    strategyFingerprint,
    reason: input.reason,
    accepted: attempt.accepted,
    attempt,
    createdAt: now,
  }
}

export function getGraphExecutionPlan(
  graphExecutionPlanId: string,
  options: { db?: Database.Database } = {},
): GraphExecutionPlanRecord | null {
  const db = options.db ?? getDb()
  const row = db.prepare(
    `SELECT *
     FROM graph_execution_plans
     WHERE graph_execution_plan_id = ?`,
  ).get(graphExecutionPlanId) as GraphExecutionPlanRow | undefined
  return row ? mapGraphExecutionPlanRow(row) : null
}

export function listGraphExecutionEvents(
  graphExecutionPlanId: string,
  options: { db?: Database.Database; limit?: number } = {},
): GraphExecutionEventRecord[] {
  const db = options.db ?? getDb()
  const limit = Math.max(1, Math.min(1000, Math.floor(options.limit ?? 500)))
  const rows = db.prepare(
    `SELECT *
     FROM graph_execution_events
     WHERE graph_execution_plan_id = ?
     ORDER BY sequence ASC, at ASC, event_id ASC
     LIMIT ?`,
  ).all(graphExecutionPlanId, limit) as GraphExecutionEventRow[]
  return rows.map(mapGraphExecutionEventRow)
}

interface GraphExecutionPlanRow {
  graph_execution_plan_id: string
  topology_id: string
  workspace_id: string
  status: GraphExecutionPlanRecord["status"]
  plan_json: string
  outcome_json: string | null
  created_at: number
  updated_at: number
}

interface GraphExecutionEventRow {
  event_id: string
  graph_execution_plan_id: string
  event_type: string
  executor_id: string | null
  edge_id: string | null
  status: string | null
  terminal_reason: string | null
  recovery_reason: string | null
  cancellation_reason: string | null
  event_json: string
  at: number
  sequence: number
}

function mapGraphExecutionPlanRow(row: GraphExecutionPlanRow): GraphExecutionPlanRecord {
  return {
    graphExecutionPlanId: row.graph_execution_plan_id,
    topologyId: row.topology_id,
    workspaceId: row.workspace_id,
    status: row.status,
    plan: JSON.parse(row.plan_json) as GraphExecutionPlan,
    outcome: row.outcome_json ? JSON.parse(row.outcome_json) as GraphExecutionOutcome : null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function mapGraphExecutionEventRow(row: GraphExecutionEventRow): GraphExecutionEventRecord {
  return {
    eventId: row.event_id,
    graphExecutionPlanId: row.graph_execution_plan_id,
    eventType: row.event_type,
    ...(row.executor_id ? { executorId: row.executor_id } : {}),
    ...(row.edge_id ? { edgeId: row.edge_id } : {}),
    ...(row.status ? { status: row.status } : {}),
    ...(row.terminal_reason ? { terminalReason: row.terminal_reason } : {}),
    ...(row.recovery_reason ? { recoveryReason: row.recovery_reason } : {}),
    ...(row.cancellation_reason ? { cancellationReason: row.cancellation_reason } : {}),
    event: JSON.parse(row.event_json) as GraphExecutionEvent,
    at: row.at,
    sequence: row.sequence,
  }
}
