import {
  type CapabilityRiskLevel,
  type DependencyEdgeContract,
  type ExpectedOutputContract,
  type OrchestrationPlan,
  type OrchestrationTask,
  type ResourceLockContract,
  type StructuredTaskScope,
} from "../contracts/sub-agent-orchestration.js"
import { CONTRACT_SCHEMA_VERSION } from "../contracts/index.js"
import type { OrchestrationModeSnapshot } from "./mode.js"
import {
  buildOrchestrationRegistrySnapshot,
  type AgentRegistryEntry,
  type OrchestrationRegistrySnapshot,
} from "./registry.js"

export const ORCHESTRATION_PLANNER_VERSION = "structured-v1"

export interface OrchestrationPlannerIntent {
  explicitAgentId?: string
  explicitTeamId?: string
  specialtyTags?: string[]
  requiredCapabilities?: string[]
  requiredSkillIds?: string[]
  requiredMcpServerIds?: string[]
  requiredToolNames?: string[]
  requiredRisk?: CapabilityRiskLevel
}

export interface OrchestrationPlannerInput {
  parentRunId: string
  parentRequestId: string
  userRequest: string
  modeSnapshot: OrchestrationModeSnapshot
  registrySnapshot?: OrchestrationRegistrySnapshot
  loadRegistrySnapshot?: () => OrchestrationRegistrySnapshot
  taskScopes?: StructuredTaskScope[]
  intent?: OrchestrationPlannerIntent
  resourceLocks?: ResourceLockContract[]
  resourceLocksByTaskId?: Record<string, ResourceLockContract[]>
  dependencyEdges?: DependencyEdgeContract[]
  timeoutMs?: number
  now?: () => number
  idProvider?: () => string
}

export interface OrchestrationCandidateScore {
  agentId: string
  teamIds: string[]
  score: number
  selected: boolean
  reasonCodes: string[]
  excludedReasonCodes: string[]
  approvalRequired: boolean
  approvalRisk?: CapabilityRiskLevel
}

export interface OrchestrationPlanBuildResult {
  plan: OrchestrationPlan
  registrySnapshot?: OrchestrationRegistrySnapshot
  candidateScores: OrchestrationCandidateScore[]
  timedOut: boolean
  reasonCodes: string[]
}

const RISK_ORDER: Record<CapabilityRiskLevel, number> = {
  safe: 0,
  moderate: 1,
  external: 2,
  sensitive: 3,
  dangerous: 4,
}

function uniqueStrings(values: string[] | undefined): string[] {
  return [...new Set((values ?? []).map((value) => value.trim()).filter(Boolean))].sort()
}

function hasAll(haystack: string[], needles: string[]): boolean {
  const set = new Set(haystack)
  return needles.every((needle) => set.has(needle))
}

function countMatches(haystack: string[], needles: string[]): number {
  const set = new Set(haystack)
  return needles.filter((needle) => set.has(needle)).length
}

function defaultExpectedOutput(): ExpectedOutputContract {
  return {
    outputId: "answer",
    kind: "text",
    description: "User-facing answer or direct execution result.",
    required: true,
    acceptance: {
      requiredEvidenceKinds: [],
      artifactRequired: false,
      reasonCodes: ["user_request_satisfied"],
    },
  }
}

export function buildDefaultStructuredTaskScope(userRequest: string): StructuredTaskScope {
  return {
    goal: userRequest.trim() || "Process the user request.",
    intentType: "user_request",
    actionType: "general",
    constraints: [],
    expectedOutputs: [defaultExpectedOutput()],
    reasonCodes: ["default_structured_scope"],
  }
}

function riskAllows(agent: AgentRegistryEntry, requiredRisk: CapabilityRiskLevel): boolean {
  return RISK_ORDER[requiredRisk] <= RISK_ORDER[agent.permissionProfile.riskCeiling]
}

function riskNeedsApproval(agent: AgentRegistryEntry, requiredRisk: CapabilityRiskLevel): boolean {
  return RISK_ORDER[requiredRisk] >= RISK_ORDER[agent.permissionProfile.approvalRequiredFrom]
}

function effectiveTeamIds(agent: AgentRegistryEntry, registry: OrchestrationRegistrySnapshot): string[] {
  const fromMembership = registry.membershipEdges
    .filter((edge) => edge.status === "active" && edge.agentId === agent.agentId)
    .map((edge) => edge.teamId)
  return uniqueStrings([...agent.teamIds, ...fromMembership])
}

function candidateAllowedByExplicitTarget(
  agent: AgentRegistryEntry,
  teamIds: string[],
  intent: OrchestrationPlannerIntent,
): boolean {
  if (intent.explicitAgentId) return agent.agentId === intent.explicitAgentId
  if (intent.explicitTeamId) return teamIds.includes(intent.explicitTeamId)
  return true
}

function scoreCandidate(
  agent: AgentRegistryEntry,
  registry: OrchestrationRegistrySnapshot,
  intent: OrchestrationPlannerIntent,
): OrchestrationCandidateScore {
  const teamIds = effectiveTeamIds(agent, registry)
  const reasonCodes: string[] = []
  const excludedReasonCodes: string[] = []
  const requiredSkillIds = uniqueStrings(intent.requiredSkillIds)
  const requiredMcpServerIds = uniqueStrings(intent.requiredMcpServerIds)
  const requiredToolNames = uniqueStrings(intent.requiredToolNames)
  const requiredCapabilities = uniqueStrings(intent.requiredCapabilities)
  const specialtyTags = uniqueStrings(intent.specialtyTags)
  const requiredRisk = intent.requiredRisk ?? "safe"

  if (!candidateAllowedByExplicitTarget(agent, teamIds, intent)) excludedReasonCodes.push("not_explicit_target")
  if (agent.status !== "enabled") excludedReasonCodes.push("agent_not_enabled")
  if (!agent.delegationEnabled) excludedReasonCodes.push("delegation_disabled")
  if (agent.retryBudget <= 0) excludedReasonCodes.push("retry_budget_exhausted")
  if (agent.currentLoad.activeSubSessions >= agent.currentLoad.maxParallelSessions) excludedReasonCodes.push("concurrency_limit_reached")
  if (!hasAll(agent.skillMcpSummary.enabledSkillIds, requiredSkillIds)) excludedReasonCodes.push("missing_required_skill")
  if (!hasAll(agent.skillMcpSummary.enabledMcpServerIds, requiredMcpServerIds)) excludedReasonCodes.push("missing_required_mcp_server")
  if (!hasAll(agent.skillMcpSummary.enabledToolNames, requiredToolNames)) excludedReasonCodes.push("missing_required_tool")
  if (!riskAllows(agent, requiredRisk)) excludedReasonCodes.push("risk_above_agent_ceiling")

  const capabilityPool = [
    ...agent.skillMcpSummary.enabledSkillIds,
    ...agent.skillMcpSummary.enabledMcpServerIds,
    ...agent.skillMcpSummary.enabledToolNames,
    agent.permissionProfile.profileId,
    agent.permissionProfile.riskCeiling,
  ]
  if (!hasAll(capabilityPool, requiredCapabilities)) excludedReasonCodes.push("missing_required_capability")

  let score = 100
  if (intent.explicitAgentId === agent.agentId) {
    score += 1_000
    reasonCodes.push("explicit_agent_target")
  }
  if (intent.explicitTeamId && teamIds.includes(intent.explicitTeamId)) {
    score += 700
    reasonCodes.push("explicit_team_member")
  }

  const specialtyMatches = countMatches(agent.specialtyTags, specialtyTags)
  if (specialtyMatches > 0) {
    score += specialtyMatches * 30
    reasonCodes.push("specialty_tag_match")
  }
  const skillMatches = countMatches(agent.skillMcpSummary.enabledSkillIds, requiredSkillIds)
  const mcpMatches = countMatches(agent.skillMcpSummary.enabledMcpServerIds, requiredMcpServerIds)
  const toolMatches = countMatches(agent.skillMcpSummary.enabledToolNames, requiredToolNames)
  score += skillMatches * 25 + mcpMatches * 20 + toolMatches * 15
  if (skillMatches > 0) reasonCodes.push("required_skill_match")
  if (mcpMatches > 0) reasonCodes.push("required_mcp_match")
  if (toolMatches > 0) reasonCodes.push("required_tool_match")

  if (riskNeedsApproval(agent, requiredRisk) && riskAllows(agent, requiredRisk)) {
    reasonCodes.push("approval_required_for_risk")
  }
  score -= Math.round(agent.currentLoad.utilization * 60)
  score -= Math.round(agent.failureRate.value * 100)
  if (agent.currentLoad.utilization > 0) reasonCodes.push("load_penalty_applied")
  if (agent.failureRate.value > 0) reasonCodes.push("failure_rate_penalty_applied")
  if (reasonCodes.length === 0) reasonCodes.push("structured_candidate_available")

  return {
    agentId: agent.agentId,
    teamIds,
    score,
    selected: false,
    reasonCodes,
    excludedReasonCodes,
    approvalRequired: riskNeedsApproval(agent, requiredRisk) && riskAllows(agent, requiredRisk),
    ...(riskNeedsApproval(agent, requiredRisk) && riskAllows(agent, requiredRisk) ? { approvalRisk: requiredRisk } : {}),
  }
}

function sortedEligibleCandidates(candidates: OrchestrationCandidateScore[]): OrchestrationCandidateScore[] {
  return candidates
    .filter((candidate) => candidate.excludedReasonCodes.length === 0)
    .sort((a, b) => b.score - a.score || a.agentId.localeCompare(b.agentId))
}

function hasExclusiveLockConflict(a: ResourceLockContract[], b: ResourceLockContract[]): boolean {
  return a.some((left) => left.mode === "exclusive" && b.some((right) => (
    right.mode === "exclusive" && right.kind === left.kind && right.target === left.target
  )))
}

function buildIdentity(planId: string, parentRunId: string, parentRequestId: string): OrchestrationPlan["identity"] {
  return {
    schemaVersion: CONTRACT_SCHEMA_VERSION,
    entityType: "session",
    entityId: planId,
    owner: { ownerType: "nobie", ownerId: "agent:nobie" },
    idempotencyKey: `orchestration-plan:${parentRunId}:${parentRequestId}`,
    auditCorrelationId: `orchestration-plan:${planId}`,
    parent: { parentRunId, parentRequestId },
  }
}

function planTask(input: {
  taskId: string
  scope: StructuredTaskScope
  executionKind: OrchestrationTask["executionKind"]
  requiredCapabilities: string[]
  resourceLockIds: string[]
  candidate?: OrchestrationCandidateScore
  assignedTeamId?: string
  reasonCodes: string[]
}): OrchestrationTask {
  return {
    taskId: input.taskId,
    executionKind: input.executionKind,
    scope: input.scope,
    ...(input.candidate ? { assignedAgentId: input.candidate.agentId } : {}),
    ...(input.assignedTeamId ? { assignedTeamId: input.assignedTeamId } : {}),
    requiredCapabilities: input.requiredCapabilities,
    resourceLockIds: input.resourceLockIds,
    planningTrace: {
      ...(input.candidate ? { score: input.candidate.score } : {}),
      reasonCodes: input.reasonCodes,
      ...(input.candidate?.excludedReasonCodes.length ? { excludedReasonCodes: input.candidate.excludedReasonCodes } : {}),
    },
  }
}

function directFallbackPlan(input: {
  parentRunId: string
  parentRequestId: string
  userRequest: string
  modeSnapshot: OrchestrationModeSnapshot
  reasonCodes: string[]
  fallbackReasonCode: string
  now: number
  idProvider: () => string
  timedOut: boolean
  candidateScores?: OrchestrationCandidateScore[]
  status?: "planned" | "degraded"
}): OrchestrationPlanBuildResult {
  const planId = input.idProvider()
  const scope = buildDefaultStructuredTaskScope(input.userRequest)
  const task = planTask({
    taskId: `${planId}:direct:0`,
    scope,
    executionKind: "direct_nobie",
    requiredCapabilities: [],
    resourceLockIds: [],
    reasonCodes: input.reasonCodes,
  })

  const plan: OrchestrationPlan = {
    identity: buildIdentity(planId, input.parentRunId, input.parentRequestId),
    planId,
    parentRunId: input.parentRunId,
    parentRequestId: input.parentRequestId,
    directNobieTasks: [task],
    delegatedTasks: [],
    dependencyEdges: [],
    resourceLocks: [],
    parallelGroups: [],
    approvalRequirements: [],
    fallbackStrategy: {
      mode: input.fallbackReasonCode === "explicit_target_unavailable" ? "ask_user" : "single_nobie",
      reasonCode: input.fallbackReasonCode,
    },
    plannerMetadata: {
      status: input.status ?? "planned",
      plannerVersion: ORCHESTRATION_PLANNER_VERSION,
      timedOut: input.timedOut,
      semanticComparisonUsed: false,
      reasonCodes: input.reasonCodes,
      candidateScores: (input.candidateScores ?? []).map((candidate) => ({
        agentId: candidate.agentId,
        teamIds: candidate.teamIds,
        score: candidate.score,
        selected: candidate.selected,
        reasonCodes: candidate.reasonCodes,
        excludedReasonCodes: candidate.excludedReasonCodes,
      })),
      directReasonCodes: input.reasonCodes,
      fallbackReasonCodes: [input.fallbackReasonCode],
    },
    createdAt: input.now,
  }

  return {
    plan,
    candidateScores: input.candidateScores ?? [],
    timedOut: input.timedOut,
    reasonCodes: input.reasonCodes,
  }
}

export function buildOrchestrationPlan(input: OrchestrationPlannerInput): OrchestrationPlanBuildResult {
  const startedAt = input.now?.() ?? Date.now()
  const now = input.now ?? (() => Date.now())
  const idProvider = input.idProvider ?? (() => crypto.randomUUID())
  const timeoutMs = Math.max(1, input.timeoutMs ?? 120)

  if (input.modeSnapshot.mode !== "orchestration") {
    return directFallbackPlan({
      parentRunId: input.parentRunId,
      parentRequestId: input.parentRequestId,
      userRequest: input.userRequest,
      modeSnapshot: input.modeSnapshot,
      reasonCodes: [`mode_${input.modeSnapshot.mode}`, input.modeSnapshot.reasonCode],
      fallbackReasonCode: input.modeSnapshot.reasonCode,
      now: startedAt,
      idProvider,
      timedOut: false,
    })
  }

  const registry = input.registrySnapshot ?? input.loadRegistrySnapshot?.() ?? buildOrchestrationRegistrySnapshot({ now })
  if (now() - startedAt > timeoutMs) {
    return directFallbackPlan({
      parentRunId: input.parentRunId,
      parentRequestId: input.parentRequestId,
      userRequest: input.userRequest,
      modeSnapshot: input.modeSnapshot,
      reasonCodes: ["planning_timeout"],
      fallbackReasonCode: "planning_timeout_single_nobie",
      now: startedAt,
      idProvider,
      timedOut: true,
      status: "degraded",
    })
  }

  const intent = input.intent ?? {}
  const candidateScores = registry.agents.map((agent) => scoreCandidate(agent, registry, intent))
  const eligible = sortedEligibleCandidates(candidateScores)
  const explicitTargetRequested = Boolean(intent.explicitAgentId || intent.explicitTeamId)

  if (eligible.length === 0) {
    return directFallbackPlan({
      parentRunId: input.parentRunId,
      parentRequestId: input.parentRequestId,
      userRequest: input.userRequest,
      modeSnapshot: input.modeSnapshot,
      reasonCodes: explicitTargetRequested ? ["explicit_target_unavailable"] : ["no_eligible_agent_candidate"],
      fallbackReasonCode: explicitTargetRequested ? "explicit_target_unavailable" : "no_eligible_agent_candidate",
      now: startedAt,
      idProvider,
      timedOut: false,
      candidateScores,
    })
  }

  const planId = idProvider()
  const scopes = input.taskScopes?.length ? input.taskScopes : [buildDefaultStructuredTaskScope(input.userRequest)]
  const resourceLocks = input.resourceLocks ?? []
  const delegatedTasks: OrchestrationTask[] = []
  const approvalRequirements: OrchestrationPlan["approvalRequirements"] = []
  const dependencyEdges: DependencyEdgeContract[] = [...(input.dependencyEdges ?? [])]
  const selectedCandidates = new Map<string, OrchestrationCandidateScore>()

  for (const [index, scope] of scopes.entries()) {
    const candidate = eligible[index % eligible.length] ?? eligible[0]
    if (!candidate) continue
    candidate.selected = true
    selectedCandidates.set(candidate.agentId, candidate)
    const taskId = `${planId}:delegated:${index}`
    const locksForTask = input.resourceLocksByTaskId?.[taskId] ?? resourceLocks
    delegatedTasks.push(planTask({
      taskId,
      scope,
      executionKind: "delegated_sub_agent",
      requiredCapabilities: uniqueStrings(intent.requiredCapabilities),
      resourceLockIds: locksForTask.map((lock) => lock.lockId),
      candidate,
      ...(intent.explicitTeamId ? { assignedTeamId: intent.explicitTeamId } : {}),
      reasonCodes: ["delegated_by_structured_score", ...candidate.reasonCodes],
    }))

    if (candidate.approvalRequired && candidate.approvalRisk) {
      approvalRequirements.push({
        approvalId: `${taskId}:approval:${candidate.approvalRisk}`,
        taskId,
        agentId: candidate.agentId,
        capability: candidate.approvalRisk,
        risk: candidate.approvalRisk,
        reasonCode: "agent_permission_profile_requires_approval",
      })
    }
  }

  for (let i = 0; i < delegatedTasks.length; i += 1) {
    const current = delegatedTasks[i]
    if (!current) continue
    const currentLocks = (input.resourceLocksByTaskId?.[current.taskId] ?? resourceLocks)
    for (let j = i + 1; j < delegatedTasks.length; j += 1) {
      const next = delegatedTasks[j]
      if (!next) continue
      const nextLocks = (input.resourceLocksByTaskId?.[next.taskId] ?? resourceLocks)
      if (hasExclusiveLockConflict(currentLocks, nextLocks)) {
        dependencyEdges.push({
          fromTaskId: current.taskId,
          toTaskId: next.taskId,
          reasonCode: "exclusive_resource_lock_conflict",
        })
      }
    }
  }

  const parallelGroups = dependencyEdges.length === 0 && delegatedTasks.length > 1
    ? [{
        groupId: `${planId}:parallel:0`,
        parentRunId: input.parentRunId,
        subSessionIds: [],
        dependencyEdges: [],
        resourceLocks,
        concurrencyLimit: Math.max(1, Math.min(
          delegatedTasks.length,
          ...[...selectedCandidates.values()].map((candidate) => {
            const agent = registry.agents.find((entry) => entry.agentId === candidate.agentId)
            return agent?.currentLoad.maxParallelSessions ?? 1
          }),
        )),
        status: "planned" as const,
      }]
    : []

  const plannerMetadata: NonNullable<OrchestrationPlan["plannerMetadata"]> = {
    status: "planned",
    plannerVersion: ORCHESTRATION_PLANNER_VERSION,
    timedOut: false,
    semanticComparisonUsed: false,
    reasonCodes: [
      "structured_scoring",
      delegatedTasks.length > 1
        ? parallelGroups.length > 0
          ? "parallel_group_planned"
          : "parallel_candidate_serialized"
        : "single_delegated_task",
    ],
    candidateScores: candidateScores.map((candidate) => ({
      agentId: candidate.agentId,
      teamIds: candidate.teamIds,
      score: candidate.score,
      selected: candidate.selected,
      reasonCodes: candidate.reasonCodes,
      excludedReasonCodes: candidate.excludedReasonCodes,
    })),
    directReasonCodes: [],
    fallbackReasonCodes: ["delegate_failure_single_nobie"],
  }

  const plan: OrchestrationPlan = {
    identity: buildIdentity(planId, input.parentRunId, input.parentRequestId),
    planId,
    parentRunId: input.parentRunId,
    parentRequestId: input.parentRequestId,
    directNobieTasks: [],
    delegatedTasks,
    dependencyEdges,
    resourceLocks,
    parallelGroups,
    approvalRequirements,
    fallbackStrategy: {
      mode: "single_nobie",
      reasonCode: "delegate_failure_single_nobie",
    },
    plannerMetadata,
    createdAt: startedAt,
  }

  return {
    plan,
    registrySnapshot: registry,
    candidateScores,
    timedOut: false,
    reasonCodes: plannerMetadata.reasonCodes,
  }
}

export function createOrchestrationPlanner() {
  return { buildPlan: buildOrchestrationPlan }
}
