export type RiskLevel = "safe" | "moderate" | "dangerous"

export interface ToolContext {
  sessionId: string
  runId: string
  workDir: string
  userMessage: string
  source: "webui" | "cli" | "telegram"
  allowWebAccess: boolean
  onProgress: (message: string) => void
  signal: AbortSignal
}

export interface ArtifactDeliveryResultDetails {
  kind: "artifact_delivery"
  channel: "telegram"
  filePath: string
  caption?: string
  size: number
  source: ToolContext["source"]
}

export function isArtifactDeliveryResultDetails(value: unknown): value is ArtifactDeliveryResultDetails {
  if (!value || typeof value !== "object") return false

  const candidate = value as Partial<ArtifactDeliveryResultDetails>
  return candidate.kind === "artifact_delivery"
    && candidate.channel === "telegram"
    && typeof candidate.filePath === "string"
    && typeof candidate.size === "number"
    && typeof candidate.source === "string"
}

export interface ToolResult {
  success: boolean
  output: string
  details?: unknown
  error?: string | undefined
}

// TParams is covariant here — use unknown as the base so any typed tool can be assigned
export interface AgentTool<TParams = unknown> {
  name: string
  description: string
  parameters: {
    type: "object"
    properties: Record<string, unknown>
    required?: string[]
  }
  riskLevel: RiskLevel
  requiresApproval: boolean
  execute(params: TParams, ctx: ToolContext): Promise<ToolResult>
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyTool = AgentTool<any>
