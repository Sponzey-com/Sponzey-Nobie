import type { AgentChunk } from "../../agent/index.js"
import { buildArtifactAccessDescriptor } from "../../artifacts/lifecycle.js"
import {
  type ChunkDeliveryReceipt,
  type RunChunkDeliveryHandler,
  deliverArtifactOnce,
} from "../../runs/delivery.js"
import { decideIsolatedToolResponse } from "../../runs/isolated-tool-response.js"
import {
  buildTextDeliveryKey,
  recordMessageLedgerEvent,
  type MessageLedgerDeliveryKind,
} from "../../runs/message-ledger.js"
import type { ArtifactDeliveryResultDetails } from "../../tools/types.js"
import type { DeliveryReceipt } from "../contracts.js"
import {
  buildTelegramFailedDeliveryReceipt,
  buildTelegramSentDeliveryReceipt,
  type TelegramDeliveryTarget,
  type TelegramFileDeliveryResult,
  type TelegramTextPartsDeliveryResult,
} from "./message-delivery.js"
import { splitMessage } from "./markdown.js"

export interface TelegramChunkResponder {
  sendToolStatus(toolName: string): Promise<number>
  updateToolStatus(messageId: number, toolName: string, success: boolean): Promise<void>
  clearToolStatus?(messageId: number): Promise<void>
  sendFile(filePath: string, caption?: string | undefined): Promise<number>
  sendFileWithReceipt?(
    filePath: string,
    idempotencyKey: string,
    caption?: string | undefined,
  ): Promise<TelegramFileDeliveryResult>
  sendFinalResponse(text: string): Promise<number[]>
  sendFinalResponseWithReceipts?(
    text: string,
    idempotencyKeyPrefix: string,
  ): Promise<TelegramTextPartsDeliveryResult>
  sendError(message: string): Promise<number>
}

export interface TelegramChunkDeliveryContext {
  responder: TelegramChunkResponder
  sessionId: string
  chatId: number
  threadId?: number
  getRunId: () => string | undefined
  deliveryKind?: MessageLedgerDeliveryKind
  parentRunId?: string
  subSessionId?: string
  agentId?: string
  maxTextChunks?: number
  recordOutgoingMessageRef: (params: {
    sessionId: string
    runId: string
    chatId: number
    threadId?: number
    messageId: number
    role: "assistant" | "tool"
  }) => void
  logError: (message: string) => void
}

const DEFAULT_MAX_TEXT_CHUNKS = 20
const FALLBACK_PREVIEW_LENGTH = 1200

function isArtifactDeliveryDetails(value: unknown): value is ArtifactDeliveryResultDetails {
  if (!value || typeof value !== "object") return false

  const candidate = value as Partial<ArtifactDeliveryResultDetails>
  return (
    candidate.kind === "artifact_delivery" &&
    candidate.channel === "telegram" &&
    typeof candidate.filePath === "string" &&
    typeof candidate.size === "number" &&
    typeof candidate.source === "string"
  )
}

function buildTelegramArtifactFallbackMessage(
  fileName: string,
  downloadUrl?: string,
  caption?: string,
): string {
  const title = caption?.trim() || fileName
  if (!downloadUrl) {
    return `파일 업로드가 실패했습니다. 안전한 다운로드 링크도 만들 수 없어 같은 대화에서 완료할 수 없습니다.\n- 파일: ${title}`
  }
  return `파일 업로드가 실패해 같은 대화에 다운로드 링크로 대신 전달합니다.\n- 파일: ${title}\n- 다운로드: ${downloadUrl}`
}

function shouldSendToolStartStatus(toolName: string): boolean {
  return toolName !== "shell_exec"
}

export function buildTelegramTooManyChunksFallbackText(input: {
  text: string
  estimatedChunks: number
  maxChunks: number
}): string {
  const preview = input.text.trim().slice(0, FALLBACK_PREVIEW_LENGTH)
  const suffix = input.text.trim().length > FALLBACK_PREVIEW_LENGTH ? "\n\n...[truncated]" : ""
  return [
    `결과가 너무 길어 Telegram 메시지 ${input.estimatedChunks}개로 나뉠 수 있어 자동 분할 전송을 중단했습니다.`,
    `최대 허용 분할 수: ${input.maxChunks}`,
    "전체 결과는 WebUI 실행 상세 또는 생성된 artifact에서 확인해 주세요.",
    "",
    preview + suffix,
  ].join("\n")
}

export function createTelegramChunkDeliveryHandler(
  context: TelegramChunkDeliveryContext,
): RunChunkDeliveryHandler {
  let bufferedText = ""
  let toolOwnedResponseActive = false
  const toolMessageIds = new Map<string, number>()

  const recordIfRunPresent = (messageId: number, role: "assistant" | "tool") => {
    const runId = context.getRunId()
    if (!runId) return
    context.recordOutgoingMessageRef({
      sessionId: context.sessionId,
      runId,
      chatId: context.chatId,
      ...(context.threadId !== undefined ? { threadId: context.threadId } : {}),
      messageId,
      role,
    })
  }

  const target = (): TelegramDeliveryTarget => ({
    chatId: context.chatId,
    ...(context.threadId !== undefined ? { threadId: context.threadId } : {}),
  })

  const textDeliveryIdempotencyPrefix = (kind: string): string => {
    return `telegram:${kind}:${context.getRunId() ?? "pending"}:${context.chatId}:${context.threadId ?? "main"}`
  }

  const sendFinalText = async (
    text: string,
    kind: "final" | "too-many-chunks-fallback" | "artifact-fallback",
  ): Promise<{ messageIds: number[]; deliveryReceipts: DeliveryReceipt[]; deliveredText: string } | undefined> => {
    const estimatedChunks = splitMessage(text).length
    const maxChunks = context.maxTextChunks ?? DEFAULT_MAX_TEXT_CHUNKS
    const deliveredText = estimatedChunks > maxChunks
      ? buildTelegramTooManyChunksFallbackText({ text, estimatedChunks, maxChunks })
      : text
    const idempotencyPrefix = textDeliveryIdempotencyPrefix(kind)
    try {
      if (context.responder.sendFinalResponseWithReceipts) {
        const result = await context.responder.sendFinalResponseWithReceipts(deliveredText, idempotencyPrefix)
        return {
          messageIds: result.messageIds,
          deliveryReceipts: result.receipts,
          deliveredText,
        }
      }

      const messageIds = await context.responder.sendFinalResponse(deliveredText)
      return {
        messageIds,
        deliveryReceipts: messageIds.map((messageId, index) => buildTelegramSentDeliveryReceipt({
          target: target(),
          idempotencyKey: `${idempotencyPrefix}:part:${index + 1}`,
          messageId,
        })),
        deliveredText,
      }
    } catch (error) {
      recordTelegramTextDeliveryFailure(error, deliveredText, kind)
      context.logError(`Failed to send Telegram text delivery: ${error instanceof Error ? error.message : String(error)}`)
      return undefined
    }
  }

  const recordTelegramTextDeliveryFailure = (
    error: unknown,
    text: string,
    kind: string,
  ): void => {
    const runId = context.getRunId()
    if (!runId) return
    const failedReceipt = buildTelegramFailedDeliveryReceipt({
      target: target(),
      idempotencyKey: `${textDeliveryIdempotencyPrefix(kind)}:failed`,
      error,
    })
    recordMessageLedgerEvent({
      runId,
      channel: "telegram",
      eventKind: "text_delivery_failed",
      deliveryKind: context.deliveryKind ?? "final",
      deliveryKey: buildTextDeliveryKey(
        "telegram",
        JSON.stringify([context.chatId, context.threadId ?? "main"]),
        text,
      ),
      idempotencyKey: failedReceipt.idempotencyKey,
      status: "failed",
      summary: "Telegram text delivery failed.",
      detail: {
        textLength: text.length,
        receiptStatus: failedReceipt.status,
        errorCode: failedReceipt.errorCode ?? null,
        errorMessage: failedReceipt.errorMessage ?? null,
      },
    })
  }

  const sendFileWithReceipt = async (
    filePath: string,
    idempotencyKey: string,
    caption?: string,
  ): Promise<TelegramFileDeliveryResult> => {
    if (context.responder.sendFileWithReceipt) {
      return context.responder.sendFileWithReceipt(filePath, idempotencyKey, caption)
    }
    const messageId = await context.responder.sendFile(filePath, caption)
    return {
      messageId,
      receipt: buildTelegramSentDeliveryReceipt({
        target: target(),
        idempotencyKey,
        messageId,
      }),
    }
  }

  return async (chunk: AgentChunk): Promise<ChunkDeliveryReceipt | undefined> => {
    if (chunk.type === "text") {
      if (toolOwnedResponseActive) return
      bufferedText += chunk.delta
      return
    }

    if (chunk.type === "tool_start") {
      if (!shouldSendToolStartStatus(chunk.toolName)) return
      const msgId = await context.responder.sendToolStatus(chunk.toolName)
      toolMessageIds.set(chunk.toolName, msgId)
      recordIfRunPresent(msgId, "tool")
      return
    }

    if (chunk.type === "tool_end") {
      const msgId = toolMessageIds.get(chunk.toolName)
      if (msgId !== undefined) {
        if (chunk.success) {
          await context.responder.clearToolStatus?.(msgId)
        } else {
          await context.responder.updateToolStatus(msgId, chunk.toolName, false)
        }
        toolMessageIds.delete(chunk.toolName)
      } else if (!chunk.success) {
        const failureMessageId = await context.responder.sendToolStatus(chunk.toolName)
        await context.responder.updateToolStatus(failureMessageId, chunk.toolName, false)
        recordIfRunPresent(failureMessageId, "tool")
      }

      const isolatedToolResponse = decideIsolatedToolResponse(chunk)
      if (isolatedToolResponse.kind === "artifact" && isArtifactDeliveryDetails(chunk.details)) {
        const details = chunk.details
        const receipt = await deliverArtifactOnce({
          runId: context.getRunId(),
          channel: "telegram",
          filePath: details.filePath,
          channelTarget: `${context.chatId}${context.threadId !== undefined ? `:${context.threadId}` : ""}`,
          sizeBytes: details.size,
          ...(details.mimeType ? { mimeType: details.mimeType } : {}),
          task: async () => {
            try {
              const sent = await sendFileWithReceipt(
                details.filePath,
                `telegram:file:${context.getRunId() ?? "pending"}:${details.filePath}`,
                details.caption,
              )
              recordIfRunPresent(sent.messageId, "assistant")
              return {
                artifactDeliveries: [
                  {
                    toolName: chunk.toolName,
                    channel: "telegram" as const,
                    filePath: details.filePath,
                    ...(details.caption ? { caption: details.caption } : {}),
                    messageId: sent.messageId,
                    deliveryReceipts: [sent.receipt],
                  },
                ],
              }
            } catch (error) {
              const message = error instanceof Error ? error.message : String(error)
              context.logError(`Failed to send file: ${message}`)
              const artifact = buildArtifactAccessDescriptor({
                filePath: details.filePath,
                sizeBytes: details.size,
                ...(details.mimeType ? { mimeType: details.mimeType } : {}),
              })
              const fallbackText = buildTelegramArtifactFallbackMessage(
                artifact.fileName,
                artifact.ok ? artifact.downloadUrl : undefined,
                details.caption,
              )
              const sent = await sendFinalText(fallbackText, "artifact-fallback")
              if (!sent) throw error
              for (const fallbackMessageId of sent.messageIds) {
                recordIfRunPresent(fallbackMessageId, "assistant")
              }
              return {
                textDeliveries: [
                  {
                    channel: "telegram" as const,
                    text: sent.deliveredText,
                    messageIds: sent.messageIds,
                    deliveryReceipts: sent.deliveryReceipts,
                  },
                ],
                ...(artifact.ok && artifact.url
                  ? {
                      artifactDeliveries: [
                        {
                          toolName: chunk.toolName,
                          channel: "telegram" as const,
                          filePath: details.filePath,
                          url: artifact.url,
                          ...(artifact.previewUrl ? { previewUrl: artifact.previewUrl } : {}),
                          ...(artifact.downloadUrl ? { downloadUrl: artifact.downloadUrl } : {}),
                          previewable: artifact.previewable,
                          mimeType: artifact.mimeType,
                          sizeBytes: details.size,
                          ...(details.caption ? { caption: details.caption } : {}),
                          ...(sent.messageIds[0] !== undefined
                            ? { messageId: sent.messageIds[0] }
                            : {}),
                          deliveryReceipts: sent.deliveryReceipts,
                        },
                      ],
                    }
                  : {}),
              }
            }
          },
        })
        if (receipt) {
          toolOwnedResponseActive = true
          bufferedText = ""
          return receipt
        }
      }

      if (isolatedToolResponse.kind === "text" && isolatedToolResponse.text) {
        toolOwnedResponseActive = true
        bufferedText = isolatedToolResponse.text
      }
      return
    }

    if (chunk.type === "done") {
      if (!bufferedText) return
      const deliveredText = bufferedText
      const sent = await sendFinalText(bufferedText, "final")
      if (!sent) {
        bufferedText = ""
        return
      }
      for (const messageId of sent.messageIds) {
        recordIfRunPresent(messageId, "assistant")
      }
      bufferedText = ""
      return {
        textDeliveries: [
          {
            channel: "telegram",
            text: sent.deliveredText,
            messageIds: sent.messageIds,
            deliveryReceipts: sent.deliveryReceipts,
            ...(sent.deliveredText !== deliveredText ? { deliveryKind: "diagnostic" as const } : {}),
            ...(context.deliveryKind ? { deliveryKind: context.deliveryKind } : {}),
            ...(context.parentRunId ? { parentRunId: context.parentRunId } : {}),
            ...(context.subSessionId ? { subSessionId: context.subSessionId } : {}),
            ...(context.agentId ? { agentId: context.agentId } : {}),
          },
        ],
      }
    }

    if (chunk.type === "error") {
      if (toolOwnedResponseActive) {
        return
      }
      const errorMessageId = await context.responder.sendError(chunk.message)
      recordIfRunPresent(errorMessageId, "assistant")
      bufferedText = ""
    }
  }
}
