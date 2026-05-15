import { commitFinalDelivery } from "./channel-finalizer.js"
import type { ChannelSource } from "../channels/contracts.js"
import {
  type RunChunkDeliveryHandler,
  emitAssistantTextDelivery,
  resolveAssistantTextDeliveryOutcome,
} from "./delivery.js"
import { recordMessageLedgerEvent } from "./message-ledger.js"
import {
  describeAssistantTextDeliveryFailure,
  summarizeRawErrorActionHintForUser,
  summarizeRawErrorForUser,
} from "./recovery.js"
import type { RunStatus, RunStepStatus } from "./types.js"

export type FinalizationSource = ChannelSource

export type FinalValidationMode = "general" | "current_fact"
export type FinalValidationScope = "parent_finalizer"
export type FinalValidationValueConfidence =
  | "verified"
  | "candidate"
  | "unverified"
  | "conflict"

export interface FinalValidationRequiredValue {
  valueId: string
  label: string
  required: boolean
}

export interface FinalValidationObservedValue {
  valueId: string
  label?: string
  value?: string
  unit?: string
  confidence: FinalValidationValueConfidence
  sourceId?: string
  sourceLabel?: string
  sourceUrl?: string
  sourceDomain?: string
  sourceTimestamp?: string | null
  fetchTimestamp?: string | null
  basisTime?: string | null
  conflicts?: string[]
}

export interface FinalValidationMissingValue {
  valueId: string
  label: string
  reasonCode: string
}

export interface FinalValidationSourceRef {
  sourceId: string
  sourceLabel?: string
  sourceUrl?: string
  sourceDomain?: string
  sourceTimestamp?: string | null
  fetchTimestamp?: string | null
  reliability?: string
  role?: string
  status?: string
}

export interface FinalValidationConflict {
  valueId?: string
  summary: string
  sourceIds?: string[]
  selectionBasis?: string
}

export interface FinalValidationInput {
  mode: FinalValidationMode
  validationScope?: FinalValidationScope
  requiredValues?: FinalValidationRequiredValue[]
  observedValues?: FinalValidationObservedValue[]
  missingValues?: FinalValidationMissingValue[]
  sourceList?: FinalValidationSourceRef[]
  sourceTimestamps?: string[]
  conflicts?: FinalValidationConflict[]
  reasonCodes?: string[]
  basisTime?: string | null
  recoveryAvailable?: boolean
  safeAlternativesExhausted?: boolean
}

export type FinalValidationStatus =
  | "ready"
  | "needs_recovery"
  | "limited_failure_allowed"

export interface FinalValidationTrace {
  mode: FinalValidationMode
  validationScope: FinalValidationScope
  requiredValues: FinalValidationRequiredValue[]
  observedValues: FinalValidationObservedValue[]
  missingValues: FinalValidationMissingValue[]
  sourceList: FinalValidationSourceRef[]
  sourceTimestamps: string[]
  conflicts: FinalValidationConflict[]
  reasonCodes: string[]
  basisTime?: string | null
  recoveryAvailable: boolean
  safeAlternativesExhausted: boolean
}

export interface FinalValidationDecision {
  status: FinalValidationStatus
  finalDeliveryAllowed: boolean
  reasonCodes: string[]
  summary: string
  trace: FinalValidationTrace
}

export interface FinalizationOutcome {
  status: "completed" | "blocked_by_final_validation"
  finalValidation?: FinalValidationDecision
}

export interface AwaitingUserParams {
  preview: string
  summary: string
  reason?: string
  rawMessage?: string
  userMessage?: string
  remainingItems?: string[]
}

export interface FinalizationDependencies {
  appendRunEvent: (runId: string, message: string) => void
  setRunStepStatus: (runId: string, step: string, status: RunStepStatus, summary: string) => unknown
  updateRunStatus: (runId: string, status: RunStatus, summary: string, active: boolean) => unknown
  rememberRunSuccess: (params: {
    runId: string
    sessionId: string
    source: FinalizationSource
    text: string
    summary: string
  }) => void
  rememberRunFailure: (params: {
    runId: string
    sessionId: string
    source: FinalizationSource
    summary: string
    detail?: string
    title?: string
  }) => void
  onDeliveryError?: (message: string) => void
  deliveryDependencies?: NonNullable<
    Parameters<typeof emitAssistantTextDelivery>[0]["dependencies"]
  >
}

function nonEmpty(value: string | null | undefined): string | undefined {
  const normalized = value?.trim()
  return normalized ? normalized : undefined
}

function uniqueStrings(values: Array<string | null | undefined>): string[] {
  return [...new Set(values.map((value) => nonEmpty(value)).filter((value): value is string => Boolean(value)))]
}

function deriveMissingRequiredValues(input: FinalValidationInput): FinalValidationMissingValue[] {
  const explicitMissing = input.missingValues ?? []
  const explicitlyMissingValueIds = new Set(explicitMissing.map((value) => value.valueId))
  const observedVerified = new Set(
    (input.observedValues ?? [])
      .filter((value) => value.confidence === "verified")
      .map((value) => value.valueId),
  )
  const derivedMissing = (input.requiredValues ?? [])
    .filter((value) =>
      value.required &&
      !observedVerified.has(value.valueId) &&
      !explicitlyMissingValueIds.has(value.valueId)
    )
    .map((value) => ({
      valueId: value.valueId,
      label: value.label,
      reasonCode: "required_value_not_observed",
    }))
  const byKey = new Map<string, FinalValidationMissingValue>()
  for (const item of [...explicitMissing, ...derivedMissing]) {
    byKey.set(`${item.valueId}:${item.reasonCode}`, item)
  }
  return [...byKey.values()]
}

function currentFactSourceIssues(input: FinalValidationInput): string[] {
  if (input.mode !== "current_fact") return []
  const issues: string[] = []
  const sourceIds = new Set((input.sourceList ?? []).map((source) => source.sourceId))
  for (const value of input.observedValues ?? []) {
    if (value.confidence !== "verified") continue
    if (!value.sourceId && !value.sourceUrl && !value.sourceDomain && !value.sourceLabel) {
      issues.push(`missing_source_reference:${value.valueId}`)
      continue
    }
    if (value.sourceId && sourceIds.size > 0 && !sourceIds.has(value.sourceId)) {
      issues.push(`source_not_in_trace:${value.valueId}:${value.sourceId}`)
    }
    if (!value.sourceTimestamp && !value.fetchTimestamp && !value.basisTime && !input.basisTime) {
      issues.push(`missing_basis_time:${value.valueId}`)
    }
  }
  if ((input.observedValues ?? []).some((value) => value.confidence === "verified") && (input.sourceList ?? []).length === 0) {
    issues.push("missing_source_list")
  }
  return uniqueStrings(issues)
}

export function validateAndFinalize(input: FinalValidationInput): FinalValidationDecision {
  const requiredValues = input.requiredValues ?? []
  const observedValues = input.observedValues ?? []
  const missingValues = deriveMissingRequiredValues(input)
  const sourceList = input.sourceList ?? []
  const observedSourceTimestamps = observedValues.flatMap((value) => [
    value.sourceTimestamp ?? undefined,
    value.fetchTimestamp ?? undefined,
    value.basisTime ?? undefined,
  ])
  const sourceTimestamps = uniqueStrings([
    ...(input.sourceTimestamps ?? []),
    ...sourceList.flatMap((source) => [source.sourceTimestamp ?? undefined, source.fetchTimestamp ?? undefined]),
    ...observedSourceTimestamps,
    input.basisTime ?? undefined,
  ])
  const observedConflicts: FinalValidationConflict[] = observedValues.flatMap((value) =>
    (value.conflicts ?? []).map((summary) => ({
      valueId: value.valueId,
      summary,
      ...(value.sourceId ? { sourceIds: [value.sourceId] } : {}),
    })),
  )
  const conflicts = [...(input.conflicts ?? []), ...observedConflicts]
  const sourceIssues = currentFactSourceIssues(input)
  const safeAlternativesExhausted = input.safeAlternativesExhausted === true
  const hasValidationIssue =
    missingValues.length > 0 || conflicts.length > 0 || sourceIssues.length > 0
  const recoveryAvailable =
    input.recoveryAvailable === true || (hasValidationIssue && !safeAlternativesExhausted)
  const baseReasonCodes = uniqueStrings([
    ...(input.reasonCodes ?? []),
    ...missingValues.map((value) => value.reasonCode),
    ...conflicts.map(() => "source_conflict"),
    ...sourceIssues,
  ])

  let status: FinalValidationStatus = "ready"
  let finalDeliveryAllowed = true
  const needsRecovery =
    recoveryAvailable &&
    hasValidationIssue
  if (needsRecovery) {
    status = "needs_recovery"
    finalDeliveryAllowed = false
  } else if (hasValidationIssue) {
    status = "limited_failure_allowed"
  }

  const reasonCodes = uniqueStrings([
    ...baseReasonCodes,
    status === "ready" ? "final_validation_ready" : undefined,
    status === "needs_recovery" ? "final_validation_requires_recovery" : undefined,
    status === "limited_failure_allowed" ? "safe_alternatives_exhausted" : undefined,
  ])
  const trace: FinalValidationTrace = {
    mode: input.mode,
    validationScope: input.validationScope ?? "parent_finalizer",
    requiredValues,
    observedValues,
    missingValues,
    sourceList,
    sourceTimestamps,
    conflicts,
    reasonCodes,
    ...(input.basisTime ? { basisTime: input.basisTime } : {}),
    recoveryAvailable,
    safeAlternativesExhausted,
  }
  const summary = finalDeliveryAllowed
    ? status === "ready"
      ? "최종 검증을 통과했습니다."
      : "안전한 대체 경로가 소진되어 제한된 최종 설명을 허용합니다."
    : "필수 값, 출처, 충돌 검증이 끝나지 않아 최종 전달을 보류합니다."

  return {
    status,
    finalDeliveryAllowed,
    reasonCodes,
    summary,
    trace,
  }
}

export class ValidateAndFinalize {
  decide(input: FinalValidationInput): FinalValidationDecision {
    return validateAndFinalize(input)
  }
}

function recordFinalValidationEvaluation(params: {
  runId: string
  sessionId: string
  source: FinalizationSource
  decision: FinalValidationDecision
}): void {
  recordMessageLedgerEvent({
    runId: params.runId,
    sessionKey: params.sessionId,
    channel: params.source,
    eventKind: "final_validation_evaluated",
    deliveryKind: "final",
    idempotencyKey: `final-validation:${params.runId}:${params.decision.status}`,
    status: params.decision.finalDeliveryAllowed ? "succeeded" : "pending",
    summary: params.decision.summary,
    detail: {
      status: params.decision.status,
      finalDeliveryAllowed: params.decision.finalDeliveryAllowed,
      reasonCodes: params.decision.reasonCodes,
      trace: params.decision.trace,
    },
  })
}

export function markRunCompleted(params: {
  runId: string
  sessionId: string
  source: FinalizationSource
  text: string
  summary: string
  executingSummary?: string
  reviewingSummary?: string
  finalizingSummary?: string
  completedSummary?: string
  eventLabel?: string
  dependencies: FinalizationDependencies
}): void {
  const executingSummary = params.executingSummary ?? params.text ?? "응답 생성을 마쳤습니다."
  const completedSummary = params.completedSummary ?? params.text ?? "실행을 완료했습니다."

  params.dependencies.rememberRunSuccess({
    runId: params.runId,
    sessionId: params.sessionId,
    source: params.source,
    text: params.text,
    summary: params.summary,
  })
  params.dependencies.setRunStepStatus(params.runId, "executing", "completed", executingSummary)
  params.dependencies.setRunStepStatus(
    params.runId,
    "reviewing",
    "completed",
    params.reviewingSummary ?? params.summary,
  )
  params.dependencies.setRunStepStatus(
    params.runId,
    "finalizing",
    "completed",
    params.finalizingSummary ?? "실행 결과를 저장했습니다.",
  )
  params.dependencies.setRunStepStatus(params.runId, "completed", "completed", completedSummary)
  params.dependencies.updateRunStatus(params.runId, "completed", completedSummary, false)
  params.dependencies.appendRunEvent(params.runId, params.eventLabel ?? "실행 완료")
}

export async function completeRunWithAssistantMessage(params: {
  runId: string
  sessionId: string
  text: string
  source: FinalizationSource
  onChunk: RunChunkDeliveryHandler | undefined
  suppressFinalDelivery?: boolean
  suppressFinalDeliveryReasonCode?: string
  finalValidation?: FinalValidationInput
  dependencies: FinalizationDependencies
}): Promise<FinalizationOutcome> {
  if (params.finalValidation) {
    const finalValidation = validateAndFinalize(params.finalValidation)
    recordFinalValidationEvaluation({
      runId: params.runId,
      sessionId: params.sessionId,
      source: params.source,
      decision: finalValidation,
    })
    if (!finalValidation.finalDeliveryAllowed) {
      params.dependencies.setRunStepStatus(
        params.runId,
        "reviewing",
        "running",
        finalValidation.summary,
      )
      params.dependencies.setRunStepStatus(
        params.runId,
        "finalizing",
        "pending",
        "최종 전달 전 검증이 보류되었습니다.",
      )
      params.dependencies.updateRunStatus(params.runId, "running", finalValidation.summary, true)
      params.dependencies.appendRunEvent(
        params.runId,
        `final_validation_blocked:${finalValidation.reasonCodes.join("+")}`,
      )
      return { status: "blocked_by_final_validation", finalValidation }
    }
    params.dependencies.appendRunEvent(
      params.runId,
      `final_validation_${finalValidation.status}:${finalValidation.reasonCodes.join("+")}`,
    )
  }

  if (params.text && params.suppressFinalDelivery) {
    const reasonCode =
      params.suppressFinalDeliveryReasonCode ?? "child_result_parent_aggregation_required"
    recordMessageLedgerEvent({
      runId: params.runId,
      sessionKey: params.sessionId,
      channel: params.source,
      eventKind: "final_answer_suppressed",
      deliveryKind: "final",
      deliveryKey: `final-suppressed:${params.runId}`,
      idempotencyKey: `final-answer-suppressed:${params.runId}:${reasonCode}`,
      status: "suppressed",
      summary: "하위 실행의 최종 채널 응답을 차단하고 상위 검증/취합으로 넘겼습니다.",
      detail: {
        reasonCode,
        textLength: params.text.trim().length,
        parentAggregationRequired: true,
      },
    })
    params.dependencies.appendRunEvent(params.runId, `child_final_delivery_suppressed:${reasonCode}`)
  } else if (params.text) {
    const finalDelivery = await commitFinalDelivery({
      parentRunId: params.runId,
      sessionId: params.sessionId,
      text: params.text,
      source: params.source,
      onChunk: params.onChunk,
      ...(params.dependencies.onDeliveryError
        ? { onDeliveryError: params.dependencies.onDeliveryError }
        : {}),
      ...(params.dependencies.deliveryDependencies
        ? { deliveryDependencies: params.dependencies.deliveryDependencies }
        : {}),
    })
    if (finalDelivery.deliveryOutcome?.hasDeliveryFailure) {
      params.dependencies.appendRunEvent(
        params.runId,
        describeAssistantTextDeliveryFailure({
          source: params.source,
          outcome: finalDelivery.deliveryOutcome,
        }),
      )
    }
  }

  const fallbackText = params.text || "실행을 완료했습니다."
  markRunCompleted({
    runId: params.runId,
    sessionId: params.sessionId,
    source: params.source,
    text: params.text,
    summary: fallbackText,
    reviewingSummary: params.text || "응답을 정리했습니다.",
    dependencies: params.dependencies,
  })
  return { status: "completed", ...(params.finalValidation ? { finalValidation: validateAndFinalize(params.finalValidation) } : {}) }
}

export async function emitStandaloneAssistantMessage(params: {
  runId: string
  sessionId: string
  text: string
  source: FinalizationSource
  onChunk: RunChunkDeliveryHandler | undefined
  dependencies: Pick<
    FinalizationDependencies,
    "appendRunEvent" | "onDeliveryError" | "deliveryDependencies"
  >
}): Promise<void> {
  if (!params.text.trim()) return
  const deliveryReceipt = await emitAssistantTextDelivery({
    runId: params.runId,
    sessionId: params.sessionId,
    text: params.text,
    source: params.source,
    onChunk: params.onChunk,
    deliveryKind: "progress",
    ...(params.dependencies.onDeliveryError
      ? { onError: params.dependencies.onDeliveryError }
      : {}),
    ...(params.dependencies.deliveryDependencies
      ? { dependencies: params.dependencies.deliveryDependencies }
      : {}),
  })
  const deliveryOutcome = resolveAssistantTextDeliveryOutcome(deliveryReceipt)
  if (deliveryOutcome.hasDeliveryFailure) {
    params.dependencies.appendRunEvent(
      params.runId,
      describeAssistantTextDeliveryFailure({ source: params.source, outcome: deliveryOutcome }),
    )
  }
}

export async function moveRunToAwaitingUser(params: {
  runId: string
  sessionId: string
  source: FinalizationSource
  onChunk: RunChunkDeliveryHandler | undefined
  awaitingUser: AwaitingUserParams
  dependencies: FinalizationDependencies
}): Promise<void> {
  const message = buildAwaitingUserMessage(params.awaitingUser)
  if (message) {
    await emitStandaloneAssistantMessage({
      runId: params.runId,
      sessionId: params.sessionId,
      text: message,
      source: params.source,
      onChunk: params.onChunk,
      dependencies: params.dependencies,
    })
  }

  const summary = params.awaitingUser.summary || "추가 입력이 필요해 자동 진행을 멈췄습니다."
  params.dependencies.setRunStepStatus(params.runId, "reviewing", "completed", summary)
  params.dependencies.setRunStepStatus(params.runId, "awaiting_user", "running", summary)
  params.dependencies.updateRunStatus(params.runId, "awaiting_user", summary, true)
  params.dependencies.appendRunEvent(params.runId, "사용자 추가 입력 대기")
}

export async function moveRunToCancelledAfterStop(params: {
  runId: string
  sessionId: string
  source: FinalizationSource
  onChunk: RunChunkDeliveryHandler | undefined
  cancellation: AwaitingUserParams
  dependencies: FinalizationDependencies
}): Promise<void> {
  const message = buildAwaitingUserMessage(params.cancellation)
  recordMessageLedgerEvent({
    runId: params.runId,
    sessionKey: params.sessionId,
    channel: params.source,
    eventKind: "recovery_stop_generated",
    idempotencyKey: `recovery-stop:${params.runId}:${params.cancellation.reason ?? params.cancellation.summary}`,
    status: "suppressed",
    summary: params.cancellation.summary || "자동 진행 중단 안내를 생성했습니다.",
    detail: {
      reason: params.cancellation.reason ?? null,
      remainingItems: params.cancellation.remainingItems ?? [],
    },
  })
  if (message) {
    await emitStandaloneAssistantMessage({
      runId: params.runId,
      sessionId: params.sessionId,
      text: message,
      source: params.source,
      onChunk: params.onChunk,
      dependencies: params.dependencies,
    })
  }

  const summary = params.cancellation.summary || "자동 진행을 중단하고 요청을 취소했습니다."
  params.dependencies.rememberRunFailure({
    runId: params.runId,
    sessionId: params.sessionId,
    source: params.source,
    summary,
    detail: buildCancelledAfterStopDetail(params.cancellation),
    title: "cancelled_after_stop",
  })
  params.dependencies.setRunStepStatus(params.runId, "reviewing", "completed", summary)
  params.dependencies.setRunStepStatus(
    params.runId,
    "finalizing",
    "completed",
    "중단 결과를 사용자에게 안내했습니다.",
  )
  params.dependencies.updateRunStatus(params.runId, "cancelled", summary, false)
  params.dependencies.appendRunEvent(params.runId, "자동 진행 중단 후 요청 취소")
}

export function buildAwaitingUserMessage(params: AwaitingUserParams): string {
  const remainingItems = params.remainingItems?.filter((item) => item.trim()) ?? []
  const lines = [
    params.userMessage?.trim() || params.summary.trim(),
    params.preview.trim() ? `현재까지 결과:\n${params.preview.trim()}` : "",
    remainingItems.length > 0 ? `남은 항목:\n- ${remainingItems.join("\n- ")}` : "",
    params.reason?.trim() ? `중단 사유: ${params.reason.trim()}` : "",
    summarizeRawErrorForUser(params.rawMessage)
      ? `오류 세부:\n${summarizeRawErrorForUser(params.rawMessage)}`
      : "",
    summarizeRawErrorActionHintForUser(params.rawMessage)
      ? `권장 조치:\n${summarizeRawErrorActionHintForUser(params.rawMessage)}`
      : "",
  ].filter(Boolean)

  return lines.join("\n\n")
}

function buildCancelledAfterStopDetail(params: AwaitingUserParams): string {
  return [
    params.reason,
    params.rawMessage,
    params.userMessage,
    params.preview,
    params.remainingItems?.join("\n"),
  ]
    .filter(Boolean)
    .join("\n")
}
