import type { AgentChunk } from "../../agent/index.js"
import { buildArtifactAccessDescriptor } from "../../artifacts/lifecycle.js"
import { deliverArtifactOnce, type ChunkDeliveryReceipt, type RunChunkDeliveryHandler } from "../../runs/delivery.js"
import type { ArtifactDeliveryResultDetails } from "../../tools/types.js"
import { decideIsolatedToolResponse } from "../../runs/isolated-tool-response.js"

export interface TelegramChunkResponder {
  sendToolStatus(toolName: string): Promise<number>
  updateToolStatus(messageId: number, toolName: string, success: boolean): Promise<void>
  sendFile(filePath: string, caption?: string | undefined): Promise<number>
  sendFinalResponse(text: string): Promise<number[]>
  sendError(message: string): Promise<number>
}

export interface TelegramChunkDeliveryContext {
  responder: TelegramChunkResponder
  sessionId: string
  chatId: number
  threadId?: number
  getRunId: () => string | undefined
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

function isArtifactDeliveryDetails(value: unknown): value is ArtifactDeliveryResultDetails {
  if (!value || typeof value !== "object") return false

  const candidate = value as Partial<ArtifactDeliveryResultDetails>
  return candidate.kind === "artifact_delivery"
    && candidate.channel === "telegram"
    && typeof candidate.filePath === "string"
    && typeof candidate.size === "number"
    && typeof candidate.source === "string"
}

function buildTelegramArtifactFallbackMessage(fileName: string, downloadUrl?: string, caption?: string): string {
  const title = caption?.trim() || fileName
  if (!downloadUrl) {
    return `파일 업로드가 실패했습니다. 안전한 다운로드 링크도 만들 수 없어 같은 대화에서 완료할 수 없습니다.\n- 파일: ${title}`
  }
  return `파일 업로드가 실패해 같은 대화에 다운로드 링크로 대신 전달합니다.\n- 파일: ${title}\n- 다운로드: ${downloadUrl}`
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

  return async (chunk: AgentChunk): Promise<ChunkDeliveryReceipt | void> => {
    if (chunk.type === "text") {
      if (toolOwnedResponseActive) return
      bufferedText += chunk.delta
      return
    }

    if (chunk.type === "tool_start") {
      const msgId = await context.responder.sendToolStatus(chunk.toolName)
      toolMessageIds.set(chunk.toolName, msgId)
      recordIfRunPresent(msgId, "tool")
      return
    }

    if (chunk.type === "tool_end") {
      const msgId = toolMessageIds.get(chunk.toolName)
      if (msgId !== undefined) {
        await context.responder.updateToolStatus(msgId, chunk.toolName, chunk.success)
        toolMessageIds.delete(chunk.toolName)
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
              const sentMessageId = await context.responder.sendFile(details.filePath, details.caption)
              recordIfRunPresent(sentMessageId, "assistant")
              return {
                artifactDeliveries: [{
                  toolName: chunk.toolName,
                  channel: "telegram" as const,
                  filePath: details.filePath,
                  ...(details.caption ? { caption: details.caption } : {}),
                  messageId: sentMessageId,
                }],
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
              const sentMessageIds = await context.responder.sendFinalResponse(fallbackText)
              for (const fallbackMessageId of sentMessageIds) {
                recordIfRunPresent(fallbackMessageId, "assistant")
              }
              return {
                textDeliveries: [{
                  channel: "telegram" as const,
                  text: fallbackText,
                  messageIds: sentMessageIds,
                }],
                ...(artifact.ok && artifact.url ? {
                  artifactDeliveries: [{
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
                    ...(sentMessageIds[0] !== undefined ? { messageId: sentMessageIds[0] } : {}),
                  }],
                } : {}),
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
      const sentMessageIds = await context.responder.sendFinalResponse(bufferedText)
      for (const messageId of sentMessageIds) {
        recordIfRunPresent(messageId, "assistant")
      }
      bufferedText = ""
      return {
        textDeliveries: [{
          channel: "telegram",
          text: deliveredText,
          messageIds: sentMessageIds,
        }],
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
