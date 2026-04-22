import type {
  AgentEntityType,
  CapabilityPolicy,
  PermissionProfile,
  SkillMcpAllowlist,
} from "../contracts/sub-agent-orchestration.js"

export type RiskLevel = "safe" | "moderate" | "dangerous"

export interface ToolContext {
  sessionId: string
  runId: string
  requestGroupId?: string
  workDir: string
  userMessage: string
  source: "webui" | "cli" | "telegram" | "slack"
  allowWebAccess: boolean
  onProgress: (message: string) => void
  signal: AbortSignal
  agentId?: string
  agentType?: AgentEntityType
  capabilityPolicy?: CapabilityPolicy
  permissionProfile?: PermissionProfile
  skillMcpAllowlist?: SkillMcpAllowlist
  capabilityRateLimit?: CapabilityPolicy["rateLimit"]
  secretScopeId?: string
  auditId?: string
  capabilityDelegationId?: string
}

export interface ArtifactDeliveryResultDetails {
  kind: "artifact_delivery"
  channel: "telegram" | "webui" | "slack"
  filePath: string
  caption?: string
  mimeType?: string
  size: number
  source: ToolContext["source"]
}

export function isArtifactDeliveryResultDetails(value: unknown): value is ArtifactDeliveryResultDetails {
  if (!value || typeof value !== "object") return false

  const candidate = value as Partial<ArtifactDeliveryResultDetails>
  return candidate.kind === "artifact_delivery"
    && (candidate.channel === "telegram" || candidate.channel === "webui" || candidate.channel === "slack")
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
  availableSources?: ToolContext["source"][]
  execute(params: TParams, ctx: ToolContext): Promise<ToolResult>
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyTool = AgentTool<any>
