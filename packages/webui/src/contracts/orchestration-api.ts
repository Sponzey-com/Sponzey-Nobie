import type {
  AgentConfig,
  CapabilityDelegationRequest,
  DataExchangePackage,
  RelationshipGraphEdge,
  RelationshipGraphNode,
  SubSessionContract,
  TeamConfig,
} from "./sub-agent-orchestration"

export type OrchestrationTargetType = "agent" | "team"
export type OrchestrationConflictStrategy = "overwrite" | "create_copy" | "cancel"

export interface OrchestrationPage<T> {
  items: T[]
  total: number
  page: number
  pages: number
  limit: number
}

export interface OrchestrationAgentRegistryEntry {
  agentId: string
  displayName: string
  nickname?: string
  status: AgentConfig["status"]
  role: string
  specialtyTags: string[]
  avoidTasks: string[]
  teamIds: string[]
  delegationEnabled: boolean
  retryBudget: number
  source: "db" | "config"
  config: AgentConfig
  permissionProfile: AgentConfig["capabilityPolicy"]["permissionProfile"]
  capabilityPolicy: AgentConfig["capabilityPolicy"]
  skillMcpSummary: AgentConfig["capabilityPolicy"]["skillMcpAllowlist"]
  currentLoad: {
    activeSubSessions: number
    queuedSubSessions: number
    failedSubSessions: number
    completedSubSessions: number
    maxParallelSessions: number
    utilization: number
  }
  failureRate: {
    windowMs: number
    consideredSubSessions: number
    failedSubSessions: number
    value: number
  }
}

export interface OrchestrationTeamRegistryEntry {
  teamId: string
  displayName: string
  nickname?: string
  status: TeamConfig["status"]
  purpose: string
  roleHints: string[]
  memberAgentIds: string[]
  activeMemberAgentIds: string[]
  unresolvedMemberAgentIds: string[]
  source: "db" | "config"
  config: TeamConfig
}

export interface OrchestrationRegistrySnapshot {
  generatedAt: number
  agents: OrchestrationAgentRegistryEntry[]
  teams: OrchestrationTeamRegistryEntry[]
  membershipEdges: Array<{
    teamId: string
    agentId: string
    status: "active" | "unresolved" | "removed"
    roleHint?: string
  }>
  diagnostics: Array<{ code: string; message: string }>
}

export interface OrchestrationRegistryResponse {
  snapshot: OrchestrationRegistrySnapshot
}

export interface OrchestrationGraphResponse {
  graph: {
    nodes: RelationshipGraphNode[]
    edges: RelationshipGraphEdge[]
  }
  diagnostics: OrchestrationRegistrySnapshot["diagnostics"]
}

export interface OrchestrationConfigExportPackage {
  schemaVersion: 1
  packageVersion: 1
  targetType: OrchestrationTargetType
  targetId: string
  compatibleNobieVersion: string
  redactionState: "redacted" | "not_sensitive"
  generatedAt: number
  checksum: string
  config: AgentConfig | TeamConfig
  redactedPaths: string[]
}

export interface OrchestrationConfigExportResponse {
  exportPackage: OrchestrationConfigExportPackage
  canonicalJson: string
}

export interface OrchestrationImportResult {
  ok: boolean
  validationOnly: boolean
  stored: boolean
  action: "created" | "updated" | "copied" | "cancelled" | "validated"
  targetType?: OrchestrationTargetType
  targetId?: string
  conflict?: "none" | "existing_target"
  activationRequired: boolean
  approvalRequired: boolean
  effectSummary: string[]
  issues: Array<{ path: string; code: string; message: string }>
  safeMessage: string
  config?: AgentConfig | TeamConfig
  exportPackage?: OrchestrationConfigExportPackage
}

export interface OrchestrationWriteOptions {
  validationOnly?: boolean
  idempotencyKey?: string
  expectedProfileVersion?: number
  auditCorrelationId?: string
}

export interface OrchestrationImportRequest extends OrchestrationWriteOptions {
  content?: string
  package?: unknown
  format?: "json" | "yaml"
  conflictStrategy?: OrchestrationConflictStrategy
}

export interface OrchestrationDataExchangeListResponse {
  items: DataExchangePackage[]
  total: number
}

export interface OrchestrationSubSessionListResponse {
  items: Array<SubSessionContract | Record<string, unknown>>
  total: number
}

export interface OrchestrationCapabilityDelegationListResponse {
  items: Array<CapabilityDelegationRequest | Record<string, unknown>>
  total: number
}
