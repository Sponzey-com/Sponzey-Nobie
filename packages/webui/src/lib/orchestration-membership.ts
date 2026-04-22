import type { SubAgentConfig, TeamConfig } from "../contracts/sub-agent-orchestration"

export type OrchestrationMembershipStatus = "active" | "desynced" | "unresolved"
export type OrchestrationMembershipSource = "persisted" | "draft"

export interface OrchestrationMembershipLink {
  id: string
  teamId: string
  agentId: string
  status: OrchestrationMembershipStatus
  source: OrchestrationMembershipSource
  roleHint?: string
}

export interface OrchestrationMembershipIssue {
  code: "missing_agent" | "missing_team" | "agent_only_membership" | "team_only_membership"
  severity: "warning" | "error"
  agentId: string
  teamId: string
  message: string
}

export interface OrchestrationMembershipIndex {
  links: OrchestrationMembershipLink[]
  byAgentId: Record<string, string[]>
  byTeamId: Record<string, string[]>
  issues: OrchestrationMembershipIssue[]
}

export interface BuildOrchestrationMembershipIndexInput {
  agents: Array<Pick<SubAgentConfig, "agentId" | "teamIds">>
  teams: Array<Pick<TeamConfig, "teamId" | "memberAgentIds" | "roleHints">>
  source?: OrchestrationMembershipSource
}

export function buildOrchestrationMembershipIndex(input: BuildOrchestrationMembershipIndexInput): OrchestrationMembershipIndex {
  const source = input.source ?? "persisted"
  const agentIds = new Set(input.agents.map((agent) => agent.agentId))
  const teamIds = new Set(input.teams.map((team) => team.teamId))
  const pairs = new Map<string, {
    teamId: string
    agentId: string
    fromAgent: boolean
    fromTeam: boolean
    roleHint?: string
  }>()

  for (const agent of input.agents) {
    for (const teamId of uniqueValues(agent.teamIds)) {
      const key = membershipKey(teamId, agent.agentId)
      const current = pairs.get(key) ?? { teamId, agentId: agent.agentId, fromAgent: false, fromTeam: false }
      current.fromAgent = true
      pairs.set(key, current)
    }
  }

  for (const team of input.teams) {
    uniqueValues(team.memberAgentIds).forEach((agentId, index) => {
      const key = membershipKey(team.teamId, agentId)
      const current = pairs.get(key) ?? { teamId: team.teamId, agentId, fromAgent: false, fromTeam: false }
      current.fromTeam = true
      if (!current.roleHint && team.roleHints[index]?.trim()) current.roleHint = team.roleHints[index].trim()
      pairs.set(key, current)
    })
  }

  const issues: OrchestrationMembershipIssue[] = []
  const links = Array.from(pairs.values())
    .sort((left, right) => left.teamId.localeCompare(right.teamId) || left.agentId.localeCompare(right.agentId))
    .map((entry) => {
      let status: OrchestrationMembershipStatus = "active"
      if (!agentIds.has(entry.agentId)) {
        status = "unresolved"
        issues.push({
          code: "missing_agent",
          severity: "error",
          agentId: entry.agentId,
          teamId: entry.teamId,
          message: `Membership points to missing agent ${entry.agentId}.`,
        })
      } else if (!teamIds.has(entry.teamId)) {
        status = "unresolved"
        issues.push({
          code: "missing_team",
          severity: "error",
          agentId: entry.agentId,
          teamId: entry.teamId,
          message: `Membership points to missing team ${entry.teamId}.`,
        })
      } else if (entry.fromAgent && entry.fromTeam) {
        status = "active"
      } else {
        status = "desynced"
        issues.push({
          code: entry.fromAgent ? "agent_only_membership" : "team_only_membership",
          severity: "warning",
          agentId: entry.agentId,
          teamId: entry.teamId,
          message: entry.fromAgent
            ? `Agent ${entry.agentId} references ${entry.teamId}, but the team does not list the member.`
            : `Team ${entry.teamId} references ${entry.agentId}, but the agent does not list the team.`,
        })
      }

      return {
        id: `membership:${entry.teamId}:${entry.agentId}`,
        teamId: entry.teamId,
        agentId: entry.agentId,
        status,
        source,
        ...(entry.roleHint ? { roleHint: entry.roleHint } : {}),
      }
    })

  return {
    links,
    byAgentId: buildMembershipMap({
      keys: input.agents.map((agent) => agent.agentId),
      valueSelector: (link) => link.teamId,
      keySelector: (link) => link.agentId,
      orderHints: new Map(input.agents.map((agent) => [agent.agentId, uniqueValues(agent.teamIds)])),
      links,
    }),
    byTeamId: buildMembershipMap({
      keys: input.teams.map((team) => team.teamId),
      valueSelector: (link) => link.agentId,
      keySelector: (link) => link.teamId,
      orderHints: new Map(input.teams.map((team) => [team.teamId, uniqueValues(team.memberAgentIds)])),
      links,
    }),
    issues,
  }
}

export function applyOrchestrationMembershipToConfigs(input: {
  agents: SubAgentConfig[]
  teams: TeamConfig[]
  links: OrchestrationMembershipLink[]
}): {
  agents: SubAgentConfig[]
  teams: TeamConfig[]
  membership: OrchestrationMembershipIndex
} {
  const linkIndex = buildMembershipCollections({
    links: input.links,
    agents: input.agents,
    teams: input.teams,
  })
  const agents = input.agents.map((agent) => ({
    ...agent,
    teamIds: linkIndex.byAgentId[agent.agentId] ?? [],
  }))
  const teams = input.teams.map((team) => ({
    ...team,
    memberAgentIds: linkIndex.byTeamId[team.teamId] ?? [],
  }))
  const membership = buildOrchestrationMembershipIndex({
    agents,
    teams,
    source: input.links.some((link) => link.source === "draft") ? "draft" : "persisted",
  })

  return {
    agents,
    teams,
    membership: {
      ...membership,
      links: input.links.map((link) => ({ ...link })),
      byAgentId: linkIndex.byAgentId,
      byTeamId: linkIndex.byTeamId,
    },
  }
}

function buildMembershipCollections(input: {
  links: OrchestrationMembershipLink[]
  agents: Array<Pick<SubAgentConfig, "agentId" | "teamIds">>
  teams: Array<Pick<TeamConfig, "teamId" | "memberAgentIds">>
}): {
  byAgentId: Record<string, string[]>
  byTeamId: Record<string, string[]>
} {
  const byAgent = new Map<string, Set<string>>()
  const byTeam = new Map<string, Set<string>>()

  for (const link of input.links) {
    if (!byAgent.has(link.agentId)) byAgent.set(link.agentId, new Set())
    if (!byTeam.has(link.teamId)) byTeam.set(link.teamId, new Set())
    byAgent.get(link.agentId)?.add(link.teamId)
    byTeam.get(link.teamId)?.add(link.agentId)
  }

  return {
    byAgentId: finalizeMembershipMap(
      input.agents.map((agent) => agent.agentId),
      byAgent,
      new Map(input.agents.map((agent) => [agent.agentId, uniqueValues(agent.teamIds)])),
    ),
    byTeamId: finalizeMembershipMap(
      input.teams.map((team) => team.teamId),
      byTeam,
      new Map(input.teams.map((team) => [team.teamId, uniqueValues(team.memberAgentIds)])),
    ),
  }
}

function buildMembershipMap<TValue>(input: {
  keys: string[]
  links: OrchestrationMembershipLink[]
  keySelector: (link: OrchestrationMembershipLink) => string
  valueSelector: (link: OrchestrationMembershipLink) => TValue
  orderHints: Map<string, TValue[]>
}): Record<string, TValue[]> {
  const grouped = new Map<string, Set<TValue>>()
  for (const link of input.links) {
    const key = input.keySelector(link)
    if (!grouped.has(key)) grouped.set(key, new Set())
    grouped.get(key)?.add(input.valueSelector(link))
  }
  const result: Record<string, TValue[]> = {}
  for (const key of input.keys) {
    const values = grouped.get(key)
    result[key] = orderValues(Array.from(values ?? []), input.orderHints.get(key) ?? [])
  }
  return result
}

function finalizeMembershipMap(
  keys: string[],
  grouped: Map<string, Set<string>>,
  orderHints: Map<string, string[]>,
): Record<string, string[]> {
  const result: Record<string, string[]> = {}
  for (const key of keys) {
    result[key] = orderValues(Array.from(grouped.get(key) ?? []), orderHints.get(key) ?? [])
  }
  return result
}

function orderValues(values: string[], orderHints: string[]): string[] {
  const unique = uniqueValues(values)
  if (unique.length === 0) return []
  const prioritized = orderHints.filter((item) => unique.includes(item))
  const remaining = unique.filter((item) => !prioritized.includes(item)).sort()
  return [...prioritized, ...remaining]
}

function membershipKey(teamId: string, agentId: string): string {
  return `${teamId}::${agentId}`
}

function uniqueValues(values: string[]): string[] {
  return Array.from(new Set(values.map((item) => item.trim()).filter(Boolean)))
}
