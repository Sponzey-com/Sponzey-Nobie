import type { BoardAgentDraft, BoardTeamLaneDraft, OrchestrationBoardDraft } from "./orchestration-board"
import { reconcileOrchestrationBoardDraft, reduceOrchestrationBoardDraft } from "./orchestration-board-reducer"
import { generateOrchestrationEntityId } from "./orchestration-id"
import {
  AGENT_CAPABILITY_PRESETS,
  AGENT_RISK_PRESETS,
  AGENT_ROLE_PRESETS,
  DEFAULT_AGENT_CAPABILITY_PRESET,
  DEFAULT_AGENT_RISK_PRESET,
  DEFAULT_AGENT_ROLE_PRESET,
  DEFAULT_TEAM_PURPOSE_PRESET,
  TEAM_PURPOSE_PRESETS,
  buildPresetSubAgentConfig,
  buildPresetTeamConfig,
  inferAgentCapabilityPresetId,
  inferAgentRiskPresetId,
  inferAgentRolePresetId,
  inferTeamPurposePresetId,
  type AgentCapabilityPresetId,
  type AgentRiskPresetId,
  type AgentRolePresetId,
  type TeamPurposePresetId,
} from "./orchestration-presets"
import { createSubAgentConfig, createTeamConfig } from "./orchestration-ui"

export interface CreateBoardAgentDraftInput {
  draft: OrchestrationBoardDraft
  displayName: string
  rolePresetId?: AgentRolePresetId
  riskPresetId?: AgentRiskPresetId
  capabilityPresetId?: AgentCapabilityPresetId
  now?: number
  randomSuffix?: () => string
}

export interface CreateBoardTeamDraftInput {
  draft: OrchestrationBoardDraft
  displayName: string
  purposePresetId?: TeamPurposePresetId
  now?: number
  randomSuffix?: () => string
}

export interface CreateBoardAgentDraftFromDescriptionInput {
  draft: OrchestrationBoardDraft
  displayName: string
  description?: string
  teamId?: string | null
  now?: number
  randomSuffix?: () => string
}

export interface CreateBoardTeamDraftFromDescriptionInput {
  draft: OrchestrationBoardDraft
  displayName: string
  description?: string
  now?: number
  randomSuffix?: () => string
}

export interface BoardAgentQuickEditPatch {
  agentId?: string
  displayName?: string
  nickname?: string
  role?: string
  status?: BoardAgentDraft["status"]
  rolePresetId?: AgentRolePresetId
  riskPresetId?: AgentRiskPresetId
  capabilityPresetId?: AgentCapabilityPresetId
  personality?: string
  specialtyTags?: string[]
  avoidTasks?: string[]
  enabledSkillIds?: string[]
  enabledMcpServerIds?: string[]
  enabledToolNames?: string[]
  allowExternalNetwork?: boolean
  allowFilesystemWrite?: boolean
  allowShellExecution?: boolean
  allowScreenControl?: boolean
  allowedPaths?: string[]
}

export interface BoardTeamQuickEditPatch {
  teamId?: string
  displayName?: string
  nickname?: string
  purpose?: string
  status?: BoardTeamLaneDraft["status"]
  purposePresetId?: TeamPurposePresetId
  roleHints?: string[]
}

export function createBoardAgentDraft(input: CreateBoardAgentDraftInput): OrchestrationBoardDraft {
  const agentId = generateOrchestrationEntityId({
    kind: "agent",
    displayName: input.displayName,
    existingIds: input.draft.agents.map((entry) => entry.agentId),
    draftIds: input.draft.agents.map((entry) => entry.agentId),
    randomSuffix: input.randomSuffix,
  })
  const rolePresetId = input.rolePresetId ?? DEFAULT_AGENT_ROLE_PRESET
  const riskPresetId = input.riskPresetId ?? DEFAULT_AGENT_RISK_PRESET
  const capabilityPresetId = input.capabilityPresetId ?? DEFAULT_AGENT_CAPABILITY_PRESET
  const config = buildPresetSubAgentConfig({
    agentId,
    displayName: input.displayName,
    rolePresetId,
    riskPresetId,
    capabilityPresetId,
    now: input.now,
  })
  return reconcileOrchestrationBoardDraft({
    draft: {
      ...input.draft,
      agents: [
        ...input.draft.agents,
        {
          kind: "agent",
          agentId,
          displayName: config.displayName,
          ...(config.nickname ? { nickname: config.nickname } : {}),
          status: config.status,
          rolePresetId,
          riskPresetId,
          capabilityPresetId,
          persisted: false,
          lockedId: false,
          config,
        },
      ],
    },
    memberships: input.draft.memberships,
    selectedNodeId: `agent:${agentId}`,
  })
}

export function createBoardAgentDraftInTeam(input: CreateBoardAgentDraftInput & {
  teamId: string
}): OrchestrationBoardDraft {
  const created = createBoardAgentDraft(input)
  const createdAgentId = created.selectedNodeId?.startsWith("agent:")
    ? created.selectedNodeId.slice("agent:".length)
    : created.agents[created.agents.length - 1]?.agentId
  if (!createdAgentId) return created
  return reduceOrchestrationBoardDraft(created, {
    type: "add_to_team",
    agentId: createdAgentId,
    targetTeamId: input.teamId,
  })
}

export function createBoardAgentDraftFromDescription(input: CreateBoardAgentDraftFromDescriptionInput): OrchestrationBoardDraft {
  const created = input.teamId
    ? createBoardAgentDraftInTeam({
        draft: input.draft,
        displayName: input.displayName,
        teamId: input.teamId,
        now: input.now,
        randomSuffix: input.randomSuffix,
      })
    : createBoardAgentDraft({
        draft: input.draft,
        displayName: input.displayName,
        now: input.now,
        randomSuffix: input.randomSuffix,
      })
  const createdAgentId = created.selectedNodeId?.startsWith("agent:")
    ? created.selectedNodeId.slice("agent:".length)
    : created.agents[created.agents.length - 1]?.agentId
  if (!createdAgentId) return created
  const description = input.description?.trim() ?? ""
  return patchBoardAgentDraft({
    draft: created,
    agentId: createdAgentId,
    patch: {
      role: summarizeDescriptionAsRole(description),
      personality: description || undefined,
    },
    now: input.now,
  })
}

export function createBoardTeamDraft(input: CreateBoardTeamDraftInput): OrchestrationBoardDraft {
  const teamId = generateOrchestrationEntityId({
    kind: "team",
    displayName: input.displayName,
    existingIds: input.draft.teams.map((entry) => entry.teamId),
    draftIds: input.draft.teams.map((entry) => entry.teamId),
    randomSuffix: input.randomSuffix,
  })
  const purposePresetId = input.purposePresetId ?? DEFAULT_TEAM_PURPOSE_PRESET
  const config = buildPresetTeamConfig({
    teamId,
    displayName: input.displayName,
    purposePresetId,
    now: input.now,
  })
  return reconcileOrchestrationBoardDraft({
    draft: {
      ...input.draft,
      teams: [
        ...input.draft.teams,
        {
          kind: "team",
          teamId,
          displayName: config.displayName,
          ...(config.nickname ? { nickname: config.nickname } : {}),
          status: config.status,
          purposePresetId,
          persisted: false,
          lockedId: false,
          config,
        },
      ],
    },
    memberships: input.draft.memberships,
    selectedNodeId: `team:${teamId}`,
  })
}

export function createBoardTeamDraftFromDescription(input: CreateBoardTeamDraftFromDescriptionInput): OrchestrationBoardDraft {
  const created = createBoardTeamDraft({
    draft: input.draft,
    displayName: input.displayName,
    now: input.now,
    randomSuffix: input.randomSuffix,
  })
  const createdTeamId = created.selectedNodeId?.startsWith("team:")
    ? created.selectedNodeId.slice("team:".length)
    : created.teams[created.teams.length - 1]?.teamId
  if (!createdTeamId) return created
  return patchBoardTeamDraft({
    draft: created,
    teamId: createdTeamId,
    patch: {
      purpose: input.description?.trim() || undefined,
    },
    now: input.now,
  })
}

export function patchBoardAgentDraft(input: {
  draft: OrchestrationBoardDraft
  agentId: string
  patch: BoardAgentQuickEditPatch
  now?: number
}): OrchestrationBoardDraft {
  const current = input.draft.agents.find((entry) => entry.agentId === input.agentId)
  if (!current) return input.draft
  const nextAgentId = current.lockedId
    ? current.agentId
    : input.patch.agentId?.trim() || current.agentId
  const rolePresetId = input.patch.rolePresetId ?? current.rolePresetId ?? inferAgentRolePresetId(current.config)
  const riskPresetId = input.patch.riskPresetId ?? current.riskPresetId ?? inferAgentRiskPresetId(current.config)
  const capabilityPresetId = input.patch.capabilityPresetId ?? current.capabilityPresetId ?? inferAgentCapabilityPresetId(current.config)
  const rolePreset = AGENT_ROLE_PRESETS[rolePresetId]
  const riskPreset = AGENT_RISK_PRESETS[riskPresetId]
  const capabilityPreset = AGENT_CAPABILITY_PRESETS[capabilityPresetId]
  const permissionProfile = current.config.capabilityPolicy.permissionProfile

  const config = createSubAgentConfig({
    agentId: nextAgentId,
    displayName: input.patch.displayName ?? current.config.displayName,
    nickname: input.patch.nickname ?? current.config.nickname,
    role: input.patch.role ?? (input.patch.rolePresetId ? rolePreset.role : current.config.role),
    personality: input.patch.personality ?? (input.patch.rolePresetId ? rolePreset.personality : current.config.personality),
    specialtyTags: uniqueValues(input.patch.specialtyTags ?? (input.patch.rolePresetId ? rolePreset.specialtyTags : current.config.specialtyTags)),
    avoidTasks: uniqueValues(input.patch.avoidTasks ?? (input.patch.rolePresetId ? rolePreset.avoidTasks : current.config.avoidTasks)),
    teamIds: current.config.teamIds,
    riskCeiling: riskPreset.riskCeiling,
    enabledSkillIds: uniqueValues(input.patch.enabledSkillIds ?? (input.patch.capabilityPresetId ? capabilityPreset.enabledSkillIds : current.config.capabilityPolicy.skillMcpAllowlist.enabledSkillIds)),
    enabledMcpServerIds: uniqueValues(input.patch.enabledMcpServerIds ?? (input.patch.capabilityPresetId ? capabilityPreset.enabledMcpServerIds : current.config.capabilityPolicy.skillMcpAllowlist.enabledMcpServerIds)),
    enabledToolNames: uniqueValues(input.patch.enabledToolNames ?? (input.patch.capabilityPresetId ? capabilityPreset.enabledToolNames : current.config.capabilityPolicy.skillMcpAllowlist.enabledToolNames)),
    allowExternalNetwork: input.patch.allowExternalNetwork ?? (
      input.patch.riskPresetId || input.patch.capabilityPresetId
        ? riskPreset.allowExternalNetwork || capabilityPreset.allowExternalNetwork
        : permissionProfile.allowExternalNetwork
    ),
    allowFilesystemWrite: input.patch.allowFilesystemWrite ?? (
      input.patch.riskPresetId || input.patch.capabilityPresetId
        ? riskPreset.allowFilesystemWrite || capabilityPreset.allowFilesystemWrite
        : permissionProfile.allowFilesystemWrite
    ),
    allowShellExecution: input.patch.allowShellExecution ?? (
      input.patch.riskPresetId || input.patch.capabilityPresetId
        ? riskPreset.allowShellExecution || capabilityPreset.allowShellExecution
        : permissionProfile.allowShellExecution
    ),
    allowScreenControl: input.patch.allowScreenControl ?? (
      input.patch.riskPresetId || input.patch.capabilityPresetId
        ? riskPreset.allowScreenControl || capabilityPreset.allowScreenControl
        : permissionProfile.allowScreenControl
    ),
    allowedPaths: uniqueValues(input.patch.allowedPaths ?? (input.patch.capabilityPresetId ? capabilityPreset.allowedPaths : permissionProfile.allowedPaths)),
    existing: current.config,
    now: input.now,
  })

  const nextConfig = nextAgentId !== current.agentId && !current.persisted
    ? {
        ...config,
        memoryPolicy: {
          ...config.memoryPolicy,
          owner: { ownerType: "sub_agent" as const, ownerId: nextAgentId },
          readScopes: config.memoryPolicy.readScopes.map((scope) =>
            scope.ownerType === "sub_agent" && scope.ownerId === current.agentId
              ? { ...scope, ownerId: nextAgentId }
              : scope),
          writeScope:
            config.memoryPolicy.writeScope.ownerType === "sub_agent" && config.memoryPolicy.writeScope.ownerId === current.agentId
              ? { ...config.memoryPolicy.writeScope, ownerId: nextAgentId }
              : config.memoryPolicy.writeScope,
        },
        capabilityPolicy: {
          ...config.capabilityPolicy,
          permissionProfile: {
            ...config.capabilityPolicy.permissionProfile,
            profileId: `profile:${nextAgentId}`,
            approvalRequiredFrom: riskPreset.riskCeiling === "safe" ? "moderate" : riskPreset.riskCeiling,
          },
        },
      }
    : {
        ...config,
        capabilityPolicy: {
          ...config.capabilityPolicy,
          permissionProfile: {
            ...config.capabilityPolicy.permissionProfile,
            approvalRequiredFrom: riskPreset.riskCeiling === "safe" ? "moderate" : riskPreset.riskCeiling,
          },
        },
      }

  const nextAgents = input.draft.agents.map((entry) =>
    entry.agentId === current.agentId
      ? {
          ...entry,
          agentId: nextAgentId,
          displayName: nextConfig.displayName,
          nickname: nextConfig.nickname,
          status: input.patch.status ?? entry.status,
          rolePresetId,
          riskPresetId,
          capabilityPresetId,
          config: {
            ...nextConfig,
            status: input.patch.status ?? nextConfig.status,
          },
        }
      : entry)
  const nextMemberships = input.draft.memberships.map((link) =>
    link.agentId === current.agentId
      ? { ...link, agentId: nextAgentId, id: `membership:${link.teamId}:${nextAgentId}` }
      : link)

  return reconcileOrchestrationBoardDraft({
    draft: {
      ...input.draft,
      agents: nextAgents,
    },
    agents: nextAgents,
    memberships: nextMemberships,
    selectedNodeId: `agent:${nextAgentId}`,
  })
}

export function patchBoardTeamDraft(input: {
  draft: OrchestrationBoardDraft
  teamId: string
  patch: BoardTeamQuickEditPatch
  now?: number
}): OrchestrationBoardDraft {
  const current = input.draft.teams.find((entry) => entry.teamId === input.teamId)
  if (!current) return input.draft
  const nextTeamId = current.lockedId
    ? current.teamId
    : input.patch.teamId?.trim() || current.teamId
  const purposePresetId = input.patch.purposePresetId ?? current.purposePresetId ?? inferTeamPurposePresetId(current.config)
  const purposePreset = TEAM_PURPOSE_PRESETS[purposePresetId]
  const config = createTeamConfig({
    teamId: nextTeamId,
    displayName: input.patch.displayName ?? current.config.displayName,
    nickname: input.patch.nickname ?? current.config.nickname,
    purpose: input.patch.purpose ?? (input.patch.purposePresetId ? purposePreset.purpose : current.config.purpose),
    memberAgentIds: current.config.memberAgentIds,
    roleHints: uniqueValues(input.patch.roleHints ?? current.config.roleHints),
    existing: current.config,
    now: input.now,
  })
  const nextTeams = input.draft.teams.map((entry) =>
    entry.teamId === current.teamId
      ? {
          ...entry,
          teamId: nextTeamId,
          displayName: config.displayName,
          nickname: config.nickname,
          status: input.patch.status ?? entry.status,
          purposePresetId,
          config: {
            ...config,
            status: input.patch.status ?? config.status,
          },
        }
      : entry)
  const nextMemberships = input.draft.memberships.map((link) =>
    link.teamId === current.teamId
      ? { ...link, teamId: nextTeamId, id: `membership:${nextTeamId}:${link.agentId}` }
      : link)

  return reconcileOrchestrationBoardDraft({
    draft: {
      ...input.draft,
      teams: nextTeams,
    },
    teams: nextTeams,
    memberships: nextMemberships,
    selectedNodeId: `team:${nextTeamId}`,
  })
}

function uniqueValues(values: string[]): string[] {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)))
}

function summarizeDescriptionAsRole(description: string): string {
  const first = description
    .split(/\n+/)
    .flatMap((line) => line.split(/[.!?]+/))
    .map((value) => value.trim())
    .find(Boolean)
  return first || "General sub-agent"
}
