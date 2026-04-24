import { CONTRACT_SCHEMA_VERSION } from "../contracts/index.js"
import type {
  CapabilityRiskLevel,
  DependencyEdgeContract,
  ExpectedOutputContract,
  OrchestrationPlan,
  OrchestrationTask,
  ResourceLockContract,
  StructuredTaskScope,
} from "../contracts/sub-agent-orchestration.js"
import type { OrchestrationModeSnapshot } from "./mode.js"
import {
  type AgentRegistryEntry,
  type OrchestrationRegistrySnapshot,
  buildOrchestrationRegistrySnapshot,
} from "./registry.js"

export const ORCHESTRATION_PLANNER_VERSION = "structured-v1"
export const FAST_PATH_CLASSIFIER_TARGET_P95_MS = 100
export const ORCHESTRATION_PLANNER_TARGET_P95_MS = 700

export type FastPathClassification = "direct_nobie" | "delegation_candidate" | "workflow_candidate"

export interface FastPathClassifierInput {
  userRequest: string
  intent?: OrchestrationPlannerIntent
  now?: () => number
}

export interface FastPathClassificationResult {
  classification: FastPathClassification
  reasonCodes: string[]
  targetP95Ms: number
  latencyMs: number
  explanation: string
}

export interface OrchestrationPlannerDiagnostic {
  code: string
  severity: "info" | "warning" | "invalid"
  message: string
  agentId?: string
  teamId?: string
}

export interface OrchestrationPlannerIntent {
  explicitAgentId?: string
  explicitTeamId?: string
  requiredRoles?: string[]
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
  parentAgentId?: string
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
  explanation: string
  approvalRequired: boolean
  approvalRisk?: CapabilityRiskLevel
}

export interface OrchestrationPlanBuildResult {
  plan: OrchestrationPlan
  registrySnapshot?: OrchestrationRegistrySnapshot
  candidateScores: OrchestrationCandidateScore[]
  diagnostics: OrchestrationPlannerDiagnostic[]
  fastPathClassification: FastPathClassificationResult
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

function hasRoutingIntent(intent: OrchestrationPlannerIntent | undefined): boolean {
  return Boolean(
    intent?.explicitAgentId ||
      intent?.explicitTeamId ||
      intent?.requiredRoles?.length ||
      intent?.specialtyTags?.length ||
      intent?.requiredCapabilities?.length ||
      intent?.requiredSkillIds?.length ||
      intent?.requiredMcpServerIds?.length ||
      intent?.requiredToolNames?.length ||
      intent?.requiredRisk,
  )
}

function looksLikeWorkflowRequest(request: string): boolean {
  const normalized = request.toLowerCase()
  return [
    "매일",
    "매주",
    "반복",
    "정기",
    "예약",
    "schedule",
    "every day",
    "every week",
    "daily",
    "weekly",
    "cron",
  ].some((token) => normalized.includes(token))
}

function looksLikeSimpleDirectRequest(request: string): boolean {
  const trimmed = request.trim()
  if (trimmed.length === 0) return true
  if (trimmed.length > 80) return false
  const normalized = trimmed.toLowerCase()
  return [
    "안녕",
    "고마워",
    "감사",
    "도움말",
    "help",
    "hello",
    "hi",
    "thanks",
    "thank you",
    "who are you",
  ].some((token) => normalized.includes(token))
}

export function classifyFastPath(input: FastPathClassifierInput): FastPathClassificationResult {
  const clock = input.now ?? (() => Date.now())
  const startedAt = clock()
  const request = input.userRequest.trim()
  let classification: FastPathClassification = "delegation_candidate"
  const reasonCodes: string[] = []
  let explanation = "요청은 서브 에이전트 후보 평가가 필요한 위임 후보입니다."

  if (looksLikeWorkflowRequest(request)) {
    classification = "workflow_candidate"
    reasonCodes.push("fast_path_workflow_candidate")
    explanation = "반복 또는 예약성 요청이라 deterministic workflow 후보로 표시했습니다."
  } else if (!hasRoutingIntent(input.intent) && looksLikeSimpleDirectRequest(request)) {
    classification = "direct_nobie"
    reasonCodes.push("fast_path_direct_nobie")
    explanation = "짧고 단순한 요청이라 노비가 직접 처리하는 후보로 분류했습니다."
  } else {
    reasonCodes.push("fast_path_delegation_candidate")
  }

  return {
    classification,
    reasonCodes,
    targetP95Ms: FAST_PATH_CLASSIFIER_TARGET_P95_MS,
    latencyMs: Math.max(0, clock() - startedAt),
    explanation,
  }
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

function effectiveTeamIds(
  agent: AgentRegistryEntry,
  registry: OrchestrationRegistrySnapshot,
): string[] {
  const fromMembership = registry.membershipEdges
    .filter((edge) => edge.status === "active" && edge.agentId === agent.agentId)
    .map((edge) => edge.teamId)
  return uniqueStrings([...agent.teamIds, ...fromMembership])
}

function plannerParentAgentId(
  input: Pick<OrchestrationPlannerInput, "parentAgentId">,
  registry: OrchestrationRegistrySnapshot,
): string {
  return input.parentAgentId ?? registry.hierarchy?.rootAgentId ?? "agent:nobie"
}

function directChildAgentIdsFor(
  registry: OrchestrationRegistrySnapshot,
  parentAgentId: string,
): Set<string> | undefined {
  const directChildIds = registry.capabilityIndex?.directChildAgentIdsByParent[parentAgentId]
  if (directChildIds) return new Set(directChildIds)
  const hierarchyDirectChildIds = registry.hierarchy?.directChildrenByParent[parentAgentId]
  if (hierarchyDirectChildIds) return new Set(hierarchyDirectChildIds)
  return undefined
}

function capabilityIndexExcludedReasons(
  registry: OrchestrationRegistrySnapshot,
  parentAgentId: string,
  agentId: string,
): string[] {
  return (
    registry.capabilityIndex?.excludedCandidatesByParent[parentAgentId]?.find(
      (candidate) => candidate.agentId === agentId,
    )?.reasonCodes ?? []
  )
}

function explanationForCandidate(input: {
  agent: AgentRegistryEntry
  reasonCodes: string[]
  excludedReasonCodes: string[]
}): string {
  if (input.excludedReasonCodes.length > 0) {
    return `${input.agent.nickname ?? input.agent.displayName}은 ${input.excludedReasonCodes[0]} 때문에 후보에서 제외되었습니다.`
  }
  if (input.reasonCodes.includes("explicit_agent_target")) {
    return `${input.agent.nickname ?? input.agent.displayName}은 사용자가 명시한 직접 대상입니다.`
  }
  if (input.reasonCodes.includes("explicit_team_member")) {
    return `${input.agent.nickname ?? input.agent.displayName}은 명시된 팀의 실행 가능 멤버입니다.`
  }
  if (input.reasonCodes.includes("specialty_tag_match")) {
    return `${input.agent.nickname ?? input.agent.displayName}은 요청한 전문 태그와 일치합니다.`
  }
  return `${input.agent.nickname ?? input.agent.displayName}은 현재 권한, 부하, capability 기준을 통과했습니다.`
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
  options: {
    parentAgentId?: string
    directChildAgentIds?: Set<string>
  } = {},
): OrchestrationCandidateScore {
  const teamIds = effectiveTeamIds(agent, registry)
  const reasonCodes: string[] = []
  const excludedReasonCodes: string[] = []
  const requiredRoles = uniqueStrings(intent.requiredRoles)
  const requiredSkillIds = uniqueStrings(intent.requiredSkillIds)
  const requiredMcpServerIds = uniqueStrings(intent.requiredMcpServerIds)
  const requiredToolNames = uniqueStrings(intent.requiredToolNames)
  const requiredCapabilities = uniqueStrings(intent.requiredCapabilities)
  const specialtyTags = uniqueStrings(intent.specialtyTags)
  const requiredRisk = intent.requiredRisk ?? "safe"

  if (
    options.directChildAgentIds &&
    !options.directChildAgentIds.has(agent.agentId) &&
    intent.explicitAgentId !== agent.agentId
  ) {
    excludedReasonCodes.push("not_direct_child_candidate")
  }
  if (!candidateAllowedByExplicitTarget(agent, teamIds, intent))
    excludedReasonCodes.push("not_explicit_target")
  if (agent.status !== "enabled") {
    excludedReasonCodes.push("agent_not_enabled")
    excludedReasonCodes.push(`agent_${agent.status}`)
  }
  if (!agent.delegationEnabled) excludedReasonCodes.push("delegation_disabled")
  if (agent.retryBudget <= 0) excludedReasonCodes.push("retry_budget_exhausted")
  if (agent.currentLoad.activeSubSessions >= agent.currentLoad.maxParallelSessions)
    excludedReasonCodes.push("concurrency_limit_reached")
  if (!hasAll([agent.role], requiredRoles)) excludedReasonCodes.push("missing_required_role")
  if (!hasAll(agent.skillMcpSummary.enabledSkillIds, requiredSkillIds))
    excludedReasonCodes.push("missing_required_skill")
  if (!hasAll(agent.skillMcpSummary.enabledMcpServerIds, requiredMcpServerIds))
    excludedReasonCodes.push("missing_required_mcp_server")
  if (!hasAll(agent.skillMcpSummary.enabledToolNames, requiredToolNames))
    excludedReasonCodes.push("missing_required_tool")
  if (!riskAllows(agent, requiredRisk)) excludedReasonCodes.push("risk_above_agent_ceiling")
  if (!agent.permissionProfile.profileId) excludedReasonCodes.push("permission_missing")
  if (agent.capabilitySummary.availability === "unavailable")
    excludedReasonCodes.push("capability_unavailable")
  if (agent.modelSummary.availability === "unavailable")
    excludedReasonCodes.push("model_unavailable")
  if (options.parentAgentId) {
    excludedReasonCodes.push(
      ...capabilityIndexExcludedReasons(registry, options.parentAgentId, agent.agentId),
    )
  }

  const capabilityPool = [
    agent.role,
    ...agent.skillMcpSummary.enabledSkillIds,
    ...agent.skillMcpSummary.enabledMcpServerIds,
    ...agent.skillMcpSummary.enabledToolNames,
    agent.permissionProfile.profileId,
    agent.permissionProfile.riskCeiling,
  ]
  if (!hasAll(capabilityPool, requiredCapabilities))
    excludedReasonCodes.push("missing_required_capability")

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
  const roleMatches = countMatches([agent.role], requiredRoles)
  if (roleMatches > 0) {
    score += roleMatches * 35
    reasonCodes.push("required_role_match")
  }
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
  const normalizedReasonCodes = uniqueStrings(reasonCodes)
  const normalizedExcludedReasonCodes = uniqueStrings(excludedReasonCodes)

  return {
    agentId: agent.agentId,
    teamIds,
    score,
    selected: false,
    reasonCodes: normalizedReasonCodes,
    excludedReasonCodes: normalizedExcludedReasonCodes,
    explanation: explanationForCandidate({
      agent,
      reasonCodes: normalizedReasonCodes,
      excludedReasonCodes: normalizedExcludedReasonCodes,
    }),
    approvalRequired: riskNeedsApproval(agent, requiredRisk) && riskAllows(agent, requiredRisk),
    ...(riskNeedsApproval(agent, requiredRisk) && riskAllows(agent, requiredRisk)
      ? { approvalRisk: requiredRisk }
      : {}),
  }
}

function sortedEligibleCandidates(
  candidates: OrchestrationCandidateScore[],
): OrchestrationCandidateScore[] {
  return candidates
    .filter((candidate) => candidate.excludedReasonCodes.length === 0)
    .sort((a, b) => b.score - a.score || a.agentId.localeCompare(b.agentId))
}

function hasExclusiveLockConflict(a: ResourceLockContract[], b: ResourceLockContract[]): boolean {
  return a.some(
    (left) =>
      left.mode === "exclusive" &&
      b.some(
        (right) =>
          right.mode === "exclusive" && right.kind === left.kind && right.target === left.target,
      ),
  )
}

function buildIdentity(
  planId: string,
  parentRunId: string,
  parentRequestId: string,
): OrchestrationPlan["identity"] {
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
  explanation?: string
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
      ...(input.candidate?.excludedReasonCodes.length
        ? { excludedReasonCodes: input.candidate.excludedReasonCodes }
        : {}),
      ...(input.explanation ? { explanation: input.explanation } : {}),
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
  diagnostics?: OrchestrationPlannerDiagnostic[]
  fastPathClassification: FastPathClassificationResult
  status?: NonNullable<OrchestrationPlan["plannerMetadata"]>["status"]
  userMessage?: string
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
    explanation: input.userMessage ?? "노비가 직접 후속 처리를 맡는 계획입니다.",
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
      mode: input.fallbackReasonCode.startsWith("explicit_") ? "ask_user" : "single_nobie",
      reasonCode: input.fallbackReasonCode,
      ...(input.userMessage ? { userMessage: input.userMessage } : {}),
    },
    plannerMetadata: {
      status: input.status ?? "planned",
      plannerVersion: ORCHESTRATION_PLANNER_VERSION,
      timedOut: input.timedOut,
      latencyMs: Math.max(0, input.now - input.now),
      targetP95Ms: ORCHESTRATION_PLANNER_TARGET_P95_MS,
      semanticComparisonUsed: false,
      fastPath: input.fastPathClassification,
      reasonCodes: input.reasonCodes,
      candidateScores: (input.candidateScores ?? []).map((candidate) => ({
        agentId: candidate.agentId,
        teamIds: candidate.teamIds,
        score: candidate.score,
        selected: candidate.selected,
        reasonCodes: candidate.reasonCodes,
        excludedReasonCodes: candidate.excludedReasonCodes,
        explanation: candidate.explanation,
      })),
      directReasonCodes: input.reasonCodes,
      fallbackReasonCodes: [input.fallbackReasonCode],
    },
    createdAt: input.now,
  }

  return {
    plan,
    candidateScores: input.candidateScores ?? [],
    diagnostics: input.diagnostics ?? [],
    fastPathClassification: input.fastPathClassification,
    timedOut: input.timedOut,
    reasonCodes: input.reasonCodes,
  }
}

function nonExecutionPlan(input: {
  parentRunId: string
  parentRequestId: string
  modeSnapshot: OrchestrationModeSnapshot
  reasonCodes: string[]
  fallbackReasonCode: string
  now: number
  idProvider: () => string
  fastPathClassification: FastPathClassificationResult
  status: NonNullable<OrchestrationPlan["plannerMetadata"]>["status"]
  candidateScores?: OrchestrationCandidateScore[]
  diagnostics?: OrchestrationPlannerDiagnostic[]
  userMessage: string
}): OrchestrationPlanBuildResult {
  const planId = input.idProvider()
  const plan: OrchestrationPlan = {
    identity: buildIdentity(planId, input.parentRunId, input.parentRequestId),
    planId,
    parentRunId: input.parentRunId,
    parentRequestId: input.parentRequestId,
    directNobieTasks: [],
    delegatedTasks: [],
    dependencyEdges: [],
    resourceLocks: [],
    parallelGroups: [],
    approvalRequirements: [],
    fallbackStrategy: {
      mode: "fail_with_reason",
      reasonCode: input.fallbackReasonCode,
      userMessage: input.userMessage,
    },
    plannerMetadata: {
      status: input.status,
      plannerVersion: ORCHESTRATION_PLANNER_VERSION,
      timedOut: false,
      latencyMs: 0,
      targetP95Ms: ORCHESTRATION_PLANNER_TARGET_P95_MS,
      semanticComparisonUsed: false,
      fastPath: input.fastPathClassification,
      reasonCodes: input.reasonCodes,
      candidateScores: (input.candidateScores ?? []).map((candidate) => ({
        agentId: candidate.agentId,
        teamIds: candidate.teamIds,
        score: candidate.score,
        selected: candidate.selected,
        reasonCodes: candidate.reasonCodes,
        excludedReasonCodes: candidate.excludedReasonCodes,
        explanation: candidate.explanation,
      })),
      directReasonCodes: [],
      fallbackReasonCodes: [input.fallbackReasonCode],
    },
    createdAt: input.now,
  }
  return {
    plan,
    candidateScores: input.candidateScores ?? [],
    diagnostics: input.diagnostics ?? [],
    fastPathClassification: input.fastPathClassification,
    timedOut: false,
    reasonCodes: input.reasonCodes,
  }
}

export function buildOrchestrationPlan(
  input: OrchestrationPlannerInput,
): OrchestrationPlanBuildResult {
  const startedAt = input.now?.() ?? Date.now()
  const now = input.now ?? (() => Date.now())
  const idProvider = input.idProvider ?? (() => crypto.randomUUID())
  const timeoutMs = Math.max(1, input.timeoutMs ?? 120)
  const intent = input.intent ?? {}
  const fastPathClassification = classifyFastPath({
    userRequest: input.userRequest,
    intent,
    now,
  })

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
      fastPathClassification,
    })
  }

  if (fastPathClassification.classification === "direct_nobie") {
    return directFallbackPlan({
      parentRunId: input.parentRunId,
      parentRequestId: input.parentRequestId,
      userRequest: input.userRequest,
      modeSnapshot: input.modeSnapshot,
      reasonCodes: fastPathClassification.reasonCodes,
      fallbackReasonCode: "direct_nobie_fast_path",
      now: startedAt,
      idProvider,
      timedOut: false,
      fastPathClassification,
      userMessage: fastPathClassification.explanation,
    })
  }

  if (fastPathClassification.classification === "workflow_candidate") {
    return nonExecutionPlan({
      parentRunId: input.parentRunId,
      parentRequestId: input.parentRequestId,
      modeSnapshot: input.modeSnapshot,
      reasonCodes: [...fastPathClassification.reasonCodes, "requires_workflow_recommendation"],
      fallbackReasonCode: "requires_workflow_recommendation",
      now: startedAt,
      idProvider,
      fastPathClassification,
      status: "requires_workflow_recommendation",
      userMessage:
        "반복성 요청은 deterministic workflow 후보로 표시했고, 실제 workflow 생성은 후속 단계에서 처리해야 합니다.",
    })
  }

  const registry =
    input.registrySnapshot ??
    input.loadRegistrySnapshot?.() ??
    buildOrchestrationRegistrySnapshot({ now })
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
      fastPathClassification,
    })
  }

  const parentAgentId = plannerParentAgentId(input, registry)
  const directChildAgentIds = directChildAgentIdsFor(registry, parentAgentId)
  const candidateScores = registry.agents.map((agent) =>
    scoreCandidate(agent, registry, intent, {
      parentAgentId,
      ...(directChildAgentIds ? { directChildAgentIds } : {}),
    }),
  )
  const diagnostics: OrchestrationPlannerDiagnostic[] = candidateScores.flatMap((candidate) =>
    candidate.excludedReasonCodes.map((reasonCode) => ({
      code: reasonCode,
      severity: "warning" as const,
      message: `${candidate.agentId} was excluded from planning by ${reasonCode}.`,
      agentId: candidate.agentId,
    })),
  )

  if (intent.explicitTeamId) {
    const team = registry.teams.find((candidate) => candidate.teamId === intent.explicitTeamId)
    const teamHealthStatus = team?.health?.status
    const activeMemberAgentIds =
      team?.coverage?.activeMemberAgentIds ?? team?.activeMemberAgentIds ?? []
    if (!team || teamHealthStatus === "invalid" || activeMemberAgentIds.length === 0) {
      const reasonCodes = [
        "explicit_team_target",
        "explicit_team_target_unavailable",
        team ? `team_health_${teamHealthStatus ?? "unknown"}` : "team_not_found",
        ...(activeMemberAgentIds.length === 0 ? ["no_active_team_members"] : []),
      ]
      return directFallbackPlan({
        parentRunId: input.parentRunId,
        parentRequestId: input.parentRequestId,
        userRequest: input.userRequest,
        modeSnapshot: input.modeSnapshot,
        reasonCodes,
        fallbackReasonCode: "explicit_team_target_unavailable",
        now: startedAt,
        idProvider,
        timedOut: false,
        candidateScores,
        diagnostics,
        fastPathClassification,
        userMessage:
          "명시된 팀을 실행 후보로 사용할 수 없어 임의 대체 없이 사용자 확인이 필요합니다.",
      })
    }

    return nonExecutionPlan({
      parentRunId: input.parentRunId,
      parentRequestId: input.parentRequestId,
      modeSnapshot: input.modeSnapshot,
      reasonCodes: [
        "explicit_team_target",
        "requires_team_expansion",
        ...(teamHealthStatus ? [`team_health_${teamHealthStatus}`] : []),
      ],
      fallbackReasonCode: "requires_team_expansion",
      now: startedAt,
      idProvider,
      fastPathClassification,
      status: "requires_team_expansion",
      candidateScores,
      diagnostics,
      userMessage:
        "명시된 팀은 직접 실행하지 않고 task011의 멤버별 TeamExecutionPlan 확장이 필요합니다.",
    })
  }

  if (intent.explicitAgentId) {
    const target = registry.agents.find((agent) => agent.agentId === intent.explicitAgentId)
    const targetScore = candidateScores.find(
      (candidate) => candidate.agentId === intent.explicitAgentId,
    )
    const visible = !directChildAgentIds || directChildAgentIds.has(intent.explicitAgentId)
    if (!target || !visible || !targetScore || targetScore.excludedReasonCodes.length > 0) {
      const reasonCodes = [
        "explicit_agent_target",
        "explicit_agent_target_unavailable",
        !target ? "agent_not_found" : undefined,
        target && !visible ? "explicit_agent_not_direct_child" : undefined,
        ...(targetScore?.excludedReasonCodes ?? []),
      ].filter((reason): reason is string => Boolean(reason))
      return directFallbackPlan({
        parentRunId: input.parentRunId,
        parentRequestId: input.parentRequestId,
        userRequest: input.userRequest,
        modeSnapshot: input.modeSnapshot,
        reasonCodes,
        fallbackReasonCode: targetScore?.excludedReasonCodes.includes("risk_above_agent_ceiling")
          ? "explicit_agent_permission_denied"
          : "explicit_agent_target_unavailable",
        now: startedAt,
        idProvider,
        timedOut: false,
        candidateScores,
        diagnostics,
        fastPathClassification,
        userMessage:
          "명시된 에이전트가 직접 하위 후보 또는 권한 조건을 만족하지 않아 임의 대체하지 않았습니다.",
      })
    }
  }

  const eligible = sortedEligibleCandidates(candidateScores)
  const explicitTargetRequested = Boolean(intent.explicitAgentId || intent.explicitTeamId)

  if (eligible.length === 0) {
    return directFallbackPlan({
      parentRunId: input.parentRunId,
      parentRequestId: input.parentRequestId,
      userRequest: input.userRequest,
      modeSnapshot: input.modeSnapshot,
      reasonCodes: explicitTargetRequested
        ? ["explicit_target_unavailable"]
        : ["no_eligible_agent_candidate"],
      fallbackReasonCode: explicitTargetRequested
        ? "explicit_target_unavailable"
        : "no_eligible_agent_candidate",
      now: startedAt,
      idProvider,
      timedOut: false,
      candidateScores,
      diagnostics,
      fastPathClassification,
    })
  }

  const planId = idProvider()
  const scopes = input.taskScopes?.length
    ? input.taskScopes
    : [buildDefaultStructuredTaskScope(input.userRequest)]
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
    delegatedTasks.push(
      planTask({
        taskId,
        scope,
        executionKind: "delegated_sub_agent",
        requiredCapabilities: uniqueStrings(intent.requiredCapabilities),
        resourceLockIds: locksForTask.map((lock) => lock.lockId),
        candidate,
        ...(intent.explicitTeamId ? { assignedTeamId: intent.explicitTeamId } : {}),
        reasonCodes: ["delegated_by_structured_score", ...candidate.reasonCodes],
        explanation: candidate.explanation,
      }),
    )

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
    const currentLocks = input.resourceLocksByTaskId?.[current.taskId] ?? resourceLocks
    for (let j = i + 1; j < delegatedTasks.length; j += 1) {
      const next = delegatedTasks[j]
      if (!next) continue
      const nextLocks = input.resourceLocksByTaskId?.[next.taskId] ?? resourceLocks
      if (hasExclusiveLockConflict(currentLocks, nextLocks)) {
        dependencyEdges.push({
          fromTaskId: current.taskId,
          toTaskId: next.taskId,
          reasonCode: "exclusive_resource_lock_conflict",
        })
      }
    }
  }

  const parallelGroups =
    dependencyEdges.length === 0 && delegatedTasks.length > 1
      ? [
          {
            groupId: `${planId}:parallel:0`,
            parentRunId: input.parentRunId,
            subSessionIds: [],
            dependencyEdges: [],
            resourceLocks,
            concurrencyLimit: Math.max(
              1,
              Math.min(
                delegatedTasks.length,
                ...[...selectedCandidates.values()].map((candidate) => {
                  const agent = registry.agents.find((entry) => entry.agentId === candidate.agentId)
                  return agent?.currentLoad.maxParallelSessions ?? 1
                }),
              ),
            ),
            status: "planned" as const,
          },
        ]
      : []

  const plannerMetadata: NonNullable<OrchestrationPlan["plannerMetadata"]> = {
    status: "planned",
    plannerVersion: ORCHESTRATION_PLANNER_VERSION,
    timedOut: false,
    latencyMs: Math.max(0, now() - startedAt),
    targetP95Ms: ORCHESTRATION_PLANNER_TARGET_P95_MS,
    semanticComparisonUsed: false,
    fastPath: fastPathClassification,
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
      explanation: candidate.explanation,
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
    diagnostics,
    fastPathClassification,
    timedOut: false,
    reasonCodes: plannerMetadata.reasonCodes,
  }
}

export function createOrchestrationPlanner() {
  return { buildPlan: buildOrchestrationPlan }
}
