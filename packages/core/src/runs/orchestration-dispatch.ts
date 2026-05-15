import { randomUUID } from "node:crypto"
import type { ParentAggregationNextAction } from "../agent/sub-agent-result-review.js"
import { CONTRACT_SCHEMA_VERSION, type JsonValue } from "../contracts/index.js"
import {
  type CommandRequest,
  type OrchestrationPlan,
  type OrchestrationTask,
  type ResultReport,
  type RuntimeIdentity,
  type StructuredTaskScope,
  type TeamExecutionTaskSnapshot,
} from "../contracts/sub-agent-orchestration.js"
import { buildAgentPromptBundle } from "../orchestration/prompt-bundle.js"
import {
  buildOrchestrationRegistrySnapshot,
  type AgentRegistryEntry,
} from "../orchestration/registry.js"
import {
  createSubSessionRunner,
  type RunSubSessionInput,
} from "../orchestration/sub-session-runner.js"
import { buildTeamExecutionPlan } from "../orchestration/team-execution-plan.js"
import type { StartRootRunParams, StartedRootRun } from "./start.js"
import type { RootRun, TaskProfile } from "./types.js"

export type DelegatedTaskDispatchOutcomeStatus =
  | "running"
  | "pending_result"
  | "completed"
  | "failed"
  | "skipped"

export interface DelegatedTaskDispatchLifecycleEntry {
  status: DelegatedTaskDispatchOutcomeStatus
  at: number
  reasonCode?: string
  parentRunId?: string
  selectedExecutorId?: string
  subSessionId?: string
  childRunId?: string
  summary?: string
}

export interface DelegatedTaskDispatchOutcome {
  taskId: string
  subSessionId?: string
  agentId?: string
  agentDisplayName?: string
  agentSource?: AgentRegistryEntry["source"]
  topologyId?: string
  topologyExecutorId?: string
  status: DelegatedTaskDispatchOutcomeStatus
  reasonCode?: string
  childRunId?: string
  summary?: string
  parentAggregationNextAction?: ParentAggregationNextAction
  feedbackRequestId?: string
  startedAt?: number
  completedAt?: number
  lifecycle?: DelegatedTaskDispatchLifecycleEntry[]
}

export interface DelegatedTaskDispatchResult {
  attempted: number
  completed: number
  failed: number
  skipped: number
  outcomes: DelegatedTaskDispatchOutcome[]
}

export interface DelegatedTaskDispatchParams {
  plan: OrchestrationPlan
  parentRunId: string
  parentSessionId: string
  parentRequestGroupId: string
  source: StartRootRunParams["source"]
  message: string
  originalRequest?: string
  workDir: string
  controller: AbortController
}

export interface DelegatedTaskDispatchDependencies {
  startSubAgentRun: (params: StartRootRunParams) => StartedRootRun
  appendParentEvent?: (runId: string, label: string) => void
  updateParentSummary?: (runId: string, summary: string) => RootRun | undefined
  now?: () => number
  idProvider?: () => string
}

const ROOT_AGENT_ID = "agent:nobie"

function uniqueStrings(values: Array<string | undefined>): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value?.trim())))]
}

function taskProfileForScope(scope: StructuredTaskScope): TaskProfile {
  const haystack = [
    scope.goal,
    scope.intentType,
    scope.actionType,
    ...scope.constraints,
    ...scope.reasonCodes,
  ].join(" ").toLowerCase()
  if (/(code|coding|develop|implement|bug|test|typescript|javascript|react|개발|구현|버그|테스트)/.test(haystack)) {
    return "coding"
  }
  if (/(review|검토|리뷰)/.test(haystack)) return "review"
  if (/(research|retrieve|search|조사|검색|자료)/.test(haystack)) return "research"
  if (/(plan|planning|계획|설계)/.test(haystack)) return "planning"
  if (/(operate|deploy|release|운영|배포)/.test(haystack)) return "operations"
  return "general_chat"
}

function executionPrompt(input: {
  renderedPrompt: string
  task: OrchestrationTask
  originalRequest: string
}): string {
  const expectedOutputs = input.task.scope.expectedOutputs
    .map((output) => `- ${output.outputId}: ${output.description}`)
    .join("\n")
  const constraints = input.task.scope.constraints.map((item) => `- ${item}`).join("\n")
  return [
    input.renderedPrompt,
    "",
    "# Delegated task",
    `Task ID: ${input.task.taskId}`,
    `Goal: ${input.task.scope.goal}`,
    `Action: ${input.task.scope.actionType}`,
    "",
    "# Original user request",
    input.originalRequest,
    "",
    "# Expected outputs",
    expectedOutputs || "- Complete the delegated scope and report concrete results.",
    "",
    "# Constraints",
    constraints || "- Stay within the delegated scope.",
    "",
    "Work as the assigned sub-agent. Complete the task directly when possible, then report results, changed files or artifacts, evidence, and remaining risks. Keep the response concise and in the user's language.",
  ].join("\n")
}

function identityFor(input: {
  entityType: RuntimeIdentity["entityType"]
  entityId: string
  ownerType: RuntimeIdentity["owner"]["ownerType"]
  ownerId: string
  parentRunId: string
  parentSessionId: string
  parentRequestId: string
  idempotencyKey: string
}): RuntimeIdentity {
  return {
    schemaVersion: CONTRACT_SCHEMA_VERSION,
    entityType: input.entityType,
    entityId: input.entityId,
    owner: { ownerType: input.ownerType, ownerId: input.ownerId },
    idempotencyKey: input.idempotencyKey,
    parent: {
      parentRunId: input.parentRunId,
      parentSessionId: input.parentSessionId,
      parentRequestId: input.parentRequestId,
    },
  }
}

function commandRequestFor(input: {
  task: OrchestrationTask
  agent: AgentRegistryEntry
  subSessionId: string
  parentRunId: string
  parentSessionId: string
  parentRequestId: string
}): CommandRequest {
  const topologyAssignment = topologyAssignmentFromAgentId(input.agent)
  return {
    identity: identityFor({
      entityType: "sub_session",
      entityId: input.subSessionId,
      ownerType: "nobie",
      ownerId: ROOT_AGENT_ID,
      parentRunId: input.parentRunId,
      parentSessionId: input.parentSessionId,
      parentRequestId: input.parentRequestId,
      idempotencyKey: `sub-session:${input.parentRunId}:${input.task.taskId}:${input.agent.agentId}`,
    }),
    commandRequestId: `command:${input.parentRunId}:${input.task.taskId}`,
    parentRunId: input.parentRunId,
    subSessionId: input.subSessionId,
    targetAgentId: input.agent.agentId,
    ...(input.agent.nickname ? { targetNicknameSnapshot: input.agent.nickname } : {}),
    ...(topologyAssignment.topologyId
      ? {
          topologyExecutor: {
            graphExecutionPlanId: topologyAssignment.topologyId,
            ...(topologyAssignment.topologyExecutorId
              ? { executorId: topologyAssignment.topologyExecutorId }
              : {}),
          },
        }
      : {}),
    taskScope: input.task.scope,
    contextPackageIds: [],
    expectedOutputs: input.task.scope.expectedOutputs,
  }
}

function reportFor(input: {
  command: CommandRequest
  agent: AgentRegistryEntry
  status: ResultReport["status"]
  childRun: RootRun | undefined
  risksOrGaps?: string[]
}): ResultReport {
  const outputStatus =
    input.status === "completed"
      ? "satisfied"
      : input.status === "needs_revision"
        ? "partial"
        : "missing"
  const value: JsonValue = {
    childRunId: input.childRun?.id,
    childStatus: input.childRun?.status,
    summary: input.childRun?.summary ?? "Sub-agent execution did not return a run summary.",
  }
  return {
    identity: identityFor({
      entityType: "sub_session",
      entityId: input.command.subSessionId,
      ownerType: "sub_agent",
      ownerId: input.agent.agentId,
      parentRunId: input.command.parentRunId,
      parentSessionId: input.command.identity.parent?.parentSessionId ?? "",
      parentRequestId: input.command.identity.parent?.parentRequestId ?? input.command.parentRunId,
      idempotencyKey: `result-report:${input.command.parentRunId}:${input.command.subSessionId}`,
    }),
    resultReportId: randomUUID(),
    parentRunId: input.command.parentRunId,
    subSessionId: input.command.subSessionId,
    source: {
      entityType: "sub_agent",
      entityId: input.agent.agentId,
      nicknameSnapshot: input.agent.nickname ?? input.agent.displayName,
    },
    status: input.status,
    outputs: input.command.expectedOutputs.map((output) => ({
      outputId: output.outputId,
      status: outputStatus,
      value,
    })),
    evidence: input.childRun
      ? [
          {
            evidenceId: randomUUID(),
            kind: "child_run",
            sourceRef: input.childRun.id,
            sourceTimestamp: new Date(input.childRun.updatedAt).toISOString(),
          },
          {
            evidenceId: randomUUID(),
            kind: "summary",
            sourceRef: input.childRun.id,
            sourceTimestamp: new Date(input.childRun.updatedAt).toISOString(),
          },
        ]
      : [],
    artifacts: [],
    risksOrGaps: input.risksOrGaps ?? [],
  }
}

function resultSummary(resultReport: ResultReport | undefined): string | undefined {
  const value = resultReport?.outputs[0]?.value
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined
  const summary = value.summary
  return typeof summary === "string" && summary.trim() ? summary.trim() : undefined
}

function isDelegationDispatchEligible(params: DelegatedTaskDispatchParams): boolean {
  return params.plan.delegatedTasks.some((task) => task.assignedAgentId?.trim() || task.assignedTeamId?.trim())
}

function topologyAssignmentFromAgentId(agent: AgentRegistryEntry): {
  topologyId?: string
  topologyExecutorId?: string
} {
  if (agent.source !== "topology") return {}
  const marker = ":node:"
  const markerIndex = agent.agentId.indexOf(marker)
  if (markerIndex < 0) return {}
  return {
    topologyId: agent.agentId.slice(0, markerIndex),
    topologyExecutorId: `node:${agent.agentId.slice(markerIndex + marker.length)}`,
  }
}

export type DispatchToChildExecutorValidation =
  | {
      ok: true
      reasonCodes: string[]
      selectedExecutorId?: string
    }
  | {
      ok: false
      reasonCode: string
      summary: string
      selectedExecutorId?: string
    }

export function validateDispatchToChildExecutorInput(input: {
  task: OrchestrationTask
  agent: AgentRegistryEntry
}): DispatchToChildExecutorValidation {
  if (input.agent.source !== "topology") {
    return { ok: true, reasonCodes: ["registry_executor_selected"] }
  }

  const selectedExecutorId = input.task.planningTrace?.selectedExecutorId?.trim()
  const reasonCodes = new Set([
    ...input.task.scope.reasonCodes,
    ...(input.task.planningTrace?.reasonCodes ?? []),
  ])
  const validatedByDecision =
    reasonCodes.has("execution_decision_selected_executor") ||
    reasonCodes.has("explicit_topology_target")
  if (!validatedByDecision) {
    return {
      ok: false,
      reasonCode: "validated_execution_decision_required",
      summary: "Topology executor dispatch was blocked because no validated executor selection was attached.",
      ...(selectedExecutorId ? { selectedExecutorId } : {}),
    }
  }
  if (!selectedExecutorId) {
    return {
      ok: false,
      reasonCode: "validated_execution_decision_executor_missing",
      summary: "Topology executor dispatch was blocked because the selected executor id is missing.",
    }
  }
  if (selectedExecutorId !== input.agent.agentId) {
    return {
      ok: false,
      reasonCode: "validated_execution_decision_executor_mismatch",
      summary: "Topology executor dispatch was blocked because the selected executor differs from the dispatch target.",
      selectedExecutorId,
    }
  }
  return {
    ok: true,
    reasonCodes: [...reasonCodes].filter((code) => code.trim()),
    selectedExecutorId,
  }
}

export class DispatchToChildExecutor {
  validate(input: {
    task: OrchestrationTask
    agent: AgentRegistryEntry
  }): DispatchToChildExecutorValidation {
    return validateDispatchToChildExecutorInput(input)
  }
}

function teamDispatchBlockReason(task: OrchestrationTask): string | undefined {
  const reasonCodes = new Set([
    ...task.scope.reasonCodes,
    ...(task.planningTrace?.reasonCodes ?? []),
  ])
  if (reasonCodes.has("inferred_team_target_from_capability")) {
    return "inferred_team_target_from_capability_blocked"
  }
  if (reasonCodes.has("inferred_team_target_from_request")) {
    return "inferred_team_target_from_request_blocked"
  }
  if (!reasonCodes.has("explicit_team_target")) {
    return "team_dispatch_requires_explicit_target"
  }
  return undefined
}

function teamTaskOrder(taskKind: TeamExecutionTaskSnapshot["taskKind"]): number {
  if (taskKind === "member") return 0
  if (taskKind === "synthesis") return 1
  if (taskKind === "review") return 2
  return 3
}

function orchestrationTaskFromTeamTask(
  task: TeamExecutionTaskSnapshot,
  parentTask: OrchestrationTask,
): OrchestrationTask {
  return {
    taskId: task.taskId,
    executionKind: task.executionKind,
    scope: task.scope,
    ...(task.assignedAgentId ? { assignedAgentId: task.assignedAgentId } : {}),
    ...(task.assignedTeamId ?? parentTask.assignedTeamId
      ? { assignedTeamId: task.assignedTeamId ?? parentTask.assignedTeamId }
      : {}),
    requiredCapabilities: uniqueStrings([
      ...parentTask.requiredCapabilities,
      ...task.requiredCapabilities,
    ]),
    resourceLockIds: uniqueStrings([
      ...parentTask.resourceLockIds,
      ...task.resourceLockIds,
    ]),
    planningTrace: {
      reasonCodes: uniqueStrings([
        ...(parentTask.planningTrace?.reasonCodes ?? []),
        ...task.reasonCodes,
        "team_execution_task_expanded",
      ]),
      explanation: `Expanded from team task ${parentTask.taskId}.`,
    },
  }
}

export async function dispatchDelegatedSubAgentTasks(
  params: DelegatedTaskDispatchParams,
  dependencies: DelegatedTaskDispatchDependencies,
): Promise<DelegatedTaskDispatchResult> {
  const appendParentEvent = dependencies.appendParentEvent ?? (() => undefined)
  const updateParentSummary = dependencies.updateParentSummary ?? (() => undefined)
  if (!isDelegationDispatchEligible(params)) {
    return { attempted: 0, completed: 0, failed: 0, skipped: 0, outcomes: [] }
  }

  const registry = buildOrchestrationRegistrySnapshot()
  const agentsById = new Map(registry.agents.map((agent) => [agent.agentId, agent]))
  const teams = registry.teams.map((team) => team.config)
  const runner = createSubSessionRunner({
    ...(dependencies.now ? { now: dependencies.now } : {}),
    ...(dependencies.idProvider ? { idProvider: dependencies.idProvider } : {}),
  })
  const originalRequest = params.originalRequest?.trim() || params.message
  const outcomes: DelegatedTaskDispatchOutcome[] = []
  let attempted = 0
  const now = dependencies.now ?? (() => Date.now())
  const childDispatch = new DispatchToChildExecutor()

  const dispatchAgentTask = async (
    task: OrchestrationTask,
    agent: AgentRegistryEntry,
  ): Promise<void> => {
    const topologyAssignment = topologyAssignmentFromAgentId(agent)
    const validation = childDispatch.validate({ task, agent })
    if (!validation.ok) {
      const failedAt = now()
      attempted += 1
      outcomes.push({
        taskId: task.taskId,
        agentId: agent.agentId,
        agentDisplayName: agent.displayName,
        agentSource: agent.source,
        ...topologyAssignment,
        status: "failed",
        reasonCode: validation.reasonCode,
        summary: validation.summary,
        completedAt: failedAt,
        lifecycle: [{
          status: "failed",
          at: failedAt,
          reasonCode: validation.reasonCode,
          parentRunId: params.parentRunId,
          ...(validation.selectedExecutorId ? { selectedExecutorId: validation.selectedExecutorId } : {}),
          summary: validation.summary,
        }],
      })
      appendParentEvent(
        params.parentRunId,
        [
          "dispatch_to_child_executor_blocked",
          task.taskId,
          agent.source,
          agent.agentId,
          validation.reasonCode,
          validation.selectedExecutorId ? `selected=${validation.selectedExecutorId}` : undefined,
          topologyAssignment.topologyId ? `topology=${topologyAssignment.topologyId}` : undefined,
          topologyAssignment.topologyExecutorId ? `executor=${topologyAssignment.topologyExecutorId}` : undefined,
        ].filter(Boolean).join(":"),
      )
      return
    }
    const subSessionId = `sub-session:${randomUUID()}`
    const command = commandRequestFor({
      task,
      agent,
      subSessionId,
      parentRunId: params.parentRunId,
      parentSessionId: params.parentSessionId,
      parentRequestId: params.plan.parentRequestId,
    })
    const bundle = buildAgentPromptBundle({
      agent: agent.config,
      taskScope: task.scope,
      teams,
      workDir: params.workDir,
      parentRunId: params.parentRunId,
      parentRequestId: params.plan.parentRequestId,
      auditCorrelationId: params.parentRunId,
    })
    const prompt = executionPrompt({
      renderedPrompt: bundle.renderedPrompt,
      task,
      originalRequest,
    })
    attempted += 1
    const startedAt = now()
    const outcomeRecord: DelegatedTaskDispatchOutcome = {
      taskId: task.taskId,
      subSessionId,
      agentId: agent.agentId,
      agentDisplayName: agent.displayName,
      agentSource: agent.source,
      ...topologyAssignment,
      status: "running",
      startedAt,
      lifecycle: [{
        status: "running",
        at: startedAt,
        parentRunId: params.parentRunId,
        selectedExecutorId: validation.selectedExecutorId ?? agent.agentId,
        subSessionId,
        summary: "Sub-agent dispatch started.",
      }],
    }
    outcomes.push(outcomeRecord)
    appendParentEvent(
      params.parentRunId,
      [
        "sub_agent_dispatch_running",
        task.taskId,
        agent.source,
        agent.agentId,
        topologyAssignment.topologyId ? `topology=${topologyAssignment.topologyId}` : undefined,
        topologyAssignment.topologyExecutorId ? `executor=${topologyAssignment.topologyExecutorId}` : undefined,
      ].filter(Boolean).join(":"),
    )
    appendParentEvent(
      params.parentRunId,
      [
        "dispatch_to_child_executor_validated",
        task.taskId,
        agent.agentId,
        `parent=${params.parentRunId}`,
        `subSession=${subSessionId}`,
        `selected=${validation.selectedExecutorId ?? agent.agentId}`,
        topologyAssignment.topologyExecutorId ? `executor=${topologyAssignment.topologyExecutorId}` : undefined,
      ].filter(Boolean).join(":"),
    )
    const outcome = await runner.runSubSession(
      {
        command,
        agent: {
          agentId: agent.agentId,
          displayName: agent.displayName,
          ...(agent.nickname ? { nickname: agent.nickname } : {}),
        },
        parentSessionId: params.parentSessionId,
        promptBundle: bundle.bundle,
        parentAbortSignal: params.controller.signal,
      },
      async (input: RunSubSessionInput, controls) => {
        await controls.emitProgress("서브 에이전트 실행을 시작했습니다.", "running")
        let started: StartedRootRun
        try {
          started = dependencies.startSubAgentRun({
            message: prompt,
            sessionId: params.parentSessionId,
            requestGroupId: `${params.parentRunId}:${input.command.subSessionId}`,
            lineageRootRunId: params.parentRequestGroupId,
            forceRequestGroupReuse: true,
            parentRunId: params.parentRunId,
            originRunId: params.parentRunId,
            originRequestGroupId: params.parentRequestGroupId,
            model: controls.modelExecution.modelId,
            providerId: controls.modelExecution.providerId,
            targetId: agent.agentId,
            targetLabel: agent.displayName,
            source: params.source,
            skipIntake: true,
            toolsEnabled: true,
            contextMode: "handoff",
            taskProfile: taskProfileForScope(task.scope),
            runScope: "child",
            handoffSummary: task.scope.goal,
            originalRequest,
            workDir: params.workDir,
          })
        } catch (error) {
          const failedAt = now()
          const safeMessage = error instanceof Error ? error.message : String(error)
          outcomeRecord.status = "failed"
          outcomeRecord.reasonCode = "child_run_creation_failed"
          outcomeRecord.completedAt = failedAt
          outcomeRecord.summary = safeMessage
          outcomeRecord.lifecycle?.push({
            status: "failed",
            at: failedAt,
            reasonCode: "child_run_creation_failed",
            parentRunId: params.parentRunId,
            selectedExecutorId: validation.selectedExecutorId ?? agent.agentId,
            subSessionId: input.command.subSessionId,
            summary: safeMessage,
          })
          appendParentEvent(
            params.parentRunId,
            [
              "sub_agent_child_run_creation_failed",
              task.taskId,
              agent.agentId,
              input.command.subSessionId,
              safeMessage,
            ].filter(Boolean).join(":"),
          )
          throw new Error(`child_run_creation_failed:${safeMessage}`)
        }
        const pendingAt = now()
        outcomeRecord.status = "pending_result"
        outcomeRecord.childRunId = started.runId
        outcomeRecord.lifecycle?.push({
          status: "pending_result",
          at: pendingAt,
          parentRunId: params.parentRunId,
          selectedExecutorId: validation.selectedExecutorId ?? agent.agentId,
          subSessionId: input.command.subSessionId,
          childRunId: started.runId,
          summary: "Child run started; awaiting result report.",
        })
        appendParentEvent(
          params.parentRunId,
          `sub_agent_dispatch_pending_result:${task.taskId}:${agent.agentId}:${started.runId}`,
        )
        updateParentSummary(params.parentRunId, "서브 에이전트 결과를 기다리고 있습니다.")
        const childRun = await started.finished
        const failedStatuses = new Set<RootRun["status"]>(["failed", "cancelled", "interrupted"])
        const reportStatus: ResultReport["status"] =
          childRun && !failedStatuses.has(childRun.status) ? "completed" : "failed"
        await controls.emitProgress(
          reportStatus === "completed"
            ? "서브 에이전트 실행을 완료했습니다."
            : "서브 에이전트 실행이 실패했습니다.",
          "running",
        )
        return reportFor({
          command: input.command,
          agent,
          status: reportStatus,
          childRun,
          risksOrGaps: reportStatus === "completed"
            ? uniqueStrings(bundle.issueCodes)
            : uniqueStrings([
                ...bundle.issueCodes,
                childRun?.summary ?? "child_run_failed",
              ]),
        })
      },
    )
    const summary = resultSummary(outcome.resultReport)
    const completedAt = now()
    const finalStatus = outcome.status === "completed" ? "completed" : "failed"
    outcomeRecord.subSessionId = outcome.subSession.subSessionId
    outcomeRecord.status = finalStatus
    outcomeRecord.completedAt = completedAt
    if (outcomeRecord.reasonCode !== "child_run_creation_failed" && outcome.errorReport?.reasonCode) {
      outcomeRecord.reasonCode = outcome.errorReport.reasonCode
    }
    if (outcome.resultReport?.evidence[0]?.sourceRef) {
      outcomeRecord.childRunId = outcome.resultReport.evidence[0].sourceRef
    }
    if (summary) outcomeRecord.summary = summary
    if (outcome.parentAggregationTrace?.nextAction) {
      outcomeRecord.parentAggregationNextAction = outcome.parentAggregationTrace.nextAction
    }
    if (outcome.feedbackRequest?.feedbackRequestId) {
      outcomeRecord.feedbackRequestId = outcome.feedbackRequest.feedbackRequestId
    }
    outcomeRecord.lifecycle?.push({
      status: finalStatus,
      at: completedAt,
      ...(outcomeRecord.reasonCode ? { reasonCode: outcomeRecord.reasonCode } : {}),
      parentRunId: params.parentRunId,
      selectedExecutorId: validation.selectedExecutorId ?? agent.agentId,
      subSessionId: outcome.subSession.subSessionId,
      ...(outcomeRecord.childRunId ? { childRunId: outcomeRecord.childRunId } : {}),
      ...(summary ? { summary } : {}),
    })
    if (outcomeRecord.reasonCode === "prompt_bundle_preflight_failed") {
      appendParentEvent(
        params.parentRunId,
        `sub_agent_dispatch_preflight_failed:${task.taskId}:${agent.agentId}:${outcome.subSession.subSessionId}`,
      )
    }
    if (outcome.status === "cancelled") {
      appendParentEvent(
        params.parentRunId,
        `sub_agent_dispatch_cancelled:${task.taskId}:${agent.agentId}:${outcome.subSession.subSessionId}`,
      )
    }
    appendParentEvent(
      params.parentRunId,
      [
        "delegated_task_result",
        task.taskId,
        agent.source,
        agent.agentId,
        agent.displayName,
        outcome.status === "completed" ? "completed" : "failed",
        topologyAssignment.topologyId ? `topology=${topologyAssignment.topologyId}` : undefined,
        topologyAssignment.topologyExecutorId ? `executor=${topologyAssignment.topologyExecutorId}` : undefined,
      ].filter(Boolean).join(":"),
    )
  }

  const dispatchTeamTask = async (task: OrchestrationTask, teamId: string): Promise<void> => {
    const blockReason = teamDispatchBlockReason(task)
    if (blockReason) {
      outcomes.push({
        taskId: task.taskId,
        status: "skipped",
        reasonCode: blockReason,
        summary: `Skipped team dispatch for ${teamId} because the team was not explicitly selected.`,
      })
      appendParentEvent(params.parentRunId, `team_dispatch_skipped:${task.taskId}:${teamId}:${blockReason}`)
      return
    }

    const teamPlan = buildTeamExecutionPlan({
      teamId,
      teamExecutionPlanId: `team-plan:${params.parentRunId}:${task.taskId}`,
      parentRunId: params.parentRunId,
      parentRequestId: params.plan.parentRequestId,
      userRequest: task.scope.goal,
      persist: true,
      auditId: params.parentRunId,
    }, {
      ...(dependencies.now ? { now: dependencies.now } : {}),
      ...(dependencies.idProvider
        ? { idProvider: (prefix: string) => `${prefix}:${dependencies.idProvider?.()}` }
        : {}),
    })
    if (!teamPlan.ok || !teamPlan.plan) {
      const reasonCode = teamPlan.diagnostics[0]?.reasonCode ?? "team_execution_plan_failed"
      outcomes.push({
        taskId: task.taskId,
        status: "failed",
        reasonCode,
        summary: `Team execution plan failed for ${teamId}.`,
      })
      appendParentEvent(params.parentRunId, `team_dispatch_failed:${task.taskId}:${teamId}:${reasonCode}`)
      return
    }

    appendParentEvent(
      params.parentRunId,
      `team_execution_planned:${teamPlan.plan.teamExecutionPlanId}:${teamId}:assignments=${teamPlan.plan.memberTaskAssignments.length}`,
    )
    const expandedTasks = teamPlan.plan.memberTaskAssignments
      .flatMap((assignment) => assignment.tasks ?? [])
      .filter((teamTask) => teamTask.executionKind === "delegated_sub_agent" && teamTask.assignedAgentId)
      .sort((left, right) =>
        teamTaskOrder(left.taskKind) - teamTaskOrder(right.taskKind) ||
        left.taskId.localeCompare(right.taskId),
      )
      .map((teamTask) => orchestrationTaskFromTeamTask(teamTask, task))

    if (expandedTasks.length === 0) {
      outcomes.push({
        taskId: task.taskId,
        status: "failed",
        reasonCode: "team_execution_plan_no_delegated_tasks",
        summary: `Team execution plan produced no delegated tasks for ${teamId}.`,
      })
      appendParentEvent(params.parentRunId, `team_dispatch_failed:${task.taskId}:${teamId}:team_execution_plan_no_delegated_tasks`)
      return
    }

    for (const expandedTask of expandedTasks) {
      const agentId = expandedTask.assignedAgentId
      const agent = agentId ? agentsById.get(agentId) : undefined
      if (!agentId || !agent) {
        outcomes.push({
          taskId: expandedTask.taskId,
          status: "skipped",
          reasonCode: agentId ? "assigned_agent_missing" : "assigned_agent_missing",
        })
        appendParentEvent(params.parentRunId, `sub_agent_dispatch_skipped:${expandedTask.taskId}:assigned_agent_missing`)
        continue
      }
      await dispatchAgentTask(expandedTask, agent)
    }
  }

  appendParentEvent(params.parentRunId, `sub_agent_dispatch_started:${params.plan.delegatedTasks.length}`)
  updateParentSummary(params.parentRunId, "서브 에이전트에게 작업을 위임하고 있습니다.")

  for (const task of params.plan.delegatedTasks) {
    const agentId = task.assignedAgentId
    const agent = agentId ? agentsById.get(agentId) : undefined
    if (agentId && agent) {
      await dispatchAgentTask(task, agent)
      continue
    }
    if (task.assignedTeamId) {
      await dispatchTeamTask(task, task.assignedTeamId)
      continue
    }
    if (!agentId || !agent) {
      outcomes.push({
        taskId: task.taskId,
        status: "skipped",
        reasonCode: agentId ? "assigned_agent_missing" : "assigned_agent_missing",
      })
      appendParentEvent(params.parentRunId, `sub_agent_dispatch_skipped:${task.taskId}:assigned_agent_missing`)
      continue
    }
  }

  const completed = outcomes.filter((outcome) => outcome.status === "completed").length
  const failed = outcomes.filter((outcome) => outcome.status === "failed").length
  const skipped = outcomes.filter((outcome) => outcome.status === "skipped").length
  appendParentEvent(
    params.parentRunId,
    `sub_agent_dispatch_finished:attempted=${attempted};completed=${completed};failed=${failed};skipped=${skipped}`,
  )
  return { attempted, completed, failed, skipped, outcomes }
}
