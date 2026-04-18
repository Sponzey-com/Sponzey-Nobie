import {
  getDb,
  insertAuditLog,
  insertControlEvent,
  insertDiagnosticEvent,
  listControlEvents,
  type DbControlEvent,
  type DbControlEventSeverity,
} from "../db/index.js"
import { eventBus } from "../events/index.js"
import { sanitizeUserFacingError } from "../runs/error-sanitizer.js"

export type ControlEventSeverity = DbControlEventSeverity
export type ControlExportAudience = "user" | "developer"
export type ControlExportFormat = "json" | "markdown"

export interface ControlEventInput {
  eventType: string
  correlationId?: string | null
  runId?: string | null
  requestGroupId?: string | null
  sessionKey?: string | null
  component: string
  severity?: ControlEventSeverity
  summary: string
  detail?: Record<string, unknown>
  createdAt?: number
}

export interface ControlTimelineQuery {
  runId?: string
  requestGroupId?: string
  correlationId?: string
  eventType?: string
  component?: string
  severity?: ControlEventSeverity
  limit?: number
}

export interface ControlTimelineEvent {
  id: string
  at: number
  eventType: string
  correlationId: string
  runId: string | null
  requestGroupId: string | null
  sessionKey: string | null
  component: string
  severity: ControlEventSeverity
  summary: string
  detail: unknown
  duplicate?: {
    kind: "tool" | "answer" | "delivery" | "recovery"
    key: string
    firstEventId: string
    occurrence: number
  }
}

export interface ControlTimelineSummary {
  total: number
  duplicateToolCount: number
  duplicateAnswerCount: number
  deliveryRetryCount: number
  recoveryReentryCount: number
  severityCounts: Record<ControlEventSeverity, number>
}

export interface ControlTimeline {
  events: ControlTimelineEvent[]
  summary: ControlTimelineSummary
}

export interface ControlTimelineExport {
  audience: ControlExportAudience
  format: ControlExportFormat
  content: string
  timeline: ControlTimeline
}

export type RetrievalTimelineEventKind = "session" | "attempt" | "source" | "candidate" | "verdict" | "planner" | "delivery" | "dedupe" | "stop" | "diagnostic"

export interface RetrievalTimelineEvent {
  id: string
  at: number
  kind: RetrievalTimelineEventKind
  eventType: string
  component: string
  severity: ControlEventSeverity
  summary: string
  detail: unknown
  source: {
    method: string | null
    toolName: string | null
    url: string | null
    domain: string | null
  }
  verdict: {
    canAnswer: boolean | null
    acceptedValue: string | null
    sufficiency: string | null
    rejectionReason: string | null
    conflicts: string[]
  }
  diagnosticRef: {
    controlEventId: string
    eventType: string
    component: string
  }
  duplicate?: ControlTimelineEvent["duplicate"]
}

export interface RetrievalTimelineSummary {
  total: number
  sessionEvents: number
  attempts: number
  sources: number
  candidates: number
  verdicts: number
  plannerActions: number
  deliveryEvents: number
  dedupeSuppressed: number
  stops: number
  conflicts: number
  finalDeliveryStatus: string | null
  stopReason: string | null
  severityCounts: Record<ControlEventSeverity, number>
}

export interface RetrievalTimeline {
  events: RetrievalTimelineEvent[]
  summary: RetrievalTimelineSummary
}

export interface RetrievalTimelineExport {
  audience: ControlExportAudience
  format: ControlExportFormat
  content: string
  timeline: RetrievalTimeline
}

const SECRET_KEY_PATTERN = /api[_-]?key|authorization|bearer|cookie|credential|password|refresh[_-]?token|secret|token|raw[_-]?(?:body|response)|provider[_-]?raw/i
const TEXT_SECRET_PATTERNS: Array<[RegExp, string]> = [
  [/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer ***"],
  [/(api[_-]?key|authorization|password|refresh[_-]?token|secret|token)(["'\s:=]+)([^"'\s,}]+)/gi, "$1$2***"],
  [/\bsk-[A-Za-z0-9_-]{12,}\b/g, "sk-***"],
  [/([A-Za-z0-9_-]{12,})\.([A-Za-z0-9_-]{12,})\.([A-Za-z0-9_-]{12,})/g, "***.***.***"],
]
const LOCAL_PATH_PATTERN = /(?:\/Users\/[^\s"')]+|\/[A-Za-z0-9_. -]+\/[A-Za-z0-9_. /-]{8,}|[A-Za-z]:\\[^\s"']+)/g

let projectionInstalled = false
let projectionUnsubscribers: Array<() => void> = []

function resolveCorrelationId(input: Pick<ControlEventInput, "correlationId" | "requestGroupId" | "runId" | "sessionKey" | "eventType">): string {
  return input.correlationId?.trim()
    || input.requestGroupId?.trim()
    || input.runId?.trim()
    || input.sessionKey?.trim()
    || input.eventType
}

function parseJson(raw: string | null): unknown {
  if (!raw) return null
  try {
    return JSON.parse(raw)
  } catch {
    return sanitizeText(raw, "developer")
  }
}

function sanitizeText(raw: string, audience: ControlExportAudience): string {
  let value = raw
  for (const [pattern, replacement] of TEXT_SECRET_PATTERNS) {
    value = value.replace(pattern, replacement)
  }

  if (/(<!doctype\s+html|<html\b|<head\b|<body\b|<script\b)/i.test(value)) {
    value = sanitizeUserFacingError(value).userMessage
  }
  if (audience === "user") {
    value = value.replace(LOCAL_PATH_PATTERN, "[local path hidden]")
  }
  return value.length > 4_000 ? `${value.slice(0, 3_990)}...` : value
}

function sanitizeDetail(value: unknown, audience: ControlExportAudience, depth = 0): unknown {
  if (value == null) return value
  if (depth > 8) return "[truncated]"
  if (typeof value === "string") return sanitizeText(value, audience)
  if (typeof value !== "object") return value
  if (Array.isArray(value)) return value.slice(0, 100).map((item) => sanitizeDetail(item, audience, depth + 1))

  const result: Record<string, unknown> = {}
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    result[key] = SECRET_KEY_PATTERN.test(key) ? "***" : sanitizeDetail(nested, audience, depth + 1)
  }
  return result
}

function resolveRunContext(runId: string | null | undefined): { requestGroupId: string | null; sessionKey: string | null; channel: string | null } | null {
  if (!runId) return null
  try {
    return getDb()
      .prepare<[string], { requestGroupId: string | null; sessionKey: string | null; channel: string | null }>(
        `SELECT request_group_id AS requestGroupId, session_id AS sessionKey, source AS channel
         FROM root_runs
         WHERE id = ?
         LIMIT 1`,
      )
      .get(runId) ?? null
  } catch {
    return null
  }
}

export function recordControlEvent(input: ControlEventInput): string | null {
  try {
    const context = resolveRunContext(input.runId)
    const requestGroupId = input.requestGroupId ?? context?.requestGroupId ?? null
    const sessionKey = input.sessionKey ?? context?.sessionKey ?? null
    const detail = input.detail ? sanitizeDetail(input.detail, "developer") as Record<string, unknown> : undefined
    return insertControlEvent({
      eventType: input.eventType,
      correlationId: resolveCorrelationId({ ...input, requestGroupId, sessionKey }),
      runId: input.runId ?? null,
      requestGroupId,
      sessionKey,
      component: input.component,
      severity: input.severity ?? "info",
      summary: sanitizeText(input.summary, "developer"),
      ...(detail ? { detail } : {}),
      ...(input.createdAt ? { createdAt: input.createdAt } : {}),
    })
  } catch (error) {
    try {
      insertDiagnosticEvent({
        kind: "control_event_projection_degraded",
        summary: `control event projection failed: ${error instanceof Error ? error.message : String(error)}`,
        ...(input.runId ? { runId: input.runId } : {}),
        ...(input.requestGroupId ? { requestGroupId: input.requestGroupId } : {}),
        detail: {
          eventType: input.eventType,
          component: input.component,
        },
      })
    } catch {
      // Control projection is diagnostic-only. Never fail the user request.
    }
    return null
  }
}

function mapRow(row: DbControlEvent, audience: ControlExportAudience): ControlTimelineEvent {
  return {
    id: row.id,
    at: row.created_at,
    eventType: row.event_type,
    correlationId: row.correlation_id,
    runId: row.run_id,
    requestGroupId: row.request_group_id,
    sessionKey: audience === "user" ? null : row.session_key,
    component: row.component,
    severity: row.severity,
    summary: sanitizeText(row.summary, audience),
    detail: sanitizeDetail(parseJson(row.detail_json), audience),
  }
}

function detailString(event: ControlTimelineEvent, key: string): string | null {
  if (!event.detail || typeof event.detail !== "object" || Array.isArray(event.detail)) return null
  const value = (event.detail as Record<string, unknown>)[key]
  return typeof value === "string" && value.trim() ? value.trim() : null
}

function detailBoolean(event: ControlTimelineEvent, key: string): boolean | null {
  if (!event.detail || typeof event.detail !== "object" || Array.isArray(event.detail)) return null
  const value = (event.detail as Record<string, unknown>)[key]
  return typeof value === "boolean" ? value : null
}

function detailRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null
}

function nestedRecord(event: ControlTimelineEvent, key: string): Record<string, unknown> | null {
  const detail = detailRecord(event.detail)
  return detail ? detailRecord(detail[key]) : null
}

function recordString(record: Record<string, unknown> | null, key: string): string | null {
  const value = record?.[key]
  return typeof value === "string" && value.trim() ? value.trim() : null
}

function recordBoolean(record: Record<string, unknown> | null, key: string): boolean | null {
  const value = record?.[key]
  return typeof value === "boolean" ? value : null
}

function recordStringArray(record: Record<string, unknown> | null, key: string): string[] {
  const value = record?.[key]
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0).map((item) => item.trim())
}

function duplicateKeyFor(event: ControlTimelineEvent): { kind: NonNullable<ControlTimelineEvent["duplicate"]>["kind"]; key: string } | null {
  if (event.eventType === "tool.dispatched") {
    const toolName = detailString(event, "toolName") ?? detailString(event, "tool") ?? event.summary
    const paramsHash = detailString(event, "paramsHash") ?? detailString(event, "idempotencyKey") ?? JSON.stringify(event.detail ?? {})
    return { kind: "tool", key: `tool:${toolName}:${paramsHash}` }
  }
  if (event.eventType === "completion.generated") return { kind: "answer", key: `answer:${event.requestGroupId ?? event.runId ?? event.correlationId}` }
  if (event.eventType === "delivery.failed" || event.eventType === "delivery.completed") {
    const deliveryKey = detailString(event, "deliveryKey") ?? event.summary
    return { kind: "delivery", key: `delivery:${deliveryKey}:${event.eventType}` }
  }
  if (event.eventType === "recovery.stopped") {
    const recoveryKey = detailString(event, "recoveryKey") ?? detailString(event, "idempotencyKey") ?? event.summary
    return { kind: "recovery", key: `recovery:${recoveryKey}` }
  }
  return null
}

function annotateTimeline(events: ControlTimelineEvent[]): ControlTimeline {
  const seen = new Map<string, { id: string; count: number; kind: NonNullable<ControlTimelineEvent["duplicate"]>["kind"] }>()
  const severityCounts: Record<ControlEventSeverity, number> = { debug: 0, info: 0, warning: 0, error: 0 }

  let duplicateToolCount = 0
  let duplicateAnswerCount = 0
  let deliveryRetryCount = 0
  let recoveryReentryCount = 0

  const annotated = events.map((event) => {
    severityCounts[event.severity] += 1
    const duplicate = duplicateKeyFor(event)
    if (!duplicate) return event

    const previous = seen.get(duplicate.key)
    if (!previous) {
      seen.set(duplicate.key, { id: event.id, count: 1, kind: duplicate.kind })
      return event
    }

    previous.count += 1
    const next: ControlTimelineEvent = {
      ...event,
      duplicate: {
        kind: duplicate.kind,
        key: duplicate.key,
        firstEventId: previous.id,
        occurrence: previous.count,
      },
    }
    if (duplicate.kind === "tool") duplicateToolCount += 1
    if (duplicate.kind === "answer") duplicateAnswerCount += 1
    if (duplicate.kind === "delivery") deliveryRetryCount += 1
    if (duplicate.kind === "recovery") recoveryReentryCount += 1
    return next
  })

  return {
    events: annotated,
    summary: {
      total: annotated.length,
      duplicateToolCount,
      duplicateAnswerCount,
      deliveryRetryCount,
      recoveryReentryCount,
      severityCounts,
    },
  }
}

export function getControlTimeline(query: ControlTimelineQuery = {}, audience: ControlExportAudience = "developer"): ControlTimeline {
  const events = listControlEvents(query).map((row) => mapRow(row, audience))
  return annotateTimeline(events)
}

function isRetrievalToolName(toolName: string | null): boolean {
  if (!toolName) return false
  return toolName === "web_search"
    || toolName === "web_fetch"
    || toolName === "screen_capture"
    || toolName === "file_search"
    || toolName.includes("browser")
    || toolName.includes("selenium")
}

function isRetrievalRelevantEvent(event: ControlTimelineEvent): boolean {
  if (event.component === "web_retrieval" || event.eventType.startsWith("web_retrieval.")) return true
  if (event.eventType === "tool.dispatched" || event.eventType === "tool.completed" || event.eventType === "tool.failed" || event.eventType === "tool.skipped") {
    return isRetrievalToolName(detailString(event, "toolName") ?? detailString(event, "tool"))
  }
  if (event.eventType === "completion.generated" || event.eventType === "delivery.completed" || event.eventType === "delivery.failed") return true
  if (event.eventType === "recovery.stopped") {
    const recoveryKey = detailString(event, "recoveryKey") ?? detailString(event, "idempotencyKey") ?? event.summary
    return /web|retrieval|search|fetch|browser|selenium|finance|weather/i.test(recoveryKey)
  }
  return false
}

function classifyRetrievalKind(event: ControlTimelineEvent): RetrievalTimelineEventKind {
  const type = event.eventType
  const lowered = `${type} ${event.summary}`.toLocaleLowerCase("en-US")
  if (type === "web_retrieval.attempt.skipped" || lowered.includes("dedupe") || lowered.includes("duplicate attempt")) return "dedupe"
  if (type.includes("candidate")) return "candidate"
  if (type.includes("verdict") || type.includes("verification") || nestedRecord(event, "verdict")) return "verdict"
  if (type.includes("planner")) return "planner"
  if (type.startsWith("delivery.") || type === "completion.generated") return "delivery"
  if (type.includes("attempt") || type.startsWith("tool.")) return "attempt"
  if (type.includes("session.transition")) {
    const nextStatus = detailString(event, "nextStatus")
    if (nextStatus === "limited_complete" || nextStatus === "blocked" || nextStatus === "delivered") return "stop"
    return "session"
  }
  if (type.includes("session")) return "session"
  if (detailString(event, "sourceUrl") || detailString(event, "sourceDomain") || detailString(event, "sourceEvidenceId")) return "source"
  return "diagnostic"
}

function sourceInfo(event: ControlTimelineEvent): RetrievalTimelineEvent["source"] {
  const sourceEvidence = nestedRecord(event, "sourceEvidence")
  return {
    method: detailString(event, "method") ?? recordString(sourceEvidence, "method"),
    toolName: detailString(event, "toolName") ?? detailString(event, "tool"),
    url: detailString(event, "sourceUrl") ?? recordString(sourceEvidence, "sourceUrl"),
    domain: detailString(event, "sourceDomain") ?? recordString(sourceEvidence, "sourceDomain"),
  }
}

function verdictInfo(event: ControlTimelineEvent): RetrievalTimelineEvent["verdict"] {
  const verdict = nestedRecord(event, "verdict") ?? detailRecord(event.detail)
  return {
    canAnswer: recordBoolean(verdict, "canAnswer") ?? detailBoolean(event, "canAnswer"),
    acceptedValue: recordString(verdict, "acceptedValue") ?? detailString(event, "acceptedValue"),
    sufficiency: recordString(verdict, "evidenceSufficiency") ?? detailString(event, "evidenceSufficiency") ?? detailString(event, "sufficiency"),
    rejectionReason: recordString(verdict, "rejectionReason") ?? detailString(event, "rejectionReason"),
    conflicts: recordStringArray(verdict, "conflicts"),
  }
}

function mapRetrievalEvent(event: ControlTimelineEvent): RetrievalTimelineEvent {
  const kind = classifyRetrievalKind(event)
  return {
    id: event.id,
    at: event.at,
    kind,
    eventType: event.eventType,
    component: event.component,
    severity: event.severity,
    summary: event.summary,
    detail: event.detail,
    source: sourceInfo(event),
    verdict: verdictInfo(event),
    diagnosticRef: {
      controlEventId: event.id,
      eventType: event.eventType,
      component: event.component,
    },
    ...(event.duplicate ? { duplicate: event.duplicate } : {}),
  }
}

function firstNonEmpty(values: Array<string | null | undefined>): string | null {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim()
  }
  return null
}

function summarizeRetrievalTimeline(events: RetrievalTimelineEvent[]): RetrievalTimelineSummary {
  const severityCounts: Record<ControlEventSeverity, number> = { debug: 0, info: 0, warning: 0, error: 0 }
  for (const event of events) severityCounts[event.severity] += 1
  const deliveryEvents = events.filter((event) => event.kind === "delivery")
  const stopEvents = events.filter((event) => event.kind === "stop" || event.severity === "error")
  const finalDelivery = [...deliveryEvents].reverse().find((event) => event.eventType.startsWith("delivery.")) ?? null
  const stopReason = firstNonEmpty(stopEvents.reverse().flatMap((event) => {
    const detail = detailRecord(event.detail)
    const verdict = detailRecord(detail?.["verdict"])
    return [
      recordString(detail, "reason"),
      recordString(detail, "stopReason"),
      recordString(detail, "errorKind"),
      recordString(detail, "status"),
      recordString(verdict, "rejectionReason"),
      recordString(verdict, "evidenceSufficiency"),
    ]
  }))
  return {
    total: events.length,
    sessionEvents: events.filter((event) => event.kind === "session").length,
    attempts: events.filter((event) => event.kind === "attempt").length,
    sources: events.filter((event) => event.kind === "source" || event.source.url || event.source.domain).length,
    candidates: events.filter((event) => event.kind === "candidate").length,
    verdicts: events.filter((event) => event.kind === "verdict").length,
    plannerActions: events.filter((event) => event.kind === "planner").length,
    deliveryEvents: deliveryEvents.length,
    dedupeSuppressed: events.filter((event) => event.kind === "dedupe").length,
    stops: stopEvents.length,
    conflicts: events.reduce((sum, event) => sum + event.verdict.conflicts.length, 0),
    finalDeliveryStatus: finalDelivery ? finalDelivery.eventType.replace("delivery.", "") : null,
    stopReason,
    severityCounts,
  }
}

export function getRetrievalEvidenceTimeline(query: ControlTimelineQuery = {}, audience: ControlExportAudience = "user"): RetrievalTimeline {
  const control = getControlTimeline(query, audience)
  const events = control.events
    .filter(isRetrievalRelevantEvent)
    .map(mapRetrievalEvent)
  return { events, summary: summarizeRetrievalTimeline(events) }
}

function renderMarkdown(timeline: ControlTimeline, audience: ControlExportAudience): string {
  const lines = [
    audience === "user" ? "# 실행 흐름 요약" : "# Control Plane Timeline",
    "",
    `- total: ${timeline.summary.total}`,
    `- duplicate tools: ${timeline.summary.duplicateToolCount}`,
    `- duplicate answers: ${timeline.summary.duplicateAnswerCount}`,
    `- delivery retries: ${timeline.summary.deliveryRetryCount}`,
    `- recovery reentries: ${timeline.summary.recoveryReentryCount}`,
    "",
  ]

  for (const event of timeline.events) {
    const marker = event.duplicate ? ` duplicate:${event.duplicate.kind}#${event.duplicate.occurrence}` : ""
    lines.push(`- ${new Date(event.at).toISOString()} [${event.severity}/${event.component}/${event.eventType}${marker}] ${event.summary}`)
    if (audience === "developer") {
      const meta = [
        event.runId ? `run=${event.runId}` : null,
        event.requestGroupId ? `group=${event.requestGroupId}` : null,
        event.correlationId ? `corr=${event.correlationId}` : null,
      ].filter(Boolean)
      if (meta.length > 0) lines.push(`  - ${meta.join(" | ")}`)
    }
  }
  return `${lines.join("\n")}\n`
}

function renderRetrievalMarkdown(timeline: RetrievalTimeline, audience: ControlExportAudience): string {
  const lines = [
    audience === "user" ? "# 검색 근거 타임라인" : "# Retrieval Evidence Timeline",
    "",
    `- total: ${timeline.summary.total}`,
    `- attempts: ${timeline.summary.attempts}`,
    `- sources: ${timeline.summary.sources}`,
    `- candidates: ${timeline.summary.candidates}`,
    `- verdicts: ${timeline.summary.verdicts}`,
    `- delivery events: ${timeline.summary.deliveryEvents}`,
    `- dedupe suppressed: ${timeline.summary.dedupeSuppressed}`,
    `- final delivery: ${timeline.summary.finalDeliveryStatus ?? "unknown"}`,
    `- stop reason: ${timeline.summary.stopReason ?? "none"}`,
    "",
  ]

  for (const event of timeline.events) {
    const duplicate = event.duplicate ? ` duplicate:${event.duplicate.kind}#${event.duplicate.occurrence}` : ""
    const source = [event.source.toolName, event.source.method, event.source.domain].filter(Boolean).join("/")
    const verdict = event.verdict.acceptedValue
      ? ` value=${event.verdict.acceptedValue}`
      : event.verdict.sufficiency
        ? ` verdict=${event.verdict.sufficiency}`
        : ""
    lines.push(`- ${new Date(event.at).toISOString()} [${event.severity}/${event.kind}/${event.eventType}${duplicate}] ${event.summary}${source ? ` (${source})` : ""}${verdict}`)
    if (audience === "developer") lines.push(`  - ref=${event.diagnosticRef.controlEventId}`)
  }
  return `${lines.join("\n")}\n`
}

export function exportControlTimeline(params: ControlTimelineQuery & {
  audience?: ControlExportAudience
  format?: ControlExportFormat
  recordAudit?: boolean
} = {}): ControlTimelineExport {
  const audience = params.audience ?? "user"
  const format = params.format ?? "markdown"
  const timeline = getControlTimeline(params, audience)
  const content = format === "json"
    ? JSON.stringify({ audience, timeline }, null, 2)
    : renderMarkdown(timeline, audience)

  if (params.recordAudit !== false) {
    try {
      insertAuditLog({
        timestamp: Date.now(),
        session_id: null,
        run_id: params.runId ?? null,
        request_group_id: params.requestGroupId ?? null,
        channel: null,
        source: "control-plane",
        tool_name: audience === "developer" ? "control_timeline_developer_export" : "control_timeline_user_export",
        params: JSON.stringify({ audience, format, runId: params.runId ?? null, requestGroupId: params.requestGroupId ?? null }),
        output: null,
        result: "success",
        duration_ms: null,
        approval_required: 0,
        approved_by: null,
      })
      recordControlEvent({
        eventType: "control.exported",
        component: "control-plane",
        severity: "info",
        summary: `${audience} control timeline export generated`,
        runId: params.runId ?? null,
        requestGroupId: params.requestGroupId ?? null,
        detail: { audience, format, eventCount: timeline.summary.total },
      })
    } catch {
      // Export audit is diagnostic-only and must not break export delivery.
    }
  }

  return { audience, format, content, timeline }
}

export function exportRetrievalEvidenceTimeline(params: ControlTimelineQuery & {
  audience?: ControlExportAudience
  format?: ControlExportFormat
  recordAudit?: boolean
} = {}): RetrievalTimelineExport {
  const audience = params.audience ?? "user"
  const format = params.format ?? "markdown"
  const timeline = getRetrievalEvidenceTimeline(params, audience)
  const content = format === "json"
    ? JSON.stringify({ audience, timeline }, null, 2)
    : renderRetrievalMarkdown(timeline, audience)

  if (params.recordAudit !== false) {
    try {
      insertAuditLog({
        timestamp: Date.now(),
        session_id: null,
        run_id: params.runId ?? null,
        request_group_id: params.requestGroupId ?? null,
        channel: null,
        source: "control-plane",
        tool_name: audience === "developer" ? "retrieval_evidence_developer_export" : "retrieval_evidence_user_export",
        params: JSON.stringify({ audience, format, runId: params.runId ?? null, requestGroupId: params.requestGroupId ?? null }),
        output: null,
        result: "success",
        duration_ms: null,
        approval_required: 0,
        approved_by: null,
      })
      recordControlEvent({
        eventType: "web_retrieval.evidence_exported",
        component: "web_retrieval",
        severity: "info",
        summary: `${audience} retrieval evidence export generated`,
        runId: params.runId ?? null,
        requestGroupId: params.requestGroupId ?? null,
        detail: { audience, format, eventCount: timeline.summary.total },
      })
    } catch {
      // Export audit is diagnostic-only and must not break export delivery.
    }
  }

  return { audience, format, content, timeline }
}

export function recordControlEventFromLedger(input: {
  runId?: string | null
  requestGroupId?: string | null
  sessionKey?: string | null
  channel?: string | null
  eventKind: string
  deliveryKey?: string | null
  idempotencyKey?: string | null
  status: string
  summary: string
  detail?: Record<string, unknown>
}): string | null {
  const eventType = (() => {
    switch (input.eventKind) {
      case "ingress_received": return "channel.ingress"
      case "approval_requested": return "approval.requested"
      case "final_answer_generated": return "completion.generated"
      case "text_delivered":
      case "artifact_delivered":
      case "delivery_finalized":
        return "delivery.completed"
      case "text_delivery_failed":
      case "artifact_delivery_failed":
        return "delivery.failed"
      case "recovery_stop_generated": return "recovery.stopped"
      case "tool_started": return "tool.dispatched"
      case "tool_skipped": return "tool.skipped"
      case "tool_failed": return "tool.failed"
      case "tool_done": return "tool.completed"
      default: return null
    }
  })()
  if (!eventType) return null

  return recordControlEvent({
    eventType,
    component: input.channel ? `channel:${input.channel}` : "run-ledger",
    severity: input.status === "failed" || input.status === "suppressed" ? "warning" : "info",
    summary: input.summary,
    runId: input.runId ?? null,
    requestGroupId: input.requestGroupId ?? null,
    sessionKey: input.sessionKey ?? null,
    detail: {
      eventKind: input.eventKind,
      status: input.status,
      deliveryKey: input.deliveryKey ?? null,
      idempotencyKey: input.idempotencyKey ?? null,
      ...(input.detail ?? {}),
    },
  })
}

export function installControlEventProjection(): void {
  if (projectionInstalled) return
  projectionInstalled = true

  projectionUnsubscribers.push(eventBus.on("gateway.started", (payload) => {
    recordControlEvent({
      eventType: "gateway.started",
      component: "gateway",
      severity: "info",
      summary: `Gateway started on ${payload.host}:${payload.port}`,
      detail: payload,
    })
  }))

  projectionUnsubscribers.push(eventBus.on("channel.connected", (payload) => {
    recordControlEvent({
      eventType: "channel.connected",
      component: `channel:${payload.channel}`,
      severity: "info",
      summary: `${payload.channel} channel connected`,
      sessionKey: payload.sessionId ?? null,
      detail: payload.detail ?? {},
    })
  }))

  projectionUnsubscribers.push(eventBus.on("message.inbound", (payload) => {
    recordControlEvent({
      eventType: "channel.ingress",
      component: `channel:${payload.source}`,
      severity: "info",
      summary: `${payload.source} inbound message received`,
      sessionKey: payload.sessionId,
      detail: { contentLength: payload.content.length, userId: payload.userId ?? null },
    })
  }))

  projectionUnsubscribers.push(eventBus.on("run.created", ({ run }) => {
    recordControlEvent({
      eventType: "run.created",
      component: "run",
      severity: "info",
      summary: `Run created: ${run.title}`,
      runId: run.id,
      requestGroupId: run.requestGroupId,
      sessionKey: run.sessionId,
      detail: { source: run.source, taskProfile: run.taskProfile, runScope: run.runScope },
    })
  }))

  projectionUnsubscribers.push(eventBus.on("tool.before", (payload) => {
    recordControlEvent({
      eventType: "tool.dispatched",
      component: "tool",
      severity: "info",
      summary: `${payload.toolName} dispatched`,
      runId: payload.runId,
      sessionKey: payload.sessionId,
      detail: { toolName: payload.toolName, params: payload.params },
    })
  }))

  projectionUnsubscribers.push(eventBus.on("tool.after", (payload) => {
    recordControlEvent({
      eventType: payload.success ? "tool.completed" : "tool.failed",
      component: "tool",
      severity: payload.success ? "info" : "warning",
      summary: `${payload.toolName} ${payload.success ? "completed" : "failed"}`,
      runId: payload.runId,
      sessionKey: payload.sessionId,
      detail: { toolName: payload.toolName, durationMs: payload.durationMs },
    })
  }))

  projectionUnsubscribers.push(eventBus.on("approval.request", (payload) => {
    recordControlEvent({
      eventType: "approval.requested",
      component: "approval",
      severity: "info",
      summary: `${payload.toolName} approval requested`,
      runId: payload.runId,
      detail: { approvalId: payload.approvalId ?? null, toolName: payload.toolName, kind: payload.kind ?? "approval" },
    })
  }))

  projectionUnsubscribers.push(eventBus.on("yeonjang.heartbeat", (payload) => {
    recordControlEvent({
      eventType: "yeonjang.heartbeat",
      component: "yeonjang",
      severity: payload.state === "offline" ? "warning" : "info",
      summary: `Yeonjang ${payload.extensionId} ${payload.state ?? "heartbeat"}`,
      detail: payload,
    })
  }))

  projectionUnsubscribers.push(eventBus.on("doctor.checked", (payload) => {
    recordControlEvent({
      eventType: "doctor.checked",
      component: "doctor",
      severity: payload.overallStatus === "blocked" ? "error" : payload.overallStatus === "warning" ? "warning" : "info",
      summary: `Doctor ${payload.mode} check ${payload.overallStatus}`,
      detail: payload,
    })
  }))
}

export function resetControlEventProjectionForTest(): void {
  for (const unsubscribe of projectionUnsubscribers.splice(0)) {
    unsubscribe()
  }
  projectionInstalled = false
}
