import type {
  OrchestrationAgentRegistryEntry,
  OrchestrationRegistrySnapshot,
  OrchestrationTeamRegistryEntry,
} from "../contracts/orchestration-api"
import type { AgentConfig, TeamConfig } from "../contracts/sub-agent-orchestration"
import { createOrchestrationBoardDraft, materializeOrchestrationBoardDraft, type BoardPersistInstruction, type OrchestrationBoardDraft } from "./orchestration-board"
import { reconcileOrchestrationBoardDraft } from "./orchestration-board-reducer"
import type { BoardValidationSnapshot } from "./orchestration-board"

export interface OrchestrationSavePlanInstruction {
  key: string
  targetType: "agent" | "team"
  targetId: string
  config: AgentConfig | TeamConfig
}

export interface OrchestrationSavePlan {
  instructions: OrchestrationSavePlanInstruction[]
}

export function buildOrchestrationSavePlan(input: {
  draft: OrchestrationBoardDraft
}): OrchestrationSavePlan {
  const materialized = materializeOrchestrationBoardDraft({ draft: input.draft })
  const agentMap = new Map(materialized.agents.map((agent) => [agent.agentId, agent]))
  const teamMap = new Map(materialized.teams.map((team) => [team.teamId, team]))

  const instructions = input.draft.persistMeta.saveOrder.flatMap((item) => {
    if (item.targetType === "team") {
      const config = teamMap.get(item.targetId)
      return config ? [{
        key: instructionKey(item),
        targetType: "team" as const,
        targetId: item.targetId,
        config,
      }] : []
    }
    const config = agentMap.get(item.targetId)
    return config ? [{
      key: instructionKey(item),
      targetType: "agent" as const,
      targetId: item.targetId,
      config,
    }] : []
  })

  return { instructions }
}

export function mergeBoardDraftWithRemoteState(input: {
  currentDraft: OrchestrationBoardDraft
  remoteSnapshot: OrchestrationRegistrySnapshot | null
  remoteAgents: OrchestrationAgentRegistryEntry[]
  remoteTeams: OrchestrationTeamRegistryEntry[]
  remainingInstructionKeys: string[]
  validationSnapshot?: BoardValidationSnapshot | null
  selectedNodeId?: string
}): OrchestrationBoardDraft {
  const remaining = new Set(input.remainingInstructionKeys)
  const remainingAgentIds = new Set(
    input.currentDraft.persistMeta.saveOrder
      .filter((item) => remaining.has(instructionKey(item)) && item.targetType === "agent")
      .map((item) => item.targetId),
  )
  const remainingTeamIds = new Set(
    input.currentDraft.persistMeta.saveOrder
      .filter((item) => remaining.has(instructionKey(item)) && item.targetType === "team")
      .map((item) => item.targetId),
  )

  const freshDraft = createOrchestrationBoardDraft({
    agents: input.remoteAgents.map((agent) => agent.config).filter(isSubAgentConfig),
    teams: input.remoteTeams.map((team) => team.config),
    snapshot: input.remoteSnapshot,
    selectedNodeId: input.selectedNodeId,
    lastValidation: input.validationSnapshot ?? null,
  })

  const mergedAgents = [
    ...freshDraft.agents.filter((agent) => !remainingAgentIds.has(agent.agentId)),
    ...input.currentDraft.agents.filter((agent) => remainingAgentIds.has(agent.agentId)),
  ]
  const mergedTeams = [
    ...freshDraft.teams.filter((team) => !remainingTeamIds.has(team.teamId)),
    ...input.currentDraft.teams.filter((team) => remainingTeamIds.has(team.teamId)),
  ]
  const validAgentIds = new Set(mergedAgents.map((agent) => agent.agentId))
  const validTeamIds = new Set(mergedTeams.map((team) => team.teamId))
  const mergedMemberships = [
    ...freshDraft.memberships.filter((link) => !remainingAgentIds.has(link.agentId) && !remainingTeamIds.has(link.teamId)),
    ...input.currentDraft.memberships
      .filter((link) => (remainingAgentIds.has(link.agentId) || remainingTeamIds.has(link.teamId))
        && validAgentIds.has(link.agentId)
        && validTeamIds.has(link.teamId))
      .map((link) => ({ ...link })),
  ]

  return reconcileOrchestrationBoardDraft({
    draft: {
      ...freshDraft,
      lastValidation: input.validationSnapshot ?? freshDraft.lastValidation,
      selectedNodeId: input.selectedNodeId ?? freshDraft.selectedNodeId,
    },
    agents: mergedAgents,
    teams: mergedTeams,
    memberships: mergedMemberships,
    selectedNodeId: input.selectedNodeId ?? freshDraft.selectedNodeId,
  })
}

export function summarizeRemainingInstructionKeys(input: {
  plan: OrchestrationSavePlan
  firstUnstoredKey?: string | null
}): string[] {
  if (!input.firstUnstoredKey) return []
  const firstIndex = input.plan.instructions.findIndex((instruction) => instruction.key === input.firstUnstoredKey)
  if (firstIndex < 0) return []
  return input.plan.instructions.slice(firstIndex).map((instruction) => instruction.key)
}

function instructionKey(instruction: BoardPersistInstruction): string {
  return `${instruction.targetType}:${instruction.targetId}`
}

function isSubAgentConfig(config: AgentConfig | TeamConfig): config is AgentConfig & { agentType: "sub_agent" } {
  return "agentType" in config && config.agentType === "sub_agent"
}
