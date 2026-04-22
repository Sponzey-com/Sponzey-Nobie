import type { OrchestrationRegistrySnapshot } from "../contracts/orchestration-api"
import type { SubAgentConfig, TeamConfig } from "../contracts/sub-agent-orchestration"
import {
  applyOrchestrationMembershipToConfigs,
  buildOrchestrationMembershipIndex,
  type OrchestrationMembershipIndex,
  type OrchestrationMembershipLink,
} from "./orchestration-membership"
import {
  inferAgentCapabilityPresetId,
  inferAgentRiskPresetId,
  inferAgentRolePresetId,
  inferTeamPurposePresetId,
  type AgentCapabilityPresetId,
  type AgentRiskPresetId,
  type AgentRolePresetId,
  type TeamPurposePresetId,
} from "./orchestration-presets"

export interface BoardAgentDraft {
  kind: "agent"
  agentId: string
  displayName: string
  nickname?: string
  status: SubAgentConfig["status"]
  rolePresetId: AgentRolePresetId
  riskPresetId: AgentRiskPresetId
  capabilityPresetId: AgentCapabilityPresetId
  persisted: boolean
  lockedId: boolean
  config: SubAgentConfig
}

export interface BoardTeamLaneDraft {
  kind: "team"
  teamId: string
  displayName: string
  nickname?: string
  status: TeamConfig["status"]
  purposePresetId: TeamPurposePresetId
  persisted: boolean
  lockedId: boolean
  config: TeamConfig
}

export interface PendingDropActionOption {
  id: "add_to_team" | "move_to_team" | "clone_to_team" | "create_team_and_add" | "unassign" | "archive" | "cancel"
  label: string
  description: string
  tone: "neutral" | "safe" | "warning" | "danger"
  recommended?: boolean
}

export interface PendingDropAction {
  entityType: "agent"
  entityId: string
  title: string
  summary: string
  sourceKind: "team" | "unassigned"
  targetKind: "team" | "unassigned" | "canvas" | "archive"
  sourceTeamId?: string | null
  targetTeamId?: string | null
  fromLaneId?: string | null
  toLaneId?: string | null
  options: PendingDropActionOption[]
  openedAt: number
}

export interface BoardDragState {
  entityType: "agent" | "team"
  entityId: string
  sourceLaneId?: string | null
  overLaneId?: string | null
  phase: "idle" | "dragging" | "pending_drop"
}

export interface BoardValidationIssue {
  severity: "info" | "warning" | "error"
  category: "field" | "membership" | "policy" | "runtime_prerequisite"
  code: string
  targetType: "board" | "agent" | "team" | "membership"
  targetId: string
  field?: string
  message: string
  agentId?: string
  teamId?: string
}

export interface BoardValidationSnapshot {
  generatedAt: number
  issues: BoardValidationIssue[]
}

export interface BoardPersistInstruction {
  targetType: "team" | "agent"
  targetId: string
}

export interface OrchestrationBoardDraft {
  version: 1
  agents: BoardAgentDraft[]
  teams: BoardTeamLaneDraft[]
  memberships: OrchestrationMembershipLink[]
  selectedNodeId?: string
  dirty: boolean
  dragState: BoardDragState | null
  pendingDrop: PendingDropAction | null
  lastValidation: BoardValidationSnapshot | null
  persistMeta: {
    allowPartialWrite: false
    saveOrder: BoardPersistInstruction[]
    source: "board_draft"
  }
}

export function createOrchestrationBoardDraft(input: {
  agents: SubAgentConfig[]
  teams: TeamConfig[]
  snapshot?: OrchestrationRegistrySnapshot | null
  selectedNodeId?: string
  dirty?: boolean
  dragState?: BoardDragState | null
  pendingDrop?: PendingDropAction | null
  lastValidation?: BoardValidationSnapshot | null
}): OrchestrationBoardDraft {
  const persistedAgentIds = new Set(input.snapshot?.agents.map((agent) => agent.agentId) ?? input.agents.map((agent) => agent.agentId))
  const persistedTeamIds = new Set(input.snapshot?.teams.map((team) => team.teamId) ?? input.teams.map((team) => team.teamId))
  const membership = buildOrchestrationMembershipIndex({
    agents: input.agents,
    teams: input.teams,
    source: "draft",
  })

  return {
    version: 1,
    agents: input.agents.map((config) => ({
      kind: "agent",
      agentId: config.agentId,
      displayName: config.displayName,
      ...(config.nickname ? { nickname: config.nickname } : {}),
      status: config.status,
      rolePresetId: inferAgentRolePresetId(config),
      riskPresetId: inferAgentRiskPresetId(config),
      capabilityPresetId: inferAgentCapabilityPresetId(config),
      persisted: persistedAgentIds.has(config.agentId),
      lockedId: persistedAgentIds.has(config.agentId),
      config: { ...config },
    })),
    teams: input.teams.map((config) => ({
      kind: "team",
      teamId: config.teamId,
      displayName: config.displayName,
      ...(config.nickname ? { nickname: config.nickname } : {}),
      status: config.status,
      purposePresetId: inferTeamPurposePresetId(config),
      persisted: persistedTeamIds.has(config.teamId),
      lockedId: persistedTeamIds.has(config.teamId),
      config: { ...config },
    })),
    memberships: membership.links,
    ...(input.selectedNodeId ? { selectedNodeId: input.selectedNodeId } : {}),
    dirty: input.dirty ?? false,
    dragState: input.dragState ?? null,
    pendingDrop: input.pendingDrop ?? null,
    lastValidation: input.lastValidation ?? null,
    persistMeta: {
      allowPartialWrite: false,
      saveOrder: buildBoardPersistOrder(input.teams.map((team) => team.teamId), input.agents.map((agent) => agent.agentId)),
      source: "board_draft",
    },
  }
}

export function materializeOrchestrationBoardDraft(input: {
  draft: OrchestrationBoardDraft
}): {
  agents: SubAgentConfig[]
  teams: TeamConfig[]
  membership: OrchestrationMembershipIndex
  persistMeta: OrchestrationBoardDraft["persistMeta"]
} {
  const materialized = applyOrchestrationMembershipToConfigs({
    agents: input.draft.agents.map((agent) => ({ ...agent.config })),
    teams: input.draft.teams.map((team) => ({ ...team.config })),
    links: input.draft.memberships,
  })

  return {
    agents: materialized.agents,
    teams: materialized.teams,
    membership: materialized.membership,
    persistMeta: input.draft.persistMeta,
  }
}

export function buildBoardPersistOrder(teamIds: string[], agentIds: string[]): BoardPersistInstruction[] {
  return [
    ...teamIds.map((targetId) => ({ targetType: "team" as const, targetId })),
    ...agentIds.map((targetId) => ({ targetType: "agent" as const, targetId })),
  ]
}
