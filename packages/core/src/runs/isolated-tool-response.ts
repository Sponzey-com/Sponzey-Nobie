import type { AgentChunk } from "../agent/index.js"

export interface IsolatedToolResponseDecision {
  kind: "none" | "artifact" | "text"
  text?: string
}

function isArtifactDeliveryDetails(value: unknown): boolean {
  if (!value || typeof value !== "object") return false

  const candidate = value as Partial<{
    kind: string
    channel: string
    filePath: string
    size: number
    source: string
  }>

  return candidate.kind === "artifact_delivery"
    && (candidate.channel === "telegram" || candidate.channel === "webui")
    && typeof candidate.filePath === "string"
    && typeof candidate.size === "number"
    && typeof candidate.source === "string"
}

function isYeonjangToolDetails(value: unknown): boolean {
  if (!value || typeof value !== "object") return false
  const candidate = value as Partial<{ via: string }>
  return candidate.via === "yeonjang"
}

export function decideIsolatedToolResponse(chunk: AgentChunk): IsolatedToolResponseDecision {
  if (chunk.type !== "tool_end" || !chunk.success) {
    return { kind: "none" }
  }

  if (isArtifactDeliveryDetails(chunk.details)) {
    return { kind: "artifact" }
  }

  if (isYeonjangToolDetails(chunk.details)) {
    const text = chunk.output.trim()
    if (text) {
      return {
        kind: "text",
        text,
      }
    }
  }

  return { kind: "none" }
}
