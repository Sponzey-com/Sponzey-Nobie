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
import {
  listTopologyRunsForRootRun,
  type TopologyRunTraceProjection,
} from "../topology-runtime/trace.js"
import type { EnterpriseTopology } from "../contracts/enterprise-topology.js"
import { createEnterpriseTopologyRegistry } from "../topology/registry.js"
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
  signalCount: number
  strategyChangeCount?: number
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
  assignmentSource?: "topology" | "agent" | "team" | "direct"
  assignedTopologyId?: string
  assignedExecutorId?: string
  assignedExecutorName?: string
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
  fallbackWarnings?: string[]
  selectedExecutorSource?: string
  selectedExecutorId?: string
  rejectedExecutorId?: string
  rejectedReasonCodes?: string[]
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

export interface RunRuntimeInspectorTopologyRun {
  topologyRunId: string
  topologyId: string
  status: string
  entryNodeId?: string
  startedAt: number
  finishedAt?: number
  nodeRunCount: number
  workOrderCount: number
  traceEventCount: number
  toolCallCount: number
  failureCount: number
  observedEdgeCount: number
  projection: TopologyRunTraceProjection
}

export interface RunRuntimeInspectorTopologyRouting {
  mode: "route" | "fallback" | "unknown"
  reasonCode?: string
  featureFlagMode?: string
  executionDecisionSource?: string
  executionDecisionGraphId?: string
  executionDecisionGraphSource?: string
  executionDecisionCurrentExecutorId?: string
  executionDecisionAvailableExecutorIds?: string[]
  executionDecisionDiagnosticExecutorIds?: string[]
  executionDecisionAllExecutorIds?: string[]
  executionDecisionAllRegisteredExecutorIds?: string[]
  executionDecisionSelectedExecutorId?: string
  executionDecisionSelectedConnectionPath?: string[]
  executionDecisionNormalizedConnectionPath?: string[]
  executionDecisionRoute?: string
  executionDecisionFallbackReason?: string
  executionDecisionValidationStatus?: string
  executionDecisionValidationIssues?: string[]
  executionDecisionResolvedExecutorId?: string
  executionDecisionExecutorNameById?: Record<string, string>
  providerFallbackBlocked: boolean
  providerFallbackBlockedReasonCode?: string
  riskBoundaryRequiresUserApproval?: boolean
  riskBoundaryKind?: string
  riskBoundaryReason?: string
  topologyId?: string
  topologyName?: string
  topologyVersion?: number
  topologySchemaVersion?: number
  topologyMigrationSource?: string
  entryNodeId?: string
  entryNodeName?: string
  explicit?: boolean
  providerFallback: boolean
  providerFallbackReasonCode?: string
  activeTopologyCount?: number
  selectedExecutorIds: string[]
  selectedEdgeIds: string[]
  assignedTopologyAgentIds: string[]
  issues: string[]
}

export interface RunRuntimeInspectorProjection {
  schemaVersion: 1
  runId: string
  requestGroupId: string
  requestIdentity: RunRuntimeInspectorRequestIdentity
  generatedAt: number
  orchestrationMode: OrchestrationMode
  topologyRouting: RunRuntimeInspectorTopologyRouting
  plan: RunRuntimeInspectorPlanProjection
  subSessions: RunRuntimeInspectorSubSession[]
  dataExchanges: RunRuntimeInspectorDataExchangeSummary[]
  approvals: RunRuntimeInspectorApprovalSummary[]
  timeline: RunRuntimeInspectorTimelineEvent[]
  topologyRuns: RunRuntimeInspectorTopologyRun[]
  finalizer: RunRuntimeInspectorFinalizer
  redaction: {
    payloadsRedacted: true
    rawPayloadVisible: false
  }
}

export interface RunRuntimeInspectorRequestIdentity {
  runId: string
  requestGroupId: string
  lineageRootRunId?: string
  parentRunId?: string
  rootRunId: string
  userMessageKey?: string
  requestIsolationMode?: string
  continuationSource?: string
  contextMode?: string
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
  const signalCount = numberValue(source.signalCount)
    ?? numberValue(source.attemptCount)
    ?? numberValue(source.retryCount)
    ?? 0
  const strategyChangeCount = numberValue(source.strategyChangeCount)
  const latencyMs = numberValue(source.latencyMs)
  const status = stringValue(source.status)

  return {
    providerId: redactedText(providerId),
    modelId: redactedText(modelId),
    fallbackApplied: booleanValue(source.fallbackApplied) ?? false,
    ...(fallbackFromModelId ? { fallbackFromModelId: redactedText(fallbackFromModelId) } : {}),
    ...(fallbackReasonCode ? { fallbackReasonCode: redactedText(fallbackReasonCode) } : {}),
    ...(effort ? { effort: redactedText(effort) } : {}),
    signalCount,
    ...(strategyChangeCount !== undefined ? { strategyChangeCount } : {}),
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

function allowedControlActionsFor(status: SubSessionStatus): RuntimeInspectorAllowedControlAction[] {
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
    status !== "cancelled"
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

interface TopologyAgentAssignment {
  topologyId: string
  executorId: string
  executorName?: string
}

interface TopologyRoutingContext {
  routing: RunRuntimeInspectorTopologyRouting
  topologyById: Map<string, EnterpriseTopology>
  topologyNodeNameByKey: Map<string, string>
}

function topologyAgentAssignmentFor(
  agentId: string | undefined,
  context: TopologyRoutingContext,
): TopologyAgentAssignment | undefined {
  if (!agentId) return undefined
  const marker = ":node:"
  const markerIndex = agentId.indexOf(marker)
  if (markerIndex < 0) return undefined
  const topologyId = agentId.slice(0, markerIndex)
  const executorId = agentId.slice(markerIndex + 1)
  if (!topologyId || !executorId) return undefined
  const executorName = context.topologyNodeNameByKey.get(`${topologyId}:${executorId}`)
  return {
    topologyId,
    executorId,
    ...(executorName ? { executorName } : {}),
  }
}

function topologyRoutingSnapshotFrom(
  run: RootRun,
): Record<string, unknown> {
  const snapshot = isRecord(run.promptSourceSnapshot) ? run.promptSourceSnapshot : {}
  return isRecord(snapshot.topologyRouting) ? snapshot.topologyRouting : {}
}

function agentExecutionDecisionSnapshotFrom(
  run: RootRun,
): Record<string, unknown> {
  const snapshot = isRecord(run.promptSourceSnapshot) ? run.promptSourceSnapshot : {}
  return isRecord(snapshot.agentExecutionDecision) ? snapshot.agentExecutionDecision : {}
}

function agentExecutionDecisionTraceSnapshotFrom(
  run: RootRun,
): Record<string, unknown> {
  const snapshot = isRecord(run.promptSourceSnapshot) ? run.promptSourceSnapshot : {}
  return isRecord(snapshot.executionDecisionTrace) ? snapshot.executionDecisionTrace : {}
}

function requestIdentityFrom(run: RootRun): RunRuntimeInspectorRequestIdentity {
  const snapshot = isRecord(run.promptSourceSnapshot) ? run.promptSourceSnapshot : {}
  const inboundMessage = isRecord(snapshot.inboundMessage) ? snapshot.inboundMessage : {}
  const requestIsolation = isRecord(snapshot.requestIsolation) ? snapshot.requestIsolation : {}
  const lineageRootRunId = stringValue(run.lineageRootRunId)
  const rootRunId = lineageRootRunId ?? stringValue(run.requestGroupId) ?? run.id
  const userMessageKey = stringValue(inboundMessage.messageKey)
  const requestIsolationMode = stringValue(requestIsolation.mode)
  const continuationSource = stringValue(requestIsolation.continuationSource)
  const contextMode = stringValue(requestIsolation.contextMode)

  return {
    runId: redactedText(run.id),
    requestGroupId: redactedText(run.requestGroupId || run.id),
    rootRunId: redactedText(rootRunId),
    ...(lineageRootRunId ? { lineageRootRunId: redactedText(lineageRootRunId) } : {}),
    ...(run.parentRunId ? { parentRunId: redactedText(run.parentRunId) } : {}),
    ...(userMessageKey ? { userMessageKey: redactedText(userMessageKey) } : {}),
    ...(requestIsolationMode ? { requestIsolationMode: redactedText(requestIsolationMode) } : {}),
    ...(continuationSource ? { continuationSource: redactedText(continuationSource) } : {}),
    ...(contextMode ? { contextMode: redactedText(contextMode) } : {}),
  }
}

function loadTopologyById(topologyIds: Iterable<string>): Map<string, EnterpriseTopology> {
  const registry = createEnterpriseTopologyRegistry()
  const result = new Map<string, EnterpriseTopology>()
  for (const topologyId of topologyIds) {
    if (!topologyId.trim() || result.has(topologyId)) continue
    const exported = registry.exportTopology(topologyId)
    const topology = exported?.version.topology
    if (topology) result.set(topologyId, topology)
  }
  return result
}

function topologyNodeNames(
  topologyById: Map<string, EnterpriseTopology>,
): Map<string, string> {
  const result = new Map<string, string>()
  for (const [topologyId, topology] of topologyById) {
    for (const node of topology.nodes) {
      result.set(`${topologyId}:${node.id}`, redactedText(node.name || node.id))
    }
  }
  return result
}

function topologyExecutorNameRecord(
  topologyById: Map<string, EnterpriseTopology>,
): Record<string, string> {
  const result: Record<string, string> = {
    "agent:nobie": "노비",
  }
  for (const [topologyId, topology] of topologyById) {
    for (const node of topology.nodes) {
      const name = redactedText(node.name || node.id)
      result[`${topologyId}:${node.id}`] = name
      result[node.id] ??= name
    }
  }
  return result
}

function topologyEdgeIdsFromExecutors(
  topology: EnterpriseTopology | undefined,
  executorIds: readonly string[],
): string[] {
  if (!topology || executorIds.length === 0) return []
  const selected = new Set(executorIds)
  return topology.relations
    .filter((relation) =>
      relation.status !== "archived" &&
      relation.from.entityType === "node" &&
      relation.to.entityType === "node" &&
      selected.has(relation.from.id) &&
      selected.has(relation.to.id)
    )
    .map((relation) => redactedText(relation.id))
}

function topologyReachableExecutorIds(
  topology: EnterpriseTopology | undefined,
  entryNodeId: string | undefined,
): string[] {
  if (!topology || !entryNodeId) return []
  const nodeIds = new Set(topology.nodes.filter((node) => node.status !== "archived").map((node) => node.id))
  if (!nodeIds.has(entryNodeId)) return []
  const outgoing = new Map<string, string[]>()
  for (const relation of topology.relations) {
    if (
      relation.status === "archived" ||
      relation.from.entityType !== "node" ||
      relation.to.entityType !== "node" ||
      !nodeIds.has(relation.from.id) ||
      !nodeIds.has(relation.to.id)
    ) {
      continue
    }
    outgoing.set(relation.from.id, [...(outgoing.get(relation.from.id) ?? []), relation.to.id])
  }

  const visited = new Set<string>()
  const queue = [entryNodeId]
  while (queue.length > 0) {
    const current = queue.shift()
    if (!current || visited.has(current)) continue
    visited.add(current)
    for (const next of outgoing.get(current) ?? []) {
      if (!visited.has(next)) queue.push(next)
    }
  }
  return [...visited].map((id) => redactedText(id))
}

function topologyIdsFromRunAndPlan(
  run: RootRun,
  plan: OrchestrationPlan | undefined,
): string[] {
  const ids = new Set<string>()
  const routing = topologyRoutingSnapshotFrom(run)
  const executionDecision = agentExecutionDecisionSnapshotFrom(run)
  const routingTopologyId = stringValue(routing.topologyId) ?? stringValue(routing.explicitTopologyId)
  if (routingTopologyId) ids.add(routingTopologyId)
  const decisionAssignment = topologyAgentAssignmentIdParts(stringValue(executionDecision.selected_executor_id))
  if (decisionAssignment) ids.add(decisionAssignment.topologyId)
  for (const task of [...(plan?.directNobieTasks ?? []), ...(plan?.delegatedTasks ?? [])]) {
    const assigned = topologyAgentAssignmentIdParts(task.assignedAgentId)
    if (assigned) ids.add(assigned.topologyId)
  }
  return [...ids]
}

function topologyAgentAssignmentIdParts(
  agentId: string | undefined,
): { topologyId: string; executorId: string } | undefined {
  if (!agentId) return undefined
  const marker = ":node:"
  const markerIndex = agentId.indexOf(marker)
  if (markerIndex < 0) return undefined
  const topologyId = agentId.slice(0, markerIndex)
  const executorId = agentId.slice(markerIndex + 1)
  if (!topologyId || !executorId) return undefined
  return { topologyId, executorId }
}

function buildTopologyRoutingContext(
  run: RootRun,
  plan: OrchestrationPlan | undefined,
): TopologyRoutingContext {
  const snapshot = topologyRoutingSnapshotFrom(run)
  const executionDecision = agentExecutionDecisionSnapshotFrom(run)
  const executionDecisionTrace = agentExecutionDecisionTraceSnapshotFrom(run)
  const mode = stringValue(snapshot.mode)
  const reasonCode = stringValue(snapshot.reasonCode)
  const topologyId = stringValue(snapshot.topologyId)
  const topologyName = stringValue(snapshot.topologyName)
  const entryNodeId = stringValue(snapshot.entryNodeId)
  const topologyById = loadTopologyById(topologyIdsFromRunAndPlan(run, plan))
  const topologyNodeNameByKey = topologyNodeNames(topologyById)
  const topologyForRoute = topologyId ? topologyById.get(topologyId) : undefined
  const topologyV2MarkerCandidate = topologyForRoute?.metadata?.executorTopologyV2
  const topologyV2Marker = isRecord(topologyV2MarkerCandidate) ? topologyV2MarkerCandidate : {}
  const executionDecisionExecutorNameById = topologyExecutorNameRecord(topologyById)
  const entryNodeName = topologyId && entryNodeId
    ? topologyNodeNameByKey.get(`${topologyId}:${entryNodeId}`)
    : undefined
  const assignedTopologyAgentIds = [...(plan?.delegatedTasks ?? []), ...(plan?.directNobieTasks ?? [])]
    .map((task) => task.assignedAgentId)
    .filter((agentId): agentId is string => Boolean(topologyAgentAssignmentIdParts(agentId)))
    .map((agentId) => redactedText(agentId))
  const assignedExecutorIds = assignedTopologyAgentIds
    .map((agentId) => topologyAgentAssignmentIdParts(agentId)?.executorId)
    .filter((executorId): executorId is string => Boolean(executorId))
  const decisionSelectedExecutorId = stringValue(executionDecision.selected_executor_id)
  const decisionSelectedAssignment = topologyAgentAssignmentIdParts(decisionSelectedExecutorId)
  const decisionExecutorId = decisionSelectedAssignment?.executorId ?? decisionSelectedExecutorId
  const decisionRoute = stringValue(executionDecision.execution_route)
  const decisionFallbackReason = stringValue(executionDecision.fallback_if_unavailable)
  const decisionRiskBoundary = isRecord(executionDecision.risk_boundary)
    ? executionDecision.risk_boundary
    : {}
  const riskBoundaryRequiresUserApproval = booleanValue(decisionRiskBoundary.requires_user_approval)
  const riskBoundaryKind = stringValue(decisionRiskBoundary.boundary_kind)
  const riskBoundaryReason = stringValue(decisionRiskBoundary.reason)
  const routeExecutorIds = topologyReachableExecutorIds(
    topologyId ? topologyById.get(topologyId) : undefined,
    entryNodeId,
  )
  const topologyVersion = numberValue(snapshot.topologyVersion)
  const topologySchemaVersion =
    numberValue(snapshot.topologySchemaVersion) ??
    numberValue(topologyV2Marker.schemaVersion) ??
    (topologyForRoute?.schemaVersion !== undefined ? Number(topologyForRoute.schemaVersion) : undefined)
  const topologyMigrationSource =
    stringValue(snapshot.topologyMigrationSource) ??
    stringValue(topologyV2Marker.migrationSource) ??
    stringValue(topologyV2Marker.sourceOfTruth)
  const activeTopologyCount = numberValue(snapshot.activeTopologyCount)
  const explicit = booleanValue(snapshot.explicit)
  const promptSnapshot = isRecord(run.promptSourceSnapshot) ? run.promptSourceSnapshot : {}
  const executionDecisionSource =
    stringValue(executionDecisionTrace.decision_source) ??
    stringValue(promptSnapshot.executionDecisionSource)
  const executionDecisionGraphId = stringValue(executionDecisionTrace.graph_id)
  const executionDecisionGraphSource = stringValue(executionDecisionTrace.graph_source)
  const executionDecisionCurrentExecutorId =
    stringValue(executionDecisionTrace.current_executor_id) ??
    stringValue(executionDecision.current_executor_id)
  const executionDecisionAvailableExecutorIds = stringArray(executionDecisionTrace.available_executor_ids)
  const executionDecisionDiagnosticExecutorIds = stringArray(executionDecisionTrace.diagnostic_executor_ids)
  const executionDecisionAllExecutorIds = stringArray(executionDecisionTrace.all_active_executor_ids)
  const executionDecisionAllRegisteredExecutorIds = stringArray(executionDecisionTrace.all_registered_executor_ids)
  const executionDecisionSelectedConnectionPath =
    stringArray(executionDecisionTrace.selected_connection_path).length > 0
      ? stringArray(executionDecisionTrace.selected_connection_path)
      : stringArray(executionDecision.selected_connection_path)
  const executionDecisionNormalizedConnectionPath = stringArray(executionDecisionTrace.normalized_connection_path)
  const executionDecisionValidationStatus = stringValue(executionDecisionTrace.validation_status)
  const executionDecisionValidationIssues = Array.isArray(executionDecisionTrace.validation_issues)
    ? executionDecisionTrace.validation_issues
        .filter(isRecord)
        .map((issue) => stringValue(issue.code) ?? stringValue(issue.message))
        .filter((value): value is string => Boolean(value))
    : []
  const executionDecisionResolvedExecutorId = stringValue(executionDecisionTrace.resolved_selected_executor_id)
  const hasSelectedExecutionDecision =
    decisionRoute === "delegate_to_child" &&
    Boolean(decisionSelectedExecutorId ?? executionDecisionResolvedExecutorId)
  const selectedExecutorIds = [
    ...new Set([
      ...(entryNodeId ? [redactedText(entryNodeId)] : []),
      ...routeExecutorIds,
      ...assignedExecutorIds.map((id) => redactedText(id)),
      ...(decisionExecutorId ? [redactedText(decisionExecutorId)] : []),
    ]),
  ]
  const providerTarget = typeof run.targetId === "string" && run.targetId.startsWith("provider:")
  const directFallback =
    mode === "fallback" &&
    assignedTopologyAgentIds.length === 0 &&
    (plan?.directNobieTasks.length ?? 0) > 0
  const providerFallback = providerTarget || (!hasSelectedExecutionDecision && directFallback)
  const providerFallbackBlockedEvent = [...run.recentEvents].reverse().find((event) =>
    event.label.includes("provider_direct_blocked_without_explicit_target")
  )
  const providerFallbackBlocked = Boolean(providerFallbackBlockedEvent)
  const providerFallbackBlockedReasonCode = providerFallbackBlocked
    ? "provider_direct_blocked_without_explicit_target"
    : undefined
  const issues = stringArray(snapshot.issues).filter((issue) =>
    hasSelectedExecutionDecision ? issue !== "selected_executor_missing" : true
  )
  const effectiveMode = hasSelectedExecutionDecision ? "route" : mode
  const effectiveReasonCode = hasSelectedExecutionDecision
    ? "execution_decision_selected_executor"
    : reasonCode
  const routing: RunRuntimeInspectorTopologyRouting = {
    mode: effectiveMode === "route" || effectiveMode === "fallback" ? effectiveMode : "unknown",
    ...(effectiveReasonCode ? { reasonCode: redactedText(effectiveReasonCode) } : {}),
    ...(stringValue(snapshot.featureFlagMode)
      ? { featureFlagMode: redactedText(snapshot.featureFlagMode) }
      : {}),
    ...(executionDecisionSource
      ? { executionDecisionSource: redactedText(executionDecisionSource) }
      : {}),
    ...(executionDecisionGraphId ? { executionDecisionGraphId: redactedText(executionDecisionGraphId) } : {}),
    ...(executionDecisionGraphSource
      ? { executionDecisionGraphSource: redactedText(executionDecisionGraphSource) }
      : {}),
    ...(executionDecisionCurrentExecutorId
      ? { executionDecisionCurrentExecutorId: redactedText(executionDecisionCurrentExecutorId) }
      : {}),
    ...(executionDecisionAvailableExecutorIds.length > 0
      ? { executionDecisionAvailableExecutorIds: executionDecisionAvailableExecutorIds.map((id) => redactedText(id)) }
      : {}),
    ...(executionDecisionDiagnosticExecutorIds.length > 0
      ? { executionDecisionDiagnosticExecutorIds: executionDecisionDiagnosticExecutorIds.map((id) => redactedText(id)) }
      : {}),
    ...(executionDecisionAllExecutorIds.length > 0
      ? { executionDecisionAllExecutorIds: executionDecisionAllExecutorIds.map((id) => redactedText(id)) }
      : {}),
    ...(executionDecisionAllRegisteredExecutorIds.length > 0
      ? {
          executionDecisionAllRegisteredExecutorIds: executionDecisionAllRegisteredExecutorIds.map((id) =>
            redactedText(id),
          ),
        }
      : {}),
    ...(decisionSelectedExecutorId
      ? { executionDecisionSelectedExecutorId: redactedText(decisionSelectedExecutorId) }
      : {}),
    ...(executionDecisionSelectedConnectionPath.length > 0
      ? {
          executionDecisionSelectedConnectionPath: executionDecisionSelectedConnectionPath.map((id) =>
            redactedText(id),
          ),
        }
      : {}),
    ...(executionDecisionNormalizedConnectionPath.length > 0
      ? {
          executionDecisionNormalizedConnectionPath: executionDecisionNormalizedConnectionPath.map((id) =>
            redactedText(id),
          ),
        }
      : {}),
    ...(decisionRoute ? { executionDecisionRoute: redactedText(decisionRoute) } : {}),
    ...(decisionFallbackReason
      ? { executionDecisionFallbackReason: redactedText(decisionFallbackReason) }
      : {}),
    ...(executionDecisionValidationStatus
      ? { executionDecisionValidationStatus: redactedText(executionDecisionValidationStatus) }
      : {}),
    ...(executionDecisionValidationIssues.length > 0
      ? { executionDecisionValidationIssues: executionDecisionValidationIssues.map((issue) => redactedText(issue)) }
      : {}),
    ...(executionDecisionResolvedExecutorId
      ? { executionDecisionResolvedExecutorId: redactedText(executionDecisionResolvedExecutorId) }
      : {}),
    executionDecisionExecutorNameById,
    providerFallbackBlocked,
    ...(providerFallbackBlockedReasonCode
      ? { providerFallbackBlockedReasonCode: redactedText(providerFallbackBlockedReasonCode) }
      : {}),
    ...(riskBoundaryRequiresUserApproval !== undefined
      ? { riskBoundaryRequiresUserApproval }
      : {}),
    ...(riskBoundaryKind ? { riskBoundaryKind: redactedText(riskBoundaryKind) } : {}),
    ...(riskBoundaryReason ? { riskBoundaryReason: redactedText(riskBoundaryReason) } : {}),
    ...(topologyId ? { topologyId: redactedText(topologyId) } : {}),
    ...(topologyName ? { topologyName: redactedText(topologyName) } : {}),
    ...(topologyVersion !== undefined ? { topologyVersion } : {}),
    ...(topologySchemaVersion !== undefined ? { topologySchemaVersion } : {}),
    ...(topologyMigrationSource ? { topologyMigrationSource: redactedText(topologyMigrationSource) } : {}),
    ...(entryNodeId ? { entryNodeId: redactedText(entryNodeId) } : {}),
    ...(entryNodeName ? { entryNodeName } : {}),
    ...(explicit !== undefined ? { explicit } : {}),
    providerFallback,
    ...(providerFallback && effectiveReasonCode
      ? { providerFallbackReasonCode: redactedText(effectiveReasonCode) }
      : {}),
    ...(activeTopologyCount !== undefined ? { activeTopologyCount } : {}),
    selectedExecutorIds,
    selectedEdgeIds: topologyId
      ? topologyEdgeIdsFromExecutors(topologyById.get(topologyId), selectedExecutorIds)
      : [],
    assignedTopologyAgentIds,
    issues,
  }
  return { routing, topologyById, topologyNodeNameByKey }
}

function planProjection(
  plan: OrchestrationPlan | undefined,
  topologyContext: TopologyRoutingContext,
): RunRuntimeInspectorPlanProjection {
  const directTasks = plan?.directNobieTasks ?? []
  const delegatedTasks = plan?.delegatedTasks ?? []
  const executionDecisionDelegatedTask = (() => {
    const selectedExecutorId = topologyContext.routing.executionDecisionSelectedExecutorId
    if (
      topologyContext.routing.mode !== "route" ||
      topologyContext.routing.executionDecisionRoute !== "delegate_to_child" ||
      delegatedTasks.length > 0 ||
      !selectedExecutorId
    ) {
      return undefined
    }

    const topologyAssignment = topologyAgentAssignmentFor(selectedExecutorId, topologyContext)
    const executorName =
      topologyAssignment?.executorName ??
      topologyContext.routing.executionDecisionExecutorNameById?.[selectedExecutorId]
    return {
      taskId: redactedText(`${plan?.planId ?? "execution-decision"}:trace:0`),
      executionKind: "delegated_sub_agent",
      goal: redactedText(
        directTasks[0]?.scope.goal ??
          "실행 판단 trace에 따라 하위 실행자에게 위임했습니다.",
      ),
      assignedAgentId: redactedText(selectedExecutorId),
      assignmentSource: topologyAssignment ? "topology" as const : "agent" as const,
      ...(topologyAssignment
        ? {
            assignedTopologyId: redactedText(topologyAssignment.topologyId),
            assignedExecutorId: redactedText(topologyAssignment.executorId),
          }
        : {}),
      ...(executorName ? { assignedExecutorName: redactedText(executorName) } : {}),
      reasonCodes: ["execution_decision_trace_delegate_to_child"],
    }
  })()
  const sourceTasks = executionDecisionDelegatedTask
    ? delegatedTasks
    : [...directTasks, ...delegatedTasks]
  const taskSummaries = [
    ...(executionDecisionDelegatedTask ? [executionDecisionDelegatedTask] : []),
    ...sourceTasks.slice(0, executionDecisionDelegatedTask ? 11 : 12).map((task) => {
      const topologyAssignment = topologyAgentAssignmentFor(task.assignedAgentId, topologyContext)
      const assignmentSource: RunRuntimeInspectorPlanTask["assignmentSource"] = topologyAssignment
        ? "topology"
        : task.assignedAgentId
          ? "agent"
          : task.assignedTeamId
            ? "team"
            : "direct"
      return {
        taskId: redactedText(task.taskId),
        executionKind: redactedText(task.executionKind),
        goal: redactedText(task.scope.goal),
        ...(task.assignedAgentId ? { assignedAgentId: redactedText(task.assignedAgentId) } : {}),
        ...(task.assignedTeamId ? { assignedTeamId: redactedText(task.assignedTeamId) } : {}),
        assignmentSource,
        ...(topologyAssignment
          ? {
              assignedTopologyId: redactedText(topologyAssignment.topologyId),
              assignedExecutorId: redactedText(topologyAssignment.executorId),
            }
          : {}),
        ...(topologyAssignment?.executorName
          ? { assignedExecutorName: redactedText(topologyAssignment.executorName) }
          : {}),
        reasonCodes: task.scope.reasonCodes.map((code) => redactedText(code)),
      }
    }),
  ]

  return {
    ...(plan?.planId ? { planId: redactedText(plan.planId) } : {}),
    ...(plan?.parentRequestId ? { parentRequestId: redactedText(plan.parentRequestId) } : {}),
    ...(plan?.createdAt !== undefined ? { createdAt: plan.createdAt } : {}),
    ...(plan?.plannerMetadata?.status
      ? { plannerStatus: redactedText(plan.plannerMetadata.status) }
      : {}),
    directTaskCount: executionDecisionDelegatedTask ? 0 : directTasks.length,
    delegatedTaskCount: executionDecisionDelegatedTask ? 1 : delegatedTasks.length,
    approvalRequirementCount: plan?.approvalRequirements.length ?? 0,
    resourceLockCount: plan?.resourceLocks.length ?? 0,
    parallelGroupCount: plan?.parallelGroups.length ?? 0,
    ...(!executionDecisionDelegatedTask && plan?.fallbackStrategy.mode
      ? { fallbackMode: redactedText(plan.fallbackStrategy.mode) }
      : {}),
    ...(!executionDecisionDelegatedTask && plan?.fallbackStrategy.reasonCode
      ? { fallbackReasonCode: redactedText(plan.fallbackStrategy.reasonCode) }
      : {}),
    ...(plan?.plannerMetadata?.selectedExecutorSource
      ? { selectedExecutorSource: redactedText(plan.plannerMetadata.selectedExecutorSource) }
      : {}),
    ...(plan?.plannerMetadata?.selectedExecutorId
      ? { selectedExecutorId: redactedText(plan.plannerMetadata.selectedExecutorId) }
      : {}),
    ...(plan?.plannerMetadata?.rejectedExecutorId
      ? { rejectedExecutorId: redactedText(plan.plannerMetadata.rejectedExecutorId) }
      : {}),
    ...(plan?.plannerMetadata?.rejectedReasonCodes?.length
      ? {
          rejectedReasonCodes: plan.plannerMetadata.rejectedReasonCodes.map((code) =>
            redactedText(code),
          ),
        }
      : {}),
    ...(plan?.fallbackStrategy.mode === "single_nobie"
      ? { fallbackWarnings: ["legacy_single_nobie_fallback_mode_deprecated"] }
      : executionDecisionDelegatedTask
        ? { fallbackWarnings: ["plan_snapshot_reconciled_with_execution_decision_trace"] }
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
      promptBundleId: redactedText(contract.promptBundleId),
      ...(contract.startedAt !== undefined ? { startedAt: contract.startedAt } : {}),
      ...(contract.finishedAt !== undefined ? { finishedAt: contract.finishedAt } : {}),
      progress: progressFor(contract.subSessionId, ledgerEvents, orchestrationEvents),
      ...(result ? { result } : {}),
      ...(review ? { review } : {}),
      feedback: feedbackFor(contract.subSessionId, orchestrationEvents, run.recentEvents),
      approvalState: approvalStateForSubSession(contract, approvals, run.orchestrationPlanSnapshot),
      ...(model ? { model } : {}),
      allowedControlActions: allowedControlActionsFor(contract.status),
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

function collectTopologyRuns(run: RootRun, limit: number): RunRuntimeInspectorTopologyRun[] {
  return listTopologyRunsForRootRun(run.id, { limit })
    .map((projection) => {
      const item: RunRuntimeInspectorTopologyRun = {
        topologyRunId: redactedText(projection.run.topologyRunId),
        topologyId: redactedText(projection.run.topologyId),
        status: projection.run.status,
        startedAt: projection.run.startedAt,
        nodeRunCount: projection.nodeRuns.length,
        workOrderCount: projection.workOrders.length,
        traceEventCount: projection.traceEvents.length,
        toolCallCount: projection.toolCalls.length,
        failureCount: projection.failureReports.length,
        observedEdgeCount: projection.observedEdges.length,
        projection,
      }
      if (projection.run.entryNodeId !== undefined) item.entryNodeId = redactedText(projection.run.entryNodeId)
      if (projection.run.finishedAt !== undefined) item.finishedAt = projection.run.finishedAt
      return item
    })
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
  const topologyContext = buildTopologyRoutingContext(run, run.orchestrationPlanSnapshot)
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
    requestIdentity: requestIdentityFrom(run),
    generatedAt: now,
    orchestrationMode: run.orchestrationMode ?? "single_nobie",
    topologyRouting: topologyContext.routing,
    plan: planProjection(run.orchestrationPlanSnapshot, topologyContext),
    subSessions,
    dataExchanges: collectDataExchanges(subSessionContracts, now),
    approvals,
    timeline: collectTimeline(run, orchestrationEvents, ledgerEvents, limit),
    topologyRuns: collectTopologyRuns(run, limit),
    finalizer: finalizerFromLedger(ledgerEvents),
    redaction: {
      payloadsRedacted: true,
      rawPayloadVisible: false,
    },
  }
}
