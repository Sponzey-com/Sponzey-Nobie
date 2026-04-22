import type { BoardAgentDraft, BoardTeamLaneDraft, OrchestrationBoardDraft } from "./orchestration-board"
import { reconcileOrchestrationBoardDraft } from "./orchestration-board-reducer"
import { generateOrchestrationEntityId } from "./orchestration-id"
import {
  buildPresetSubAgentConfig,
  buildPresetTeamConfig,
  type AgentCapabilityPresetId,
  type AgentRiskPresetId,
  type AgentRolePresetId,
  type TeamPurposePresetId,
} from "./orchestration-presets"

export type OrchestrationStarterKitId = "research_team" | "review_squad" | "workspace_operator_pair"

export interface OrchestrationStarterKitDefinition {
  id: OrchestrationStarterKitId
  label: string
  description: string
  command: string
  defaultCount: number
  teamDisplayName: string
  teamPurposePresetId: TeamPurposePresetId
  agentDisplayPrefix: string
  rolePresetId: AgentRolePresetId
  riskPresetId: AgentRiskPresetId
  capabilityPresetId: AgentCapabilityPresetId
}

export interface OrchestrationStarterPlanAgent {
  displayName: string
  rolePresetId: AgentRolePresetId
  riskPresetId: AgentRiskPresetId
  capabilityPresetId: AgentCapabilityPresetId
}

export interface OrchestrationStarterPlan {
  starterKitId: OrchestrationStarterKitId
  title: string
  summary: string
  command: string
  team: {
    displayName: string
    purposePresetId: TeamPurposePresetId
  }
  agents: OrchestrationStarterPlanAgent[]
}

export const ORCHESTRATION_STARTER_KITS: Record<OrchestrationStarterKitId, OrchestrationStarterKitDefinition> = {
  research_team: {
    id: "research_team",
    label: "Research team",
    description: "Creates a research pod with browser-oriented researchers.",
    command: "research team 3",
    defaultCount: 3,
    teamDisplayName: "Research Team",
    teamPurposePresetId: "research_pod",
    agentDisplayPrefix: "Research Agent",
    rolePresetId: "researcher",
    riskPresetId: "safe_read",
    capabilityPresetId: "browser_research",
  },
  review_squad: {
    id: "review_squad",
    label: "Review squad",
    description: "Creates a review-heavy pod with review-only capability defaults.",
    command: "review squad",
    defaultCount: 3,
    teamDisplayName: "Review Squad",
    teamPurposePresetId: "research_pod",
    agentDisplayPrefix: "Review Agent",
    rolePresetId: "reviewer",
    riskPresetId: "safe_read",
    capabilityPresetId: "review_only",
  },
  workspace_operator_pair: {
    id: "workspace_operator_pair",
    label: "Workspace operator pair",
    description: "Creates a build pod with two workspace-capable operators.",
    command: "workspace operator pair",
    defaultCount: 2,
    teamDisplayName: "Workspace Operators",
    teamPurposePresetId: "build_pod",
    agentDisplayPrefix: "Workspace Operator",
    rolePresetId: "operator",
    riskPresetId: "workspace_write",
    capabilityPresetId: "workspace_tools",
  },
}

export const ORCHESTRATION_STARTER_COMMAND_CHIPS = Object.values(ORCHESTRATION_STARTER_KITS).map((kit) => ({
  id: kit.id,
  label: kit.label,
  command: kit.command,
}))

export function buildOrchestrationStarterPlan(input: {
  starterKitId: OrchestrationStarterKitId
  countOverride?: number
  command?: string
}): OrchestrationStarterPlan {
  const definition = ORCHESTRATION_STARTER_KITS[input.starterKitId]
  const count = clampStarterCount(input.countOverride ?? definition.defaultCount)
  return {
    starterKitId: definition.id,
    title: definition.label,
    summary: definition.description,
    command: input.command?.trim() || definition.command,
    team: {
      displayName: definition.teamDisplayName,
      purposePresetId: definition.teamPurposePresetId,
    },
    agents: Array.from({ length: count }, (_, index) => ({
      displayName: `${definition.agentDisplayPrefix} ${index + 1}`,
      rolePresetId: definition.rolePresetId,
      riskPresetId: definition.riskPresetId,
      capabilityPresetId: definition.capabilityPresetId,
    })),
  }
}

export function applyOrchestrationStarterPlanToDraft(input: {
  draft: OrchestrationBoardDraft
  plan: OrchestrationStarterPlan
  now?: number
  randomSuffix?: () => string
}): OrchestrationBoardDraft {
  const teamId = generateOrchestrationEntityId({
    kind: "team",
    displayName: input.plan.team.displayName,
    existingIds: input.draft.teams.map((entry) => entry.teamId),
    draftIds: input.draft.teams.map((entry) => entry.teamId),
    randomSuffix: input.randomSuffix,
  })
  const generatedAgentIds: string[] = []

  for (const planAgent of input.plan.agents) {
    const agentId = generateOrchestrationEntityId({
      kind: "agent",
      displayName: planAgent.displayName,
      existingIds: input.draft.agents.map((entry) => entry.agentId),
      draftIds: [
        ...input.draft.agents.map((entry) => entry.agentId),
        ...generatedAgentIds,
      ],
      randomSuffix: input.randomSuffix,
    })
    generatedAgentIds.push(agentId)
  }

  const teamConfig = buildPresetTeamConfig({
    teamId,
    displayName: input.plan.team.displayName,
    purposePresetId: input.plan.team.purposePresetId,
    memberAgentIds: generatedAgentIds,
    now: input.now,
  })

  const nextTeam: BoardTeamLaneDraft = {
    kind: "team",
    teamId,
    displayName: teamConfig.displayName,
    ...(teamConfig.nickname ? { nickname: teamConfig.nickname } : {}),
    status: teamConfig.status,
    purposePresetId: input.plan.team.purposePresetId,
    persisted: false,
    lockedId: false,
    config: teamConfig,
  }

  const nextAgents: BoardAgentDraft[] = input.plan.agents.map((planAgent, index) => {
    const agentId = generatedAgentIds[index]!
    const config = buildPresetSubAgentConfig({
      agentId,
      displayName: planAgent.displayName,
      rolePresetId: planAgent.rolePresetId,
      riskPresetId: planAgent.riskPresetId,
      capabilityPresetId: planAgent.capabilityPresetId,
      teamIds: [teamId],
      now: input.now,
    })
    return {
      kind: "agent",
      agentId,
      displayName: config.displayName,
      ...(config.nickname ? { nickname: config.nickname } : {}),
      status: config.status,
      rolePresetId: planAgent.rolePresetId,
      riskPresetId: planAgent.riskPresetId,
      capabilityPresetId: planAgent.capabilityPresetId,
      persisted: false,
      lockedId: false,
      config,
    }
  })

  return reconcileOrchestrationBoardDraft({
    draft: {
      ...input.draft,
      teams: [...input.draft.teams, nextTeam],
      agents: [...input.draft.agents, ...nextAgents],
    },
    memberships: [
      ...input.draft.memberships.map((link) => ({ ...link })),
      ...generatedAgentIds.map((agentId) => ({
        id: `membership:${teamId}:${agentId}`,
        teamId,
        agentId,
        status: "active" as const,
        source: "draft" as const,
      })),
    ],
    selectedNodeId: `team:${teamId}`,
  })
}

function clampStarterCount(count: number): number {
  const normalized = Number.isFinite(count) ? Math.trunc(count) : 1
  return Math.min(6, Math.max(1, normalized))
}
