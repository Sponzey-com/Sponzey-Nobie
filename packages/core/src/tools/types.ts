export type RiskLevel = "safe" | "moderate" | "dangerous"

export interface ToolContext {
  sessionId: string
  runId: string
  workDir: string
  onProgress: (message: string) => void
  signal: AbortSignal
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
