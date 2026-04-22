import type {
  OrchestrationAgentRegistryEntry,
  OrchestrationRegistrySnapshot,
  OrchestrationTeamRegistryEntry,
} from "../contracts/orchestration-api"
import type { SkillMcpAllowlist, SubAgentConfig, TeamConfig } from "../contracts/sub-agent-orchestration"
import {
  buildBoardPersistOrder,
  type BoardAgentDraft,
  type BoardTeamLaneDraft,
  type OrchestrationBoardDraft,
  type PendingDropAction,
  type PendingDropActionOption,
} from "./orchestration-board"
import { applyOrchestrationMembershipToConfigs } from "./orchestration-membership"
import { generateOrchestrationEntityId } from "./orchestration-id"
import {
  buildPresetTeamConfig,
  inferAgentCapabilityPresetId,
  inferAgentRiskPresetId,
  inferAgentRolePresetId,
  inferTeamPurposePresetId,
} from "./orchestration-presets"
import { createSubAgentConfig } from "./orchestration-ui"
import { pickUiText, type UiLanguage } from "../stores/uiLanguage"

export type OrchestrationBoardReducerAction =
  | { type: "add_to_team"; agentId: string; targetTeamId: string }
  | { type: "move_to_team"; agentId: string; sourceTeamId?: string | null; targetTeamId: string }
  | { type: "clone_to_team"; agentId: string; targetTeamId: string; language: UiLanguage; now?: number; randomSuffix?: () => string }
  | { type: "create_team_and_add"; agentId: string; language: UiLanguage; now?: number; randomSuffix?: () => string }
  | { type: "unassign"; agentId: string; sourceTeamId?: string | null }
  | { type: "archive_agent"; agentId: string }
  | { type: "cancel_pending_drop" }

export function reduceOrchestrationBoardDraft(
  draft: OrchestrationBoardDraft,
  action: OrchestrationBoardReducerAction,
): OrchestrationBoardDraft {
  switch (action.type) {
    case "add_to_team":
      return reconcileOrchestrationBoardDraft({
        draft,
        memberships: addMembershipLink(draft.memberships, action.targetTeamId, action.agentId),
        selectedNodeId: `agent:${action.agentId}`,
      })
    case "move_to_team":
      return reconcileOrchestrationBoardDraft({
        draft,
        memberships: addMembershipLink(
          removeMembershipLink(draft.memberships, action.sourceTeamId ?? null, action.agentId),
          action.targetTeamId,
          action.agentId,
        ),
        selectedNodeId: `agent:${action.agentId}`,
      })
    case "unassign":
      return reconcileOrchestrationBoardDraft({
        draft,
        memberships: removeMembershipLink(draft.memberships, action.sourceTeamId ?? null, action.agentId),
        selectedNodeId: `agent:${action.agentId}`,
      })
    case "archive_agent":
      return archiveBoardAgent(draft, action.agentId)
    case "clone_to_team":
      return cloneBoardAgentToTeam(draft, action)
    case "create_team_and_add":
      return createTeamAndAddAgent(draft, action)
    case "cancel_pending_drop":
      return {
        ...draft,
        dragState: null,
        pendingDrop: null,
      }
    default:
      return draft
  }
}

export function resolveReducerActionFromPendingDrop(input: {
  pendingDrop: PendingDropAction
  optionId: PendingDropActionOption["id"]
  language: UiLanguage
  now?: number
  randomSuffix?: () => string
}): OrchestrationBoardReducerAction {
  const { pendingDrop, optionId, language, now, randomSuffix } = input
  switch (optionId) {
    case "add_to_team":
      return {
        type: "add_to_team",
        agentId: pendingDrop.entityId,
        targetTeamId: pendingDrop.targetTeamId ?? "",
      }
    case "move_to_team":
      return {
        type: "move_to_team",
        agentId: pendingDrop.entityId,
        sourceTeamId: pendingDrop.sourceTeamId ?? null,
        targetTeamId: pendingDrop.targetTeamId ?? "",
      }
    case "clone_to_team":
      return {
        type: "clone_to_team",
        agentId: pendingDrop.entityId,
        targetTeamId: pendingDrop.targetTeamId ?? "",
        language,
        now,
        randomSuffix,
      }
    case "create_team_and_add":
      return {
        type: "create_team_and_add",
        agentId: pendingDrop.entityId,
        language,
        now,
        randomSuffix,
      }
    case "unassign":
      return {
        type: "unassign",
        agentId: pendingDrop.entityId,
        sourceTeamId: pendingDrop.sourceTeamId ?? null,
      }
    case "archive":
      return {
        type: "archive_agent",
        agentId: pendingDrop.entityId,
      }
    case "cancel":
    default:
      return { type: "cancel_pending_drop" }
  }
}

export function buildBoardViewStateFromDraft(input: {
  draft: OrchestrationBoardDraft
  baseAgents: OrchestrationAgentRegistryEntry[]
  baseTeams: OrchestrationTeamRegistryEntry[]
  generatedAt?: number
}): {
  snapshot: OrchestrationRegistrySnapshot
  agents: OrchestrationAgentRegistryEntry[]
  teams: OrchestrationTeamRegistryEntry[]
} {
  const { draft, baseAgents, baseTeams, generatedAt } = input
  const materialized = applyOrchestrationMembershipToConfigs({
    agents: draft.agents.map((agent) => ({ ...agent.config })),
    teams: draft.teams.map((team) => ({ ...team.config })),
    links: draft.memberships,
  })
  const baseAgentMap = new Map(baseAgents.map((agent) => [agent.agentId, agent]))
  const baseTeamMap = new Map(baseTeams.map((team) => [team.teamId, team]))

  const agents = materialized.agents.map((config) => {
    const base = baseAgentMap.get(config.agentId)
    return {
      agentId: config.agentId,
      displayName: config.displayName,
      nickname: config.nickname,
      status: config.status,
      role: config.role,
      specialtyTags: config.specialtyTags,
      avoidTasks: config.avoidTasks,
      teamIds: config.teamIds,
      delegationEnabled: config.delegation.enabled,
      retryBudget: config.delegation.retryBudget,
      source: base?.source ?? "config",
      config,
      permissionProfile: config.capabilityPolicy.permissionProfile,
      capabilityPolicy: config.capabilityPolicy,
      skillMcpSummary: normalizeAllowlist(config.capabilityPolicy.skillMcpAllowlist),
      currentLoad: base?.currentLoad ?? {
        activeSubSessions: 0,
        queuedSubSessions: 0,
        failedSubSessions: 0,
        completedSubSessions: 0,
        maxParallelSessions: config.delegation.maxParallelSessions,
        utilization: 0,
      },
      failureRate: base?.failureRate ?? {
        windowMs: 86_400_000,
        consideredSubSessions: 0,
        failedSubSessions: 0,
        value: 0,
      },
    }
  })

  const activeAgentIds = new Set(agents.filter((agent) => agent.status === "enabled").map((agent) => agent.agentId))
  const teams = materialized.teams.map((config) => {
    const base = baseTeamMap.get(config.teamId)
    const unresolvedMemberAgentIds = config.memberAgentIds.filter((agentId) => !agents.some((agent) => agent.agentId === agentId))
    return {
      teamId: config.teamId,
      displayName: config.displayName,
      nickname: config.nickname,
      status: config.status,
      purpose: config.purpose,
      roleHints: config.roleHints,
      memberAgentIds: config.memberAgentIds,
      activeMemberAgentIds: config.memberAgentIds.filter((agentId) => activeAgentIds.has(agentId)),
      unresolvedMemberAgentIds,
      source: base?.source ?? "config",
      config,
    }
  })

  return {
    agents,
    teams,
    snapshot: {
      generatedAt: generatedAt ?? Date.now(),
      agents,
      teams,
      membershipEdges: materialized.membership.links.map((link) => ({
        teamId: link.teamId,
        agentId: link.agentId,
        status: link.status === "unresolved" ? "unresolved" as const : "active" as const,
        ...(link.roleHint ? { roleHint: link.roleHint } : {}),
      })),
      diagnostics: materialized.membership.issues.map((issue) => ({
        code: issue.code,
        message: issue.message,
      })),
    },
  }
}

function cloneBoardAgentToTeam(
  draft: OrchestrationBoardDraft,
  action: Extract<OrchestrationBoardReducerAction, { type: "clone_to_team" }>,
): OrchestrationBoardDraft {
  const source = draft.agents.find((agent) => agent.agentId === action.agentId)
  if (!source) return draft
  const t = (ko: string, en: string) => pickUiText(action.language, ko, en)
  const cloneDisplayName = `${source.displayName} ${t("복제", "Copy")}`
  const cloneAgentId = generateOrchestrationEntityId({
    kind: "agent",
    displayName: cloneDisplayName,
    existingIds: draft.agents.map((agent) => agent.agentId),
    draftIds: draft.agents.map((agent) => agent.agentId),
    randomSuffix: action.randomSuffix,
  })
  const cloneConfig = createSubAgentConfig({
    agentId: cloneAgentId,
    displayName: cloneDisplayName,
    nickname: source.nickname ? `${source.nickname}-copy` : undefined,
    role: source.config.role,
    personality: source.config.personality,
    specialtyTags: source.config.specialtyTags,
    avoidTasks: source.config.avoidTasks,
    teamIds: [action.targetTeamId],
    riskCeiling: source.config.capabilityPolicy.permissionProfile.riskCeiling,
    enabledSkillIds: source.config.capabilityPolicy.skillMcpAllowlist.enabledSkillIds,
    enabledMcpServerIds: source.config.capabilityPolicy.skillMcpAllowlist.enabledMcpServerIds,
    enabledToolNames: source.config.capabilityPolicy.skillMcpAllowlist.enabledToolNames,
    allowExternalNetwork: source.config.capabilityPolicy.permissionProfile.allowExternalNetwork,
    allowFilesystemWrite: source.config.capabilityPolicy.permissionProfile.allowFilesystemWrite,
    allowShellExecution: source.config.capabilityPolicy.permissionProfile.allowShellExecution,
    allowScreenControl: source.config.capabilityPolicy.permissionProfile.allowScreenControl,
    allowedPaths: source.config.capabilityPolicy.permissionProfile.allowedPaths,
    now: action.now,
  })
  return reconcileOrchestrationBoardDraft({
    draft: {
      ...draft,
      agents: [
        ...draft.agents,
        {
          kind: "agent",
          agentId: cloneAgentId,
          displayName: cloneConfig.displayName,
          ...(cloneConfig.nickname ? { nickname: cloneConfig.nickname } : {}),
          status: cloneConfig.status,
          rolePresetId: inferAgentRolePresetId(cloneConfig),
          riskPresetId: inferAgentRiskPresetId(cloneConfig),
          capabilityPresetId: inferAgentCapabilityPresetId(cloneConfig),
          persisted: false,
          lockedId: false,
          config: cloneConfig,
        },
      ],
    },
    memberships: addMembershipLink(draft.memberships, action.targetTeamId, cloneAgentId),
    selectedNodeId: `agent:${cloneAgentId}`,
  })
}

function createTeamAndAddAgent(
  draft: OrchestrationBoardDraft,
  action: Extract<OrchestrationBoardReducerAction, { type: "create_team_and_add" }>,
): OrchestrationBoardDraft {
  const agent = draft.agents.find((entry) => entry.agentId === action.agentId)
  if (!agent) return draft
  const t = (ko: string, en: string) => pickUiText(action.language, ko, en)
  const teamDisplayName = `${agent.displayName} ${t("팀", "Team")}`
  const teamId = generateOrchestrationEntityId({
    kind: "team",
    displayName: teamDisplayName,
    existingIds: draft.teams.map((team) => team.teamId),
    draftIds: draft.teams.map((team) => team.teamId),
    randomSuffix: action.randomSuffix,
  })
  const teamConfig = buildPresetTeamConfig({
    teamId,
    displayName: teamDisplayName,
    memberAgentIds: [action.agentId],
    now: action.now,
  })
  return reconcileOrchestrationBoardDraft({
    draft: {
      ...draft,
      teams: [
        ...draft.teams,
        {
          kind: "team",
          teamId,
          displayName: teamConfig.displayName,
          ...(teamConfig.nickname ? { nickname: teamConfig.nickname } : {}),
          status: teamConfig.status,
          purposePresetId: inferTeamPurposePresetId(teamConfig),
          persisted: false,
          lockedId: false,
          config: teamConfig,
        },
      ],
    },
    memberships: addMembershipLink(draft.memberships, teamId, action.agentId),
    selectedNodeId: `team:${teamId}`,
  })
}

function archiveBoardAgent(
  draft: OrchestrationBoardDraft,
  agentId: string,
): OrchestrationBoardDraft {
  const nextAgents = draft.agents.map((agent) => {
    if (agent.agentId !== agentId) return agent
    return {
      ...agent,
      status: "archived" as const,
      config: {
        ...agent.config,
        status: "archived" as const,
      },
    }
  })
  return reconcileOrchestrationBoardDraft({
    draft,
    agents: nextAgents,
    memberships: removeMembershipsForAgent(draft.memberships, agentId),
    selectedNodeId: `agent:${agentId}`,
  })
}

export function reconcileOrchestrationBoardDraft(input: {
  draft: OrchestrationBoardDraft
  agents?: BoardAgentDraft[]
  teams?: BoardTeamLaneDraft[]
  memberships: OrchestrationBoardDraft["memberships"]
  selectedNodeId?: string
}): OrchestrationBoardDraft {
  const nextAgents = input.agents ?? input.draft.agents
  const nextTeams = input.teams ?? input.draft.teams
  const materialized = applyOrchestrationMembershipToConfigs({
    agents: nextAgents.map((agent) => ({ ...agent.config })),
    teams: nextTeams.map((team) => ({ ...team.config })),
    links: input.memberships,
  })
  const agentMeta = new Map(nextAgents.map((agent) => [agent.agentId, agent]))
  const teamMeta = new Map(nextTeams.map((team) => [team.teamId, team]))

  const agents: BoardAgentDraft[] = materialized.agents.map((config) => {
    const previous = agentMeta.get(config.agentId)
    return {
      kind: "agent",
      agentId: config.agentId,
      displayName: config.displayName,
      ...(config.nickname ? { nickname: config.nickname } : {}),
      status: config.status,
      rolePresetId: previous?.rolePresetId ?? inferAgentRolePresetId(config),
      riskPresetId: previous?.riskPresetId ?? inferAgentRiskPresetId(config),
      capabilityPresetId: previous?.capabilityPresetId ?? inferAgentCapabilityPresetId(config),
      persisted: previous?.persisted ?? false,
      lockedId: previous?.lockedId ?? false,
      config,
    }
  })
  const teams: BoardTeamLaneDraft[] = materialized.teams.map((config) => {
    const previous = teamMeta.get(config.teamId)
    return {
      kind: "team",
      teamId: config.teamId,
      displayName: config.displayName,
      ...(config.nickname ? { nickname: config.nickname } : {}),
      status: config.status,
      purposePresetId: previous?.purposePresetId ?? inferTeamPurposePresetId(config),
      persisted: previous?.persisted ?? false,
      lockedId: previous?.lockedId ?? false,
      config,
    }
  })

  return {
    ...input.draft,
    agents,
    teams,
    memberships: materialized.membership.links,
    ...(input.selectedNodeId ? { selectedNodeId: input.selectedNodeId } : {}),
    dirty: true,
    dragState: null,
    pendingDrop: null,
    lastValidation: input.draft.lastValidation,
    persistMeta: {
      ...input.draft.persistMeta,
      saveOrder: buildBoardPersistOrder(teams.map((team) => team.teamId), agents.map((agent) => agent.agentId)),
    },
  }
}

function addMembershipLink(
  links: OrchestrationBoardDraft["memberships"],
  teamId: string,
  agentId: string,
): OrchestrationBoardDraft["memberships"] {
  if (!teamId) return [...links]
  if (links.some((link) => link.teamId === teamId && link.agentId === agentId)) return links.map((link) => ({ ...link }))
  return [
    ...links.map((link) => ({ ...link })),
    {
      id: `membership:${teamId}:${agentId}`,
      teamId,
      agentId,
      status: "active",
      source: "draft",
    },
  ]
}

function removeMembershipLink(
  links: OrchestrationBoardDraft["memberships"],
  sourceTeamId: string | null,
  agentId: string,
): OrchestrationBoardDraft["memberships"] {
  return links
    .filter((link) => {
      if (link.agentId !== agentId) return true
      if (sourceTeamId) return link.teamId !== sourceTeamId
      return false
    })
    .map((link) => ({ ...link }))
}

function removeMembershipsForAgent(
  links: OrchestrationBoardDraft["memberships"],
  agentId: string,
): OrchestrationBoardDraft["memberships"] {
  return links
    .filter((link) => link.agentId !== agentId)
    .map((link) => ({ ...link }))
}

function normalizeAllowlist(allowlist: SkillMcpAllowlist): OrchestrationAgentRegistryEntry["skillMcpSummary"] {
  return {
    enabledSkillIds: [...allowlist.enabledSkillIds],
    enabledMcpServerIds: [...allowlist.enabledMcpServerIds],
    enabledToolNames: [...allowlist.enabledToolNames],
    disabledToolNames: [...allowlist.disabledToolNames],
    ...(allowlist.secretScopeId ? { secretScopeId: allowlist.secretScopeId } : {}),
  }
}
