import type { AgentChunk } from "../../agent/index.js"
import { buildArtifactAccessDescriptor } from "../../artifacts/lifecycle.js"
import { deliverArtifactOnce, type ChunkDeliveryReceipt, type RunChunkDeliveryHandler } from "../../runs/delivery.js"
import type { ArtifactDeliveryResultDetails } from "../../tools/types.js"
import { decideIsolatedToolResponse } from "../../runs/isolated-tool-response.js"

export interface SlackChunkResponder {
  sendToolStatus(toolName: string): Promise<string>
  updateToolStatus(messageId: string, toolName: string, success: boolean): Promise<void>
  sendFile(filePath: string, caption?: string): Promise<string>
  sendFinalResponse(text: string): Promise<string[]>
  sendError(message: string): Promise<string>
}

export interface SlackChunkDeliveryContext {
  responder: SlackChunkResponder
  sessionId: string
  channelId: string
  threadTs: string
  getRunId: () => string | undefined
  recordOutgoingMessageRef: (params: {
    sessionId: string
    runId: string
    channelId: string
    threadTs: string
    messageId: string
    role: "assistant" | "tool"
  }) => void
  logError: (message: string) => void
}

function isArtifactDeliveryDetails(value: unknown): value is ArtifactDeliveryResultDetails {
  if (!value || typeof value !== "object") return false
  const candidate = value as Partial<ArtifactDeliveryResultDetails>
  return candidate.kind === "artifact_delivery"
    && candidate.channel === "slack"
    && typeof candidate.filePath === "string"
    && typeof candidate.size === "number"
}

function buildSlackArtifactFallbackMessage(fileName: string, downloadUrl?: string, caption?: string): string {
  const title = caption?.trim() || fileName
  if (!downloadUrl) {
    return `파일 업로드가 실패했습니다. 안전한 다운로드 링크도 만들 수 없어 같은 Slack 스레드에서 완료할 수 없습니다.\n- 파일: ${title}`
  }
  return `파일 업로드가 실패해 같은 Slack 스레드에 다운로드 링크로 대신 전달합니다.\n- 파일: ${title}\n- 다운로드: ${downloadUrl}`
}

export function createSlackChunkDeliveryHandler(
  context: SlackChunkDeliveryContext,
): RunChunkDeliveryHandler {
  let bufferedText = ""
  let toolOwnedResponseActive = false
  const toolMessageIds = new Map<string, string>()

  const recordIfRunPresent = (messageId: string, role: "assistant" | "tool") => {
    const runId = context.getRunId()
    if (!runId) return
    context.recordOutgoingMessageRef({
      sessionId: context.sessionId,
      runId,
      channelId: context.channelId,
      threadTs: context.threadTs,
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
      const messageId = await context.responder.sendToolStatus(chunk.toolName)
      toolMessageIds.set(chunk.toolName, messageId)
      recordIfRunPresent(messageId, "tool")
      return
    }

    if (chunk.type === "tool_end") {
      const toolMessageId = toolMessageIds.get(chunk.toolName)
      if (toolMessageId) {
        await context.responder.updateToolStatus(toolMessageId, chunk.toolName, chunk.success)
        toolMessageIds.delete(chunk.toolName)
      }

      const isolatedToolResponse = decideIsolatedToolResponse(chunk)
      if (isolatedToolResponse.kind === "artifact" && isArtifactDeliveryDetails(chunk.details)) {
        const details = chunk.details
        const receipt = await deliverArtifactOnce({
          runId: context.getRunId(),
          channel: "slack",
          filePath: details.filePath,
          channelTarget: `${context.channelId}:${context.threadTs}`,
          sizeBytes: details.size,
          ...(details.mimeType ? { mimeType: details.mimeType } : {}),
          task: async () => {
            try {
              const sentMessageId = await context.responder.sendFile(details.filePath, details.caption)
              recordIfRunPresent(sentMessageId, "assistant")
              return {
                artifactDeliveries: [{
                  toolName: chunk.toolName,
                  channel: "slack" as const,
                  filePath: details.filePath,
                  ...(details.caption ? { caption: details.caption } : {}),
                }],
              }
            } catch (error) {
              const message = error instanceof Error ? error.message : String(error)
              context.logError(`Failed to send Slack file: ${message}`)
              const artifact = buildArtifactAccessDescriptor({
                filePath: details.filePath,
                sizeBytes: details.size,
                ...(details.mimeType ? { mimeType: details.mimeType } : {}),
              })
              const fallbackText = buildSlackArtifactFallbackMessage(
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
                  channel: "slack" as const,
                  text: fallbackText,
                }],
                ...(artifact.ok && artifact.url ? {
                  artifactDeliveries: [{
                    toolName: chunk.toolName,
                    channel: "slack" as const,
                    filePath: details.filePath,
                    url: artifact.url,
                    ...(artifact.previewUrl ? { previewUrl: artifact.previewUrl } : {}),
                    ...(artifact.downloadUrl ? { downloadUrl: artifact.downloadUrl } : {}),
                    previewable: artifact.previewable,
                    mimeType: artifact.mimeType,
                    sizeBytes: details.size,
                    ...(details.caption ? { caption: details.caption } : {}),
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
          channel: "slack",
          text: deliveredText,
        }],
      }
    }

    if (chunk.type === "error") {
      if (toolOwnedResponseActive) return
      const messageId = await context.responder.sendError(chunk.message)
      recordIfRunPresent(messageId, "assistant")
      bufferedText = ""
    }
  }
}
