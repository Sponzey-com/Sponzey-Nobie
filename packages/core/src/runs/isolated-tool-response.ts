import type { AgentChunk } from "../agent/index.js"

export interface IsolatedToolResponseDecision {
  kind: "none" | "artifact" | "text"
  text?: string
}

interface ExplicitToolResponseOwnershipDetails {
  responseOwnership?: "final_text"
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

function hasExplicitFinalTextOwnership(value: unknown): value is ExplicitToolResponseOwnershipDetails {
  if (!value || typeof value !== "object") return false
  const candidate = value as ExplicitToolResponseOwnershipDetails
  return candidate.responseOwnership === "final_text"
}

export function decideIsolatedToolResponse(chunk: AgentChunk): IsolatedToolResponseDecision {
  if (chunk.type !== "tool_end" || !chunk.success) {
    return { kind: "none" }
  }

  if (isArtifactDeliveryDetails(chunk.details)) {
    return { kind: "artifact" }
  }

  if (hasExplicitFinalTextOwnership(chunk.details)) {
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

export function shouldTerminateRunAfterSuccessfulTool(chunk: AgentChunk): boolean {
  if (chunk.type !== "tool_end" || !chunk.success) return false
  return decideIsolatedToolResponse(chunk).kind !== "none"
}
