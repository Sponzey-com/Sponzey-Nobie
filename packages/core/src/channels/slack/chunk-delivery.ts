import type { AgentChunk } from "../../agent/index.js"
import type { ChunkDeliveryReceipt, RunChunkDeliveryHandler } from "../../runs/delivery.js"
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
        try {
          const sentMessageId = await context.responder.sendFile(chunk.details.filePath, chunk.details.caption)
          toolOwnedResponseActive = true
          bufferedText = ""
          recordIfRunPresent(sentMessageId, "assistant")
          return {
            artifactDeliveries: [{
              toolName: chunk.toolName,
              channel: "slack",
              filePath: chunk.details.filePath,
              ...(chunk.details.caption ? { caption: chunk.details.caption } : {}),
            }],
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          context.logError(`Failed to send Slack file: ${message}`)
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
