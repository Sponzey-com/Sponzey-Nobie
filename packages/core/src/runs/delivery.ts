import crypto from "node:crypto"
import { homedir } from "node:os"
import type { AgentChunk } from "../agent/index.js"
import { insertMessage } from "../db/index.js"
import { eventBus } from "../events/index.js"

export interface SuccessfulFileDelivery {
  toolName: string
  channel: "telegram"
  filePath: string
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
  directArtifactDeliveryRequested: boolean
  hasSuccessfulArtifactDelivery: boolean
  deliverySatisfied: boolean
  deliverySummary?: string
  requiresDirectArtifactRecovery: boolean
}

export type RunChunkDeliveryHandler =
  | ((chunk: AgentChunk) => Promise<ChunkDeliveryReceipt | void> | ChunkDeliveryReceipt | void)
  | undefined

export type DeliverySource = "webui" | "cli" | "telegram"

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

export function displayHomePath(value: string): string {
  const home = homedir()
  return value.startsWith(home) ? value.replace(home, "~") : value
}

export function buildSuccessfulDeliverySummary(deliveries: SuccessfulFileDelivery[]): string {
  if (deliveries.length === 0) return "파일 전달 완료"
  const last = deliveries[deliveries.length - 1]
  if (!last) return "파일 전달 완료"
  return `${last.channel === "telegram" ? "텔레그램" : "채널"} 파일 전달 완료: ${displayHomePath(last.filePath)}`
}

export function resolveDeliveryOutcome(params: {
  wantsDirectArtifactDelivery: boolean
  deliveries: SuccessfulFileDelivery[]
}): DeliveryOutcome {
  const hasSuccessfulArtifactDelivery = params.deliveries.length > 0
  const deliverySatisfied = params.wantsDirectArtifactDelivery && hasSuccessfulArtifactDelivery
  const deliverySummary = hasSuccessfulArtifactDelivery
    ? buildSuccessfulDeliverySummary(params.deliveries)
    : undefined

  return {
    directArtifactDeliveryRequested: params.wantsDirectArtifactDelivery,
    hasSuccessfulArtifactDelivery,
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
    const message = `runId=${params.runId} chunk delivery failed: ${error instanceof Error ? error.message : String(error)}`
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
      && existing.messageId === delivery.messageId,
    )
    if (alreadyRecorded) continue

    params.successfulFileDeliveries.push(delivery)
    params.appendEvent(params.runId, `텔레그램 파일 전달 완료: ${displayHomePath(delivery.filePath)}`)
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
    } else {
      params.appendEvent(params.runId, "CLI 텍스트 출력 완료")
    }
  }
}

export function logAssistantReply(source: DeliverySource, text: string): void {
  if (source !== "webui" && source !== "telegram") return
  const normalized = text.trim()
  if (!normalized) return
  process.stdout.write(`${normalized}\n`)
}
