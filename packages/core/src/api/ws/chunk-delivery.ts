import { basename, relative, sep } from "node:path"
import { eventBus } from "../../events/index.js"
import { PATHS } from "../../config/index.js"
import type { AgentChunk } from "../../agent/index.js"
import type { ChunkDeliveryReceipt, RunChunkDeliveryHandler } from "../../runs/delivery.js"
import type { ArtifactDeliveryResultDetails } from "../../tools/types.js"
import { decideIsolatedToolResponse } from "../../runs/isolated-tool-response.js"

function isWebUiArtifactDeliveryDetails(value: unknown): value is ArtifactDeliveryResultDetails {
  if (!value || typeof value !== "object") return false

  const candidate = value as Partial<ArtifactDeliveryResultDetails>
  return candidate.kind === "artifact_delivery"
    && candidate.channel === "webui"
    && typeof candidate.filePath === "string"
    && typeof candidate.size === "number"
    && typeof candidate.source === "string"
}

function buildWebUiArtifactUrl(filePath: string): string | null {
  const artifactsRoot = `${PATHS.stateDir}${sep}artifacts`
  const resolvedRelative = relative(artifactsRoot, filePath)
  if (!resolvedRelative || resolvedRelative.startsWith("..") || resolvedRelative.includes(`..${sep}`)) {
    return null
  }

  const encodedPath = resolvedRelative
    .split(sep)
    .map((segment) => encodeURIComponent(segment))
    .join("/")
  return `/api/artifacts/${encodedPath}`
}

export function createWebUiChunkDeliveryHandler(params: {
  sessionId: string
  runId: string
}): RunChunkDeliveryHandler {
  let bufferedText = ""
  let toolOwnedResponseActive = false

  return async (chunk: AgentChunk): Promise<ChunkDeliveryReceipt | void> => {
    if (chunk.type === "text") {
      if (toolOwnedResponseActive) return
      bufferedText += chunk.delta
      return
    }

    if (chunk.type === "tool_end") {
      const isolatedToolResponse = decideIsolatedToolResponse(chunk)
      if (isolatedToolResponse.kind === "artifact" && chunk.success && isWebUiArtifactDeliveryDetails(chunk.details)) {
        const artifactUrl = buildWebUiArtifactUrl(chunk.details.filePath)
        if (!artifactUrl) return

        eventBus.emit("agent.artifact", {
          sessionId: params.sessionId,
          runId: params.runId,
          url: artifactUrl,
          filePath: chunk.details.filePath,
          fileName: basename(chunk.details.filePath),
          ...(chunk.details.mimeType ? { mimeType: chunk.details.mimeType } : {}),
          ...(chunk.details.caption ? { caption: chunk.details.caption } : {}),
        })
        toolOwnedResponseActive = true
        bufferedText = ""
        return {
          artifactDeliveries: [{
            toolName: chunk.toolName,
            channel: "webui",
            filePath: chunk.details.filePath,
            ...(chunk.details.caption ? { caption: chunk.details.caption } : {}),
          }],
        }
      }

      if (isolatedToolResponse.kind === "text" && isolatedToolResponse.text) {
        toolOwnedResponseActive = true
        bufferedText = isolatedToolResponse.text
      }
    }

    if (chunk.type === "done") {
      if (!bufferedText.trim()) return
      const deliveredText = bufferedText
      bufferedText = ""
      return {
        textDeliveries: [{
          channel: "webui",
          text: deliveredText,
        }],
      }
    }

    if (chunk.type === "error") {
      if (toolOwnedResponseActive) {
        return
      }
      bufferedText = ""
    }
  }
}
