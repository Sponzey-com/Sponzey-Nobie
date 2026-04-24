import { commitFinalDelivery } from "./channel-finalizer.js"
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

export type FinalizationSource = "webui" | "cli" | "telegram" | "slack"

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
  dependencies: FinalizationDependencies
}): Promise<void> {
  if (params.text) {
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
