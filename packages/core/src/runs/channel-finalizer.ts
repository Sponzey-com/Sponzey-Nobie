import type { SubAgentResultReview } from "../agent/sub-agent-result-review.js"
import { decideSubSessionCompletionIntegration } from "../agent/sub-agent-result-review.js"
import { CONTRACT_SCHEMA_VERSION, type JsonValue } from "../contracts/index.js"
import {
  type NamedDeliveryEvent,
  type NicknameSnapshot,
  type ResultReport,
  type RuntimeIdentity,
  type UserVisibleAgentMessage,
  normalizeNicknameSnapshot,
  validateNamedDeliveryEvent,
  validateUserVisibleAgentMessage,
} from "../contracts/sub-agent-orchestration.js"
import { type DbMessageLedgerEvent, listMessageLedgerEvents } from "../db/index.js"
import { recordOrchestrationEvent } from "../orchestration/event-ledger.js"
import {
  type AssistantTextDeliveryOutcome,
  type RunChunkDeliveryHandler,
  emitAssistantTextDelivery,
  resolveAssistantTextDeliveryOutcome,
} from "./delivery.js"
import { hashLedgerValue, recordMessageLedgerEvent } from "./message-ledger.js"

export type FinalDeliverySource = "webui" | "cli" | "telegram" | "slack"
export type FinalDeliveryStatus =
  | "delivered"
  | "duplicate_suppressed"
  | "blocked"
  | "delivery_failed"

export type FinalizerApprovalStatus =
  | "requested"
  | "approved"
  | "approved_once"
  | "approved_run"
  | "consumed"
  | "denied"
  | "expired"
  | "superseded"

export interface FinalizerApprovalState {
  approvalId: string
  status: FinalizerApprovalStatus
  subSessionId?: string
  agentId?: string
  summary?: string
  reasonCode?: string
}

export interface FinalizerReviewState {
  subSessionId: string
  review: Pick<SubAgentResultReview, "accepted" | "normalizedFailureKey"> &
    Partial<Pick<SubAgentResultReview, "verdict" | "parentIntegrationStatus">>
}

export interface FinalDeliveryAttribution {
  resultReportId: string
  subSessionId: string
  source: NicknameSnapshot
  summary: string
}

export interface FinalDeliveryCommitResult {
  status: FinalDeliveryStatus
  idempotencyKey: string
  deliveryKey: string
  text: string
  attributions: FinalDeliveryAttribution[]
  reasonCodes: string[]
  existingEventId?: string
  deliveryOutcome?: AssistantTextDeliveryOutcome
}

export interface PendingFinalizerRestoreItem {
  parentRunId: string
  requestGroupId: string | null
  sessionKey: string | null
  channel: string
  deliveryKey: string
  generatedEventId: string
  generatedAt: number
  safeToAutoDeliver: false
  duplicateRisk: true
}

export interface ApprovalAggregationResult {
  eventId: string | null
  text: string
  pendingApprovalIds: string[]
  blockedApprovalIds: string[]
  approvedApprovalIds: string[]
}

const NOBIE_SPEAKER: NicknameSnapshot = {
  entityType: "nobie",
  entityId: "agent:nobie",
  nicknameSnapshot: "노비",
}

function finalDeliveryKey(parentRunId: string): string {
  return `final:${parentRunId}`
}

function finalDeliveryIdempotencyKey(parentRunId: string): string {
  return `final-delivery:${parentRunId}`
}

function normalizeSpeaker(speaker: NicknameSnapshot | undefined): NicknameSnapshot {
  if (!speaker) return NOBIE_SPEAKER
  const nicknameSnapshot = normalizeNicknameSnapshot(speaker.nicknameSnapshot)
  return nicknameSnapshot ? { ...speaker, nicknameSnapshot } : NOBIE_SPEAKER
}

function recordOrchestrationEventSafely(
  input: Parameters<typeof recordOrchestrationEvent>[0],
): void {
  try {
    recordOrchestrationEvent(input)
  } catch {
    // Finalizer orchestration events are durable telemetry, not delivery control flow.
  }
}

function identity(input: {
  entityType: RuntimeIdentity["entityType"]
  entityId: string
  parentRunId: string
  idempotencyKey: string
}): RuntimeIdentity {
  return {
    schemaVersion: CONTRACT_SCHEMA_VERSION,
    entityType: input.entityType,
    entityId: input.entityId,
    owner: { ownerType: "nobie", ownerId: "agent:nobie" },
    idempotencyKey: input.idempotencyKey,
    parent: { parentRunId: input.parentRunId },
  }
}

function eventSucceeded(event: DbMessageLedgerEvent | undefined): boolean {
  return Boolean(
    event &&
      (event.status === "delivered" || event.status === "succeeded" || event.status === "sent"),
  )
}

function outputSummary(report: ResultReport): string {
  const values = report.outputs
    .map((output) => output.value)
    .filter((value): value is JsonValue => value !== undefined)
  const text = values.find((value) => typeof value === "string")
  if (typeof text === "string" && text.trim()) return text.trim()
  const first = values[0]
  if (first !== undefined) return JSON.stringify(first).slice(0, 240)
  return report.status
}

export function buildFinalDeliveryAttributions(
  resultReports: readonly ResultReport[] = [],
): FinalDeliveryAttribution[] {
  const attributions: FinalDeliveryAttribution[] = []
  const seen = new Set<string>()
  for (const report of resultReports) {
    if (!report.source) continue
    const source = normalizeSpeaker(report.source)
    const key = `${report.resultReportId}:${source.entityId}:${source.nicknameSnapshot}`
    if (seen.has(key)) continue
    seen.add(key)
    attributions.push({
      resultReportId: report.resultReportId,
      subSessionId: report.subSessionId,
      source,
      summary: outputSummary(report),
    })
  }
  return attributions
}

export function buildNobieFinalAnswer(input: {
  text: string
  resultReports?: readonly ResultReport[]
}): { text: string; attributions: FinalDeliveryAttribution[] } {
  const text = input.text.trim()
  const attributions = buildFinalDeliveryAttributions(input.resultReports)
  if (attributions.length === 0) return { text, attributions }
  const lines = attributions.map((item) => `- ${item.source.nicknameSnapshot}: ${item.summary}`)
  return {
    text: [text, `참고한 서브 에이전트 결과:\n${lines.join("\n")}`].filter(Boolean).join("\n\n"),
    attributions,
  }
}

export function findCommittedFinalDelivery(parentRunId: string): DbMessageLedgerEvent | undefined {
  return listMessageLedgerEvents({ runId: parentRunId, limit: 1000 }).find(
    (event) =>
      event.delivery_key === finalDeliveryKey(parentRunId) &&
      event.event_kind === "final_answer_delivered" &&
      eventSucceeded(event),
  )
}

function blockingApprovalReasonCodes(approvals: readonly FinalizerApprovalState[]): string[] {
  const blocking = approvals.filter(
    (approval) =>
      approval.status === "requested" ||
      approval.status === "denied" ||
      approval.status === "expired" ||
      approval.status === "superseded",
  )
  return blocking.map((approval) => `approval_${approval.status}:${approval.approvalId}`)
}

function commitBlocked(input: {
  parentRunId: string
  sessionId: string
  source: FinalDeliverySource
  deliveryKey: string
  idempotencyKey: string
  text: string
  attributions: FinalDeliveryAttribution[]
  reasonCodes: string[]
  summary: string
  speaker: NicknameSnapshot
}): FinalDeliveryCommitResult {
  const blockedHash = hashLedgerValue({
    parentRunId: input.parentRunId,
    deliveryKey: input.deliveryKey,
    reasonCodes: input.reasonCodes,
  })
  recordMessageLedgerEvent({
    runId: input.parentRunId,
    sessionKey: input.sessionId,
    channel: input.source,
    eventKind: "final_answer_suppressed",
    deliveryKind: "final",
    deliveryKey: input.deliveryKey,
    idempotencyKey: `${input.idempotencyKey}:blocked:${blockedHash}`,
    status: "suppressed",
    summary: input.summary,
    detail: {
      reasonCodes: input.reasonCodes,
      speaker: input.speaker,
      sourceAttributions: input.attributions,
    },
  })
  return {
    status: "blocked",
    idempotencyKey: input.idempotencyKey,
    deliveryKey: input.deliveryKey,
    text: input.text,
    attributions: input.attributions,
    reasonCodes: input.reasonCodes,
  }
}

export async function commitFinalDelivery(input: {
  parentRunId: string
  sessionId: string
  source: FinalDeliverySource
  text: string
  onChunk: RunChunkDeliveryHandler | undefined
  speaker?: NicknameSnapshot
  resultReports?: readonly ResultReport[]
  reviews?: readonly FinalizerReviewState[]
  approvals?: readonly FinalizerApprovalState[]
  deliveryDependencies?: NonNullable<
    Parameters<typeof emitAssistantTextDelivery>[0]["dependencies"]
  >
  onDeliveryError?: (message: string) => void
}): Promise<FinalDeliveryCommitResult> {
  const speaker = normalizeSpeaker(input.speaker)
  const answer = buildNobieFinalAnswer({
    text: input.text,
    ...(input.resultReports ? { resultReports: input.resultReports } : {}),
  })
  const deliveryKey = finalDeliveryKey(input.parentRunId)
  const idempotencyKey = finalDeliveryIdempotencyKey(input.parentRunId)
  const reasonCodes: string[] = []

  if (!answer.text.trim()) reasonCodes.push("final_answer_empty")

  const integration = input.reviews
    ? decideSubSessionCompletionIntegration([...input.reviews])
    : undefined
  if (integration && !integration.finalDeliveryAllowed) {
    reasonCodes.push(...integration.reasonCodes)
  }
  reasonCodes.push(...blockingApprovalReasonCodes(input.approvals ?? []))

  if (reasonCodes.length > 0) {
    return commitBlocked({
      parentRunId: input.parentRunId,
      sessionId: input.sessionId,
      source: input.source,
      deliveryKey,
      idempotencyKey,
      text: answer.text,
      attributions: answer.attributions,
      reasonCodes,
      summary: "최종 응답 전송이 finalizer 입력 검증에서 차단되었습니다.",
      speaker,
    })
  }

  const existing = findCommittedFinalDelivery(input.parentRunId)
  if (existing) {
    const duplicateHash = hashLedgerValue({
      parentRunId: input.parentRunId,
      deliveryKey,
      existingEventId: existing.id,
    })
    recordMessageLedgerEvent({
      runId: input.parentRunId,
      sessionKey: input.sessionId,
      channel: input.source,
      eventKind: "final_answer_suppressed",
      deliveryKind: "final",
      deliveryKey,
      idempotencyKey: `${idempotencyKey}:duplicate:${duplicateHash}`,
      status: "suppressed",
      summary: "이미 커밋된 최종 응답이 있어 중복 전송을 억제했습니다.",
      detail: {
        committedLedgerEventId: existing.id,
        committedAt: existing.created_at,
        speaker,
        sourceAttributions: answer.attributions,
      },
    })
    return {
      status: "duplicate_suppressed",
      idempotencyKey,
      deliveryKey,
      text: answer.text,
      attributions: answer.attributions,
      reasonCodes: ["final_delivery_already_committed"],
      existingEventId: existing.id,
    }
  }

  const visibleMessage: UserVisibleAgentMessage = {
    identity: identity({
      entityType: "nobie",
      entityId: `final-message:${input.parentRunId}`,
      parentRunId: input.parentRunId,
      idempotencyKey: `final-message:${input.parentRunId}`,
    }),
    messageId: `final-message:${input.parentRunId}`,
    parentRunId: input.parentRunId,
    speaker,
    text: answer.text,
    createdAt: Date.now(),
  }
  const visibleValidation = validateUserVisibleAgentMessage(visibleMessage)
  if (!visibleValidation.ok) {
    return commitBlocked({
      parentRunId: input.parentRunId,
      sessionId: input.sessionId,
      source: input.source,
      deliveryKey,
      idempotencyKey,
      text: answer.text,
      attributions: answer.attributions,
      reasonCodes: visibleValidation.issues.map((issue) => issue.path),
      summary: "최종 응답 발화자 스냅샷 검증에 실패했습니다.",
      speaker,
    })
  }

  recordMessageLedgerEvent({
    runId: input.parentRunId,
    sessionKey: input.sessionId,
    channel: input.source,
    eventKind: "final_answer_generated",
    deliveryKind: "final",
    deliveryKey,
    idempotencyKey: `final-answer:${input.parentRunId}`,
    status: "generated",
    summary: "parent finalizer가 최종 응답을 생성했습니다.",
    detail: {
      textLength: answer.text.length,
      speaker,
      sourceAttributions: answer.attributions,
      integration,
    },
  })

  const receipt = await emitAssistantTextDelivery({
    runId: input.parentRunId,
    sessionId: input.sessionId,
    text: answer.text,
    source: input.source,
    onChunk: input.onChunk,
    deliveryKind: "final",
    speaker,
    sourceAttributions: answer.attributions,
    ...(input.onDeliveryError ? { onError: input.onDeliveryError } : {}),
    ...(input.deliveryDependencies ? { dependencies: input.deliveryDependencies } : {}),
  })
  const deliveryOutcome = resolveAssistantTextDeliveryOutcome(receipt)
  if (deliveryOutcome.hasDeliveryFailure) {
    return {
      status: "delivery_failed",
      idempotencyKey,
      deliveryKey,
      text: answer.text,
      attributions: answer.attributions,
      reasonCodes: [`delivery_${deliveryOutcome.failureStage}_failed`],
      deliveryOutcome,
    }
  }

  recordMessageLedgerEvent({
    runId: input.parentRunId,
    sessionKey: input.sessionId,
    channel: input.source,
    eventKind: "final_answer_delivered",
    deliveryKind: "final",
    deliveryKey,
    idempotencyKey,
    status: "delivered",
    summary: "parent finalizer가 최종 응답을 한 번 전달했습니다.",
    detail: {
      speaker,
      sourceAttributions: answer.attributions,
      textLength: answer.text.length,
    },
  })
  recordOrchestrationEventSafely({
    eventKind: "final_delivery_completed",
    runId: input.parentRunId,
    correlationId: input.parentRunId,
    dedupeKey: `orchestration:${idempotencyKey}`,
    source: "channel-finalizer",
    summary: "Parent finalizer committed final delivery.",
    payload: {
      deliveryKey,
      idempotencyKey,
      channel: input.source,
      speaker,
      sourceAttributions: answer.attributions,
    },
  })
  for (const attribution of answer.attributions) {
    const namedDelivery = buildNamedResultDeliveryEvent({
      parentRunId: input.parentRunId,
      sender: attribution.source,
      recipient: speaker,
      resultReportId: attribution.resultReportId,
      summary: attribution.summary,
    })
    recordOrchestrationEventSafely({
      eventKind: "named_delivery_attributed",
      runId: input.parentRunId,
      subSessionId: attribution.subSessionId,
      correlationId: input.parentRunId,
      dedupeKey: `orchestration:named-delivery:${input.parentRunId}:${attribution.resultReportId}`,
      source: "channel-finalizer",
      summary: "Sub-agent result attribution was preserved in final delivery.",
      payload: { namedDelivery },
    })
  }

  return {
    status: "delivered",
    idempotencyKey,
    deliveryKey,
    text: answer.text,
    attributions: answer.attributions,
    reasonCodes: ["final_delivery_committed"],
    deliveryOutcome,
  }
}

export function buildNamedResultDeliveryEvent(input: {
  parentRunId: string
  sender: NicknameSnapshot
  recipient: NicknameSnapshot
  resultReportId: string
  summary: string
}): NamedDeliveryEvent {
  const event: NamedDeliveryEvent = {
    identity: identity({
      entityType: "data_exchange",
      entityId: `named-delivery:${input.resultReportId}`,
      parentRunId: input.parentRunId,
      idempotencyKey: `named-delivery:${input.parentRunId}:${input.resultReportId}`,
    }),
    deliveryId: `named-delivery:${input.resultReportId}`,
    parentRunId: input.parentRunId,
    deliveryKind: "result_report",
    sender: normalizeSpeaker(input.sender),
    recipient: normalizeSpeaker(input.recipient),
    summary: input.summary,
    resultReportId: input.resultReportId,
    createdAt: Date.now(),
  }
  const validation = validateNamedDeliveryEvent(event)
  if (!validation.ok) {
    throw new Error(
      `invalid named delivery event: ${validation.issues.map((issue) => issue.path).join(",")}`,
    )
  }
  return event
}

export function recordApprovalAggregation(input: {
  parentRunId: string
  sessionId: string
  source: FinalDeliverySource
  approvals: readonly FinalizerApprovalState[]
  speaker?: NicknameSnapshot
}): ApprovalAggregationResult {
  const speaker = normalizeSpeaker(input.speaker)
  const pendingApprovalIds = input.approvals
    .filter((approval) => approval.status === "requested")
    .map((approval) => approval.approvalId)
  const blockedApprovalIds = input.approvals
    .filter(
      (approval) =>
        approval.status === "denied" ||
        approval.status === "expired" ||
        approval.status === "superseded",
    )
    .map((approval) => approval.approvalId)
  const approvedApprovalIds = input.approvals
    .filter(
      (approval) =>
        approval.status === "approved" ||
        approval.status === "approved_once" ||
        approval.status === "approved_run" ||
        approval.status === "consumed",
    )
    .map((approval) => approval.approvalId)
  const text = [
    `${speaker.nicknameSnapshot} 승인 요청 요약`,
    ...input.approvals.map(
      (approval) =>
        `- ${approval.approvalId}: ${approval.status}${approval.summary ? ` - ${approval.summary}` : ""}`,
    ),
  ].join("\n")
  const eventId = recordMessageLedgerEvent({
    runId: input.parentRunId,
    sessionKey: input.sessionId,
    channel: input.source,
    eventKind: "approval_aggregated",
    deliveryKind: "approval",
    deliveryKey: `approval:${input.parentRunId}:${input.approvals.map((item) => item.approvalId).join(",")}`,
    idempotencyKey: `approval-aggregation:${input.parentRunId}:${input.approvals.map((item) => item.approvalId).join(",")}`,
    status:
      blockedApprovalIds.length > 0
        ? "failed"
        : pendingApprovalIds.length > 0
          ? "pending"
          : "succeeded",
    summary: "여러 승인 요청을 사용자-facing 요약으로 집계했습니다.",
    detail: {
      speaker,
      approvals: input.approvals,
      pendingApprovalIds,
      blockedApprovalIds,
      approvedApprovalIds,
      text,
    },
  })
  recordOrchestrationEventSafely({
    eventKind: "approval_requested",
    runId: input.parentRunId,
    correlationId: input.parentRunId,
    dedupeKey: `orchestration:approval-aggregation:${input.parentRunId}:${input.approvals.map((item) => item.approvalId).join(",")}`,
    source: "channel-finalizer",
    summary: "Approval requests were aggregated for the parent finalizer.",
    payload: {
      speaker,
      approvals: input.approvals,
      pendingApprovalIds,
      blockedApprovalIds,
      approvedApprovalIds,
    },
  })
  return { eventId, text, pendingApprovalIds, blockedApprovalIds, approvedApprovalIds }
}

export function listPendingFinalizers(
  input: {
    runId?: string
    requestGroupId?: string
    limit?: number
  } = {},
): PendingFinalizerRestoreItem[] {
  const events = listMessageLedgerEvents({
    ...(input.runId ? { runId: input.runId } : {}),
    ...(input.requestGroupId ? { requestGroupId: input.requestGroupId } : {}),
    limit: input.limit ?? 1000,
  })
  const deliveredKeys = new Set(
    events
      .filter((event) => event.event_kind === "final_answer_delivered" && eventSucceeded(event))
      .map((event) => event.delivery_key)
      .filter((value): value is string => Boolean(value)),
  )
  return events
    .filter(
      (event) =>
        event.event_kind === "final_answer_generated" &&
        event.delivery_key &&
        !deliveredKeys.has(event.delivery_key),
    )
    .map((event) => ({
      parentRunId: event.run_id ?? "",
      requestGroupId: event.request_group_id,
      sessionKey: event.session_key,
      channel: event.channel,
      deliveryKey: event.delivery_key ?? "",
      generatedEventId: event.id,
      generatedAt: event.created_at,
      safeToAutoDeliver: false as const,
      duplicateRisk: true as const,
    }))
    .filter((item) => item.parentRunId && item.deliveryKey)
}

export function recordLateResultNoReply(input: {
  parentRunId: string
  subSessionId: string
  agentId?: string
  resultReportId: string
  reasonCode?: string
}): void {
  recordOrchestrationEventSafely({
    eventKind: "result_reported",
    runId: input.parentRunId,
    subSessionId: input.subSessionId,
    ...(input.agentId ? { agentId: input.agentId } : {}),
    correlationId: input.parentRunId,
    dedupeKey: `orchestration:late-result:${input.parentRunId}:${input.subSessionId}:${input.resultReportId}`,
    source: "channel-finalizer",
    summary: "Late child result was retained without a user-facing reply.",
    payload: {
      resultReportId: input.resultReportId,
      lateResultPolicy: "no_reply",
      reasonCode: input.reasonCode ?? "parent_finalized",
    },
  })
}
