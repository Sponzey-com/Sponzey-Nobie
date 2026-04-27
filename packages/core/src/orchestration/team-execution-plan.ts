import type { ContractValidationIssue, JsonObject, JsonValue } from "../contracts/index.js"
import {
  type ExpectedOutputContract,
  type StructuredTaskScope,
  type TaskExecutionKind,
  type TeamConfig,
  type TeamExecutionFallbackAssignment,
  type TeamExecutionPlan,
  type TeamExecutionPlanAssignment,
  type TeamExecutionTaskSnapshot,
  validateTeamExecutionPlan,
} from "../contracts/sub-agent-orchestration.js"
import { insertTeamExecutionPlan } from "../db/index.js"
import {
  type TeamCompositionDiagnostic,
  type TeamCompositionMemberCoverage,
  type TeamCompositionServiceDependencies,
  type TeamCoverageReport,
  createTeamCompositionService,
} from "./team-composition.js"

export type TeamExecutionPlanDiagnosticSeverity = "info" | "warning" | "invalid"

export interface TeamExecutionPlanDiagnostic {
  reasonCode: string
  severity: TeamExecutionPlanDiagnosticSeverity
  message: string
  teamId: string
  agentId?: string
  fallbackForAgentId?: string
}

export interface TeamExecutionPlanBuildInput {
  teamId: string
  team?: TeamConfig
  teamExecutionPlanId?: string
  parentRunId?: string
  parentRequestId?: string
  userRequest?: string
  persist?: boolean
  auditId?: string | null
}

export interface TeamExecutionPlanBuildResult {
  ok: boolean
  plan?: TeamExecutionPlan
  persisted: boolean
  diagnostics: TeamExecutionPlanDiagnostic[]
  validationIssues?: ContractValidationIssue[]
}

export interface TeamExecutionPlanServiceDependencies extends TeamCompositionServiceDependencies {
  idProvider?: (prefix: string) => string
}

type TeamExecutionTaskKind = TeamExecutionTaskSnapshot["taskKind"]

interface TaskBuildInput {
  planId: string
  taskKind: TeamExecutionTaskKind
  agentId: string
  team: TeamConfig
  coverage: TeamCoverageReport
  member?: TeamCompositionMemberCoverage | undefined
  role: string
  required: boolean
  dependsOnTaskIds: string[]
  userRequest?: string | undefined
  parentRequestId?: string | undefined
  reasonCodes: string[]
}

const ROOT_AGENT_ID = "agent:nobie"
const ALLOWED_FALLBACK_REASON_CODES = new Set([
  "member_disabled",
  "member_overloaded",
  "member_failed",
  "member_permission_denied",
  "permission_denied",
])

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.filter((value) => value.trim().length > 0))]
}

function normalizeRole(value: string): string {
  return value.trim().toLowerCase()
}

function hasTeamRole(member: TeamCompositionMemberCoverage, role: string): boolean {
  const expected = normalizeRole(role)
  return (
    normalizeRole(member.primaryRole) === expected ||
    member.teamRoles.some((teamRole) => normalizeRole(teamRole) === expected)
  )
}

function asJsonObject(value: Record<string, JsonValue | undefined>): JsonObject {
  return value
}

function nowFrom(dependencies: TeamExecutionPlanServiceDependencies): number {
  return dependencies.now?.() ?? Date.now()
}

function defaultId(prefix: string, now: number): string {
  return `${prefix}:${now}:${Math.random().toString(36).slice(2, 10)}`
}

function nextId(
  dependencies: TeamExecutionPlanServiceDependencies,
  prefix: string,
  now: number,
): string {
  return dependencies.idProvider?.(prefix) ?? defaultId(prefix, now)
}

function taskId(planId: string, kind: TeamExecutionTaskKind, agentId: string): string {
  return `${planId}:task:${kind}:${agentId}`
}

function outputContract(input: {
  outputId: string
  description: string
  required: boolean
  reasonCodes: string[]
}): ExpectedOutputContract {
  return {
    outputId: input.outputId,
    kind: "text",
    description: input.description,
    required: input.required,
    acceptance: {
      statusField: "status",
      requiredEvidenceKinds: ["summary"],
      artifactRequired: false,
      reasonCodes: input.reasonCodes,
    },
  }
}

function validationCriteria(kind: TeamExecutionTaskKind, required: boolean): string[] {
  const common = [
    "result_status_present",
    required ? "required_assignment_completed" : "optional_assignment_reported",
  ]
  if (kind === "member") return [...common, "member_output_addresses_role"]
  if (kind === "synthesis") return [...common, "synthesis_covers_member_outputs"]
  if (kind === "review") return [...common, "review_records_accept_revise_or_block"]
  return [...common, "verification_records_evidence_status"]
}

function taskScope(input: {
  kind: TeamExecutionTaskKind
  role: string
  team: TeamConfig
  userRequest?: string | undefined
  expectedOutputs: ExpectedOutputContract[]
  reasonCodes: string[]
}): StructuredTaskScope {
  const goalByKind: Record<TeamExecutionTaskKind, string> = {
    member: `Produce ${input.role} output for ${input.team.displayName}.`,
    synthesis: `Synthesize ${input.team.displayName} member outputs.`,
    review: `Review ${input.team.displayName} synthesis output.`,
    verification: `Verify ${input.team.displayName} synthesis evidence.`,
  }
  const actionByKind: Record<TeamExecutionTaskKind, string> = {
    member: "produce_team_member_output",
    synthesis: "synthesize_team_outputs",
    review: "review_team_synthesis",
    verification: "verify_team_synthesis",
  }
  return {
    goal: goalByKind[input.kind],
    intentType: "team_execution",
    actionType: actionByKind[input.kind],
    constraints: [
      `team:${input.team.teamId}`,
      `role:${input.role}`,
      ...(input.userRequest ? [`request:${input.userRequest}`] : []),
    ],
    expectedOutputs: input.expectedOutputs,
    reasonCodes: input.reasonCodes,
  }
}

function executionKindForAgent(agentId: string): TaskExecutionKind {
  return agentId === ROOT_AGENT_ID ? "direct_nobie" : "delegated_sub_agent"
}

function requiredCapabilitiesFor(
  team: TeamConfig,
  member: TeamCompositionMemberCoverage | undefined,
  role: string,
): string[] {
  const required = team.requiredCapabilityTags ?? []
  const memberCapabilities = member?.specialtyTags ?? []
  const covered = required.filter((capability) => memberCapabilities.includes(capability))
  return uniqueStrings([
    ...covered,
    ...(covered.length === 0 ? memberCapabilities : []),
    ...(memberCapabilities.length === 0 ? [role] : []),
  ])
}

function taskSnapshot(input: TaskBuildInput): TeamExecutionTaskSnapshot {
  const id = taskId(input.planId, input.taskKind, input.agentId)
  const expectedOutputs = [
    outputContract({
      outputId: `${id}:output`,
      description:
        input.taskKind === "member"
          ? `Output for ${input.role}.`
          : `Output for ${input.taskKind} step.`,
      required: input.required,
      reasonCodes: input.reasonCodes,
    }),
  ]
  const inputContext = asJsonObject({
    teamId: input.team.teamId,
    teamDisplayName: input.team.displayName,
    teamNickname: input.team.nickname,
    ownerAgentId: input.coverage.ownerAgentId,
    leadAgentId: input.coverage.leadAgentId,
    agentId: input.agentId,
    membershipId: input.member?.membershipId,
    role: input.role,
    required: input.required,
    parentRequestId: input.parentRequestId,
    userRequest: input.userRequest,
    coverageGeneratedAt: input.coverage.generatedAt,
    dependsOnTaskIds: input.dependsOnTaskIds,
  })
  return {
    taskId: id,
    taskKind: input.taskKind,
    executionKind: executionKindForAgent(input.agentId),
    scope: taskScope({
      kind: input.taskKind,
      role: input.role,
      team: input.team,
      userRequest: input.userRequest,
      expectedOutputs,
      reasonCodes: input.reasonCodes,
    }),
    assignedAgentId: input.agentId,
    requiredCapabilities: requiredCapabilitiesFor(input.team, input.member, input.role),
    resourceLockIds: [],
    inputContext,
    expectedOutputs,
    validationCriteria: validationCriteria(input.taskKind, input.required),
    dependsOnTaskIds: input.dependsOnTaskIds,
    required: input.required,
    reasonCodes: input.reasonCodes,
  }
}

function assignment(input: {
  agentId: string
  role: string
  member?: TeamCompositionMemberCoverage | undefined
  tasks: TeamExecutionTaskSnapshot[]
}): TeamExecutionPlanAssignment {
  const taskKinds = uniqueStrings(
    input.tasks.map((task) => task.taskKind),
  ) as TeamExecutionTaskKind[]
  const expectedOutputs = input.tasks.flatMap((task) => task.expectedOutputs)
  const validation = uniqueStrings(input.tasks.flatMap((task) => task.validationCriteria))
  const reasonCodes = uniqueStrings(input.tasks.flatMap((task) => task.reasonCodes))
  const dependsOnTaskIds = uniqueStrings(input.tasks.flatMap((task) => task.dependsOnTaskIds))
  const memberExecutionState =
    input.member?.executionState === "active" || input.member?.executionState === "fallback"
      ? input.member.executionState
      : undefined
  const nonMemberTask = input.tasks.find((task) => task.taskKind !== "member")
  const taskExecutionState =
    nonMemberTask?.taskKind === "synthesis" ||
    nonMemberTask?.taskKind === "review" ||
    nonMemberTask?.taskKind === "verification"
      ? nonMemberTask.taskKind
      : undefined
  const executionState = memberExecutionState ?? taskExecutionState
  const inputContext = input.tasks[0]?.inputContext
  return {
    agentId: input.agentId,
    taskIds: input.tasks.map((task) => task.taskId),
    role: input.role,
    ...(input.member?.membershipId ? { membershipId: input.member.membershipId } : {}),
    required: input.tasks.some((task) => task.required),
    ...(executionState ? { executionState } : {}),
    taskKinds,
    ...(inputContext ? { inputContext } : {}),
    expectedOutputs,
    validationCriteria: validation,
    dependsOnTaskIds,
    ...(input.member?.fallbackForAgentId
      ? { fallbackForAgentId: input.member.fallbackForAgentId }
      : {}),
    reasonCodes,
    tasks: input.tasks,
  }
}

function fallbackReason(coverage: TeamCoverageReport, missingAgentId: string): string {
  const primary = coverage.members.find((member) => member.agentId === missingAgentId)
  const preferred = [
    "member_disabled",
    "member_overloaded",
    "member_degraded",
    "member_archived",
    "member_agent_missing",
    "member_unresolved",
    "member_failed",
    "member_permission_denied",
    "permission_denied",
    "membership_inactive",
    "owner_direct_child_required",
  ]
  return (
    preferred.find((reason) => primary?.excludedReasonCodes.includes(reason)) ??
    primary?.excludedReasonCodes[0] ??
    "primary_unavailable"
  )
}

function isAllowedFallbackAssignment(
  coverage: TeamCoverageReport,
  member: TeamCompositionMemberCoverage,
): boolean {
  if (member.executionState !== "fallback" || !member.fallbackForAgentId) return false
  return ALLOWED_FALLBACK_REASON_CODES.has(fallbackReason(coverage, member.fallbackForAgentId))
}

function isPlanExecutableMember(
  coverage: TeamCoverageReport,
  member: TeamCompositionMemberCoverage,
): boolean {
  return member.executionState === "active" || isAllowedFallbackAssignment(coverage, member)
}

function fallbackAssignments(coverage: TeamCoverageReport): TeamExecutionFallbackAssignment[] {
  return coverage.members.flatMap((member) => {
    if (!isAllowedFallbackAssignment(coverage, member) || !member.fallbackForAgentId) return []
    return {
      missingAgentId: member.fallbackForAgentId,
      fallbackAgentId: member.agentId,
      reasonCode: fallbackReason(coverage, member.fallbackForAgentId),
    }
  })
}

function coverageReportSnapshot(input: {
  coverage: TeamCoverageReport
  team: TeamConfig
  executableMembers: TeamCompositionMemberCoverage[]
  synthesisAgentId: string
  synthesisMode: "lead_synthesis" | "owner_synthesis"
}): JsonObject {
  const selectedAgentIds = new Set(input.executableMembers.map((member) => member.agentId))
  const roleProviders = (role: string) =>
    input.executableMembers
      .filter((member) => hasTeamRole(member, role))
      .map((member) => member.agentId)
  const capabilityProviders = (capability: string) =>
    input.executableMembers
      .filter((member) => member.specialtyTags.includes(capability))
      .map((member) => member.agentId)
  const report = {
    ...(input.coverage as unknown as JsonObject),
    policySnapshot: asJsonObject({
      conflictPolicy: input.team.conflictPolicy ?? "lead_decides",
      resultPolicy: input.team.resultPolicy ?? input.synthesisMode,
      effectiveSynthesisMode: input.synthesisMode,
      synthesisAgentId: input.synthesisAgentId,
    }),
    requiredCoverage: {
      roles: input.coverage.roleCoverage.required.map((role) => {
        const providers = roleProviders(role)
        return {
          kind: "role",
          name: role,
          fulfilled: providers.length > 0,
          providers,
        }
      }),
      capabilityTags: input.coverage.capabilityCoverage.required.map((capability) => {
        const providers = capabilityProviders(capability)
        return {
          kind: "capability",
          name: capability,
          fulfilled: providers.length > 0,
          providers,
        }
      }),
    },
    exclusions: input.coverage.members
      .filter((member) => !selectedAgentIds.has(member.agentId))
      .map((member) => ({
        agentId: member.agentId,
        executionState: member.executionState,
        required: member.required,
        reasonCodes:
          member.executionState === "fallback"
            ? [...member.excludedReasonCodes, "fallback_reason_not_allowed_for_team_execution_plan"]
            : member.excludedReasonCodes,
      })),
  }
  return report as unknown as JsonObject
}

function diagnosticFromComposition(
  diagnostic: TeamCompositionDiagnostic,
): TeamExecutionPlanDiagnostic {
  return {
    reasonCode: diagnostic.reasonCode,
    severity: diagnostic.severity,
    message: diagnostic.message,
    teamId: diagnostic.teamId,
    ...(diagnostic.agentId ? { agentId: diagnostic.agentId } : {}),
    ...(diagnostic.fallbackForAgentId ? { fallbackForAgentId: diagnostic.fallbackForAgentId } : {}),
  }
}

function missingRoleDiagnostics(input: {
  team: TeamConfig
  reviewerAgentIds: string[]
  verifierAgentIds: string[]
}): TeamExecutionPlanDiagnostic[] {
  const diagnostics: TeamExecutionPlanDiagnostic[] = []
  const resultPolicy = input.team.resultPolicy
  if (resultPolicy === "reviewer_required" && input.reviewerAgentIds.length === 0) {
    diagnostics.push({
      reasonCode: "reviewer_required_missing",
      severity: "warning",
      message: "Team result policy requires a reviewer but no executable reviewer member exists.",
      teamId: input.team.teamId,
    })
  }
  if (resultPolicy === "verifier_required" && input.verifierAgentIds.length === 0) {
    diagnostics.push({
      reasonCode: "verifier_required_missing",
      severity: "warning",
      message: "Team result policy requires a verifier but no executable verifier member exists.",
      teamId: input.team.teamId,
    })
  }
  return diagnostics
}

export function buildTeamExecutionPlan(
  input: TeamExecutionPlanBuildInput,
  dependencies: TeamExecutionPlanServiceDependencies = {},
): TeamExecutionPlanBuildResult {
  const generatedAt = nowFrom(dependencies)
  const compositionInput = input.team ?? input.teamId
  const composition = createTeamCompositionService(dependencies).evaluate(compositionInput)
  const diagnostics = composition.diagnostics.map(diagnosticFromComposition)

  if (!composition.ok || !composition.team || !composition.coverage) {
    return {
      ok: false,
      persisted: false,
      diagnostics,
    }
  }

  const team = composition.team
  const coverage = composition.coverage
  const executableMembers = coverage.members.filter((member) =>
    isPlanExecutableMember(coverage, member),
  )
  if (executableMembers.length === 0) {
    return {
      ok: false,
      persisted: false,
      diagnostics: [
        ...diagnostics,
        {
          reasonCode: "team_execution_plan_no_executable_members",
          severity: "invalid",
          message: "TeamExecutionPlan requires at least one executable direct child member.",
          teamId: team.teamId,
        },
      ],
    }
  }

  const planId = input.teamExecutionPlanId ?? nextId(dependencies, "team-plan", generatedAt)
  const parentRunId = input.parentRunId ?? nextId(dependencies, "run", generatedAt)
  const memberTasks = executableMembers.map((member) =>
    taskSnapshot({
      planId,
      taskKind: "member",
      agentId: member.agentId,
      team,
      coverage,
      member,
      role: member.primaryRole,
      required: member.required,
      dependsOnTaskIds: [],
      userRequest: input.userRequest,
      parentRequestId: input.parentRequestId,
      reasonCodes: [
        "team_member_direct_child_expansion",
        member.executionState === "fallback"
          ? "fallback_assignment_selected"
          : "active_member_selected",
      ],
    }),
  )
  const memberTaskIds = memberTasks.map((task) => task.taskId)
  const executableLead = team.leadAgentId
    ? executableMembers.find(
        (member) => member.agentId === team.leadAgentId && member.executionState === "active",
      )
    : undefined
  const synthesisAgentId = executableLead?.agentId ?? coverage.ownerAgentId
  const synthesisMode = executableLead ? "lead_synthesis" : "owner_synthesis"
  const synthesisTask = taskSnapshot({
    planId,
    taskKind: "synthesis",
    agentId: synthesisAgentId,
    team,
    coverage,
    member: executableLead,
    role: synthesisMode,
    required: true,
    dependsOnTaskIds: memberTaskIds,
    userRequest: input.userRequest,
    parentRequestId: input.parentRequestId,
    reasonCodes: [
      synthesisMode,
      executableLead ? "lead_synthesis_selected" : "owner_synthesis_selected",
    ],
  })

  const reviewerMembers = executableMembers.filter((member) => hasTeamRole(member, "reviewer"))
  const verifierMembers = executableMembers.filter((member) => hasTeamRole(member, "verifier"))
  const reviewerTasks = reviewerMembers.map((member) =>
    taskSnapshot({
      planId,
      taskKind: "review",
      agentId: member.agentId,
      team,
      coverage,
      member,
      role: member.primaryRole,
      required: true,
      dependsOnTaskIds: [synthesisTask.taskId],
      userRequest: input.userRequest,
      parentRequestId: input.parentRequestId,
      reasonCodes: ["reviewer_role_review_task", "synthesis_review_required"],
    }),
  )
  const reviewerTaskIds = reviewerTasks.map((task) => task.taskId)
  const verifierTasks = verifierMembers.map((member) =>
    taskSnapshot({
      planId,
      taskKind: "verification",
      agentId: member.agentId,
      team,
      coverage,
      member,
      role: member.primaryRole,
      required: true,
      dependsOnTaskIds: [synthesisTask.taskId, ...reviewerTaskIds],
      userRequest: input.userRequest,
      parentRequestId: input.parentRequestId,
      reasonCodes: ["verifier_role_verification_task", "synthesis_verification_required"],
    }),
  )

  const tasksByAgent = new Map<string, TeamExecutionTaskSnapshot[]>()
  const addTask = (task: TeamExecutionTaskSnapshot) => {
    tasksByAgent.set(task.assignedAgentId ?? ROOT_AGENT_ID, [
      ...(tasksByAgent.get(task.assignedAgentId ?? ROOT_AGENT_ID) ?? []),
      task,
    ])
  }
  for (const task of [...memberTasks, synthesisTask, ...reviewerTasks, ...verifierTasks]) {
    addTask(task)
  }

  const memberByAgent = new Map(executableMembers.map((member) => [member.agentId, member]))
  const assignments = [...tasksByAgent.entries()].map(([agentId, tasks]) =>
    assignment({
      agentId,
      role: memberByAgent.get(agentId)?.primaryRole ?? tasks[0]?.taskKind ?? "member",
      ...(memberByAgent.get(agentId) ? { member: memberByAgent.get(agentId) } : {}),
      tasks,
    }),
  )
  const reviewerAgentIds = reviewerMembers.map((member) => member.agentId)
  const verifierAgentIds = verifierMembers.map((member) => member.agentId)
  const plan: TeamExecutionPlan = {
    teamExecutionPlanId: planId,
    parentRunId,
    teamId: team.teamId,
    ...(team.nickname ? { teamNicknameSnapshot: team.nickname } : {}),
    ownerAgentId: coverage.ownerAgentId,
    leadAgentId: executableLead?.agentId ?? coverage.ownerAgentId,
    memberTaskAssignments: assignments,
    reviewerAgentIds,
    verifierAgentIds,
    fallbackAssignments: fallbackAssignments(coverage),
    coverageReport: coverageReportSnapshot({
      coverage,
      team,
      executableMembers,
      synthesisAgentId,
      synthesisMode,
    }),
    conflictPolicySnapshot: team.conflictPolicy ?? "lead_decides",
    resultPolicySnapshot: team.resultPolicy ?? synthesisMode,
    createdAt: generatedAt,
  }
  const validation = validateTeamExecutionPlan(plan)
  if (!validation.ok) {
    return {
      ok: false,
      plan,
      persisted: false,
      diagnostics: [
        ...diagnostics,
        {
          reasonCode: "invalid_team_execution_plan_contract",
          severity: "invalid",
          message: "Generated TeamExecutionPlan did not pass contract validation.",
          teamId: team.teamId,
        },
      ],
      validationIssues: validation.issues,
    }
  }

  const persist = input.persist ?? true
  const persisted = persist
    ? insertTeamExecutionPlan(plan, { auditId: input.auditId ?? null })
    : false
  return {
    ok: true,
    plan,
    persisted,
    diagnostics: [
      ...diagnostics,
      ...missingRoleDiagnostics({ team, reviewerAgentIds, verifierAgentIds }),
    ],
  }
}

export function createTeamExecutionPlanService(
  dependencies: TeamExecutionPlanServiceDependencies = {},
) {
  return {
    build(input: TeamExecutionPlanBuildInput): TeamExecutionPlanBuildResult {
      return buildTeamExecutionPlan(input, dependencies)
    },
  }
}
