import type {
  DataExchangePackage,
  ExpectedOutputContract,
  ModelExecutionSnapshot,
  OrchestrationMode,
  OrchestrationPlan,
  StructuredTaskScope,
  SubSessionContract,
  SubSessionStatus,
} from "../contracts/sub-agent-orchestration.js"
import {
  type DbAgentDataExchange,
  type DbMessageLedgerEvent,
  type DbOrchestrationEvent,
  type DbRunSubSession,
  listAgentDataExchangesForRecipient,
  listAgentDataExchangesForSource,
  listMessageLedgerEvents,
  listOrchestrationEvents,
  listRunSubSessionsForParentRun,
} from "../db/index.js"
import { redactUiValue } from "../ui/redaction.js"
import type { RootRun, RunEvent } from "./types.js"

export type RuntimeInspectorControlAction =
  | "send"
  | "steer"
  | "retry"
  | "feedback"
  | "redelegate"
  | "cancel"
  | "kill"

export type RuntimeInspectorApprovalState =
  | "not_required"
  | "required"
  | "approved"
  | "denied"
  | "pending"

export interface RuntimeInspectorAllowedControlAction {
  action: RuntimeInspectorControlAction
  reasonCode: string
}

export interface RunRuntimeInspectorExpectedOutput {
  outputId: string
  kind: ExpectedOutputContract["kind"]
  required: boolean
  description: string
  acceptanceReasonCodes: string[]
}

export interface RunRuntimeInspectorProgressItem {
  eventId: string
  at: number
  status: string
  summary: string
}

export interface RunRuntimeInspectorReview {
  resultReportId?: string
  status?: string
  verdict?: string
  parentIntegrationStatus?: string
  accepted?: boolean
  issueCodes: string[]
  normalizedFailureKey?: string
  risksOrGaps: string[]
}

export interface RunRuntimeInspectorResult {
  resultReportId?: string
  status?: string
  outputCount?: number
  artifactCount?: number
  riskOrGapCount?: number
  risksOrGaps: string[]
  summary?: string
  impossibleReasonKind?: string
}

export interface RunRuntimeInspectorFeedback {
  status: "none" | "requested" | "redelegation_requested"
  feedbackRequestId?: string
  targetAgentId?: string
  targetAgentNickname?: string
  reasonCode?: string
  missingItemCount?: number
  requiredChangeCount?: number
}

export interface RunRuntimeInspectorModel {
  providerId: string
  modelId: string
  fallbackApplied: boolean
  fallbackFromModelId?: string
  fallbackReasonCode?: string
  effort?: string
  retryCount: number
  attemptCount?: number
  estimatedInputTokens: number
  estimatedOutputTokens: number
  estimatedCost: number
  latencyMs?: number
  status?: string
}

export interface RunRuntimeInspectorSubSession {
  subSessionId: string
  parentRunId: string
  parentSubSessionId?: string
  childSubSessionIds: string[]
  depth: number
  resultAggregationStage: "nobie_finalization" | "parent_sub_agent_review"
  resultReturnTargetAgentId?: string
  resultReturnTargetSubSessionId?: string
  agentId: string
  agentDisplayName: string
  agentNickname?: string
  status: SubSessionStatus
  commandSummary: string
  expectedOutputs: RunRuntimeInspectorExpectedOutput[]
  retryBudgetRemaining: number
  promptBundleId: string
  startedAt?: number
  finishedAt?: number
  progress: RunRuntimeInspectorProgressItem[]
  result?: RunRuntimeInspectorResult
  review?: RunRuntimeInspectorReview
  feedback: RunRuntimeInspectorFeedback
  approvalState: RuntimeInspectorApprovalState
  model?: RunRuntimeInspectorModel
  allowedControlActions: RuntimeInspectorAllowedControlAction[]
}

export interface RunRuntimeInspectorDataExchangeSummary {
  exchangeId: string
  sourceOwnerId: string
  sourceNickname?: string
  recipientOwnerId: string
  recipientNickname?: string
  purpose: string
  allowedUse: DataExchangePackage["allowedUse"]
  retentionPolicy: DataExchangePackage["retentionPolicy"]
  redactionState: DataExchangePackage["redactionState"]
  provenanceCount: number
  createdAt: number
  expiresAt?: number
}

export interface RunRuntimeInspectorApprovalSummary {
  approvalId: string
  status: RuntimeInspectorApprovalState
  subSessionId?: string
  agentId?: string
  summary: string
  at: number
}

export interface RunRuntimeInspectorTimelineEvent {
  id: string
  at: number
  source: "run_event" | "orchestration" | "message_ledger"
  kind: string
  status?: string
  severity?: string
  summary: string
  subSessionId?: string
  agentId?: string
  exchangeId?: string
  approvalId?: string
}

export interface RunRuntimeInspectorPlanTask {
  taskId: string
  executionKind: string
  goal: string
  assignedAgentId?: string
  assignedTeamId?: string
  reasonCodes: string[]
}

export interface RunRuntimeInspectorPlanProjection {
  planId?: string
  parentRequestId?: string
  createdAt?: number
  plannerStatus?: string
  directTaskCount: number
  delegatedTaskCount: number
  approvalRequirementCount: number
  resourceLockCount: number
  parallelGroupCount: number
  fallbackMode?: string
  fallbackReasonCode?: string
  taskSummaries: RunRuntimeInspectorPlanTask[]
}

export interface RunRuntimeInspectorFinalizer {
  parentOwnedFinalAnswer: true
  status: "not_started" | "generated" | "delivered" | "suppressed" | "failed"
  deliveryKey?: string
  idempotencyKey?: string
  summary?: string
  at?: number
}

export interface RunRuntimeInspectorProjection {
  schemaVersion: 1
  runId: string
  requestGroupId: string
  generatedAt: number
  orchestrationMode: OrchestrationMode
  plan: RunRuntimeInspectorPlanProjection
  subSessions: RunRuntimeInspectorSubSession[]
  dataExchanges: RunRuntimeInspectorDataExchangeSummary[]
  approvals: RunRuntimeInspectorApprovalSummary[]
  timeline: RunRuntimeInspectorTimelineEvent[]
  finalizer: RunRuntimeInspectorFinalizer
  redaction: {
    payloadsRedacted: true
    rawPayloadVisible: false
  }
}

export interface RunRuntimeInspectorProjectionOptions {
  now?: number
  limit?: number
}

const ACTIVE_CONTROL_STATUSES = new Set<SubSessionStatus>([
  "created",
  "queued",
  "running",
  "waiting_for_input",
  "awaiting_approval",
])

const TERMINAL_STATUSES = new Set<SubSessionStatus>([
  "completed",
  "needs_revision",
  "failed",
  "cancelled",
])

const FINALIZER_EVENT_PRECEDENCE: Record<RunRuntimeInspectorFinalizer["status"], number> = {
  not_started: 0,
  generated: 1,
  suppressed: 2,
  failed: 3,
  delivered: 4,
}

const PRIVATE_MEMORY_PATTERN = /[^\n.]*private raw memory[^\n.]*/giu

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function parseJsonRecord(value: string | null | undefined): Record<string, unknown> {
  if (!value) return {}
  try {
    const parsed = JSON.parse(value)
    return isRecord(parsed) ? parsed : {}
  } catch {
    return {}
  }
}

function parseJsonArray(value: string | null | undefined): unknown[] {
  if (!value) return []
  try {
    const parsed = JSON.parse(value)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function redactedRecord(value: Record<string, unknown>): Record<string, unknown> {
  return redactUiValue(value, { audience: "advanced" }).value
}

function redactedText(value: unknown, fallback = ""): string {
  const raw = typeof value === "string" ? value : fallback
  const redacted = redactUiValue(raw, { audience: "advanced" }).value.replace(
    PRIVATE_MEMORY_PATTERN,
    "[private memory redacted]",
  )
  return redacted.length > 600 ? `${redacted.slice(0, 597)}...` : redacted
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined
}

function booleanValue(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value
    .map((item) => (typeof item === "string" ? redactedText(item) : undefined))
    .filter((item): item is string => Boolean(item))
}

function recordArray(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) return []
  return value.filter(isRecord)
}

function safeCount(value: unknown): number | undefined {
  const explicit = numberValue(value)
  if (explicit !== undefined) return Math.max(0, Math.floor(explicit))
  if (Array.isArray(value)) return value.length
  return undefined
}

function subSessionIdFromDetail(detail: Record<string, unknown>): string | undefined {
  return stringValue(detail.subSessionId) ?? stringValue(detail.sub_session_id)
}

function agentIdFromDetail(detail: Record<string, unknown>): string | undefined {
  return stringValue(detail.agentId) ?? stringValue(detail.agent_id)
}

function exchangeIdFromDetail(detail: Record<string, unknown>): string | undefined {
  return stringValue(detail.exchangeId) ?? stringValue(detail.exchange_id)
}

function approvalIdFromDetail(detail: Record<string, unknown>): string | undefined {
  return stringValue(detail.approvalId) ?? stringValue(detail.approval_id)
}

function parseSubSessionContract(row: DbRunSubSession): SubSessionContract | undefined {
  const parsed = parseJsonRecord(row.contract_json)
  return stringValue(parsed.subSessionId) ? (parsed as unknown as SubSessionContract) : undefined
}

function fallbackSubSessionContract(row: DbRunSubSession): SubSessionContract {
  return {
    identity: {
      schemaVersion: 1,
      entityType: "sub_session",
      entityId: row.sub_session_id,
      owner: { ownerType: "sub_agent", ownerId: row.agent_id },
      idempotencyKey: row.idempotency_key,
      ...(row.audit_id ? { auditCorrelationId: row.audit_id } : {}),
      parent: {
        parentRunId: row.parent_run_id,
        ...(row.parent_request_id ? { parentRequestId: row.parent_request_id } : {}),
        ...(row.parent_sub_session_id ? { parentSubSessionId: row.parent_sub_session_id } : {}),
      },
    },
    subSessionId: row.sub_session_id,
    parentSessionId: row.parent_session_id,
    parentRunId: row.parent_run_id,
    agentId: row.agent_id,
    agentDisplayName: row.agent_display_name,
    ...(row.agent_nickname ? { agentNickname: row.agent_nickname } : {}),
    commandRequestId: row.command_request_id,
    status: row.status,
    retryBudgetRemaining: row.retry_budget_remaining,
    promptBundleId: row.prompt_bundle_id,
    ...(row.started_at ? { startedAt: row.started_at } : {}),
    ...(row.finished_at ? { finishedAt: row.finished_at } : {}),
  }
}

function contractFromRow(row: DbRunSubSession): SubSessionContract {
  return parseSubSessionContract(row) ?? fallbackSubSessionContract(row)
}

function expectedOutputProjection(
  output: ExpectedOutputContract,
): RunRuntimeInspectorExpectedOutput {
  return {
    outputId: redactedText(output.outputId),
    kind: output.kind,
    required: output.required,
    description: redactedText(output.description),
    acceptanceReasonCodes: output.acceptance.reasonCodes.map((code) => redactedText(code)),
  }
}

function expectedOutputsFor(contract: SubSessionContract): RunRuntimeInspectorExpectedOutput[] {
  const fromTaskScope = contract.promptBundleSnapshot?.taskScope.expectedOutputs ?? []
  const fromCompletionCriteria = contract.promptBundleSnapshot?.completionCriteria ?? []
  const source = fromTaskScope.length > 0 ? fromTaskScope : fromCompletionCriteria
  return source.map(expectedOutputProjection)
}

function commandSummaryFor(contract: SubSessionContract): string {
  const taskScope: StructuredTaskScope | undefined = contract.promptBundleSnapshot?.taskScope
  return redactedText(
    taskScope?.goal,
    `${contract.agentNickname ?? contract.agentDisplayName} ${contract.commandRequestId}`,
  )
}

function modelProjectionFrom(value: unknown): RunRuntimeInspectorModel | undefined {
  const record = isRecord(value) ? value : undefined
  if (!record) return undefined
  const nestedSnapshot = isRecord(record.snapshot) ? record.snapshot : undefined
  const source = nestedSnapshot ?? record
  const providerId = stringValue(source.providerId)
  const modelId = stringValue(source.modelId)
  if (!providerId || !modelId) return undefined
  const fallbackFromModelId = stringValue(source.fallbackFromModelId)
  const fallbackReasonCode = stringValue(source.fallbackReasonCode)
  const effort = stringValue(source.effort)
  const attemptCount = numberValue(source.attemptCount)
  const latencyMs = numberValue(source.latencyMs)
  const status = stringValue(source.status)

  return {
    providerId: redactedText(providerId),
    modelId: redactedText(modelId),
    fallbackApplied: booleanValue(source.fallbackApplied) ?? false,
    ...(fallbackFromModelId ? { fallbackFromModelId: redactedText(fallbackFromModelId) } : {}),
    ...(fallbackReasonCode ? { fallbackReasonCode: redactedText(fallbackReasonCode) } : {}),
    ...(effort ? { effort: redactedText(effort) } : {}),
    retryCount: numberValue(source.retryCount) ?? 0,
    ...(attemptCount !== undefined ? { attemptCount } : {}),
    estimatedInputTokens: numberValue(source.estimatedInputTokens) ?? 0,
    estimatedOutputTokens: numberValue(source.estimatedOutputTokens) ?? 0,
    estimatedCost: numberValue(source.estimatedCost) ?? 0,
    ...(latencyMs !== undefined ? { latencyMs } : {}),
    ...(status ? { status: redactedText(status) } : {}),
  }
}

function modelFor(
  contract: SubSessionContract,
  ledgerEvents: readonly DbMessageLedgerEvent[],
): RunRuntimeInspectorModel | undefined {
  const fromLedger = [...ledgerEvents].reverse().find((event) => {
    const detail = parseJsonRecord(event.detail_json)
    return (
      subSessionIdFromDetail(detail) === contract.subSessionId && isRecord(detail.modelExecution)
    )
  })
  const ledgerDetail = fromLedger ? parseJsonRecord(fromLedger.detail_json) : undefined
  return (
    modelProjectionFrom(ledgerDetail?.modelExecution) ??
    modelProjectionFrom(contract.modelExecutionSnapshot as ModelExecutionSnapshot | undefined)
  )
}

function allowedControlActionsFor(
  status: SubSessionStatus,
  retryBudgetRemaining: number,
): RuntimeInspectorAllowedControlAction[] {
  if (ACTIVE_CONTROL_STATUSES.has(status)) {
    return [
      { action: "send", reasonCode: "sub_session_active_control_allowed" },
      { action: "steer", reasonCode: "sub_session_active_control_allowed" },
      { action: "cancel", reasonCode: "sub_session_active_control_allowed" },
      { action: "kill", reasonCode: "sub_session_active_control_allowed" },
    ]
  }

  if (
    TERMINAL_STATUSES.has(status) &&
    status !== "completed" &&
    status !== "cancelled" &&
    retryBudgetRemaining > 0
  ) {
    return [
      { action: "retry", reasonCode: "sub_session_retry_state_allowed" },
      { action: "feedback", reasonCode: "sub_session_feedback_state_allowed" },
      { action: "redelegate", reasonCode: "sub_session_feedback_state_allowed" },
    ]
  }

  return []
}

function progressFor(
  subSessionId: string,
  ledgerEvents: readonly DbMessageLedgerEvent[],
  orchestrationEvents: readonly DbOrchestrationEvent[],
): RunRuntimeInspectorProgressItem[] {
  const items: RunRuntimeInspectorProgressItem[] = []

  for (const event of ledgerEvents) {
    if (event.event_kind !== "sub_session_progress_summarized") continue
    const detail = parseJsonRecord(event.detail_json)
    for (const item of recordArray(detail.items)) {
      if (subSessionIdFromDetail(item) !== subSessionId) continue
      items.push({
        eventId: `${event.id}:${items.length}`,
        at: numberValue(item.at) ?? event.created_at,
        status: redactedText(item.status, event.status),
        summary: redactedText(item.summary, event.summary),
      })
    }
  }

  for (const event of orchestrationEvents) {
    if (
      event.sub_session_id !== subSessionId ||
      event.event_kind !== "sub_session_progress_reported"
    ) {
      continue
    }
    items.push({
      eventId: event.id,
      at: event.emitted_at || event.created_at,
      status: redactedText(event.severity),
      summary: redactedText(event.summary),
    })
  }

  return items
    .sort((left, right) => left.at - right.at || left.eventId.localeCompare(right.eventId))
    .slice(-20)
}

function resultFor(
  subSessionId: string,
  ledgerEvents: readonly DbMessageLedgerEvent[],
  orchestrationEvents: readonly DbOrchestrationEvent[],
): RunRuntimeInspectorResult | undefined {
  const resultEvent = [...orchestrationEvents].reverse().find((event) => {
    if (event.event_kind !== "result_reported") return false
    return event.sub_session_id === subSessionId
  })
  const ledgerEvent = [...ledgerEvents].reverse().find((event) => {
    if (
      event.event_kind !== "sub_session_completed" &&
      event.event_kind !== "sub_session_failed" &&
      event.event_kind !== "sub_session_result_suppressed"
    ) {
      return false
    }
    return subSessionIdFromDetail(parseJsonRecord(event.detail_json)) === subSessionId
  })

  if (!resultEvent && !ledgerEvent) return undefined

  const payload = resultEvent
    ? redactedRecord(parseJsonRecord(resultEvent.payload_redacted_json))
    : {}
  const ledgerDetail = ledgerEvent ? redactedRecord(parseJsonRecord(ledgerEvent.detail_json)) : {}
  const risksOrGaps = [
    ...stringArray(payload.risksOrGaps),
    ...stringArray(ledgerDetail.risksOrGaps),
  ]
  const resultReportId =
    stringValue(payload.resultReportId) ??
    stringValue(ledgerDetail.resultReportId) ??
    stringValue(payload.result_report_id)
  const impossibleReason = isRecord(payload.impossibleReason)
    ? payload.impossibleReason
    : isRecord(ledgerDetail.impossibleReason)
      ? ledgerDetail.impossibleReason
      : undefined
  const status = stringValue(payload.status)
  const outputCount = safeCount(payload.outputCount ?? payload.outputs ?? ledgerDetail.outputCount)
  const artifactCount = safeCount(
    payload.artifactCount ?? payload.artifacts ?? ledgerDetail.artifactCount,
  )
  const riskOrGapCount = safeCount(
    payload.riskOrGapCount ?? payload.risksOrGaps ?? ledgerDetail.riskOrGapCount,
  )
  const impossibleReasonKind = stringValue(impossibleReason?.kind)

  return {
    ...(resultReportId ? { resultReportId: redactedText(resultReportId) } : {}),
    ...(status ? { status: redactedText(status) } : {}),
    ...(outputCount !== undefined ? { outputCount } : {}),
    ...(artifactCount !== undefined ? { artifactCount } : {}),
    ...(riskOrGapCount !== undefined ? { riskOrGapCount } : {}),
    risksOrGaps,
    ...(ledgerEvent?.summary ? { summary: redactedText(ledgerEvent.summary) } : {}),
    ...(impossibleReasonKind ? { impossibleReasonKind: redactedText(impossibleReasonKind) } : {}),
  }
}

function reviewFor(
  subSessionId: string,
  orchestrationEvents: readonly DbOrchestrationEvent[],
): RunRuntimeInspectorReview | undefined {
  const event = [...orchestrationEvents]
    .reverse()
    .find((item) => item.event_kind === "result_reviewed" && item.sub_session_id === subSessionId)
  if (!event) return undefined
  const payload = redactedRecord(parseJsonRecord(event.payload_redacted_json))
  const resultReportId = stringValue(payload.resultReportId)
  const status = stringValue(payload.status)
  const verdict = stringValue(payload.verdict)
  const parentIntegrationStatus = stringValue(payload.parentIntegrationStatus)
  const accepted = booleanValue(payload.accepted)
  const normalizedFailureKey = stringValue(payload.normalizedFailureKey)

  return {
    ...(resultReportId ? { resultReportId: redactedText(resultReportId) } : {}),
    ...(status ? { status: redactedText(status) } : {}),
    ...(verdict ? { verdict: redactedText(verdict) } : {}),
    ...(parentIntegrationStatus
      ? { parentIntegrationStatus: redactedText(parentIntegrationStatus) }
      : {}),
    ...(accepted !== undefined ? { accepted } : {}),
    issueCodes: stringArray(payload.issueCodes),
    ...(normalizedFailureKey ? { normalizedFailureKey: redactedText(normalizedFailureKey) } : {}),
    risksOrGaps: stringArray(payload.risksOrGaps),
  }
}

function feedbackFor(
  subSessionId: string,
  orchestrationEvents: readonly DbOrchestrationEvent[],
  runEvents: readonly RunEvent[],
): RunRuntimeInspectorFeedback {
  const event = [...orchestrationEvents]
    .reverse()
    .find(
      (item) =>
        item.sub_session_id === subSessionId &&
        (item.event_kind === "feedback_requested" || item.event_kind === "redelegation_requested"),
    )
  if (event) {
    const payload = redactedRecord(parseJsonRecord(event.payload_redacted_json))
    const feedbackRequestId = stringValue(payload.feedbackRequestId)
    const targetAgentId = stringValue(payload.targetAgentId)
    const targetAgentNickname = stringValue(payload.targetAgentNicknameSnapshot)
    const reasonCode = stringValue(payload.reasonCode)
    const missingItemCount = safeCount(payload.missingItems)
    const requiredChangeCount = safeCount(payload.requiredChanges)
    return {
      status:
        event.event_kind === "redelegation_requested" ? "redelegation_requested" : "requested",
      ...(feedbackRequestId ? { feedbackRequestId: redactedText(feedbackRequestId) } : {}),
      ...(targetAgentId ? { targetAgentId: redactedText(targetAgentId) } : {}),
      ...(targetAgentNickname ? { targetAgentNickname: redactedText(targetAgentNickname) } : {}),
      ...(reasonCode ? { reasonCode: redactedText(reasonCode) } : {}),
      ...(missingItemCount !== undefined ? { missingItemCount } : {}),
      ...(requiredChangeCount !== undefined ? { requiredChangeCount } : {}),
    }
  }

  const parentEvent = [...runEvents]
    .reverse()
    .find((item) => item.label.startsWith(`sub_session_feedback_requested:${subSessionId}:`))
  if (parentEvent) {
    return {
      status: "requested",
      reasonCode: redactedText(parentEvent.label.split(":").at(2), "unknown"),
    }
  }

  return { status: "none" }
}

function approvalStatusFrom(value: unknown): RuntimeInspectorApprovalState {
  const status = stringValue(value)
  if (!status) return "required"
  if (
    status === "approved" ||
    status === "approved_once" ||
    status === "approved_run" ||
    status === "consumed"
  ) {
    return "approved"
  }
  if (status === "denied" || status === "expired" || status === "superseded") return "denied"
  if (status === "requested" || status === "pending") return "pending"
  return "required"
}

function collectApprovals(
  orchestrationEvents: readonly DbOrchestrationEvent[],
  ledgerEvents: readonly DbMessageLedgerEvent[],
): RunRuntimeInspectorApprovalSummary[] {
  const byId = new Map<string, RunRuntimeInspectorApprovalSummary>()
  const setApproval = (approval: RunRuntimeInspectorApprovalSummary) => {
    const previous = byId.get(approval.approvalId)
    if (!previous || previous.at <= approval.at) byId.set(approval.approvalId, approval)
  }

  for (const event of orchestrationEvents) {
    if (!event.event_kind.startsWith("approval_")) continue
    const payload = redactedRecord(parseJsonRecord(event.payload_redacted_json))
    const approvals = recordArray(payload.approvals)
    if (approvals.length > 0) {
      for (const item of approvals) {
        const approvalId = stringValue(item.approvalId) ?? event.approval_id
        if (!approvalId) continue
        setApproval({
          approvalId: redactedText(approvalId),
          status: approvalStatusFrom(item.status),
          ...(stringValue(item.subSessionId)
            ? { subSessionId: redactedText(item.subSessionId) }
            : {}),
          ...(stringValue(item.agentId) ? { agentId: redactedText(item.agentId) } : {}),
          summary: redactedText(item.summary, event.summary),
          at: event.emitted_at || event.created_at,
        })
      }
      continue
    }

    const approvalId = event.approval_id ?? stringValue(payload.approvalId)
    if (approvalId) {
      setApproval({
        approvalId: redactedText(approvalId),
        status: approvalStatusFrom(payload.status),
        ...(event.sub_session_id ? { subSessionId: redactedText(event.sub_session_id) } : {}),
        ...(event.agent_id ? { agentId: redactedText(event.agent_id) } : {}),
        summary: redactedText(event.summary),
        at: event.emitted_at || event.created_at,
      })
    }
  }

  for (const event of ledgerEvents) {
    if (event.event_kind !== "approval_aggregated" && event.event_kind !== "approval_requested") {
      continue
    }
    const detail = redactedRecord(parseJsonRecord(event.detail_json))
    for (const item of recordArray(detail.approvals)) {
      const approvalId = stringValue(item.approvalId)
      if (!approvalId) continue
      setApproval({
        approvalId: redactedText(approvalId),
        status: approvalStatusFrom(item.status),
        ...(stringValue(item.subSessionId)
          ? { subSessionId: redactedText(item.subSessionId) }
          : {}),
        ...(stringValue(item.agentId) ? { agentId: redactedText(item.agentId) } : {}),
        summary: redactedText(item.summary, event.summary),
        at: event.created_at,
      })
    }
  }

  return [...byId.values()].sort((left, right) => left.at - right.at)
}

function approvalStateForSubSession(
  subSession: SubSessionContract,
  approvals: readonly RunRuntimeInspectorApprovalSummary[],
  plan: OrchestrationPlan | undefined,
): RuntimeInspectorApprovalState {
  const related = approvals.filter(
    (item) =>
      item.subSessionId === subSession.subSessionId ||
      item.agentId === subSession.agentId ||
      item.summary.includes(subSession.subSessionId),
  )
  const latest = related.at(-1)
  if (latest) return latest.status
  if (subSession.status === "awaiting_approval") return "pending"
  const planRequiresApproval = plan?.approvalRequirements.some(
    (requirement) => requirement.agentId === subSession.agentId,
  )
  return planRequiresApproval ? "required" : "not_required"
}

function dataExchangeProjection(row: DbAgentDataExchange): RunRuntimeInspectorDataExchangeSummary {
  return {
    exchangeId: redactedText(row.exchange_id),
    sourceOwnerId: redactedText(row.source_owner_id),
    ...(row.source_nickname_snapshot
      ? { sourceNickname: redactedText(row.source_nickname_snapshot) }
      : {}),
    recipientOwnerId: redactedText(row.recipient_owner_id),
    ...(row.recipient_nickname_snapshot
      ? { recipientNickname: redactedText(row.recipient_nickname_snapshot) }
      : {}),
    purpose: redactedText(row.purpose),
    allowedUse: row.allowed_use,
    retentionPolicy: row.retention_policy,
    redactionState: row.redaction_state,
    provenanceCount: parseJsonArray(row.provenance_refs_json).length,
    createdAt: row.created_at,
    ...(row.expires_at ? { expiresAt: row.expires_at } : {}),
  }
}

function collectDataExchanges(
  subSessions: readonly SubSessionContract[],
  now: number,
): RunRuntimeInspectorDataExchangeSummary[] {
  const byId = new Map<string, DbAgentDataExchange>()
  for (const subSession of subSessions) {
    const owner = { ownerType: "sub_agent" as const, ownerId: subSession.agentId }
    for (const row of listAgentDataExchangesForSource(owner, {
      includeExpired: true,
      limit: 100,
      now,
    })) {
      byId.set(row.exchange_id, row)
    }
    for (const row of listAgentDataExchangesForRecipient(owner, {
      includeExpired: true,
      limit: 100,
      now,
    })) {
      byId.set(row.exchange_id, row)
    }
  }
  return [...byId.values()]
    .sort(
      (left, right) =>
        left.created_at - right.created_at || left.exchange_id.localeCompare(right.exchange_id),
    )
    .map(dataExchangeProjection)
}

function planProjection(plan: OrchestrationPlan | undefined): RunRuntimeInspectorPlanProjection {
  const directTasks = plan?.directNobieTasks ?? []
  const delegatedTasks = plan?.delegatedTasks ?? []
  const taskSummaries = [...directTasks, ...delegatedTasks].slice(0, 12).map((task) => ({
    taskId: redactedText(task.taskId),
    executionKind: redactedText(task.executionKind),
    goal: redactedText(task.scope.goal),
    ...(task.assignedAgentId ? { assignedAgentId: redactedText(task.assignedAgentId) } : {}),
    ...(task.assignedTeamId ? { assignedTeamId: redactedText(task.assignedTeamId) } : {}),
    reasonCodes: task.scope.reasonCodes.map((code) => redactedText(code)),
  }))

  return {
    ...(plan?.planId ? { planId: redactedText(plan.planId) } : {}),
    ...(plan?.parentRequestId ? { parentRequestId: redactedText(plan.parentRequestId) } : {}),
    ...(plan?.createdAt !== undefined ? { createdAt: plan.createdAt } : {}),
    ...(plan?.plannerMetadata?.status
      ? { plannerStatus: redactedText(plan.plannerMetadata.status) }
      : {}),
    directTaskCount: directTasks.length,
    delegatedTaskCount: delegatedTasks.length,
    approvalRequirementCount: plan?.approvalRequirements.length ?? 0,
    resourceLockCount: plan?.resourceLocks.length ?? 0,
    parallelGroupCount: plan?.parallelGroups.length ?? 0,
    ...(plan?.fallbackStrategy.mode
      ? { fallbackMode: redactedText(plan.fallbackStrategy.mode) }
      : {}),
    ...(plan?.fallbackStrategy.reasonCode
      ? { fallbackReasonCode: redactedText(plan.fallbackStrategy.reasonCode) }
      : {}),
    taskSummaries,
  }
}

function timelineFromRunEvent(event: RunEvent): RunRuntimeInspectorTimelineEvent {
  return {
    id: event.id,
    at: event.at,
    source: "run_event",
    kind: "run_event",
    summary: redactedText(event.label),
    ...(event.label.includes("sub_session_")
      ? { subSessionId: redactedText(event.label.split(":").at(1), "") }
      : {}),
  }
}

function timelineFromOrchestrationEvent(
  event: DbOrchestrationEvent,
): RunRuntimeInspectorTimelineEvent {
  return {
    id: event.id,
    at: event.emitted_at || event.created_at,
    source: "orchestration",
    kind: redactedText(event.event_kind),
    severity: event.severity,
    summary: redactedText(event.summary),
    ...(event.sub_session_id ? { subSessionId: redactedText(event.sub_session_id) } : {}),
    ...(event.agent_id ? { agentId: redactedText(event.agent_id) } : {}),
    ...(event.exchange_id ? { exchangeId: redactedText(event.exchange_id) } : {}),
    ...(event.approval_id ? { approvalId: redactedText(event.approval_id) } : {}),
  }
}

function timelineFromLedgerEvent(event: DbMessageLedgerEvent): RunRuntimeInspectorTimelineEvent {
  const detail = redactedRecord(parseJsonRecord(event.detail_json))
  return {
    id: event.id,
    at: event.created_at,
    source: "message_ledger",
    kind: redactedText(event.event_kind),
    status: event.status,
    summary: redactedText(event.summary),
    ...(subSessionIdFromDetail(detail)
      ? { subSessionId: redactedText(subSessionIdFromDetail(detail)) }
      : {}),
    ...(agentIdFromDetail(detail) ? { agentId: redactedText(agentIdFromDetail(detail)) } : {}),
    ...(exchangeIdFromDetail(detail)
      ? { exchangeId: redactedText(exchangeIdFromDetail(detail)) }
      : {}),
    ...(approvalIdFromDetail(detail)
      ? { approvalId: redactedText(approvalIdFromDetail(detail)) }
      : {}),
  }
}

function mergeEventsById<T extends { id: string }>(events: T[]): T[] {
  return [...new Map(events.map((event) => [event.id, event])).values()]
}

function collectTimeline(
  run: RootRun,
  orchestrationEvents: readonly DbOrchestrationEvent[],
  ledgerEvents: readonly DbMessageLedgerEvent[],
  limit: number,
): RunRuntimeInspectorTimelineEvent[] {
  return [
    ...run.recentEvents.map(timelineFromRunEvent),
    ...orchestrationEvents.map(timelineFromOrchestrationEvent),
    ...ledgerEvents.map(timelineFromLedgerEvent),
  ]
    .sort((left, right) => left.at - right.at || left.id.localeCompare(right.id))
    .slice(-limit)
}

function finalizerFromLedger(
  ledgerEvents: readonly DbMessageLedgerEvent[],
): RunRuntimeInspectorFinalizer {
  let finalizer: RunRuntimeInspectorFinalizer = {
    parentOwnedFinalAnswer: true,
    status: "not_started",
  }

  for (const event of ledgerEvents) {
    const status: RunRuntimeInspectorFinalizer["status"] | undefined =
      event.event_kind === "final_answer_delivered"
        ? "delivered"
        : event.event_kind === "final_answer_generated"
          ? "generated"
          : event.event_kind === "final_answer_suppressed"
            ? "suppressed"
            : event.event_kind === "text_delivery_failed"
              ? "failed"
              : undefined
    if (!status) continue
    if (FINALIZER_EVENT_PRECEDENCE[status] < FINALIZER_EVENT_PRECEDENCE[finalizer.status]) continue
    finalizer = {
      parentOwnedFinalAnswer: true,
      status,
      ...(event.delivery_key ? { deliveryKey: redactedText(event.delivery_key) } : {}),
      ...(event.idempotency_key ? { idempotencyKey: redactedText(event.idempotency_key) } : {}),
      summary: redactedText(event.summary),
      at: event.created_at,
    }
  }

  return finalizer
}

function collectSubSessions(
  run: RootRun,
  contracts: readonly SubSessionContract[],
  ledgerEvents: readonly DbMessageLedgerEvent[],
  orchestrationEvents: readonly DbOrchestrationEvent[],
  approvals: readonly RunRuntimeInspectorApprovalSummary[],
): RunRuntimeInspectorSubSession[] {
  const tree = subSessionTreeMetadata(contracts)
  return contracts.map((contract) => {
    const result = resultFor(contract.subSessionId, ledgerEvents, orchestrationEvents)
    const review = reviewFor(contract.subSessionId, orchestrationEvents)
    const model = modelFor(contract, ledgerEvents)
    const metadata = tree.get(contract.subSessionId)
    return {
      subSessionId: redactedText(contract.subSessionId),
      parentRunId: redactedText(contract.parentRunId),
      ...(contract.identity.parent?.parentSubSessionId
        ? { parentSubSessionId: redactedText(contract.identity.parent.parentSubSessionId) }
        : {}),
      childSubSessionIds: (metadata?.childSubSessionIds ?? []).map((id) => redactedText(id)),
      depth: metadata?.depth ?? 1,
      resultAggregationStage: contract.identity.parent?.parentSubSessionId
        ? "parent_sub_agent_review"
        : "nobie_finalization",
      ...(metadata?.resultReturnTargetAgentId
        ? { resultReturnTargetAgentId: redactedText(metadata.resultReturnTargetAgentId) }
        : {}),
      ...(contract.identity.parent?.parentSubSessionId
        ? {
            resultReturnTargetSubSessionId: redactedText(
              contract.identity.parent.parentSubSessionId,
            ),
          }
        : {}),
      agentId: redactedText(contract.agentId),
      agentDisplayName: redactedText(contract.agentDisplayName),
      ...(contract.agentNickname ? { agentNickname: redactedText(contract.agentNickname) } : {}),
      status: contract.status,
      commandSummary: commandSummaryFor(contract),
      expectedOutputs: expectedOutputsFor(contract),
      retryBudgetRemaining: contract.retryBudgetRemaining,
      promptBundleId: redactedText(contract.promptBundleId),
      ...(contract.startedAt !== undefined ? { startedAt: contract.startedAt } : {}),
      ...(contract.finishedAt !== undefined ? { finishedAt: contract.finishedAt } : {}),
      progress: progressFor(contract.subSessionId, ledgerEvents, orchestrationEvents),
      ...(result ? { result } : {}),
      ...(review ? { review } : {}),
      feedback: feedbackFor(contract.subSessionId, orchestrationEvents, run.recentEvents),
      approvalState: approvalStateForSubSession(contract, approvals, run.orchestrationPlanSnapshot),
      ...(model ? { model } : {}),
      allowedControlActions: allowedControlActionsFor(
        contract.status,
        contract.retryBudgetRemaining,
      ),
    }
  })
}

function subSessionTreeMetadata(contracts: readonly SubSessionContract[]): Map<
  string,
  {
    depth: number
    childSubSessionIds: string[]
    resultReturnTargetAgentId?: string
  }
> {
  const byId = new Map(contracts.map((contract) => [contract.subSessionId, contract]))
  const childrenByParent = new Map<string, string[]>()
  for (const contract of contracts) {
    const parentSubSessionId = contract.identity.parent?.parentSubSessionId
    if (!parentSubSessionId) continue
    const children = childrenByParent.get(parentSubSessionId) ?? []
    children.push(contract.subSessionId)
    childrenByParent.set(parentSubSessionId, children)
  }

  const depthCache = new Map<string, number>()
  const depthFor = (contract: SubSessionContract, seen = new Set<string>()): number => {
    const cached = depthCache.get(contract.subSessionId)
    if (cached !== undefined) return cached
    if (seen.has(contract.subSessionId)) return 1
    const parentSubSessionId = contract.identity.parent?.parentSubSessionId
    const parent = parentSubSessionId ? byId.get(parentSubSessionId) : undefined
    const depth = parent ? depthFor(parent, new Set([...seen, contract.subSessionId])) + 1 : 1
    depthCache.set(contract.subSessionId, depth)
    return depth
  }

  const result = new Map<
    string,
    { depth: number; childSubSessionIds: string[]; resultReturnTargetAgentId?: string }
  >()
  for (const contract of contracts) {
    const parentSubSessionId = contract.identity.parent?.parentSubSessionId
    const parent = parentSubSessionId ? byId.get(parentSubSessionId) : undefined
    result.set(contract.subSessionId, {
      depth: depthFor(contract),
      childSubSessionIds: [...(childrenByParent.get(contract.subSessionId) ?? [])].sort((a, b) =>
        a.localeCompare(b),
      ),
      resultReturnTargetAgentId: parent?.agentId ?? contract.parentAgentId ?? "agent:nobie",
    })
  }
  return result
}

function subSessionContractsFor(run: RootRun): SubSessionContract[] {
  const rows = listRunSubSessionsForParentRun(run.id)
  const contracts = rows.map(contractFromRow)
  if (contracts.length === 0 && run.subSessionsSnapshot?.length) {
    contracts.push(...run.subSessionsSnapshot)
  }
  return contracts
}

function collectOrchestrationEvents(run: RootRun, limit: number): DbOrchestrationEvent[] {
  const byId = new Map<string, DbOrchestrationEvent>()
  for (const event of listOrchestrationEvents({ runId: run.id, limit })) byId.set(event.id, event)
  if (run.requestGroupId && run.requestGroupId !== run.id) {
    for (const event of listOrchestrationEvents({ requestGroupId: run.requestGroupId, limit })) {
      byId.set(event.id, event)
    }
  }
  return [...byId.values()].sort((left, right) => left.sequence - right.sequence)
}

function collectLedgerEvents(run: RootRun, limit: number): DbMessageLedgerEvent[] {
  return mergeEventsById([
    ...listMessageLedgerEvents({ runId: run.id, limit }),
    ...(run.requestGroupId && run.requestGroupId !== run.id
      ? listMessageLedgerEvents({ requestGroupId: run.requestGroupId, limit })
      : []),
  ]).sort((left, right) => left.created_at - right.created_at || left.id.localeCompare(right.id))
}

export function buildRunRuntimeInspectorProjection(
  run: RootRun,
  options: RunRuntimeInspectorProjectionOptions = {},
): RunRuntimeInspectorProjection {
  const now = options.now ?? Date.now()
  const limit = Math.max(1, Math.min(500, Math.floor(options.limit ?? 120)))
  const orchestrationEvents = collectOrchestrationEvents(run, Math.max(limit, 500))
  const ledgerEvents = collectLedgerEvents(run, Math.max(limit, 500))
  const approvals = collectApprovals(orchestrationEvents, ledgerEvents)
  const subSessionContracts = subSessionContractsFor(run)
  const subSessions = collectSubSessions(
    run,
    subSessionContracts,
    ledgerEvents,
    orchestrationEvents,
    approvals,
  )

  return {
    schemaVersion: 1,
    runId: redactedText(run.id),
    requestGroupId: redactedText(run.requestGroupId || run.id),
    generatedAt: now,
    orchestrationMode: run.orchestrationMode ?? "single_nobie",
    plan: planProjection(run.orchestrationPlanSnapshot),
    subSessions,
    dataExchanges: collectDataExchanges(subSessionContracts, now),
    approvals,
    timeline: collectTimeline(run, orchestrationEvents, ledgerEvents, limit),
    finalizer: finalizerFromLedger(ledgerEvents),
    redaction: {
      payloadsRedacted: true,
      rawPayloadVisible: false,
    },
  }
}
