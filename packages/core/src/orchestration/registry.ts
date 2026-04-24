import { createHash } from "node:crypto"
import { type OrchestrationConfig, getConfig } from "../config/index.js"
import {
  type AgentConfig,
  type AgentRelationship,
  type CapabilityPolicy,
  type CapabilityRiskLevel,
  type PermissionProfile,
  type SubAgentConfig,
  type TeamConfig,
  type TeamMembership,
  validateAgentConfig,
  validateTeamConfig,
} from "../contracts/sub-agent-orchestration.js"
import {
  type AgentConfigPersistenceOptions,
  type DbAgentConfig,
  type DbTeamConfig,
  type TeamConfigPersistenceOptions,
  disableAgentConfig,
  getAgentConfig,
  getDb,
  getTeamConfig,
  listAgentConfigs,
  listAgentRelationships,
  listAgentTeamMemberships,
  listTeamConfigs,
  upsertAgentConfig,
  upsertTeamConfig,
} from "../db/index.js"
import {
  type AgentCapabilitySummary,
  type AgentModelSummary,
  resolveAgentCapabilityModelSummary,
} from "./capability-model.js"
import {
  normalizeLegacyAgentConfigRow,
  normalizeLegacyTeamConfigRow,
} from "./config-normalization.js"

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

export type OrchestrationRegistryStatus = "ready" | "degraded"
export type OrchestrationRegistryDiagnosticSeverity = "info" | "warning" | "invalid"

export interface OrchestrationRegistryDiagnostic {
  code: string
  message: string
  severity?: OrchestrationRegistryDiagnosticSeverity
  agentId?: string
  teamId?: string
  parentAgentId?: string
  childAgentId?: string
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
  capabilitySummary: AgentCapabilitySummary
  modelSummary: AgentModelSummary
  degradedReasonCodes: string[]
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
  coverage?: RegistryTeamCoverageSnapshot
  health?: RegistryTeamHealthSnapshot
}

export interface RegistryHierarchyDirectChildSnapshot {
  parentAgentId: string
  childAgentId: string
  edgeId: string
  relationshipStatus: AgentRelationship["status"] | "fallback"
  executionCandidate: boolean
  reasonCodes: string[]
}

export interface RegistryHierarchySnapshot {
  rootAgentId: string
  fallbackActive: boolean
  directChildrenByParent: Record<string, string[]>
  topLevelSubAgentIds: string[]
  directChildren: RegistryHierarchyDirectChildSnapshot[]
  diagnostics: OrchestrationRegistryDiagnostic[]
}

export interface RegistryCoverageDimensionSnapshot {
  required: string[]
  covered: string[]
  missing: string[]
  providers: Record<string, string[]>
}

export interface RegistryTeamMemberCoverageSnapshot {
  agentId: string
  membershipId: string
  primaryRole: string
  teamRoles: string[]
  required: boolean
  executionState: "active" | "reference" | "unresolved" | "excluded" | "fallback"
  directChild: boolean
  active: boolean
  reasonCodes: string[]
  specialtyTags: string[]
  capabilityIds: string[]
  modelAvailability?: AgentModelSummary["availability"]
  capabilityAvailability?: AgentCapabilitySummary["availability"]
}

export interface RegistryTeamCoverageSnapshot {
  teamId: string
  ownerAgentId: string
  leadAgentId?: string
  generatedAt: number
  executionCandidate: boolean
  activeMemberAgentIds: string[]
  referenceMemberAgentIds: string[]
  unresolvedMemberAgentIds: string[]
  excludedMemberAgentIds: string[]
  members: RegistryTeamMemberCoverageSnapshot[]
  roleCoverage: RegistryCoverageDimensionSnapshot
  capabilityCoverage: RegistryCoverageDimensionSnapshot
  diagnostics: OrchestrationRegistryDiagnostic[]
  recalculationKeys: string[]
}

export interface RegistryTeamHealthSnapshot {
  teamId: string
  status: "healthy" | "degraded" | "invalid"
  executionCandidate: boolean
  activeMemberCount: number
  referenceMemberCount: number
  unresolvedMemberCount: number
  excludedMemberCount: number
  diagnostics: OrchestrationRegistryDiagnostic[]
  coverageSummary: {
    missingRoles: string[]
    missingCapabilityTags: string[]
    recalculationKeys: string[]
  }
}

export interface AgentCapabilityIndexCandidate {
  parentAgentId: string
  agentId: string
  eligible: boolean
  reasonCodes: string[]
  specialtyTags: string[]
  enabledSkillIds: string[]
  enabledMcpServerIds: string[]
  enabledToolNames: string[]
  modelAvailability: AgentModelSummary["availability"]
  capabilityAvailability: AgentCapabilitySummary["availability"]
  load: AgentRuntimeLoadSnapshot
  failureRate: AgentFailureRateSnapshot
}

export interface AgentCapabilityIndexMetrics {
  buildLatencyMs: number
  targetP95Ms: number
}

export interface AgentCapabilityIndex {
  generatedAt: number
  cacheKey: string
  rootAgentId: string
  topLevelCandidateAgentIds: string[]
  directChildAgentIdsByParent: Record<string, string[]>
  candidateAgentIdsByParent: Record<string, string[]>
  excludedCandidatesByParent: Record<string, Array<{ agentId: string; reasonCodes: string[] }>>
  candidatesByAgentId: Record<string, AgentCapabilityIndexCandidate[]>
  diagnostics: OrchestrationRegistryDiagnostic[]
  metrics: AgentCapabilityIndexMetrics
}

export interface RegistryInvalidationTableFingerprint {
  rowCount: number
  maxUpdatedAt: number
  missing?: boolean
}

export interface RegistryInvalidationSnapshot {
  cacheKey: string
  configHash: string
  tables: Record<string, RegistryInvalidationTableFingerprint>
}

export interface OrchestrationRegistryLatencyMetrics {
  buildLatencyMs: number
  coldSnapshotTargetP95Ms: number
  hotIndexTargetP95Ms: number
}

export interface OrchestrationRegistrySnapshot {
  status?: OrchestrationRegistryStatus
  generatedAt: number
  agents: AgentRegistryEntry[]
  teams: TeamRegistryEntry[]
  hierarchy?: RegistryHierarchySnapshot
  capabilityIndex?: AgentCapabilityIndex
  invalidation?: RegistryInvalidationSnapshot
  metrics?: OrchestrationRegistryLatencyMetrics
  fallback?: {
    mode: "single_nobie"
    reasonCode: "registry_load_failed"
    reason: string
  }
  membershipEdges: Array<{
    teamId: string
    agentId: string
    status: "active" | "unresolved" | "removed"
    roleHint?: string
  }>
  diagnostics: OrchestrationRegistryDiagnostic[]
}

export interface RegistryServiceDependencies {
  getConfig?: () => Pick<{ orchestration: OrchestrationConfig }, "orchestration">
  now?: () => number
  failureWindowMs?: number
}

const DEFAULT_ROOT_AGENT_ID = "agent:nobie"
const COLD_REGISTRY_TARGET_P95_MS = 500
const HOT_INDEX_TARGET_P95_MS = 100
const TEAM_RECALCULATION_KEYS = [
  "task008.skill_mcp_binding_recalculated",
  "task009.model_state_recalculated",
]
const HOT_CAPABILITY_INDEX_CACHE = new Map<string, AgentCapabilityIndex>()

function uniqueStrings(values: Array<string | undefined>): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value?.trim())))]
}

function sortedUniqueStrings(values: Array<string | undefined>): string[] {
  return uniqueStrings(values).sort((left, right) => left.localeCompare(right))
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`)
      .join(",")}}`
  }
  return JSON.stringify(value)
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex")
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

function rootAgentIdFromConfig(config: OrchestrationConfig): string {
  return config.nobie?.agentId ?? DEFAULT_ROOT_AGENT_ID
}

function tableFingerprint(tableName: string): RegistryInvalidationTableFingerprint {
  try {
    const row = getDb()
      .prepare<[], { rowCount: number; maxUpdatedAt: number | null }>(
        `SELECT COUNT(*) AS rowCount, COALESCE(MAX(updated_at), 0) AS maxUpdatedAt FROM ${tableName}`,
      )
      .get()
    return {
      rowCount: row?.rowCount ?? 0,
      maxUpdatedAt: row?.maxUpdatedAt ?? 0,
    }
  } catch {
    return {
      rowCount: 0,
      maxUpdatedAt: 0,
      missing: true,
    }
  }
}

function buildInvalidationSnapshot(config: OrchestrationConfig): RegistryInvalidationSnapshot {
  const tables = {
    agent_configs: tableFingerprint("agent_configs"),
    team_configs: tableFingerprint("team_configs"),
    agent_team_memberships: tableFingerprint("agent_team_memberships"),
    agent_relationships: tableFingerprint("agent_relationships"),
    skill_catalog: tableFingerprint("skill_catalog"),
    mcp_server_catalog: tableFingerprint("mcp_server_catalog"),
    agent_capability_bindings: tableFingerprint("agent_capability_bindings"),
    run_subsessions: tableFingerprint("run_subsessions"),
  }
  const configHash = sha256(
    stableStringify({
      nobie: config.nobie,
      subAgents: config.subAgents ?? [],
      teams: config.teams ?? [],
    }),
  )
  const cacheKey = sha256(stableStringify({ configHash, tables }))
  return { cacheKey, configHash, tables }
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
    (countByStatus.get("created") ?? 0) +
    (countByStatus.get("queued") ?? 0) +
    (countByStatus.get("running") ?? 0) +
    (countByStatus.get("waiting_for_input") ?? 0) +
    (countByStatus.get("awaiting_approval") ?? 0) +
    (countByStatus.get("needs_revision") ?? 0)
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

function failureRateForAgent(
  agentId: string,
  now: number,
  windowMs: number,
): AgentFailureRateSnapshot {
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

function relationshipFromRow(
  row: ReturnType<typeof listAgentRelationships>[number],
): AgentRelationship {
  return {
    edgeId: row.edge_id,
    parentAgentId: row.parent_agent_id,
    childAgentId: row.child_agent_id,
    relationshipType: row.relationship_type,
    status: row.status,
    sortOrder: row.sort_order,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function activeRelationships(): AgentRelationship[] {
  return listAgentRelationships({ status: "active" }).map(relationshipFromRow)
}

function directChildBlockedReasons(
  agent: AgentRegistryEntry | undefined,
  rootAgentId: string,
  agentsById: Map<string, AgentRegistryEntry>,
  active: AgentRelationship[],
): string[] {
  if (!agent) return ["missing_agent"]
  const reasons: string[] = []
  if (agent.status !== "enabled") reasons.push(`agent_${agent.status}`)
  const parentByChild = new Map(
    active.map((relationship) => [relationship.childAgentId, relationship]),
  )
  let cursor = agent.agentId
  const seen = new Set<string>()
  while (cursor !== rootAgentId) {
    if (seen.has(cursor)) {
      reasons.push("cycle_detected")
      break
    }
    seen.add(cursor)
    const relationship = parentByChild.get(cursor)
    if (!relationship) break
    const parent = agentsById.get(relationship.parentAgentId)
    if (relationship.parentAgentId !== rootAgentId && !parent) reasons.push("missing_ancestor")
    if (parent && relationship.parentAgentId !== rootAgentId && parent.status !== "enabled") {
      reasons.push(`ancestor_${parent.status}`)
    }
    cursor = relationship.parentAgentId
  }
  return uniqueStrings(reasons)
}

function buildHierarchySnapshot(input: {
  rootAgentId: string
  agentsById: Map<string, AgentRegistryEntry>
}): RegistryHierarchySnapshot {
  const active = activeRelationships()
  const directChildren: RegistryHierarchyDirectChildSnapshot[] = []
  const directChildrenByParent = new Map<string, string[]>()
  const diagnostics: OrchestrationRegistryDiagnostic[] = []
  const appendDirectChild = (
    parentAgentId: string,
    childAgentId: string,
    edgeId: string,
    relationshipStatus: AgentRelationship["status"] | "fallback",
  ) => {
    const agent = input.agentsById.get(childAgentId)
    const reasonCodes = directChildBlockedReasons(
      agent,
      input.rootAgentId,
      input.agentsById,
      active,
    )
    const children = directChildrenByParent.get(parentAgentId) ?? []
    children.push(childAgentId)
    directChildrenByParent.set(parentAgentId, children)
    directChildren.push({
      parentAgentId,
      childAgentId,
      edgeId,
      relationshipStatus,
      executionCandidate: reasonCodes.length === 0,
      reasonCodes,
    })
    for (const reasonCode of reasonCodes) {
      diagnostics.push({
        code: reasonCode,
        severity:
          reasonCode === "missing_agent" || reasonCode === "cycle_detected" ? "invalid" : "warning",
        message: `${parentAgentId} direct child ${childAgentId} is blocked by ${reasonCode}.`,
        parentAgentId,
        childAgentId,
        agentId: childAgentId,
      })
    }
  }

  if (active.length === 0) {
    for (const agent of [...input.agentsById.values()].sort((a, b) =>
      a.agentId.localeCompare(b.agentId),
    )) {
      appendDirectChild(
        input.rootAgentId,
        agent.agentId,
        `fallback:${input.rootAgentId}->${agent.agentId}`,
        "fallback",
      )
    }
    diagnostics.push({
      code: "hierarchy_fallback_enabled_sub_agents",
      severity: "info",
      message:
        "No hierarchy rows exist; registry projects configured sub-agents under Nobie for candidate diagnostics.",
      parentAgentId: input.rootAgentId,
    })
  } else {
    for (const relationship of active.sort(
      (left, right) =>
        left.parentAgentId.localeCompare(right.parentAgentId) ||
        left.sortOrder - right.sortOrder ||
        left.edgeId.localeCompare(right.edgeId),
    )) {
      appendDirectChild(
        relationship.parentAgentId,
        relationship.childAgentId,
        relationship.edgeId,
        relationship.status,
      )
    }
  }

  const directChildrenRecord: Record<string, string[]> = {}
  for (const [parentAgentId, childIds] of directChildrenByParent.entries()) {
    directChildrenRecord[parentAgentId] = sortedUniqueStrings(childIds)
  }
  const topLevelSubAgentIds = (directChildrenRecord[input.rootAgentId] ?? []).filter((agentId) => {
    const agent = input.agentsById.get(agentId)
    return agent?.status === "enabled"
  })

  return {
    rootAgentId: input.rootAgentId,
    fallbackActive: active.length === 0,
    directChildrenByParent: directChildrenRecord,
    topLevelSubAgentIds,
    directChildren: directChildren.sort(
      (left, right) =>
        left.parentAgentId.localeCompare(right.parentAgentId) ||
        left.childAgentId.localeCompare(right.childAgentId),
    ),
    diagnostics,
  }
}

function defaultMembershipId(teamId: string, agentId: string, index: number): string {
  return `${teamId}:membership:${agentId}:${index}`
}

function teamMemberships(team: TeamConfig): TeamMembership[] {
  if (team.memberships && team.memberships.length > 0) {
    return team.memberships.map((membership, index) => ({
      ...membership,
      membershipId:
        membership.membershipId || defaultMembershipId(team.teamId, membership.agentId, index),
      teamId: team.teamId,
      primaryRole:
        membership.primaryRole || membership.teamRoles[0] || team.roleHints[index] || "member",
      teamRoles: uniqueStrings(
        membership.teamRoles.length > 0
          ? membership.teamRoles
          : [team.roleHints[index] ?? "member"],
      ),
      sortOrder: membership.sortOrder ?? index,
      status: membership.status ?? "active",
    }))
  }

  return team.memberAgentIds.map((agentId, index) => {
    const primaryRole = team.roleHints[index] ?? "member"
    return {
      membershipId: defaultMembershipId(team.teamId, agentId, index),
      teamId: team.teamId,
      agentId,
      teamRoles: [primaryRole],
      primaryRole,
      required: true,
      sortOrder: index,
      status: "active",
      ...(team.ownerAgentId ? { ownerAgentIdSnapshot: team.ownerAgentId } : {}),
    }
  })
}

function coverageDimension(
  members: RegistryTeamMemberCoverageSnapshot[],
  required: string[],
  providerValues: (member: RegistryTeamMemberCoverageSnapshot) => string[],
): RegistryCoverageDimensionSnapshot {
  const providers: Record<string, string[]> = {}
  for (const item of required) {
    providers[item] = members
      .filter((member) => providerValues(member).includes(item))
      .map((member) => member.agentId)
      .sort((left, right) => left.localeCompare(right))
  }
  const covered = required.filter((item) => (providers[item] ?? []).length > 0)
  return {
    required,
    covered,
    missing: required.filter((item) => !covered.includes(item)),
    providers,
  }
}

function capabilityIdsForAgent(agent: AgentRegistryEntry): string[] {
  return sortedUniqueStrings([
    ...agent.specialtyTags,
    ...agent.capabilitySummary.enabledSkillIds,
    ...agent.capabilitySummary.enabledMcpServerIds,
    ...agent.capabilitySummary.enabledToolNames,
    agent.permissionProfile.profileId,
    agent.permissionProfile.riskCeiling,
  ])
}

function registryDiagnostic(
  input: OrchestrationRegistryDiagnostic,
): OrchestrationRegistryDiagnostic {
  return input
}

function healthFromTeamCoverage(
  coverage: RegistryTeamCoverageSnapshot,
): RegistryTeamHealthSnapshot {
  const invalidDiagnostics = coverage.diagnostics.filter(
    (diagnostic) => diagnostic.severity === "invalid",
  )
  const warningDiagnostics = coverage.diagnostics.filter(
    (diagnostic) => diagnostic.severity === "warning",
  )
  const status =
    invalidDiagnostics.length > 0
      ? "invalid"
      : warningDiagnostics.length > 0
        ? "degraded"
        : "healthy"
  return {
    teamId: coverage.teamId,
    status,
    executionCandidate: status === "healthy",
    activeMemberCount: coverage.activeMemberAgentIds.length,
    referenceMemberCount: coverage.referenceMemberAgentIds.length,
    unresolvedMemberCount: coverage.unresolvedMemberAgentIds.length,
    excludedMemberCount: coverage.excludedMemberAgentIds.length,
    diagnostics: coverage.diagnostics,
    coverageSummary: {
      missingRoles: coverage.roleCoverage.missing,
      missingCapabilityTags: coverage.capabilityCoverage.missing,
      recalculationKeys: coverage.recalculationKeys,
    },
  }
}

function agentEntry(
  config: SubAgentConfig,
  source: AgentRegistryEntry["source"],
  now: number,
  failureWindowMs: number,
): AgentRegistryEntry {
  const capabilityModelSummary = resolveAgentCapabilityModelSummary(config)
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
    skillMcpSummary: capabilityModelSummary.skillMcpSummary,
    capabilitySummary: capabilityModelSummary.capabilitySummary,
    modelSummary: capabilityModelSummary.modelSummary,
    degradedReasonCodes: capabilityModelSummary.degradedReasonCodes,
    currentLoad: runtimeLoadForAgent(config),
    failureRate: failureRateForAgent(config.agentId, now, failureWindowMs),
  }
}

function teamEntry(
  config: TeamConfig,
  source: TeamRegistryEntry["source"],
  activeAgentIds: Set<string>,
): TeamRegistryEntry {
  return {
    teamId: config.teamId,
    displayName: config.displayName,
    ...(config.nickname ? { nickname: config.nickname } : {}),
    status: config.status,
    purpose: config.purpose,
    roleHints: [...config.roleHints],
    memberAgentIds: [...config.memberAgentIds],
    activeMemberAgentIds: config.memberAgentIds.filter((agentId) => activeAgentIds.has(agentId)),
    unresolvedMemberAgentIds: config.memberAgentIds.filter(
      (agentId) => !activeAgentIds.has(agentId),
    ),
    source,
    config,
  }
}

function buildTeamCoverageSnapshot(input: {
  team: TeamRegistryEntry
  generatedAt: number
  rootAgentId: string
  agentsById: Map<string, AgentRegistryEntry>
  hierarchy: RegistryHierarchySnapshot
}): RegistryTeamCoverageSnapshot {
  const ownerAgentId = input.team.config.ownerAgentId ?? input.rootAgentId
  const owner =
    ownerAgentId === input.rootAgentId
      ? { status: "enabled" as const }
      : input.agentsById.get(ownerAgentId)
  const directChildIds = new Set(input.hierarchy.directChildrenByParent[ownerAgentId] ?? [])
  const diagnostics: OrchestrationRegistryDiagnostic[] = []
  if (input.team.status !== "enabled") {
    diagnostics.push(
      registryDiagnostic({
        code: "team_unavailable",
        severity: "invalid",
        message: `Team ${input.team.teamId} is ${input.team.status}.`,
        teamId: input.team.teamId,
        parentAgentId: ownerAgentId,
      }),
    )
  }
  if (!owner) {
    diagnostics.push(
      registryDiagnostic({
        code: "team_owner_missing",
        severity: "invalid",
        message: `Team owner ${ownerAgentId} is not defined.`,
        teamId: input.team.teamId,
        parentAgentId: ownerAgentId,
      }),
    )
  } else if (owner.status !== "enabled") {
    diagnostics.push(
      registryDiagnostic({
        code: "team_owner_unavailable",
        severity: "invalid",
        message: `Team owner ${ownerAgentId} is ${owner.status}.`,
        teamId: input.team.teamId,
        parentAgentId: ownerAgentId,
      }),
    )
  }

  const members = teamMemberships(input.team.config).map((membership) => {
    const agent = input.agentsById.get(membership.agentId)
    const reasonCodes: string[] = []
    const directChild = directChildIds.has(membership.agentId)
    if (!agent) reasonCodes.push("member_agent_missing")
    if (membership.status === "removed") reasonCodes.push("membership_removed")
    if (membership.status === "inactive") reasonCodes.push("membership_inactive")
    if (!directChild) reasonCodes.push("owner_direct_child_required")
    if (owner && owner.status !== "enabled") reasonCodes.push("team_owner_unavailable")
    if (agent?.status && agent.status !== "enabled") reasonCodes.push(`member_${agent.status}`)
    if (agent && !agent.delegationEnabled) reasonCodes.push("delegation_disabled")
    if (agent && agent.currentLoad.activeSubSessions >= agent.currentLoad.maxParallelSessions) {
      reasonCodes.push("member_overloaded")
    }
    if (agent?.modelSummary.availability === "unavailable") {
      reasonCodes.push("member_model_unavailable")
    } else if (agent?.modelSummary.availability === "degraded") {
      reasonCodes.push("member_model_degraded")
    }
    if (agent?.capabilitySummary.disabledSkillIds.length) {
      reasonCodes.push("member_skill_binding_unavailable")
    }
    if (agent?.capabilitySummary.disabledMcpServerIds.length) {
      reasonCodes.push("member_mcp_binding_unavailable")
    }
    if (agent?.capabilitySummary.availability === "unavailable") {
      reasonCodes.push("member_capability_unavailable")
    }

    const blockingReasons = reasonCodes.filter(
      (reasonCode) => reasonCode !== "member_model_degraded",
    )
    const active =
      membership.status === "active" &&
      input.team.status === "enabled" &&
      owner?.status === "enabled" &&
      agent?.status === "enabled" &&
      directChild &&
      blockingReasons.length === 0
    let executionState: RegistryTeamMemberCoverageSnapshot["executionState"] = "excluded"
    if (!agent) executionState = "unresolved"
    else if (!directChild) executionState = "reference"
    else if (membership.status === "fallback_only") executionState = "fallback"
    else if (active) executionState = "active"

    return {
      agentId: membership.agentId,
      membershipId: membership.membershipId,
      primaryRole: membership.primaryRole,
      teamRoles: [...membership.teamRoles],
      required: membership.required,
      executionState,
      directChild,
      active,
      reasonCodes: uniqueStrings(reasonCodes),
      specialtyTags: agent?.specialtyTags ?? [],
      capabilityIds: agent ? capabilityIdsForAgent(agent) : [],
      ...(agent?.modelSummary.availability
        ? { modelAvailability: agent.modelSummary.availability }
        : {}),
      ...(agent?.capabilitySummary.availability
        ? { capabilityAvailability: agent.capabilitySummary.availability }
        : {}),
    }
  })

  for (const member of members) {
    for (const reasonCode of member.reasonCodes) {
      diagnostics.push({
        code: reasonCode,
        severity:
          reasonCode === "member_agent_missing" ||
          reasonCode === "team_owner_unavailable" ||
          reasonCode === "member_archived"
            ? "invalid"
            : "warning",
        message: `${member.agentId} is not an active team execution member because of ${reasonCode}.`,
        teamId: input.team.teamId,
        agentId: member.agentId,
        parentAgentId: ownerAgentId,
      })
    }
  }

  const activeMembers = members.filter((member) => member.active)
  const requiredRoles = sortedUniqueStrings(input.team.config.requiredTeamRoles ?? [])
  const requiredCapabilities = sortedUniqueStrings(input.team.config.requiredCapabilityTags ?? [])
  const roleCoverage = coverageDimension(activeMembers, requiredRoles, (member) => [
    member.primaryRole,
    ...member.teamRoles,
  ])
  const capabilityCoverage = coverageDimension(
    activeMembers,
    requiredCapabilities,
    (member) => member.capabilityIds,
  )
  const roleTagOnlyMembers = members.filter((member) => {
    const agent = input.agentsById.get(member.agentId)
    return (
      member.directChild &&
      input.team.status === "enabled" &&
      owner?.status === "enabled" &&
      membershipActiveForCoverage(input.team.config, member.agentId) &&
      agent?.status === "enabled"
    )
  })
  const tagOnlyCapabilityCoverage = coverageDimension(
    roleTagOnlyMembers,
    requiredCapabilities,
    (member) => member.specialtyTags,
  )

  if (activeMembers.length === 0) {
    diagnostics.push({
      code: "no_active_team_members",
      severity: "invalid",
      message: "Team has no active owner-direct-child members.",
      teamId: input.team.teamId,
      parentAgentId: ownerAgentId,
    })
  }
  if (
    input.team.config.leadAgentId &&
    !activeMembers.some((member) => member.agentId === input.team.config.leadAgentId)
  ) {
    diagnostics.push({
      code: "lead_not_active_member",
      severity: "invalid",
      message: `Team lead ${input.team.config.leadAgentId} is not an active member.`,
      teamId: input.team.teamId,
      agentId: input.team.config.leadAgentId,
      parentAgentId: ownerAgentId,
    })
  }
  if (roleCoverage.missing.length > 0) {
    diagnostics.push({
      code: "required_role_missing",
      severity: "warning",
      message: `Missing required team roles: ${roleCoverage.missing.join(", ")}.`,
      teamId: input.team.teamId,
      parentAgentId: ownerAgentId,
    })
  }
  if (capabilityCoverage.missing.length > 0) {
    diagnostics.push({
      code: "required_capability_missing",
      severity: "warning",
      message: `Missing required capability tags: ${capabilityCoverage.missing.join(", ")}.`,
      teamId: input.team.teamId,
      parentAgentId: ownerAgentId,
    })
  }
  if (tagOnlyCapabilityCoverage.missing.length < capabilityCoverage.missing.length) {
    diagnostics.push({
      code: "coverage_recalculated_conservative",
      severity: "warning",
      message:
        "Role/tag-only team coverage was reduced after capability and model summaries were applied.",
      teamId: input.team.teamId,
      parentAgentId: ownerAgentId,
    })
  }

  const coverageWithoutHealth: RegistryTeamCoverageSnapshot = {
    teamId: input.team.teamId,
    ownerAgentId,
    ...(input.team.config.leadAgentId ? { leadAgentId: input.team.config.leadAgentId } : {}),
    generatedAt: input.generatedAt,
    executionCandidate: false,
    activeMemberAgentIds: activeMembers.map((member) => member.agentId),
    referenceMemberAgentIds: members
      .filter((member) => member.executionState === "reference")
      .map((member) => member.agentId),
    unresolvedMemberAgentIds: members
      .filter((member) => member.executionState === "unresolved")
      .map((member) => member.agentId),
    excludedMemberAgentIds: members
      .filter((member) => member.executionState === "excluded")
      .map((member) => member.agentId),
    members,
    roleCoverage,
    capabilityCoverage,
    diagnostics,
    recalculationKeys: [...TEAM_RECALCULATION_KEYS],
  }
  const health = healthFromTeamCoverage(coverageWithoutHealth)
  return {
    ...coverageWithoutHealth,
    executionCandidate: health.status === "healthy",
  }
}

function membershipActiveForCoverage(team: TeamConfig, agentId: string): boolean {
  return teamMemberships(team).some(
    (membership) => membership.agentId === agentId && membership.status === "active",
  )
}

function attachTeamCoverage(input: {
  teams: TeamRegistryEntry[]
  generatedAt: number
  rootAgentId: string
  agentsById: Map<string, AgentRegistryEntry>
  hierarchy: RegistryHierarchySnapshot
}): TeamRegistryEntry[] {
  return input.teams.map((team) => {
    const coverage = buildTeamCoverageSnapshot({
      team,
      generatedAt: input.generatedAt,
      rootAgentId: input.rootAgentId,
      agentsById: input.agentsById,
      hierarchy: input.hierarchy,
    })
    return {
      ...team,
      coverage,
      health: healthFromTeamCoverage(coverage),
    }
  })
}

function candidateReasonCodes(agent: AgentRegistryEntry | undefined): string[] {
  if (!agent) return ["missing_agent"]
  const reasons: string[] = []
  if (agent.status !== "enabled") reasons.push(`agent_${agent.status}`)
  if (!agent.delegationEnabled) reasons.push("delegation_disabled")
  if (agent.retryBudget <= 0) reasons.push("retry_budget_exhausted")
  if (agent.currentLoad.activeSubSessions >= agent.currentLoad.maxParallelSessions) {
    reasons.push("concurrency_limit_reached")
  }
  if (!agent.permissionProfile?.profileId) reasons.push("permission_missing")
  if (
    agent.capabilitySummary.availability === "unavailable" ||
    agent.capabilitySummary.disabledSkillIds.length > 0 ||
    agent.capabilitySummary.disabledMcpServerIds.length > 0
  ) {
    reasons.push("capability_unavailable")
  } else if (agent.capabilitySummary.availability === "degraded") {
    reasons.push("capability_degraded")
  }
  if (agent.modelSummary.availability === "unavailable") reasons.push("model_unavailable")
  else if (agent.modelSummary.availability === "degraded") reasons.push("model_degraded")
  return uniqueStrings(reasons)
}

function buildAgentCapabilityIndex(input: {
  generatedAt: number
  rootAgentId: string
  agents: AgentRegistryEntry[]
  hierarchy: RegistryHierarchySnapshot
  invalidation: RegistryInvalidationSnapshot
  clock: () => number
}): AgentCapabilityIndex {
  const cached = HOT_CAPABILITY_INDEX_CACHE.get(input.invalidation.cacheKey)
  if (cached) return cached
  const startedAt = input.clock()
  const agentsById = new Map(input.agents.map((agent) => [agent.agentId, agent]))
  const candidateAgentIdsByParent: Record<string, string[]> = {}
  const excludedCandidatesByParent: AgentCapabilityIndex["excludedCandidatesByParent"] = {}
  const candidatesByAgentId: Record<string, AgentCapabilityIndexCandidate[]> = {}
  const diagnostics: OrchestrationRegistryDiagnostic[] = []

  for (const [parentAgentId, childAgentIds] of Object.entries(
    input.hierarchy.directChildrenByParent,
  ).sort(([left], [right]) => left.localeCompare(right))) {
    candidateAgentIdsByParent[parentAgentId] = []
    excludedCandidatesByParent[parentAgentId] = []
    for (const agentId of childAgentIds) {
      const agent = agentsById.get(agentId)
      const reasonCodes = candidateReasonCodes(agent)
      const candidate: AgentCapabilityIndexCandidate = {
        parentAgentId,
        agentId,
        eligible: reasonCodes.length === 0,
        reasonCodes,
        specialtyTags: agent?.specialtyTags ?? [],
        enabledSkillIds: agent?.capabilitySummary.enabledSkillIds ?? [],
        enabledMcpServerIds: agent?.capabilitySummary.enabledMcpServerIds ?? [],
        enabledToolNames: agent?.capabilitySummary.enabledToolNames ?? [],
        modelAvailability: agent?.modelSummary.availability ?? "unavailable",
        capabilityAvailability: agent?.capabilitySummary.availability ?? "unavailable",
        load: agent?.currentLoad ?? {
          activeSubSessions: 0,
          queuedSubSessions: 0,
          failedSubSessions: 0,
          completedSubSessions: 0,
          maxParallelSessions: 1,
          utilization: 0,
        },
        failureRate: agent?.failureRate ?? {
          windowMs: 0,
          consideredSubSessions: 0,
          failedSubSessions: 0,
          value: 0,
        },
      }
      const byAgent = candidatesByAgentId[agentId] ?? []
      byAgent.push(candidate)
      candidatesByAgentId[agentId] = byAgent
      if (candidate.eligible) candidateAgentIdsByParent[parentAgentId]?.push(agentId)
      else {
        excludedCandidatesByParent[parentAgentId]?.push({ agentId, reasonCodes })
        diagnostics.push({
          code: "candidate_excluded",
          severity: "warning",
          message: `${agentId} is excluded for parent ${parentAgentId}: ${reasonCodes.join(", ")}.`,
          parentAgentId,
          agentId,
        })
        for (const reasonCode of reasonCodes) {
          diagnostics.push({
            code: reasonCode,
            severity: reasonCode === "missing_agent" ? "invalid" : "warning",
            message: `${agentId} is excluded for parent ${parentAgentId} by ${reasonCode}.`,
            parentAgentId,
            agentId,
          })
        }
      }
    }
  }

  for (const parentAgentId of Object.keys(candidateAgentIdsByParent)) {
    candidateAgentIdsByParent[parentAgentId] = sortedUniqueStrings(
      candidateAgentIdsByParent[parentAgentId] ?? [],
    )
    excludedCandidatesByParent[parentAgentId] = [
      ...(excludedCandidatesByParent[parentAgentId] ?? []),
    ].sort((left, right) => left.agentId.localeCompare(right.agentId))
  }

  const index: AgentCapabilityIndex = {
    generatedAt: input.generatedAt,
    cacheKey: input.invalidation.cacheKey,
    rootAgentId: input.rootAgentId,
    topLevelCandidateAgentIds: candidateAgentIdsByParent[input.rootAgentId] ?? [],
    directChildAgentIdsByParent: input.hierarchy.directChildrenByParent,
    candidateAgentIdsByParent,
    excludedCandidatesByParent,
    candidatesByAgentId,
    diagnostics,
    metrics: {
      buildLatencyMs: Math.max(0, input.clock() - startedAt),
      targetP95Ms: HOT_INDEX_TARGET_P95_MS,
    },
  }
  HOT_CAPABILITY_INDEX_CACHE.set(input.invalidation.cacheKey, index)
  return index
}

function buildOrchestrationRegistrySnapshotUnsafe(input: {
  dependencies: RegistryServiceDependencies
  startedAt: number
  clock: () => number
}): OrchestrationRegistrySnapshot {
  const cfg = input.dependencies.getConfig?.() ?? getConfig()
  const now = input.startedAt
  const failureWindowMs = input.dependencies.failureWindowMs ?? 7 * 24 * 60 * 60 * 1000
  const diagnostics: OrchestrationRegistrySnapshot["diagnostics"] = []
  const agentsById = new Map<string, AgentRegistryEntry>()
  const teamsById = new Map<string, TeamConfig & { source: TeamRegistryEntry["source"] }>()
  const rootAgentId = rootAgentIdFromConfig(cfg.orchestration)
  const invalidation = buildInvalidationSnapshot(cfg.orchestration)
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
      diagnostics.push({
        code: "invalid_agent_config_row",
        severity: "invalid",
        message: `agent_configs row ${row.agent_id} could not be parsed.`,
        agentId: row.agent_id,
      })
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
      diagnostics.push({
        code: "invalid_team_config_row",
        severity: "invalid",
        message: `team_configs row ${row.team_id} could not be parsed.`,
        teamId: row.team_id,
      })
      continue
    }
    teamsById.set(config.teamId, { ...config, source: "db" })
  }

  const hierarchy = buildHierarchySnapshot({ rootAgentId, agentsById })
  diagnostics.push(...hierarchy.diagnostics)
  const activeAgentIds = new Set(
    [...agentsById.values()]
      .filter((agent) => agent.status === "enabled" && agent.delegationEnabled)
      .map((agent) => agent.agentId),
  )
  const teamsWithoutCoverage = [...teamsById.values()]
    .map((team) => teamEntry(team, team.source, activeAgentIds))
    .sort((a, b) => a.teamId.localeCompare(b.teamId))
  const teams = attachTeamCoverage({
    teams: teamsWithoutCoverage,
    generatedAt: now,
    rootAgentId,
    agentsById,
    hierarchy,
  })
  const membershipEdges = listAgentTeamMemberships()
    .filter(
      (membership): membership is typeof membership & { status: "active" | "unresolved" } =>
        membership.status === "active" || membership.status === "unresolved",
    )
    .map((membership) => ({
      teamId: membership.team_id,
      agentId: membership.agent_id,
      status: membership.status,
      ...(membership.role_hint ? { roleHint: membership.role_hint } : {}),
    }))

  for (const team of teams) {
    for (const agentId of team.memberAgentIds) {
      if (!agentsById.has(agentId)) {
        diagnostics.push({
          code: "unresolved_team_member",
          severity: "warning",
          message: `${team.teamId} references missing agent ${agentId}.`,
          teamId: team.teamId,
          agentId,
        })
      }
    }
    diagnostics.push(...(team.coverage?.diagnostics ?? []))
  }

  for (const agent of agentsById.values()) {
    for (const reasonCode of agent.degradedReasonCodes) {
      diagnostics.push({
        code: reasonCode,
        severity: "warning",
        message: `${agent.agentId} has capability/model diagnostic ${reasonCode}.`,
        agentId: agent.agentId,
      })
    }
  }

  const agents = [...agentsById.values()].sort((a, b) => a.agentId.localeCompare(b.agentId))
  const capabilityIndex = buildAgentCapabilityIndex({
    generatedAt: now,
    rootAgentId,
    agents,
    hierarchy,
    invalidation,
    clock: input.clock,
  })
  diagnostics.push(...capabilityIndex.diagnostics)

  return {
    status: "ready",
    generatedAt: now,
    agents,
    teams,
    hierarchy,
    capabilityIndex,
    invalidation,
    metrics: {
      buildLatencyMs: Math.max(0, input.clock() - input.startedAt),
      coldSnapshotTargetP95Ms: COLD_REGISTRY_TARGET_P95_MS,
      hotIndexTargetP95Ms: HOT_INDEX_TARGET_P95_MS,
    },
    membershipEdges,
    diagnostics,
  }
}

function fallbackRegistrySnapshot(input: {
  error: unknown
  generatedAt: number
  buildLatencyMs: number
}): OrchestrationRegistrySnapshot {
  const detail = input.error instanceof Error ? input.error.message : String(input.error)
  const invalidation: RegistryInvalidationSnapshot = {
    cacheKey: sha256(`registry_load_failed:${detail}`),
    configHash: sha256("registry_load_failed"),
    tables: {},
  }
  const hierarchy: RegistryHierarchySnapshot = {
    rootAgentId: DEFAULT_ROOT_AGENT_ID,
    fallbackActive: true,
    directChildrenByParent: {},
    topLevelSubAgentIds: [],
    directChildren: [],
    diagnostics: [],
  }
  const capabilityIndex = buildAgentCapabilityIndex({
    generatedAt: input.generatedAt,
    rootAgentId: DEFAULT_ROOT_AGENT_ID,
    agents: [],
    hierarchy,
    invalidation,
    clock: () => input.generatedAt,
  })
  return {
    status: "degraded",
    generatedAt: input.generatedAt,
    agents: [],
    teams: [],
    hierarchy,
    capabilityIndex,
    invalidation,
    metrics: {
      buildLatencyMs: input.buildLatencyMs,
      coldSnapshotTargetP95Ms: COLD_REGISTRY_TARGET_P95_MS,
      hotIndexTargetP95Ms: HOT_INDEX_TARGET_P95_MS,
    },
    fallback: {
      mode: "single_nobie",
      reasonCode: "registry_load_failed",
      reason: `Registry snapshot failed and fell back to single Nobie mode: ${detail}`,
    },
    membershipEdges: [],
    diagnostics: [
      {
        code: "registry_load_failed",
        severity: "invalid",
        message: `Registry snapshot failed: ${detail}`,
      },
    ],
  }
}

export function clearAgentCapabilityIndexCache(): void {
  HOT_CAPABILITY_INDEX_CACHE.clear()
}

export function buildOrchestrationRegistrySnapshot(
  dependencies: RegistryServiceDependencies = {},
): OrchestrationRegistrySnapshot {
  const clock = dependencies.now ?? (() => Date.now())
  const startedAt = clock()
  try {
    return buildOrchestrationRegistrySnapshotUnsafe({ dependencies, startedAt, clock })
  } catch (error) {
    return fallbackRegistrySnapshot({
      error,
      generatedAt: startedAt,
      buildLatencyMs: Math.max(0, clock() - startedAt),
    })
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
      upsertAgentConfig({ ...current, status: "archived", updatedAt: now() } as AgentConfig, {
        source: "manual",
        now: now(),
      })
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
      upsertTeamConfig(
        { ...current, status: "disabled", updatedAt: now() },
        { source: "manual", now: now() },
      )
      return true
    },
    archive(teamId: string): boolean {
      const current = this.get(teamId)
      if (!current) return false
      upsertTeamConfig(
        { ...current, status: "archived", updatedAt: now() },
        { source: "manual", now: now() },
      )
      return true
    },
  }
}
