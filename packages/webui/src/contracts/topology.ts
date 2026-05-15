export type AgentTopologyNodeKind = "nobie" | "sub_agent" | "team" | "team_lead" | "team_role"

export type AgentTopologyEdgeKind = "parent_child" | "team_membership"
export type AgentTopologyEdgeStyle =
  | "hierarchy"
  | "membership"
  | "membership_reference"
  | "lead"
  | "invalid"

export interface AgentTopologyPosition {
  x: number
  y: number
  collapsed?: boolean
}

export interface AgentTopologyDiagnostic {
  reasonCode: string
  severity: "info" | "warning" | "blocked" | "invalid"
  message: string
  nodeId?: string
  edgeId?: string
  agentId?: string
  teamId?: string
  parentAgentId?: string
  childAgentId?: string
}

export interface AgentTopologyNode {
  id: string
  kind: AgentTopologyNodeKind
  entityId: string
  label: string
  status?: string
  position: AgentTopologyPosition
  badges: string[]
  data: Record<string, unknown>
  diagnostics: AgentTopologyDiagnostic[]
}

export interface AgentTopologyEdge {
  id: string
  kind: AgentTopologyEdgeKind
  source: string
  target: string
  label?: string
  valid: boolean
  style: AgentTopologyEdgeStyle
  data: Record<string, unknown>
  diagnostics: AgentTopologyDiagnostic[]
}

export interface AgentTopologyAgentInspector {
  agentId: string
  nodeId: string
  kind: "nobie" | "sub_agent"
  displayName: string
  nickname?: string
  status: string
  role: string
  specialtyTags: string[]
  teamIds: string[]
  source: "db" | "config" | "synthetic"
  model: {
    providerId?: string
    modelId?: string
    fallbackModelId?: string
    availability?: string
    reasonCodes: string[]
  }
  skillMcp: {
    enabledSkillIds: string[]
    enabledMcpServerIds: string[]
    enabledToolNames: string[]
    disabledToolNames: string[]
    secretScope: "configured" | "none"
  }
  tools: {
    enabledCount: number
    disabledCount: number
    enabledToolNames: string[]
    disabledToolNames: string[]
  }
  memory: {
    owner: string
    visibility: "private" | "coordinator_visible" | "team_visible" | "unknown"
    readScopeCount: number
    readScopes: string[]
    writeScope: string
    retentionPolicy: "session" | "short_term" | "long_term" | "unknown"
    writebackReviewRequired: boolean
  }
  capability: {
    riskCeiling?: string
    approvalRequiredFrom?: string
    allowExternalNetwork: boolean
    allowFilesystemWrite: boolean
    allowShellExecution: boolean
    allowScreenControl: boolean
    allowedPathCount: number
    availability?: string
    reasonCodes: string[]
  }
  delegation: {
    enabled: boolean
    maxParallelSessions: number
  }
  diagnostics: string[]
}

export interface AgentTopologyTeamBuilderCandidate {
  agentId: string
  label: string
  directChild: boolean
  configuredMember: boolean
  active: boolean
  canActivate: boolean
  membershipStatus: "active" | "inactive" | "fallback_only" | "removed" | "unconfigured"
  primaryRole?: string
  teamRoles: string[]
  reasonCodes: string[]
}

export interface AgentTopologyTeamMemberInspector {
  agentId: string
  label: string
  membershipId?: string
  primaryRole: string
  teamRoles: string[]
  required: boolean
  executionState: string
  directChild: boolean
  active: boolean
  reasonCodes: string[]
  specialtyTags: string[]
  capabilityIds: string[]
  modelAvailability?: string
  capabilityAvailability?: string
}

export interface AgentTopologyCoverageDimension {
  required: string[]
  covered: string[]
  missing: string[]
  providers: Record<string, string[]>
}

export interface AgentTopologyTeamInspector {
  teamId: string
  nodeId: string
  displayName: string
  nickname?: string
  status: string
  purpose: string
  ownerAgentId: string
  leadAgentId?: string
  memberAgentIds: string[]
  activeMemberAgentIds: string[]
  roleHints: string[]
  requiredTeamRoles: string[]
  requiredCapabilityTags: string[]
  members: AgentTopologyTeamMemberInspector[]
  roleCoverage: AgentTopologyCoverageDimension
  capabilityCoverage: AgentTopologyCoverageDimension
  health: {
    status: "healthy" | "degraded" | "invalid" | "unknown"
    executionCandidate: boolean
    activeMemberCount: number
    referenceMemberCount: number
    unresolvedMemberCount: number
    excludedMemberCount: number
    degradedReasonCodes: string[]
  }
  builder: {
    ownerAgentId: string
    directChildAgentIds: string[]
    candidates: AgentTopologyTeamBuilderCandidate[]
  }
  diagnostics: AgentTopologyDiagnostic[]
}

export interface AgentTopologyProjection {
  schemaVersion: 1
  generatedAt: number
  rootAgentId: string
  nodes: AgentTopologyNode[]
  edges: AgentTopologyEdge[]
  inspectors: {
    agents: Record<string, AgentTopologyAgentInspector>
    teams: Record<string, AgentTopologyTeamInspector>
  }
  layout: {
    schemaVersion: number
    layout: string
    nodes: Record<string, AgentTopologyPosition>
    viewport?: { x: number; y: number; zoom: number }
    updatedAt: number | null
  }
  diagnostics: AgentTopologyDiagnostic[]
  validation: {
    hierarchy: {
      maxDepth: number
      maxChildCount: number
    }
    teamActiveMembershipRule: "owner_direct_child_required"
  }
}

export interface AgentTopologyResponse extends AgentTopologyProjection {
  ok: boolean
}

export const EXECUTOR_TOPOLOGY_V2_SCHEMA_VERSION = 2 as const

export type ExecutorTopologyV2SchemaVersion = typeof EXECUTOR_TOPOLOGY_V2_SCHEMA_VERSION
export type ExecutorTopologyV2Status = "draft" | "active" | "archived"
export type ExecutorNodeV2Status = "active" | "archived"
export type ExecutorEdgeV2Status = "active" | "archived"
export type ExecutorTopologyV2Timestamp = number | string
export type ExecutorTopologyV2MetadataValue =
  | string
  | number
  | boolean
  | null
  | ExecutorTopologyV2MetadataValue[]
  | { [key: string]: ExecutorTopologyV2MetadataValue | undefined }
export type ExecutorTopologyV2Metadata = { [key: string]: ExecutorTopologyV2MetadataValue | undefined }

export interface ExecutorNodeV2 {
  id: string
  name: string
  roleName?: string
  description: string
  definitionQuickChips?: string[]
  instruction?: string
  position: {
    x: number
    y: number
  }
  status: ExecutorNodeV2Status
  profile?: ExecutorTopologyV2Metadata
  metadata?: ExecutorTopologyV2Metadata
}

export interface ExecutorEdgeV2 {
  id: string
  sourceNodeId: string
  targetNodeId: string
  type: "delegates_to"
  label?: string
  status: ExecutorEdgeV2Status
}

export interface ExecutorTopologyV2 {
  schemaVersion: ExecutorTopologyV2SchemaVersion
  id: string
  name: string
  status: ExecutorTopologyV2Status
  activeVersion?: number
  nodes: ExecutorNodeV2[]
  edges: ExecutorEdgeV2[]
  metadata?: ExecutorTopologyV2Metadata
  createdAt: ExecutorTopologyV2Timestamp
  updatedAt: ExecutorTopologyV2Timestamp
}

export interface ExecutorRuntimeGraphSnapshotV2 {
  topologyId: string
  schemaVersion: ExecutorTopologyV2SchemaVersion
  rootAgentId: "agent:nobie"
  nodes: ExecutorNodeV2[]
  edges: ExecutorEdgeV2[]
  rootDirectChildIds: string[]
  directChildrenByNodeId: Record<string, string[]>
}

export interface ExecutorTopologyV2ValidationIssue {
  code: string
  severity: "error" | "warning"
  path: string
  message: string
  nodeId?: string
  edgeId?: string
}

export interface ExecutorTopologyV2ValidationResult {
  ok: boolean
  issues: ExecutorTopologyV2ValidationIssue[]
}

export interface ExecutorTopologyV2MigrationIssue {
  code: string
  severity: "info" | "warning" | "invalid"
  message: string
  topologyId: string
  nodeId?: string
  edgeId?: string
  relationId?: string
}

export interface ExecutorTopologyV2MigrationResult {
  topology: ExecutorTopologyV2
  issues: ExecutorTopologyV2MigrationIssue[]
}

export interface ExecutorTopologyV2PersistenceRepairResult {
  topology: ExecutorTopologyV2
  issues: ExecutorTopologyV2MigrationIssue[]
}

export interface AgentTopologyEdgeValidationInput {
  kind: AgentTopologyEdgeKind
  sourceAgentId?: string
  targetAgentId?: string
  teamId?: string
  agentId?: string
  memberStatus?: "active" | "inactive" | "fallback_only" | "removed"
  relationship?: unknown
}

export interface AgentTopologyEdgeValidationResponse {
  ok: boolean
  valid: boolean
  kind: AgentTopologyEdgeKind
  relationship?: unknown
  diagnostics: AgentTopologyDiagnostic[]
}

export interface AgentRelationshipCreateResponse {
  ok: boolean
  relationship: unknown
  diagnostics: AgentTopologyDiagnostic[]
}

export interface AgentTopologyTeamMembershipDraft {
  agentId: string
  active: boolean
  primaryRole: string
  teamRoles: string[]
  required: boolean
}

export interface AgentTopologyTeamMembersPayload {
  memberAgentIds: string[]
  roleHints: string[]
  memberships: Array<{
    membershipId: string
    teamId: string
    agentId: string
    ownerAgentIdSnapshot?: string
    teamRoles: string[]
    primaryRole: string
    required: boolean
    sortOrder: number
    status: "active" | "inactive"
  }>
}
