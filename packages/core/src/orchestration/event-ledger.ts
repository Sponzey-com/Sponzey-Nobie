import crypto from "node:crypto"
import { recordControlEvent } from "../control-plane/timeline.js"
import {
  type DbOrchestrationEvent,
  type DbOrchestrationEventSeverity,
  getOrchestrationEventByDedupeKey,
  getOrchestrationEventById,
  insertAuditLog,
  insertDiagnosticEvent,
  insertOrchestrationEvent,
  listOrchestrationEvents,
} from "../db/index.js"
import { eventBus } from "../events/index.js"
import { recordLatencyMetric } from "../observability/latency.js"

export type OrchestrationEventKind =
  | "agent_registered"
  | "team_registered"
  | "hierarchy_changed"
  | "orchestration_planned"
  | "team_execution_planned"
  | "command_requested"
  | "named_handoff_created"
  | "data_exchange_created"
  | "sub_session_queued"
  | "sub_session_started"
  | "sub_session_progress_reported"
  | "sub_session_completed"
  | "sub_session_failed"
  | "sub_session_cancelled"
  | "capability_called"
  | "approval_requested"
  | "result_reported"
  | "result_reviewed"
  | "control_action"
  | "resource_lock_wait"
  | "resource_lock_released"
  | "resource_lock_timeout"
  | "budget_blocked"
  | "model_resolved"
  | "model_fallback"
  | "model_budget_blocked"
  | "feedback_requested"
  | "redelegation_requested"
  | "retry_started"
  | "final_delivery_completed"
  | "named_delivery_attributed"
  | "learning_recorded"
  | "history_restored"

export type OrchestrationEventSeverity = DbOrchestrationEventSeverity

export interface OrchestrationEventInput {
  eventKind: OrchestrationEventKind
  runId?: string | null
  parentRunId?: string | null
  requestGroupId?: string | null
  subSessionId?: string | null
  agentId?: string | null
  teamId?: string | null
  exchangeId?: string | null
  approvalId?: string | null
  correlationId?: string | null
  dedupeKey?: string | null
  source?: string
  severity?: OrchestrationEventSeverity
  summary: string
  payload?: Record<string, unknown>
  payloadRawRef?: string | null
  producerTask?: string | null
  createdAt?: number
  emittedAt?: number
}

export interface OrchestrationEvent {
  sequence: number
  cursor: string
  id: string
  createdAt: number
  emittedAt: number
  eventKind: OrchestrationEventKind
  runId: string | null
  parentRunId: string | null
  requestGroupId: string | null
  subSessionId: string | null
  agentId: string | null
  teamId: string | null
  exchangeId: string | null
  approvalId: string | null
  correlationId: string
  dedupeKey: string | null
  source: string
  severity: OrchestrationEventSeverity
  summary: string
  payload: Record<string, unknown>
  payloadRawRef: string | null
  producerTask: string | null
}

export interface OrchestrationEventAppendResult {
  event: OrchestrationEvent
  inserted: boolean
}

export interface OrchestrationEventQuery {
  runId?: string
  requestGroupId?: string
  subSessionId?: string
  agentId?: string
  teamId?: string
  exchangeId?: string
  approvalId?: string
  correlationId?: string
  eventKind?: OrchestrationEventKind
  afterCursor?: string
  limit?: number
}

export interface OrchestrationMonitoringSnapshot {
  generatedAt: number
  runId: string | null
  requestGroupId: string | null
  latestCursor: string | null
  eventCount: number
  summary: {
    total: number
    activeSubSessionCount: number
    completedSubSessionCount: number
    failedSubSessionCount: number
    approvalPendingCount: number
    budgetBlockedCount: number
    modelFallbackCount: number
    duplicateSuppressedCount: number
  }
  agents: Array<{ agentId: string; eventCount: number; latestEventKind: OrchestrationEventKind }>
  teams: Array<{ teamId: string; eventCount: number; latestEventKind: OrchestrationEventKind }>
  subSessions: Array<{
    subSessionId: string
    agentId: string | null
    status: "queued" | "running" | "completed" | "failed" | "cancelled" | "unknown"
    latestEventKind: OrchestrationEventKind
    updatedAt: number
  }>
  dataExchanges: Array<{
    exchangeId: string
    eventCount: number
    latestEventKind: OrchestrationEventKind
  }>
  approvals: Array<{
    approvalId: string
    status: "requested" | "resolved" | "unknown"
    latestEventKind: OrchestrationEventKind
  }>
  models: Array<{ subSessionId: string | null; modelId: string | null; fallbackApplied: boolean }>
  locks: Array<{ subSessionId: string | null; eventKind: OrchestrationEventKind; summary: string }>
  budgets: Array<{ subSessionId: string | null; reasonCode: string | null; summary: string }>
  events: OrchestrationEvent[]
}

export const ORCHESTRATION_EVENT_KINDS = [
  "agent_registered",
  "team_registered",
  "hierarchy_changed",
  "orchestration_planned",
  "team_execution_planned",
  "command_requested",
  "named_handoff_created",
  "data_exchange_created",
  "sub_session_queued",
  "sub_session_started",
  "sub_session_progress_reported",
  "sub_session_completed",
  "sub_session_failed",
  "sub_session_cancelled",
  "capability_called",
  "approval_requested",
  "result_reported",
  "result_reviewed",
  "control_action",
  "resource_lock_wait",
  "resource_lock_released",
  "resource_lock_timeout",
  "budget_blocked",
  "model_resolved",
  "model_fallback",
  "model_budget_blocked",
  "feedback_requested",
  "redelegation_requested",
  "retry_started",
  "final_delivery_completed",
  "named_delivery_attributed",
  "learning_recorded",
  "history_restored",
] as const satisfies readonly OrchestrationEventKind[]

const EVENT_KIND_SET = new Set<string>(ORCHESTRATION_EVENT_KINDS)
const SECRET_KEY_PATTERN =
  /api[_-]?key|authorization|bearer|cookie|credential|password|private|raw|refresh[_-]?token|secret|token/i
const TEXT_SECRET_PATTERNS: Array<[RegExp, string]> = [
  [/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer ***"],
  [/\bsk-[A-Za-z0-9_-]{12,}\b/g, "sk-***"],
  [
    /(api[_-]?key|authorization|password|refresh[_-]?token|secret|token)(["'\s:=]+)([^"'\s,}]+)/gi,
    "$1$2***",
  ],
]

let projectionInstalled = false
let projectionUnsubscribers: Array<() => void> = []

function stableStringify(value: unknown): string {
  if (value === undefined) return "null"
  if (value === null || typeof value !== "object") return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(",")}]`
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, nested]) => nested !== undefined)
    .sort(([left], [right]) => left.localeCompare(right))
  return `{${entries.map(([key, nested]) => `${JSON.stringify(key)}:${stableStringify(nested)}`).join(",")}}`
}

function hashValue(value: unknown): string {
  return crypto.createHash("sha256").update(stableStringify(value)).digest("hex")
}

function trimOrNull(value: string | null | undefined): string | null {
  const trimmed = value?.trim()
  return trimmed ? trimmed : null
}

function parseJsonObject(raw: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw) as unknown
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {}
  } catch {
    return {}
  }
}

function sanitizeText(value: string): string {
  let result = value
  for (const [pattern, replacement] of TEXT_SECRET_PATTERNS) {
    result = result.replace(pattern, replacement)
  }
  return result.length > 4_000 ? `${result.slice(0, 3_990)}...` : result
}

function sanitizePayload(value: unknown, depth = 0): unknown {
  if (value == null) return value
  if (depth > 8) return "[truncated]"
  if (typeof value === "string") return sanitizeText(value)
  if (typeof value !== "object") return value
  if (Array.isArray(value))
    return value.slice(0, 100).map((item) => sanitizePayload(item, depth + 1))
  const output: Record<string, unknown> = {}
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    output[key] = SECRET_KEY_PATTERN.test(key) ? "[redacted]" : sanitizePayload(nested, depth + 1)
  }
  return output
}

function correlationIdFor(input: OrchestrationEventInput): string {
  return (
    trimOrNull(input.correlationId) ??
    trimOrNull(input.requestGroupId) ??
    trimOrNull(input.runId) ??
    trimOrNull(input.parentRunId) ??
    trimOrNull(input.subSessionId) ??
    trimOrNull(input.exchangeId) ??
    trimOrNull(input.approvalId) ??
    trimOrNull(input.agentId) ??
    trimOrNull(input.teamId) ??
    input.eventKind
  )
}

function dedupeKeyFor(input: OrchestrationEventInput, payload: Record<string, unknown>): string {
  const explicit = trimOrNull(input.dedupeKey)
  if (explicit) return explicit
  return [
    "orchestration",
    input.eventKind,
    correlationIdFor(input),
    trimOrNull(input.subSessionId) ?? "",
    trimOrNull(input.exchangeId) ?? "",
    trimOrNull(input.approvalId) ?? "",
    hashValue({ summary: input.summary, payload }),
  ].join(":")
}

function eventFromRow(row: DbOrchestrationEvent): OrchestrationEvent {
  return {
    sequence: row.sequence,
    cursor: String(row.sequence),
    id: row.id,
    createdAt: row.created_at,
    emittedAt: row.emitted_at,
    eventKind: row.event_kind as OrchestrationEventKind,
    runId: row.run_id,
    parentRunId: row.parent_run_id,
    requestGroupId: row.request_group_id,
    subSessionId: row.sub_session_id,
    agentId: row.agent_id,
    teamId: row.team_id,
    exchangeId: row.exchange_id,
    approvalId: row.approval_id,
    correlationId: row.correlation_id,
    dedupeKey: row.dedupe_key,
    source: row.source,
    severity: row.severity,
    summary: row.summary,
    payload: parseJsonObject(row.payload_redacted_json),
    payloadRawRef: row.payload_raw_ref,
    producerTask: row.producer_task,
  }
}

export function parseOrchestrationReplayCursor(cursor: string | null | undefined): number {
  const raw = cursor?.trim()
  if (!raw) return 0
  const first = raw.split(":")[0] ?? raw
  const parsed = Number.parseInt(first, 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0
}

export function validateOrchestrationEventInput(input: OrchestrationEventInput): {
  ok: boolean
  issueCodes: string[]
} {
  const issueCodes: string[] = []
  if (!EVENT_KIND_SET.has(input.eventKind)) issueCodes.push("event_kind_invalid")
  if (!input.summary.trim()) issueCodes.push("event_summary_missing")
  if (!correlationIdFor(input).trim()) issueCodes.push("event_correlation_missing")
  if (input.severity && !["debug", "info", "warning", "error"].includes(input.severity)) {
    issueCodes.push("event_severity_invalid")
  }
  return { ok: issueCodes.length === 0, issueCodes }
}

export function recordOrchestrationEvent(
  input: OrchestrationEventInput,
): OrchestrationEventAppendResult | null {
  const validation = validateOrchestrationEventInput(input)
  if (!validation.ok) {
    insertDiagnosticEvent({
      kind: "orchestration_event_invalid",
      summary: `orchestration event validation failed: ${validation.issueCodes.join(",")}`,
      detail: { eventKind: input.eventKind, issueCodes: validation.issueCodes },
    })
    return null
  }

  const payload = sanitizePayload(input.payload ?? {}) as Record<string, unknown>
  const dedupeKey = dedupeKeyFor(input, payload)
  const duplicate = getOrchestrationEventByDedupeKey(dedupeKey)
  if (duplicate) return { event: eventFromRow(duplicate), inserted: false }
  const event = eventFromRow(
    insertOrchestrationEvent({
      eventKind: input.eventKind,
      ...(trimOrNull(input.runId) ? { runId: trimOrNull(input.runId) } : {}),
      ...(trimOrNull(input.parentRunId) ? { parentRunId: trimOrNull(input.parentRunId) } : {}),
      ...(trimOrNull(input.requestGroupId)
        ? { requestGroupId: trimOrNull(input.requestGroupId) }
        : {}),
      ...(trimOrNull(input.subSessionId) ? { subSessionId: trimOrNull(input.subSessionId) } : {}),
      ...(trimOrNull(input.agentId) ? { agentId: trimOrNull(input.agentId) } : {}),
      ...(trimOrNull(input.teamId) ? { teamId: trimOrNull(input.teamId) } : {}),
      ...(trimOrNull(input.exchangeId) ? { exchangeId: trimOrNull(input.exchangeId) } : {}),
      ...(trimOrNull(input.approvalId) ? { approvalId: trimOrNull(input.approvalId) } : {}),
      correlationId: correlationIdFor(input),
      dedupeKey,
      source: input.source?.trim() || "runtime",
      severity: input.severity ?? "info",
      summary: sanitizeText(input.summary),
      payloadRedacted: payload,
      ...(trimOrNull(input.payloadRawRef)
        ? { payloadRawRef: trimOrNull(input.payloadRawRef) }
        : {}),
      ...(trimOrNull(input.producerTask) ? { producerTask: trimOrNull(input.producerTask) } : {}),
      ...(input.createdAt !== undefined ? { createdAt: input.createdAt } : {}),
      ...(input.emittedAt !== undefined ? { emittedAt: input.emittedAt } : {}),
    }),
  )
  eventBus.emit("orchestration.event", event)
  return { event, inserted: true }
}

export function listOrchestrationEventLedger(
  query: OrchestrationEventQuery = {},
): OrchestrationEvent[] {
  return listOrchestrationEvents({
    ...(query.runId ? { runId: query.runId } : {}),
    ...(query.requestGroupId ? { requestGroupId: query.requestGroupId } : {}),
    ...(query.subSessionId ? { subSessionId: query.subSessionId } : {}),
    ...(query.agentId ? { agentId: query.agentId } : {}),
    ...(query.teamId ? { teamId: query.teamId } : {}),
    ...(query.exchangeId ? { exchangeId: query.exchangeId } : {}),
    ...(query.approvalId ? { approvalId: query.approvalId } : {}),
    ...(query.correlationId ? { correlationId: query.correlationId } : {}),
    ...(query.eventKind ? { eventKind: query.eventKind } : {}),
    afterSequence: parseOrchestrationReplayCursor(query.afterCursor),
    ...(query.limit ? { limit: query.limit } : {}),
  }).map(eventFromRow)
}

function payloadString(event: OrchestrationEvent, key: string): string | null {
  const value = event.payload[key]
  return typeof value === "string" && value.trim() ? value.trim() : null
}

function modelId(event: OrchestrationEvent): string | null {
  const direct = payloadString(event, "modelId")
  if (direct) return direct
  const nested = event.payload.modelExecution
  if (nested && typeof nested === "object" && !Array.isArray(nested)) {
    const value = (nested as Record<string, unknown>).modelId
    return typeof value === "string" && value.trim() ? value.trim() : null
  }
  return null
}

function reasonCode(event: OrchestrationEvent): string | null {
  return payloadString(event, "reasonCode") ?? payloadString(event, "fallbackReasonCode")
}

function updateAgentCount(
  map: Map<
    string,
    { agentId: string; eventCount: number; latestEventKind: OrchestrationEventKind }
  >,
  id: string | null,
  eventKind: OrchestrationEventKind,
): void {
  if (!id) return
  const existing = map.get(id) ?? { agentId: id, eventCount: 0, latestEventKind: eventKind }
  existing.eventCount += 1
  existing.latestEventKind = eventKind
  map.set(id, existing)
}

function updateTeamCount(
  map: Map<string, { teamId: string; eventCount: number; latestEventKind: OrchestrationEventKind }>,
  id: string | null,
  eventKind: OrchestrationEventKind,
): void {
  if (!id) return
  const existing = map.get(id) ?? { teamId: id, eventCount: 0, latestEventKind: eventKind }
  existing.eventCount += 1
  existing.latestEventKind = eventKind
  map.set(id, existing)
}

function updateExchangeCount(
  map: Map<
    string,
    { exchangeId: string; eventCount: number; latestEventKind: OrchestrationEventKind }
  >,
  id: string | null,
  eventKind: OrchestrationEventKind,
): void {
  if (!id) return
  const existing = map.get(id) ?? { exchangeId: id, eventCount: 0, latestEventKind: eventKind }
  existing.eventCount += 1
  existing.latestEventKind = eventKind
  map.set(id, existing)
}

export function buildOrchestrationMonitoringSnapshot(
  query: OrchestrationEventQuery = {},
): OrchestrationMonitoringSnapshot {
  const startedAt = Date.now()
  const events = listOrchestrationEventLedger(query)
  const agents = new Map<
    string,
    { agentId: string; eventCount: number; latestEventKind: OrchestrationEventKind }
  >()
  const teams = new Map<
    string,
    { teamId: string; eventCount: number; latestEventKind: OrchestrationEventKind }
  >()
  const exchanges = new Map<
    string,
    { exchangeId: string; eventCount: number; latestEventKind: OrchestrationEventKind }
  >()
  const approvals = new Map<string, OrchestrationMonitoringSnapshot["approvals"][number]>()
  const subSessions = new Map<string, OrchestrationMonitoringSnapshot["subSessions"][number]>()
  const models: OrchestrationMonitoringSnapshot["models"] = []
  const locks: OrchestrationMonitoringSnapshot["locks"] = []
  const budgets: OrchestrationMonitoringSnapshot["budgets"] = []
  let duplicateSuppressedCount = 0

  for (const event of events) {
    updateAgentCount(agents, event.agentId, event.eventKind)
    updateTeamCount(teams, event.teamId, event.eventKind)
    updateExchangeCount(exchanges, event.exchangeId, event.eventKind)
    if (event.payload.duplicateSuppressed === true) duplicateSuppressedCount += 1

    if (event.subSessionId) {
      const previous = subSessions.get(event.subSessionId)
      const status =
        event.eventKind === "sub_session_completed"
          ? "completed"
          : event.eventKind === "sub_session_failed"
            ? "failed"
            : event.eventKind === "sub_session_cancelled"
              ? "cancelled"
              : event.eventKind === "sub_session_queued"
                ? "queued"
                : event.eventKind === "sub_session_started" ||
                    event.eventKind === "sub_session_progress_reported"
                  ? "running"
                  : (previous?.status ?? "unknown")
      subSessions.set(event.subSessionId, {
        subSessionId: event.subSessionId,
        agentId: event.agentId ?? previous?.agentId ?? null,
        status,
        latestEventKind: event.eventKind,
        updatedAt: event.createdAt,
      })
    }

    if (event.approvalId) {
      approvals.set(event.approvalId, {
        approvalId: event.approvalId,
        status: event.eventKind === "approval_requested" ? "requested" : "resolved",
        latestEventKind: event.eventKind,
      })
    }

    if (event.eventKind === "model_resolved" || event.eventKind === "model_fallback") {
      models.push({
        subSessionId: event.subSessionId,
        modelId: modelId(event),
        fallbackApplied:
          event.eventKind === "model_fallback" || event.payload.fallbackApplied === true,
      })
    }
    if (
      event.eventKind === "resource_lock_wait" ||
      event.eventKind === "resource_lock_released" ||
      event.eventKind === "resource_lock_timeout"
    ) {
      locks.push({
        subSessionId: event.subSessionId,
        eventKind: event.eventKind,
        summary: event.summary,
      })
    }
    if (event.eventKind === "budget_blocked" || event.eventKind === "model_budget_blocked") {
      budgets.push({
        subSessionId: event.subSessionId,
        reasonCode: reasonCode(event),
        summary: event.summary,
      })
    }
  }

  const subSessionValues = [...subSessions.values()]
  const latestCursor = events[events.length - 1]?.cursor ?? null
  const snapshot: OrchestrationMonitoringSnapshot = {
    generatedAt: Date.now(),
    runId: query.runId ?? null,
    requestGroupId: query.requestGroupId ?? null,
    latestCursor,
    eventCount: events.length,
    summary: {
      total: events.length,
      activeSubSessionCount: subSessionValues.filter(
        (item) => item.status === "queued" || item.status === "running",
      ).length,
      completedSubSessionCount: subSessionValues.filter((item) => item.status === "completed")
        .length,
      failedSubSessionCount: subSessionValues.filter(
        (item) => item.status === "failed" || item.status === "cancelled",
      ).length,
      approvalPendingCount: [...approvals.values()].filter((item) => item.status === "requested")
        .length,
      budgetBlockedCount: budgets.length,
      modelFallbackCount: models.filter((item) => item.fallbackApplied).length,
      duplicateSuppressedCount,
    },
    agents: [...agents.values()],
    teams: [...teams.values()],
    subSessions: subSessionValues,
    dataExchanges: [...exchanges.values()],
    approvals: [...approvals.values()],
    models,
    locks,
    budgets,
    events,
  }
  recordLatencyMetric({
    name: "monitoring_snapshot_latency_ms",
    durationMs: Math.max(0, Date.now() - startedAt),
    ...(query.runId ? { runId: query.runId } : {}),
    ...(query.requestGroupId ? { requestGroupId: query.requestGroupId } : {}),
    source: "orchestration-event-ledger",
    detail: {
      eventCount: snapshot.eventCount,
      latestCursor,
    },
  })
  return snapshot
}

export function buildRestartResumeProjection(query: OrchestrationEventQuery = {}): {
  latestCursor: string | null
  activeSubSessionIds: string[]
  activeSubSessions: OrchestrationMonitoringSnapshot["subSessions"]
} {
  const snapshot = buildOrchestrationMonitoringSnapshot(query)
  const activeSubSessions = snapshot.subSessions.filter(
    (item) => item.status === "queued" || item.status === "running",
  )
  return {
    latestCursor: snapshot.latestCursor,
    activeSubSessionIds: activeSubSessions.map((item) => item.subSessionId),
    activeSubSessions,
  }
}

export function formatOrchestrationEventSse(event: OrchestrationEvent): string {
  return [
    `id: ${event.cursor}`,
    "event: orchestration.event",
    `data: ${JSON.stringify(event)}`,
    "",
    "",
  ].join("\n")
}

export function openOrchestrationEventRawPayload(input: {
  eventId: string
  admin: boolean
  requester?: string
}): { ok: boolean; reasonCode?: string; event?: OrchestrationEvent; rawRef?: string | null } {
  const row = getOrchestrationEventById(input.eventId)
  if (!row) return { ok: false, reasonCode: "orchestration_event_not_found" }
  const event = eventFromRow(row)
  if (!input.admin) {
    recordControlEvent({
      eventType: "orchestration_event.raw_view.denied",
      component: "orchestration-event-ledger",
      ...(event.runId ? { runId: event.runId } : {}),
      ...(event.requestGroupId ? { requestGroupId: event.requestGroupId } : {}),
      correlationId: event.correlationId,
      severity: "warning",
      summary: "Raw orchestration event payload access was denied.",
      detail: { eventId: event.id, requester: input.requester ?? "unknown" },
    })
    return { ok: false, reasonCode: "admin_required", event }
  }
  insertAuditLog({
    timestamp: Date.now(),
    session_id: null,
    run_id: event.runId,
    request_group_id: event.requestGroupId,
    channel: null,
    source: "orchestration-event-ledger",
    tool_name: "orchestration_event_raw_view",
    params: JSON.stringify({ eventId: event.id, requester: input.requester ?? null }),
    output: event.payloadRawRef,
    result: "success",
    duration_ms: null,
    approval_required: 1,
    approved_by: input.requester ?? "admin",
  })
  recordControlEvent({
    eventType: "orchestration_event.raw_view.opened",
    component: "orchestration-event-ledger",
    ...(event.runId ? { runId: event.runId } : {}),
    ...(event.requestGroupId ? { requestGroupId: event.requestGroupId } : {}),
    correlationId: event.correlationId,
    severity: "info",
    summary: "Raw orchestration event payload reference was opened by an admin.",
    detail: { eventId: event.id, requester: input.requester ?? "admin" },
  })
  return { ok: true, event, rawRef: event.payloadRawRef }
}

export function installOrchestrationEventProjection(): void {
  if (projectionInstalled) return
  projectionInstalled = true
  projectionUnsubscribers = [
    eventBus.on("tool.before", (event) => {
      recordOrchestrationEvent({
        eventKind: "capability_called",
        runId: event.runId,
        ...(event.requestGroupId ? { requestGroupId: event.requestGroupId } : {}),
        correlationId: event.requestGroupId ?? event.runId,
        source: "event-bus",
        summary: `Capability called: ${event.toolName}`,
        payload: { toolName: event.toolName, params: event.params },
      })
    }),
    eventBus.on("approval.request", (event) => {
      recordOrchestrationEvent({
        eventKind: "approval_requested",
        runId: event.parentRunId ?? event.runId,
        ...(event.subSessionId ? { subSessionId: event.subSessionId } : {}),
        ...(event.agentId ? { agentId: event.agentId } : {}),
        ...(event.teamId ? { teamId: event.teamId } : {}),
        approvalId: event.approvalId ?? event.runId,
        correlationId: event.approvalId ?? event.runId,
        source: "event-bus",
        summary: `Approval requested: ${event.toolName}`,
        payload: {
          toolName: event.toolName,
          kind: event.kind,
          guidance: event.guidance,
          riskSummary: event.riskSummary,
          expiresAt: event.expiresAt,
          params: event.params,
        },
      })
    }),
  ]
}

export function resetOrchestrationEventProjectionForTest(): void {
  for (const unsubscribe of projectionUnsubscribers) unsubscribe()
  projectionUnsubscribers = []
  projectionInstalled = false
}
