import crypto from "node:crypto"
import { homedir } from "node:os"
import { basename } from "node:path"
import type { AgentChunk } from "../agent/index.js"
import { recordArtifactMetadata, type ArtifactRetentionPolicy } from "../artifacts/lifecycle.js"
import { getTaskContinuity, hasArtifactReceipt, insertArtifactReceipt, insertDiagnosticEvent, insertMessage, upsertTaskContinuity } from "../db/index.js"
import { eventBus } from "../events/index.js"
import { sanitizeUserFacingError } from "./error-sanitizer.js"
import { getRootRun } from "./store.js"

export interface SuccessfulFileDelivery {
  toolName: string
  channel: "telegram" | "webui" | "slack"
  filePath: string
  url?: string
  previewUrl?: string
  downloadUrl?: string
  previewable?: boolean
  mimeType?: string
  sizeBytes?: number
  caption?: string
  messageId?: number
}

export interface SuccessfulTextDelivery {
  channel: DeliverySource
  text: string
  messageIds?: number[]
}

export interface ChunkDeliveryReceipt {
  artifactDeliveries?: SuccessfulFileDelivery[]
  textDeliveries?: SuccessfulTextDelivery[]
}

export interface DeliveryOutcome {
  mode?: "reply" | "direct_artifact" | "channel_message" | "none"
  directArtifactDeliveryRequested: boolean
  hasSuccessfulArtifactDelivery: boolean
  hasSuccessfulTextDelivery?: boolean
  textDeliverySatisfied?: boolean
  deliverySatisfied: boolean
  deliverySummary?: string
  requiresDirectArtifactRecovery: boolean
}

export type RunChunkDeliveryHandler =
  | ((chunk: AgentChunk) => Promise<ChunkDeliveryReceipt | void> | ChunkDeliveryReceipt | void)
  | undefined

export type DeliverySource = "webui" | "cli" | "telegram" | "slack"

export interface ArtifactDeliveryOnceParams<T> {
  runId?: string | undefined
  channel: SuccessfulFileDelivery["channel"]
  filePath: string
  channelTarget?: string | undefined
  mimeType?: string | undefined
  sizeBytes?: number | undefined
  retentionPolicy?: ArtifactRetentionPolicy | undefined
  force?: boolean | undefined
  forceReason?: string | undefined
  task: () => Promise<T>
}

export interface AssistantTextDeliveryReceipt {
  persisted: boolean
  textDelivered: boolean
  doneDelivered: boolean
}

export interface AssistantTextDeliveryOutcome {
  persisted: boolean
  textDelivered: boolean
  doneDelivered: boolean
  hasDeliveryFailure: boolean
  failureStage: "none" | "text" | "done" | "text_and_done"
  summary: string
}

interface AssistantTextDeliveryDependencies {
  now: () => number
  createId: () => string
  insertMessage: typeof insertMessage
  emitStart: (payload: { sessionId: string; runId: string }) => void
  emitStream: (payload: { sessionId: string; runId: string; delta: string }) => void
  emitEnd: (payload: { sessionId: string; runId: string; durationMs: number }) => void
  writeReplyLog: (source: DeliverySource, text: string) => void
}

const defaultAssistantTextDeliveryDependencies: AssistantTextDeliveryDependencies = {
  now: () => Date.now(),
  createId: () => crypto.randomUUID(),
  insertMessage,
  emitStart: (payload) => eventBus.emit("agent.start", payload),
  emitStream: (payload) => eventBus.emit("agent.stream", payload),
  emitEnd: (payload) => eventBus.emit("agent.end", payload),
  writeReplyLog: (source, text) => logAssistantReply(source, text),
}

const MAX_COMPLETED_ARTIFACT_DELIVERY_KEYS = 2_000
const activeArtifactDeliveryLocks = new Map<string, Promise<unknown>>()
const completedArtifactDeliveryKeys = new Map<string, number>()

export function buildArtifactDeliveryKey(params: {
  runId: string
  channel: SuccessfulFileDelivery["channel"]
  filePath: string
}): string {
  return `${params.runId}:${params.channel}:${params.filePath}`
}

function rememberCompletedArtifactDelivery(key: string): void {
  completedArtifactDeliveryKeys.set(key, Date.now())
  if (completedArtifactDeliveryKeys.size <= MAX_COMPLETED_ARTIFACT_DELIVERY_KEYS) return

  const oldestKey = completedArtifactDeliveryKeys.keys().next().value as string | undefined
  if (oldestKey) completedArtifactDeliveryKeys.delete(oldestKey)
}

export async function deliverArtifactOnce<T>(params: ArtifactDeliveryOnceParams<T>): Promise<T | undefined> {
  const runId = params.runId?.trim()
  if (!runId) return params.task()

  const key = buildArtifactDeliveryKey({
    runId,
    channel: params.channel,
    filePath: params.filePath,
  })
  if (!params.force && completedArtifactDeliveryKeys.has(key)) return undefined

  const run = getRootRun(runId)
  if (!params.force && run && hasArtifactReceipt({ runId, channel: params.channel, artifactPath: params.filePath })) {
    rememberCompletedArtifactDelivery(key)
    return undefined
  }
  if (!params.force && run) {
    const continuity = getTaskContinuity(run.requestGroupId)
    const deliveryReceipts = [
      `${params.channel}:${params.filePath}`,
      `${params.channel}:${displayHomePath(params.filePath)}`,
    ]
    if (continuity?.lastDeliveryReceipt && deliveryReceipts.includes(continuity.lastDeliveryReceipt)) {
      rememberCompletedArtifactDelivery(key)
      return undefined
    }
  }

  const active = activeArtifactDeliveryLocks.get(key)
  if (active) {
    await active.catch(() => undefined)
    return undefined
  }

  const delivery = params.task()
    .then((result) => {
      if (result !== undefined) {
        rememberCompletedArtifactDelivery(key)
        if (run) {
          try {
            recordArtifactMetadata({
              sourceRunId: runId,
              requestGroupId: run.requestGroupId,
              ownerChannel: params.channel,
              artifactPath: params.filePath,
              retentionPolicy: params.retentionPolicy ?? "standard",
              metadata: {
                dedupeKey: key,
                ...(params.force ? { resend: true } : {}),
                ...(params.forceReason ? { forceReason: params.forceReason } : {}),
              },
              ...(params.channelTarget ? { channelTarget: params.channelTarget } : {}),
              ...(params.mimeType ? { mimeType: params.mimeType } : {}),
              ...(params.sizeBytes !== undefined ? { sizeBytes: params.sizeBytes } : {}),
            })
            insertArtifactReceipt({
              runId,
              requestGroupId: run.requestGroupId,
              channel: params.channel,
              artifactPath: params.filePath,
              deliveredAt: Date.now(),
              deliveryReceipt: {
                dedupeKey: key,
                ...(params.channelTarget ? { channelTarget: params.channelTarget } : {}),
                ...(params.force ? { resend: true } : {}),
                ...(params.forceReason ? { forceReason: params.forceReason } : {}),
              },
              ...(params.mimeType ? { mimeType: params.mimeType } : {}),
              ...(params.sizeBytes !== undefined ? { sizeBytes: params.sizeBytes } : {}),
            })
            if (params.force) {
              insertDiagnosticEvent({
                runId,
                requestGroupId: run.requestGroupId,
                kind: "artifact_resend",
                summary: `artifact resent to ${params.channel}`,
                detail: {
                  artifactPath: params.filePath,
                  channel: params.channel,
                  ...(params.channelTarget ? { channelTarget: params.channelTarget } : {}),
                  ...(params.forceReason ? { forceReason: params.forceReason } : {}),
                },
              })
            }
          } catch {
            // Delivery already succeeded; persistence is best-effort for restart dedupe.
          }
        }
      }
      return result
    })
    .finally(() => {
      if (activeArtifactDeliveryLocks.get(key) === delivery) {
        activeArtifactDeliveryLocks.delete(key)
      }
    })

  activeArtifactDeliveryLocks.set(key, delivery)
  return delivery
}

export function resetArtifactDeliveryDedupeForTest(): void {
  activeArtifactDeliveryLocks.clear()
  completedArtifactDeliveryKeys.clear()
}

export function displayHomePath(value: string): string {
  const home = homedir()
  return value.startsWith(home) ? value.replace(home, "~") : value
}

function rememberDeliveryContinuity(runId: string, receipt: {
  lastToolReceipt?: string
  lastDeliveryReceipt?: string
  pendingDelivery?: string[]
  status?: string
}): void {
  try {
    const run = getRootRun(runId)
    if (!run) return
    const lineageRootRunId = run?.lineageRootRunId ?? run?.requestGroupId ?? runId
    upsertTaskContinuity({
      lineageRootRunId,
      ...(run?.parentRunId ? { parentRunId: run.parentRunId } : {}),
      ...(run?.handoffSummary ? { handoffSummary: run.handoffSummary } : {}),
      ...(receipt.lastToolReceipt ? { lastToolReceipt: receipt.lastToolReceipt } : {}),
      ...(receipt.lastDeliveryReceipt ? { lastDeliveryReceipt: receipt.lastDeliveryReceipt } : {}),
      ...(receipt.pendingDelivery ? { pendingDelivery: receipt.pendingDelivery } : {}),
      ...(receipt.status ? { status: receipt.status } : {}),
    })
  } catch {
    // Continuity telemetry is best-effort and must not affect delivery.
  }
}

export function buildSuccessfulDeliverySummary(deliveries: SuccessfulFileDelivery[]): string {
  if (deliveries.length === 0) return "파일 전달 완료"
  const last = deliveries[deliveries.length - 1]
  if (!last) return "파일 전달 완료"
  const channelLabel = last.channel === "telegram"
    ? "텔레그램"
    : last.channel === "webui"
      ? "WebUI"
      : last.channel === "slack"
        ? "Slack"
      : "채널"
  return `${channelLabel} 파일 전달 완료: ${describeArtifactForUser(last)}`
}

export function describeArtifactForUser(delivery: Pick<SuccessfulFileDelivery, "filePath" | "url">): string {
  return delivery.url?.trim() || basename(delivery.filePath)
}

export async function resendArtifact<T>(params: Omit<ArtifactDeliveryOnceParams<T>, "force">): Promise<T | undefined> {
  return deliverArtifactOnce({
    ...params,
    force: true,
    forceReason: params.forceReason ?? "explicit_resend",
  })
}

export function resolveDeliveryOutcome(params: {
  wantsDirectArtifactDelivery: boolean
  deliveries: SuccessfulFileDelivery[]
  textDeliveries?: SuccessfulTextDelivery[]
}): DeliveryOutcome {
  const hasSuccessfulArtifactDelivery = params.deliveries.length > 0
  const hasSuccessfulTextDelivery = (params.textDeliveries?.length ?? 0) > 0
  const deliverySatisfied = params.wantsDirectArtifactDelivery
    ? hasSuccessfulArtifactDelivery
    : hasSuccessfulTextDelivery
  const deliverySummary = hasSuccessfulArtifactDelivery
    ? buildSuccessfulDeliverySummary(params.deliveries)
    : undefined

  return {
    mode: params.wantsDirectArtifactDelivery ? "direct_artifact" : "reply",
    directArtifactDeliveryRequested: params.wantsDirectArtifactDelivery,
    hasSuccessfulArtifactDelivery,
    hasSuccessfulTextDelivery,
    textDeliverySatisfied: hasSuccessfulTextDelivery,
    deliverySatisfied,
    ...(deliverySummary ? { deliverySummary } : {}),
    requiresDirectArtifactRecovery: params.wantsDirectArtifactDelivery && !hasSuccessfulArtifactDelivery,
  }
}

export async function emitAssistantTextDelivery(params: {
  runId: string
  sessionId: string
  text: string
  source: DeliverySource
  onChunk: RunChunkDeliveryHandler
  persistMessage?: boolean
  emitDone?: boolean
  onError?: (message: string) => void
  dependencies?: Partial<AssistantTextDeliveryDependencies>
}): Promise<AssistantTextDeliveryReceipt> {
  const dependencies = {
    ...defaultAssistantTextDeliveryDependencies,
    ...params.dependencies,
  }
  const normalized = params.text.trim()
  if (!normalized) {
    return {
      persisted: false,
      textDelivered: false,
      doneDelivered: false,
    }
  }

  dependencies.emitStart({ sessionId: params.sessionId, runId: params.runId })
  if (params.persistMessage !== false) {
    dependencies.insertMessage({
      id: dependencies.createId(),
      session_id: params.sessionId,
      root_run_id: params.runId,
      role: "assistant",
      content: normalized,
      tool_calls: null,
      tool_call_id: null,
      created_at: dependencies.now(),
    })
  }
  dependencies.writeReplyLog(params.source, normalized)
  dependencies.emitStream({ sessionId: params.sessionId, runId: params.runId, delta: normalized })

  let textDeliveryFailed = false
  await deliverChunk({
    onChunk: params.onChunk,
    chunk: { type: "text", delta: normalized },
    runId: params.runId,
    onError: (message) => {
      textDeliveryFailed = true
      params.onError?.(message)
    },
  })

  let doneDelivered = false
  if (params.emitDone !== false) {
    dependencies.emitEnd({ sessionId: params.sessionId, runId: params.runId, durationMs: 0 })
    let doneDeliveryFailed = false
    await deliverChunk({
      onChunk: params.onChunk,
      chunk: { type: "done", totalTokens: 0 },
      runId: params.runId,
      onError: (message) => {
        doneDeliveryFailed = true
        params.onError?.(message)
      },
    })
    doneDelivered = !doneDeliveryFailed
  }

  return {
    persisted: params.persistMessage !== false,
    textDelivered: params.onChunk == null || !textDeliveryFailed,
    doneDelivered,
  }
}

export function resolveAssistantTextDeliveryOutcome(
  receipt: AssistantTextDeliveryReceipt,
): AssistantTextDeliveryOutcome {
  const hasDeliveryFailure = !receipt.textDelivered || !receipt.doneDelivered
  const failureStage =
    !receipt.textDelivered && !receipt.doneDelivered
      ? "text_and_done"
      : !receipt.textDelivered
        ? "text"
        : !receipt.doneDelivered
          ? "done"
          : "none"

  const summary = !hasDeliveryFailure
    ? "응답 전달 완료"
    : failureStage === "text_and_done"
      ? "응답 텍스트와 완료 신호 전달에 실패했습니다."
      : failureStage === "text"
        ? "응답 텍스트 전달에 실패했습니다."
        : "응답 완료 신호 전달에 실패했습니다."

  return {
    persisted: receipt.persisted,
    textDelivered: receipt.textDelivered,
    doneDelivered: receipt.doneDelivered,
    hasDeliveryFailure,
    failureStage,
    summary,
  }
}

export async function deliverChunk(params: {
  onChunk: RunChunkDeliveryHandler
  chunk: AgentChunk
  runId: string
  onError?: (message: string) => void
}): Promise<ChunkDeliveryReceipt | undefined> {
  if (!params.onChunk) return undefined
  try {
    return (await params.onChunk(params.chunk)) ?? undefined
  } catch (error) {
    const rawMessage = error instanceof Error ? error.message : String(error)
    const sanitized = sanitizeUserFacingError(`chunk delivery failed: ${rawMessage}`)
    const message = `runId=${params.runId} chunk delivery failed: ${sanitized.userMessage}`
    params.onError?.(message)
    return undefined
  }
}

export async function deliverTrackedChunk(params: {
  onChunk: RunChunkDeliveryHandler
  chunk: AgentChunk
  runId: string
  onError?: (message: string) => void
  successfulFileDeliveries: SuccessfulFileDelivery[]
  successfulTextDeliveries: SuccessfulTextDelivery[]
  appendEvent: (runId: string, label: string) => void
}): Promise<ChunkDeliveryReceipt | undefined> {
  const receipt = await deliverChunk({
    onChunk: params.onChunk,
    chunk: params.chunk,
    runId: params.runId,
    ...(params.onError ? { onError: params.onError } : {}),
  })
  applyChunkDeliveryReceipt({
    runId: params.runId,
    receipt,
    successfulFileDeliveries: params.successfulFileDeliveries,
    successfulTextDeliveries: params.successfulTextDeliveries,
    appendEvent: params.appendEvent,
  })
  return receipt
}

export function applyChunkDeliveryReceipt(params: {
  runId: string
  receipt: ChunkDeliveryReceipt | undefined
  successfulFileDeliveries: SuccessfulFileDelivery[]
  successfulTextDeliveries: SuccessfulTextDelivery[]
  appendEvent: (runId: string, label: string) => void
}): void {
  for (const delivery of params.receipt?.artifactDeliveries ?? []) {
    const alreadyRecorded = params.successfulFileDeliveries.some((existing) =>
      existing.channel === delivery.channel
      && existing.filePath === delivery.filePath
      && existing.toolName === delivery.toolName,
    )
    if (alreadyRecorded) continue

    params.successfulFileDeliveries.push(delivery)
    if (delivery.channel === "telegram") {
      params.appendEvent(params.runId, `텔레그램 파일 전달 완료: ${describeArtifactForUser(delivery)}`)
    } else if (delivery.channel === "slack") {
      params.appendEvent(params.runId, `Slack 파일 전달 완료: ${describeArtifactForUser(delivery)}`)
    } else {
      params.appendEvent(params.runId, `WebUI 파일 전달 완료: ${describeArtifactForUser(delivery)}`)
    }
    rememberDeliveryContinuity(params.runId, {
      lastToolReceipt: `${delivery.toolName}:${delivery.channel}:${displayHomePath(delivery.filePath)}`,
      lastDeliveryReceipt: `${delivery.channel}:${displayHomePath(delivery.filePath)}`,
      pendingDelivery: [],
      status: "delivered",
    })
  }

  for (const delivery of params.receipt?.textDeliveries ?? []) {
    const alreadyRecorded = params.successfulTextDeliveries.some((existing) =>
      existing.channel === delivery.channel
      && existing.text === delivery.text
      && JSON.stringify(existing.messageIds ?? []) === JSON.stringify(delivery.messageIds ?? []),
    )
    if (alreadyRecorded) continue

    params.successfulTextDeliveries.push(delivery)
    if (delivery.channel === "telegram") {
      params.appendEvent(params.runId, `텔레그램 텍스트 전달 완료`)
    } else if (delivery.channel === "webui") {
      params.appendEvent(params.runId, "WebUI 텍스트 전달 완료")
    } else if (delivery.channel === "slack") {
      params.appendEvent(params.runId, "Slack 텍스트 전달 완료")
    } else {
      params.appendEvent(params.runId, "CLI 텍스트 출력 완료")
    }
    rememberDeliveryContinuity(params.runId, {
      lastDeliveryReceipt: `${delivery.channel}:text`,
      pendingDelivery: [],
      status: "delivered",
    })
  }
}

export function logAssistantReply(source: DeliverySource, text: string): void {
  if (source !== "webui" && source !== "telegram") return
  const normalized = text.trim()
  if (!normalized) return
  process.stdout.write(`${normalized}\n`)
}
