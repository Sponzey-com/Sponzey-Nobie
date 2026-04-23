import { getConfig, type OrchestrationConfig } from "../config/index.js"
import {
  disableAgentConfig,
  getAgentConfig,
  getDb,
  getTeamConfig,
  listAgentConfigs,
  listAgentTeamMemberships,
  listTeamConfigs,
  upsertAgentConfig,
  upsertTeamConfig,
  type AgentConfigPersistenceOptions,
  type DbAgentConfig,
  type DbTeamConfig,
  type TeamConfigPersistenceOptions,
} from "../db/index.js"
import {
  validateAgentConfig,
  validateTeamConfig,
  type AgentConfig,
  type CapabilityPolicy,
  type PermissionProfile,
  type SubAgentConfig,
  type TeamConfig,
} from "../contracts/sub-agent-orchestration.js"
import { normalizeSkillMcpAllowlist } from "../security/capability-isolation.js"
import { normalizeLegacyAgentConfigRow, normalizeLegacyTeamConfigRow } from "./config-normalization.js"

export interface AgentRuntimeLoadSnapshot {
  activeSubSessions: number
  queuedSubSessions: number
  failedSubSessions: number
  completedSubSessions: number
  maxParallelSessions: number
  utilization: number
}

export interface AgentFailureRateSnapshot {
  windowMs: number
  consideredSubSessions: number
  failedSubSessions: number
  value: number
}

export interface AgentSkillMcpSummary {
  enabledSkillIds: string[]
  enabledMcpServerIds: string[]
  enabledToolNames: string[]
  disabledToolNames: string[]
  secretScopeId?: string
}

export interface AgentRegistryEntry {
  agentId: string
  displayName: string
  nickname?: string
  status: SubAgentConfig["status"]
  role: string
  specialtyTags: string[]
  avoidTasks: string[]
  teamIds: string[]
  delegationEnabled: boolean
  retryBudget: number
  source: "db" | "config"
  config: SubAgentConfig
  permissionProfile: PermissionProfile
  capabilityPolicy: CapabilityPolicy
  skillMcpSummary: AgentSkillMcpSummary
  currentLoad: AgentRuntimeLoadSnapshot
  failureRate: AgentFailureRateSnapshot
}

export interface TeamRegistryEntry {
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
  agents: AgentRegistryEntry[]
  teams: TeamRegistryEntry[]
  membershipEdges: Array<{
    teamId: string
    agentId: string
    status: "active" | "unresolved" | "removed"
    roleHint?: string
  }>
  diagnostics: Array<{
    code: string
    message: string
  }>
}

export interface RegistryServiceDependencies {
  getConfig?: () => Pick<{ orchestration: OrchestrationConfig }, "orchestration">
  now?: () => number
  failureWindowMs?: number
}

function parseJsonObject(value: string): unknown {
  try {
    return JSON.parse(value)
  } catch {
    return undefined
  }
}

function parseAgentConfigRow(row: DbAgentConfig): AgentConfig | undefined {
  const parsed = normalizeLegacyAgentConfigRow(parseJsonObject(row.config_json))
  const validation = validateAgentConfig(parsed)
  return validation.ok ? validation.value : undefined
}

function parseTeamConfigRow(row: DbTeamConfig): TeamConfig | undefined {
  const parsed = normalizeLegacyTeamConfigRow(parseJsonObject(row.config_json))
  const validation = validateTeamConfig(parsed)
  return validation.ok ? validation.value : undefined
}

function subAgentFromAgentConfig(config: AgentConfig): SubAgentConfig | undefined {
  return config.agentType === "sub_agent" ? config : undefined
}

function safeRatio(numerator: number, denominator: number): number {
  if (denominator <= 0) return 0
  return Math.max(0, Math.min(1, numerator / denominator))
}

function runtimeLoadForAgent(agent: SubAgentConfig): AgentRuntimeLoadSnapshot {
  const rows = getDb()
    .prepare<[string], { status: string; count: number }>(
      "SELECT status, COUNT(*) AS count FROM run_subsessions WHERE agent_id = ? GROUP BY status",
    )
    .all(agent.agentId)
  const countByStatus = new Map(rows.map((row) => [row.status, row.count]))
  const activeSubSessions =
    (countByStatus.get("created") ?? 0)
    + (countByStatus.get("queued") ?? 0)
    + (countByStatus.get("running") ?? 0)
    + (countByStatus.get("waiting_for_input") ?? 0)
    + (countByStatus.get("awaiting_approval") ?? 0)
    + (countByStatus.get("needs_revision") ?? 0)
  const maxParallelSessions = Math.max(1, agent.delegation.maxParallelSessions)
  return {
    activeSubSessions,
    queuedSubSessions: (countByStatus.get("created") ?? 0) + (countByStatus.get("queued") ?? 0),
    failedSubSessions: countByStatus.get("failed") ?? 0,
    completedSubSessions: countByStatus.get("completed") ?? 0,
    maxParallelSessions,
    utilization: safeRatio(activeSubSessions, maxParallelSessions),
  }
}

function failureRateForAgent(agentId: string, now: number, windowMs: number): AgentFailureRateSnapshot {
  const windowStart = now - windowMs
  const row = getDb()
    .prepare<[string, number], { total: number; failed: number }>(
      `SELECT
         COUNT(*) AS total,
         SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed
       FROM run_subsessions
       WHERE agent_id = ? AND updated_at >= ? AND status IN ('completed', 'failed', 'cancelled')`,
    )
    .get(agentId, windowStart)
  const consideredSubSessions = row?.total ?? 0
  const failedSubSessions = row?.failed ?? 0
  return {
    windowMs,
    consideredSubSessions,
    failedSubSessions,
    value: safeRatio(failedSubSessions, consideredSubSessions),
  }
}

function agentSkillMcpSummary(config: SubAgentConfig): AgentSkillMcpSummary {
  const allowlist = normalizeSkillMcpAllowlist(config.capabilityPolicy.skillMcpAllowlist)
  return {
    enabledSkillIds: [...allowlist.enabledSkillIds],
    enabledMcpServerIds: [...allowlist.enabledMcpServerIds],
    enabledToolNames: [...allowlist.enabledToolNames],
    disabledToolNames: [...allowlist.disabledToolNames],
    ...(allowlist.secretScopeId ? { secretScopeId: allowlist.secretScopeId } : {}),
  }
}

function agentEntry(config: SubAgentConfig, source: AgentRegistryEntry["source"], now: number, failureWindowMs: number): AgentRegistryEntry {
  return {
    agentId: config.agentId,
    displayName: config.displayName,
    ...(config.nickname ? { nickname: config.nickname } : {}),
    status: config.status,
    role: config.role,
    specialtyTags: [...config.specialtyTags],
    avoidTasks: [...config.avoidTasks],
    teamIds: [...config.teamIds],
    delegationEnabled: config.delegation.enabled,
    retryBudget: config.delegation.retryBudget,
    source,
    config,
    permissionProfile: config.capabilityPolicy.permissionProfile,
    capabilityPolicy: config.capabilityPolicy,
    skillMcpSummary: agentSkillMcpSummary(config),
    currentLoad: runtimeLoadForAgent(config),
    failureRate: failureRateForAgent(config.agentId, now, failureWindowMs),
  }
}

function teamEntry(config: TeamConfig, source: TeamRegistryEntry["source"], activeAgentIds: Set<string>): TeamRegistryEntry {
  return {
    teamId: config.teamId,
    displayName: config.displayName,
    ...(config.nickname ? { nickname: config.nickname } : {}),
    status: config.status,
    purpose: config.purpose,
    roleHints: [...config.roleHints],
    memberAgentIds: [...config.memberAgentIds],
    activeMemberAgentIds: config.memberAgentIds.filter((agentId) => activeAgentIds.has(agentId)),
    unresolvedMemberAgentIds: config.memberAgentIds.filter((agentId) => !activeAgentIds.has(agentId)),
    source,
    config,
  }
}

export function buildOrchestrationRegistrySnapshot(
  dependencies: RegistryServiceDependencies = {},
): OrchestrationRegistrySnapshot {
  const cfg = dependencies.getConfig?.() ?? getConfig()
  const now = dependencies.now?.() ?? Date.now()
  const failureWindowMs = dependencies.failureWindowMs ?? 7 * 24 * 60 * 60 * 1000
  const diagnostics: OrchestrationRegistrySnapshot["diagnostics"] = []
  const agentsById = new Map<string, AgentRegistryEntry>()
  const teamsById = new Map<string, TeamConfig & { source: TeamRegistryEntry["source"] }>()
  const archivedAgentIds = new Set(
    listAgentConfigs({ includeArchived: true, agentType: "sub_agent" })
      .filter((row) => row.status === "archived")
      .map((row) => row.agent_id),
  )
  const archivedTeamIds = new Set(
    listTeamConfigs({ includeArchived: true })
      .filter((row) => row.status === "archived")
      .map((row) => row.team_id),
  )

  for (const agent of cfg.orchestration.subAgents ?? []) {
    if (archivedAgentIds.has(agent.agentId)) continue
    agentsById.set(agent.agentId, agentEntry(agent, "config", now, failureWindowMs))
  }

  for (const row of listAgentConfigs({ includeArchived: false, agentType: "sub_agent" })) {
    const config = parseAgentConfigRow(row)
    const subAgent = config ? subAgentFromAgentConfig(config) : undefined
    if (!subAgent) {
      diagnostics.push({ code: "invalid_agent_config_row", message: `agent_configs row ${row.agent_id} could not be parsed.` })
      continue
    }
    agentsById.set(subAgent.agentId, agentEntry(subAgent, "db", now, failureWindowMs))
  }

  for (const team of cfg.orchestration.teams ?? []) {
    if (archivedTeamIds.has(team.teamId)) continue
    teamsById.set(team.teamId, { ...team, source: "config" })
  }

  for (const row of listTeamConfigs({ includeArchived: false })) {
    const config = parseTeamConfigRow(row)
    if (!config) {
      diagnostics.push({ code: "invalid_team_config_row", message: `team_configs row ${row.team_id} could not be parsed.` })
      continue
    }
    teamsById.set(config.teamId, { ...config, source: "db" })
  }

  const activeAgentIds = new Set(
    [...agentsById.values()]
      .filter((agent) => agent.status === "enabled" && agent.delegationEnabled)
      .map((agent) => agent.agentId),
  )
  const teams = [...teamsById.values()]
    .map((team) => teamEntry(team, team.source, activeAgentIds))
    .sort((a, b) => a.teamId.localeCompare(b.teamId))
  const membershipEdges = listAgentTeamMemberships()
    .filter((membership) => membership.status !== "removed")
    .map((membership) => ({
      teamId: membership.team_id,
      agentId: membership.agent_id,
      status: membership.status,
      ...(membership.role_hint ? { roleHint: membership.role_hint } : {}),
    }))

  for (const team of teams) {
    for (const agentId of team.memberAgentIds) {
      if (!agentsById.has(agentId)) {
        diagnostics.push({ code: "unresolved_team_member", message: `${team.teamId} references missing agent ${agentId}.` })
      }
    }
  }

  return {
    generatedAt: now,
    agents: [...agentsById.values()].sort((a, b) => a.agentId.localeCompare(b.agentId)),
    teams,
    membershipEdges,
    diagnostics,
  }
}

export function createAgentRegistryService(dependencies: RegistryServiceDependencies = {}) {
  const now = () => dependencies.now?.() ?? Date.now()
  return {
    get(agentId: string): AgentConfig | undefined {
      const row = getAgentConfig(agentId)
      return row ? parseAgentConfigRow(row) : undefined
    },
    list(): AgentConfig[] {
      return listAgentConfigs({ includeArchived: true })
        .map(parseAgentConfigRow)
        .filter((config): config is AgentConfig => config != null)
    },
    snapshot(): OrchestrationRegistrySnapshot {
      return buildOrchestrationRegistrySnapshot(dependencies)
    },
    createOrUpdate(input: AgentConfig, options: AgentConfigPersistenceOptions = {}): void {
      upsertAgentConfig(input, { ...options, now: options.now ?? now() })
    },
    disable(agentId: string): boolean {
      return disableAgentConfig(agentId, now())
    },
    archive(agentId: string): boolean {
      const current = this.get(agentId)
      if (!current) return false
      upsertAgentConfig({ ...current, status: "archived", updatedAt: now() } as AgentConfig, { source: "manual", now: now() })
      return true
    },
  }
}

export function createTeamRegistryService(dependencies: RegistryServiceDependencies = {}) {
  const now = () => dependencies.now?.() ?? Date.now()
  return {
    get(teamId: string): TeamConfig | undefined {
      const row = getTeamConfig(teamId)
      return row ? parseTeamConfigRow(row) : undefined
    },
    list(): TeamConfig[] {
      return listTeamConfigs({ includeArchived: true })
        .map(parseTeamConfigRow)
        .filter((config): config is TeamConfig => config != null)
    },
    snapshot(): OrchestrationRegistrySnapshot {
      return buildOrchestrationRegistrySnapshot(dependencies)
    },
    createOrUpdate(input: TeamConfig, options: TeamConfigPersistenceOptions = {}): void {
      upsertTeamConfig(input, { ...options, now: options.now ?? now() })
    },
    disable(teamId: string): boolean {
      const current = this.get(teamId)
      if (!current) return false
      upsertTeamConfig({ ...current, status: "disabled", updatedAt: now() }, { source: "manual", now: now() })
      return true
    },
    archive(teamId: string): boolean {
      const current = this.get(teamId)
      if (!current) return false
      upsertTeamConfig({ ...current, status: "archived", updatedAt: now() }, { source: "manual", now: now() })
      return true
    },
  }
}
