import { randomUUID } from "node:crypto"
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

export interface DelegatedTaskDispatchOutcome {
  taskId: string
  subSessionId?: string
  agentId?: string
  status: "completed" | "failed" | "skipped"
  reasonCode?: string
  childRunId?: string
  summary?: string
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
    taskScope: input.task.scope,
    contextPackageIds: [],
    expectedOutputs: input.task.scope.expectedOutputs,
    retryBudget: input.agent.retryBudget,
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

  const dispatchAgentTask = async (
    task: OrchestrationTask,
    agent: AgentRegistryEntry,
  ): Promise<void> => {
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
        const started = dependencies.startSubAgentRun({
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
    outcomes.push({
      taskId: task.taskId,
      subSessionId: outcome.subSession.subSessionId,
      agentId: agent.agentId,
      status: outcome.status === "completed" ? "completed" : "failed",
      ...(outcome.errorReport?.reasonCode ? { reasonCode: outcome.errorReport.reasonCode } : {}),
      ...(outcome.resultReport?.evidence[0]?.sourceRef
        ? { childRunId: outcome.resultReport.evidence[0].sourceRef }
        : {}),
      ...(summary ? { summary } : {}),
    })
  }

  const dispatchTeamTask = async (task: OrchestrationTask, teamId: string): Promise<void> => {
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
