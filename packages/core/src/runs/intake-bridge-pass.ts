import {
  detectAvailableProvider,
  getDefaultModel,
  getProvider,
  type AIProvider,
  type ProviderAuditTrace,
} from "../ai/index.js"
import type { ChannelSource } from "../channels/contracts.js"
import {
  buildScheduleRegistrationCancelledEvent,
  buildScheduleRegistrationCreatedEvent,
} from "../scheduler/lifecycle.js"
import {
  analyzeTaskIntake,
  type TaskExecutionSemantics,
  type TaskIntentEnvelope,
  type TaskStructuredRequest,
} from "../agent/intake.js"
import {
  reviewTaskCompletion,
  type CompletionReviewResult,
} from "../agent/completion-review.js"
import type { AgentContextMode } from "../agent/index.js"
import { resolveRunRoute } from "./routing.js"
import { normalizeDirectArtifactDeliverySemantics } from "./execution-profile.js"
import {
  buildFollowupPrompt,
  createDefaultScheduleActionDependencies,
  executeScheduleActions,
  inferDelegatedTaskProfile,
  type ScheduleDelayedRunRequest,
} from "./action-execution.js"
import type { RunChunkDeliveryHandler } from "./delivery.js"
import type { LoopDirective } from "./loop-directive.js"
import type { TaskProfile } from "./types.js"
import type { WorkerRuntimeTarget } from "./worker-runtime.js"
import type {
  AgentExecutionDecision,
  AgentExecutionDecisionTraceSnapshot,
} from "../orchestration/execution-decision-contract.js"
import {
  decideExecutionRoute,
  type DecideExecutionRouteResult,
} from "../orchestration/decide-execution-route.js"
import {
  buildExecutionGraphSnapshot,
  EXECUTION_GRAPH_ROOT_AGENT_ID,
} from "../orchestration/execution-graph-snapshot.js"
import {
  formatAgentExecutionDecisionTraceRunEvent,
  runAgentExecutionHarness,
  type AgentExecutionHarnessResult,
  type AgentExecutionModelCaller,
} from "../orchestration/execution-harness.js"

export interface DelegatedRunStartParams {
  message: string
  sessionId: string
  taskProfile: TaskProfile
  requestGroupId: string
  parentRunId?: string | undefined
  runScope?: "root" | "child" | "analysis" | undefined
  handoffSummary?: string | undefined
  originalRequest: string
  executionSemantics: TaskExecutionSemantics
  structuredRequest: TaskStructuredRequest
  intentEnvelope: TaskIntentEnvelope
  model?: string | undefined
  providerId?: string | undefined
  provider?: AIProvider | undefined
  providerTrace?: ProviderAuditTrace | undefined
  workerRuntime?: WorkerRuntimeTarget | undefined
  targetId?: string | undefined
  targetLabel?: string | undefined
  agentExecutionDecision?: AgentExecutionDecision | undefined
  agentExecutionDecisionTrace?: AgentExecutionDecisionTraceSnapshot | undefined
  workDir: string
  source: ChannelSource
  skipIntake?: boolean | undefined
  toolsEnabled?: boolean | undefined
  contextMode?: AgentContextMode | undefined
  onChunk?: RunChunkDeliveryHandler
}

export interface DelegatedRunStartResult {
  runId?: string | undefined
  finished?: Promise<{ status?: string; summary?: string } | undefined>
}

interface IntakeBridgePassDependencies {
  appendRunEvent: (runId: string, message: string) => void
  updateRunSummary: (runId: string, summary: string) => void
  incrementDelegationTurnCount: (runId: string, summary: string) => void
  emitScheduleCreated: (payload: ReturnType<typeof buildScheduleRegistrationCreatedEvent>) => void
  emitScheduleCancelled: (payload: ReturnType<typeof buildScheduleRegistrationCancelledEvent>) => void
  scheduleDelayedRun: (params: ScheduleDelayedRunRequest) => void
  startDelegatedRun: (
    params: DelegatedRunStartParams,
  ) => void | DelegatedRunStartResult | Promise<void | DelegatedRunStartResult>
  normalizeTaskProfile: (taskProfile: string | undefined) => TaskProfile
  logInfo: (message: string, payload: Record<string, unknown>) => void
  recordExecutionDecisionTrace?: (params: {
    runId: string
    agentExecutionDecision: AgentExecutionDecision
    executionDecisionTrace: AgentExecutionDecisionTraceSnapshot
  }) => void
}

interface IntakeBridgePassModuleDependencies {
  analyzeTaskIntake: typeof analyzeTaskIntake
  resolveRunRoute: typeof resolveRunRoute
  executeScheduleActions: typeof executeScheduleActions
  createDefaultScheduleActionDependencies: typeof createDefaultScheduleActionDependencies
  inferDelegatedTaskProfile: typeof inferDelegatedTaskProfile
  buildFollowupPrompt: typeof buildFollowupPrompt
  buildExecutionGraphSnapshot?: typeof buildExecutionGraphSnapshot
  runAgentExecutionHarness?: typeof runAgentExecutionHarness
  reviewTaskCompletion?: typeof reviewTaskCompletion
}

const defaultModuleDependencies: IntakeBridgePassModuleDependencies = {
  analyzeTaskIntake,
  resolveRunRoute,
  executeScheduleActions,
  createDefaultScheduleActionDependencies,
  inferDelegatedTaskProfile,
  buildFollowupPrompt,
  buildExecutionGraphSnapshot,
  runAgentExecutionHarness,
  reviewTaskCompletion,
}

type DecisionRouteWithTrace = Extract<DecideExecutionRouteResult, { decisionResult: AgentExecutionHarnessResult }>

function buildExecutionDecisionModelCaller(input: {
  providerId?: string | undefined
  provider?: AIProvider | undefined
  model?: string | undefined
}): AgentExecutionModelCaller | undefined {
  const providerId = input.providerId?.trim() || detectAvailableProvider()
  let provider = input.provider
  if (!provider && providerId) {
    try {
      provider = getProvider(providerId)
    } catch {
      provider = undefined
    }
  }
  if (!provider) return undefined
  const model = input.model?.trim() || getDefaultModel() || provider.supportedModels[0]
  if (!model) return undefined
  return async (params): Promise<string> => {
    let output = ""
    for await (const chunk of provider.chat({
      model,
      system: "You are Nobie's execution-decision harness. Return only the requested JSON decision object.",
      messages: [{ role: "user", content: params.prompt }],
      maxTokens: 4000,
      signal: params.signal,
    })) {
      if (chunk.type === "text_delta") output += chunk.delta
    }
    return output.trim()
  }
}

function recordExecutionDecisionTraceForRun(
  dependencies: IntakeBridgePassDependencies,
  runId: string,
  decisionRoute: DecisionRouteWithTrace,
): void {
  dependencies.recordExecutionDecisionTrace?.({
    runId,
    agentExecutionDecision: decisionRoute.agentExecutionDecision,
    executionDecisionTrace: decisionRoute.decisionResult.decisionTrace,
  })
}

async function reviewDelegatedChildCompletion(input: {
  params: Parameters<typeof runIntakeBridgePass>[0]
  dependencies: IntakeBridgePassDependencies
  moduleDependencies: IntakeBridgePassModuleDependencies
  childRunId: string
  childSummary: string
}): Promise<CompletionReviewResult | null> {
  const reviewer = input.moduleDependencies.reviewTaskCompletion
  if (!reviewer) return null
  return reviewer({
    originalRequest: input.params.originalRequest,
    latestAssistantMessage: input.childSummary,
    ...(input.params.model ? { model: input.params.model } : {}),
    ...(input.params.providerId ? { providerId: input.params.providerId } : {}),
    ...(input.params.provider ? { provider: input.params.provider } : {}),
    workDir: input.params.workDir,
  }).catch((error) => {
    input.dependencies.appendRunEvent(
      input.params.runId,
      `parent_run_child_result_review_failed:intake_followup;child_run=${input.childRunId};error=${error instanceof Error ? error.message : String(error)}`,
    )
    return null
  })
}

function buildDelegatedChildCompletionFollowupPrompt(params: {
  originalRequest: string
  childSummary: string
  review: CompletionReviewResult
}): string {
  return [
    "[Delegated Child Completion Follow-up]",
    "The previous delegated child result did not fully satisfy the original request.",
    "",
    `Original user request:\n${params.originalRequest}`,
    "",
    `Previous child result:\n${params.childSummary}`,
    "",
    `Review summary:\n${params.review.summary || "추가 확인이 필요합니다."}`,
    params.review.reason ? `\nReview reason:\n${params.review.reason}` : "",
    params.review.remainingItems.length > 0
      ? `\nRemaining items:\n${params.review.remainingItems.map((item) => `- ${item}`).join("\n")}`
      : "",
    "",
    "Continue autonomously using a different concrete source path or tool path when the previous path was insufficient.",
    "Do not finalize until the requested values are verified, or until every viable path is exhausted with clear evidence.",
    "",
    `Focused follow-up:\n${params.review.followupPrompt ?? params.review.summary}`,
  ].filter(Boolean).join("\n")
}

function buildDelegatedChildReviewDirective(params: {
  originalRequest: string
  childSummary: string
  review: CompletionReviewResult
}): LoopDirective | null {
  if (params.review.status === "followup" || params.review.remainingItems.length > 0) {
    return {
      kind: "retry_intake",
      summary: params.review.summary || "하위 실행 결과에 남은 항목이 있어 계속 확인합니다.",
      reason: params.review.reason || "하위 실행 결과가 원 요청을 완전히 충족하지 않았습니다.",
      message: buildDelegatedChildCompletionFollowupPrompt(params),
      remainingItems: params.review.remainingItems,
      eventLabel: "하위 실행 결과 미완료로 재분석",
    }
  }

  if (params.review.status === "ask_user") {
    const userMessage = params.review.userMessage
      || params.review.reason
      || "요청을 완료하려면 추가 확인이 필요합니다."
    return {
      kind: "awaiting_user",
      preview: userMessage,
      summary: params.review.summary || "하위 실행 결과 검증에서 사용자 확인이 필요합니다.",
      reason: params.review.reason,
      userMessage,
      remainingItems: params.review.remainingItems,
      eventLabel: "하위 실행 결과 검증 사용자 확인",
    }
  }

  return null
}

export async function runIntakeBridgePass(
  params: {
    message: string
    originalRequest: string
    sessionId: string
    requestGroupId: string
    model: string | undefined
    providerId?: string | undefined
    provider?: AIProvider | undefined
    workDir: string
    source: ChannelSource
    runId: string
    onChunk: RunChunkDeliveryHandler | undefined
    reuseConversationContext: boolean
  },
  dependencies: IntakeBridgePassDependencies,
  moduleDependencies: IntakeBridgePassModuleDependencies = defaultModuleDependencies,
): Promise<LoopDirective | null> {
  const intakeSessionId = params.requestGroupId !== params.runId || params.reuseConversationContext
    ? params.sessionId
    : undefined
  const intake = await moduleDependencies.analyzeTaskIntake({
    userMessage: params.message,
    ...(intakeSessionId ? { sessionId: intakeSessionId } : {}),
    requestGroupId: params.requestGroupId,
    ...(params.model ? { model: params.model } : {}),
    workDir: params.workDir,
    source: params.source,
  }).catch(() => null)

  if (!intake) return null

  dependencies.logInfo("intake bridge result", {
    runId: params.runId,
    sessionId: params.sessionId,
    category: intake.intent.category,
    actions: intake.action_items.map((item) => item.type),
    scheduling: intake.scheduling,
  })

  dependencies.appendRunEvent(params.runId, `Intake: ${intake.intent.category}`)
  if (intake.intent.summary.trim()) {
    dependencies.updateRunSummary(params.runId, intake.intent.summary.trim())
  }

  const replyAction = intake.action_items.find((item) => item.type === "reply")
  if (replyAction) {
    const content = getString(replyAction.payload.content)
    if (content) {
      return {
        kind: "complete",
        text: content,
        eventLabel: "intake 즉시 응답 완료",
      }
    }
  }

  const scheduleActions = intake.action_items.filter((item) => item.type === "create_schedule" || item.type === "cancel_schedule")
  const delegatedActions = intake.action_items.filter((item) => item.type === "run_task" || item.type === "delegate_agent")

  if (scheduleActions.length > 0 || delegatedActions.length > 0 || intake.intent.category === "schedule_request") {
    const responseParts: string[] = []
    let delegatedFollowupCount = 0

    if (scheduleActions.length > 0 || intake.intent.category === "schedule_request") {
      const scheduleResult = moduleDependencies.executeScheduleActions(
        scheduleActions,
        intake,
        params,
        moduleDependencies.createDefaultScheduleActionDependencies({
          scheduleDelayedRun: dependencies.scheduleDelayedRun,
        }),
      )
      dependencies.logInfo("schedule action handled", {
        runId: params.runId,
        sessionId: params.sessionId,
        count: scheduleActions.length,
        ok: scheduleResult.ok,
        message: scheduleResult.message,
      })
      const shouldRetryScheduleIntake = !scheduleResult.ok
        && scheduleResult.successCount === 0
        && delegatedActions.length === 0

      if (shouldRetryScheduleIntake) {
        return {
          kind: "retry_intake",
          summary: "일정 요청을 다시 분석하고 가능한 일정 방안으로 재시도합니다.",
          reason: scheduleResult.detail || scheduleResult.message,
          message: buildScheduleIntakeRecoveryPrompt({
            originalRequest: params.originalRequest,
            previousReceipt: scheduleResult.message,
            reason: scheduleResult.detail || scheduleResult.message,
          }),
          remainingItems: [
            "유효한 run_at 또는 cron 일정으로 다시 해석",
            "필요한 경우에만 최소한의 확인 질문 생성",
          ],
          eventLabel: "일정 해석 실패로 재분석",
        }
      }

      if (scheduleResult.message.trim()) {
        responseParts.push(scheduleResult.message.trim())
      }

      for (const receipt of scheduleResult.receipts) {
        if (receipt.kind === "schedule_create_one_time") {
          dependencies.emitScheduleCreated(buildScheduleRegistrationCreatedEvent({
            runId: params.runId,
            requestGroupId: params.requestGroupId,
            registrationKind: "one_time",
            title: receipt.title,
            task: receipt.task,
            source: receipt.source,
            scheduleText: receipt.scheduleText,
            runAtMs: receipt.runAtMs,
          }))
          continue
        }

        if (receipt.kind === "schedule_create_recurring") {
          dependencies.emitScheduleCreated(buildScheduleRegistrationCreatedEvent({
            runId: receipt.originRunId,
            requestGroupId: receipt.originRequestGroupId,
            registrationKind: "recurring",
            title: receipt.title,
            task: receipt.task,
            source: receipt.source,
            scheduleText: receipt.scheduleText,
            scheduleId: receipt.scheduleId,
            cron: receipt.cron,
            ...(receipt.targetSessionId ? { targetSessionId: receipt.targetSessionId } : {}),
            driver: receipt.driver,
          }))
          continue
        }

        dependencies.emitScheduleCancelled(buildScheduleRegistrationCancelledEvent({
          runId: params.runId,
          requestGroupId: params.requestGroupId,
          cancelledScheduleIds: receipt.cancelledScheduleIds,
          cancelledNames: receipt.cancelledNames,
        }))
      }
    }

    for (const delegatedAction of delegatedActions) {
      const delegatedExecutionSemantics = normalizeDirectArtifactDeliverySemantics({
        message: params.originalRequest,
        originalRequest: params.originalRequest,
        executionSemantics: intake.intent_envelope.execution_semantics,
        structuredRequest: intake.structured_request,
        intentEnvelope: intake.intent_envelope,
      })
      const delegatedIntentEnvelope = {
        ...intake.intent_envelope,
        execution_semantics: delegatedExecutionSemantics,
        delivery_mode: delegatedExecutionSemantics.artifactDelivery,
        requires_approval: delegatedExecutionSemantics.approvalRequired,
        approval_tool: delegatedExecutionSemantics.approvalTool,
      }
      const delegatedIntake = {
        ...intake,
        execution: {
          ...intake.execution,
          execution_semantics: delegatedExecutionSemantics,
        },
        intent_envelope: delegatedIntentEnvelope,
      }
      const delegatedTaskProfile = moduleDependencies.inferDelegatedTaskProfile({
        intake: delegatedIntake,
        action: delegatedAction,
      })
      const preferredTarget =
        getString(delegatedAction.payload.preferred_target)
        || getString(delegatedAction.payload.preferredTarget)
        || intake.intent_envelope.preferred_target
      const callModel = buildExecutionDecisionModelCaller({
        providerId: params.providerId,
        provider: params.provider,
        model: params.model,
      })
      const decisionRoute = await decideExecutionRoute({
        originalRequest: params.originalRequest,
        delegatedTitle: delegatedAction.title,
        delegatedTaskProfile,
        sessionId: params.sessionId,
        source: params.source,
        preferredTarget,
        fallbackModel: params.model,
        currentExecutorId: EXECUTION_GRAPH_ROOT_AGENT_ID,
        buildExecutionGraphSnapshot: moduleDependencies.buildExecutionGraphSnapshot,
        runAgentExecutionHarness: moduleDependencies.runAgentExecutionHarness,
        ...(callModel ? { callModel } : {}),
        resolveExplicitProviderTarget: (routeInput) =>
          moduleDependencies.resolveRunRoute({
            preferredTarget: routeInput.preferredTarget,
            taskProfile: routeInput.taskProfile,
            fallbackModel: routeInput.fallbackModel,
          }),
      })

      if (decisionRoute.kind === "self_solve") {
        recordExecutionDecisionTraceForRun(dependencies, params.runId, decisionRoute)
        dependencies.appendRunEvent(
          params.runId,
          formatAgentExecutionDecisionTraceRunEvent(decisionRoute.decisionResult.decisionTrace),
        )
        dependencies.appendRunEvent(
          params.runId,
          "execution_decision_fallback:self_solve; provider_direct_blocked_without_explicit_target",
        )
        dependencies.logInfo("delegated follow-up self-solve fallback", {
          runId: params.runId,
          sessionId: params.sessionId,
          delegatedType: delegatedAction.type,
          delegatedTitle: delegatedAction.title,
          delegatedTaskProfile,
          preferredTarget: preferredTarget ?? null,
          reason: "provider_direct_blocked_without_explicit_target",
        })
        continue
      }

      if (decisionRoute.kind === "ask_user" || decisionRoute.kind === "boundary_failure") {
        recordExecutionDecisionTraceForRun(dependencies, params.runId, decisionRoute)
        dependencies.appendRunEvent(
          params.runId,
          formatAgentExecutionDecisionTraceRunEvent(decisionRoute.decisionResult.decisionTrace),
        )
        return {
          kind: "awaiting_user",
          preview: decisionRoute.agentExecutionDecision.unresolved_reason
            ?? decisionRoute.agentExecutionDecision.reason,
          summary: decisionRoute.kind === "boundary_failure"
            ? "현재 실행 경계 안에서 처리할 수 없는 요청입니다."
            : "실행 전에 사용자 확인이 필요합니다.",
          reason: decisionRoute.agentExecutionDecision.reason,
          userMessage: decisionRoute.agentExecutionDecision.unresolved_reason
            ?? "요청을 계속 진행하려면 필요한 조건을 확인해 주세요.",
          eventLabel: decisionRoute.kind === "boundary_failure"
            ? "execution decision 경계 실패"
            : "execution decision 사용자 확인 대기",
        }
      }

      const route =
        decisionRoute.kind === "explicit_provider_target" || decisionRoute.kind === "delegate_to_child"
          ? decisionRoute.route
          : undefined
      if (!route) continue
      const routeWorkerRuntime = route.workerRuntime as WorkerRuntimeTarget | undefined
      const followupPrompt = moduleDependencies.buildFollowupPrompt({
        originalMessage: params.originalRequest,
        intake: delegatedIntake,
        action: delegatedAction,
        taskProfile: delegatedTaskProfile,
        ...(route.targetId ? { selectedExecutorId: route.targetId } : {}),
        ...(route.targetLabel ? { selectedExecutorLabel: route.targetLabel } : {}),
        ...(decisionRoute.kind === "delegate_to_child"
          ? { selectedExecutorReason: decisionRoute.agentExecutionDecision.reason }
          : {}),
      })
      if (decisionRoute.kind === "delegate_to_child") {
        recordExecutionDecisionTraceForRun(dependencies, params.runId, decisionRoute)
        dependencies.appendRunEvent(
          params.runId,
          formatAgentExecutionDecisionTraceRunEvent(decisionRoute.decisionResult.decisionTrace),
        )
      }
      if (decisionRoute.kind === "explicit_provider_target") {
        dependencies.appendRunEvent(
          params.runId,
          `execution_decision_fallback:explicit_provider; provider_direct_allowed_with_explicit_target; target=${route.targetId ?? preferredTarget ?? "unknown"}`,
        )
      }
      dependencies.appendRunEvent(
        params.runId,
        route.targetLabel
          ? `후속 실행 생성: ${delegatedAction.title} -> ${route.targetLabel} (${delegatedTaskProfile})`
          : `후속 실행 생성: ${delegatedAction.title} (${delegatedTaskProfile})`,
      )
      dependencies.logInfo("delegated follow-up run created", {
        runId: params.runId,
        sessionId: params.sessionId,
        delegatedType: delegatedAction.type,
        delegatedTitle: delegatedAction.title,
        delegatedTaskProfile,
        targetId: route.targetId ?? null,
        targetLabel: route.targetLabel ?? null,
        model: route.model ?? params.model ?? null,
        providerId: route.providerId ?? null,
        workerRuntime: routeWorkerRuntime?.kind ?? null,
        executionGraph: decisionRoute.kind === "delegate_to_child"
          ? {
              graphId: decisionRoute.executionGraph.graphId,
              graphSource: decisionRoute.executionGraph.graphSource,
              topologyId: decisionRoute.executionGraph.topologyId ?? null,
              currentExecutorId: decisionRoute.executionGraph.currentExecutorId,
              availableExecutorIds: decisionRoute.executionGraph.availableExecutorIds,
            }
          : null,
        executionDecisionSource: decisionRoute.kind === "delegate_to_child" ? "nobie_harness" : null,
      })
      dependencies.incrementDelegationTurnCount(params.runId, `${delegatedAction.title} 후속 작업을 시작합니다.`)

      const delegatedRequestGroupId = `${params.runId}:child:${delegatedFollowupCount + 1}`
      const delegatedRun = await dependencies.startDelegatedRun({
        message: followupPrompt,
        sessionId: params.sessionId,
        taskProfile: dependencies.normalizeTaskProfile(delegatedTaskProfile),
        requestGroupId: delegatedRequestGroupId,
        parentRunId: params.runId,
        runScope: "child",
        handoffSummary: delegatedAction.title,
        originalRequest: params.message,
        executionSemantics: delegatedExecutionSemantics,
        structuredRequest: delegatedIntake.structured_request,
        intentEnvelope: delegatedIntentEnvelope,
        model: route.model ?? params.model,
        ...(route.providerId ? { providerId: route.providerId } : {}),
        ...(route.provider ? { provider: route.provider } : {}),
        ...(route.providerTrace ? { providerTrace: route.providerTrace } : {}),
        ...(routeWorkerRuntime ? { workerRuntime: routeWorkerRuntime } : {}),
        ...(route.targetId ? { targetId: route.targetId } : {}),
        ...(route.targetLabel ? { targetLabel: route.targetLabel } : {}),
        ...(decisionRoute.kind === "delegate_to_child" ? { agentExecutionDecision: decisionRoute.agentExecutionDecision } : {}),
        ...(decisionRoute.kind === "delegate_to_child"
          ? { agentExecutionDecisionTrace: decisionRoute.decisionResult.decisionTrace }
          : {}),
        workDir: params.workDir,
        source: params.source,
        skipIntake: true,
        contextMode: "handoff",
      })
      delegatedFollowupCount += 1
      if (isDelegatedRunStartResult(delegatedRun) && delegatedRun.finished) {
        dependencies.appendRunEvent(
          params.runId,
          `parent_run_awaiting_child_result:intake_followup;child_run=${delegatedRun.runId ?? "unknown"}`,
        )
        const completedChild = await delegatedRun.finished
        dependencies.appendRunEvent(
          params.runId,
          `parent_run_child_result_received:intake_followup;child_run=${delegatedRun.runId ?? "unknown"};status=${completedChild?.status ?? "unknown"}`,
        )
        const childSummary = completedChild?.summary?.trim()
        if (childSummary) {
          const childRunId = delegatedRun.runId ?? "unknown"
          const completionReview = await reviewDelegatedChildCompletion({
            params,
            dependencies,
            moduleDependencies,
            childRunId,
            childSummary,
          })
          if (completionReview) {
            dependencies.appendRunEvent(
              params.runId,
              `parent_run_child_result_review:intake_followup;child_run=${childRunId};status=${completionReview.status};remaining=${completionReview.remainingItems.length}`,
            )
            const reviewDirective = buildDelegatedChildReviewDirective({
              originalRequest: params.originalRequest,
              childSummary,
              review: completionReview,
            })
            if (reviewDirective) return reviewDirective
          }
          responseParts.push(childSummary)
        }
      }
    }

    if (responseParts.length > 0) {
      return {
        kind: "complete",
        text: responseParts.join("\n\n"),
        eventLabel: "intake 처리 결과 전달",
      }
    }

    if (delegatedFollowupCount > 0) {
      return {
        kind: "complete_silent",
        summary: "후속 실행으로 전달되었습니다.",
        eventLabel: "intake 후속 실행 생성 완료",
      }
    }
    return null
  }

  if (intake.user_message.mode === "clarification_receipt" || intake.user_message.mode === "failed_receipt") {
    const text = intake.user_message.text.trim()
    if (text) {
      return {
        kind: "complete",
        text,
        eventLabel: "intake 확인 응답 완료",
      }
    }
  }

  return null
}

function buildScheduleIntakeRecoveryPrompt(params: {
  originalRequest: string
  previousReceipt: string
  reason: string
}): string {
  return [
    "[Schedule Intake Recovery]",
    "The previous schedule-analysis pass did not create a valid schedule action.",
    `Original user request: ${params.originalRequest}`,
    `Previous schedule receipt: ${params.previousReceipt}`,
    `Failure reason: ${params.reason}`,
    "Re-analyze this as a scheduling request.",
    "Produce a concrete create_schedule or cancel_schedule action with a valid run_at or cron value.",
    "Only ask a clarification question if a required time expression or delivery target is truly missing.",
    "Do not return a success receipt unless a schedule action can actually be executed.",
  ].join("\n\n")
}

function getString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined
}

function isDelegatedRunStartResult(value: unknown): value is DelegatedRunStartResult {
  return typeof value === "object" && value !== null &&
    ("finished" in value || "runId" in value)
}
