import type { LLMProvider } from "../llm/index.js"
import {
  analyzeTaskIntake,
  type TaskExecutionSemantics,
  type TaskIntentEnvelope,
  type TaskStructuredRequest,
} from "../agent/intake.js"
import type { AgentContextMode } from "../agent/index.js"
import { resolveRunRoute } from "./routing.js"
import {
  buildDelegatedReceipt,
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

export interface DelegatedRunStartParams {
  message: string
  sessionId: string
  taskProfile: TaskProfile
  requestGroupId: string
  originalRequest: string
  executionSemantics: TaskExecutionSemantics
  structuredRequest: TaskStructuredRequest
  intentEnvelope: TaskIntentEnvelope
  model?: string | undefined
  providerId?: string | undefined
  provider?: LLMProvider | undefined
  workerRuntime?: WorkerRuntimeTarget | undefined
  targetId?: string | undefined
  targetLabel?: string | undefined
  workDir: string
  source: "webui" | "cli" | "telegram"
  skipIntake?: boolean | undefined
  toolsEnabled?: boolean | undefined
  contextMode?: AgentContextMode | undefined
  onChunk?: RunChunkDeliveryHandler
}

interface IntakeBridgePassDependencies {
  appendRunEvent: (runId: string, message: string) => void
  updateRunSummary: (runId: string, summary: string) => void
  incrementDelegationTurnCount: (runId: string, summary: string) => void
  scheduleDelayedRun: (params: ScheduleDelayedRunRequest) => void
  startDelegatedRun: (params: DelegatedRunStartParams) => void
  normalizeTaskProfile: (taskProfile: string | undefined) => TaskProfile
  logInfo: (message: string, payload: Record<string, unknown>) => void
}

interface IntakeBridgePassModuleDependencies {
  analyzeTaskIntake: typeof analyzeTaskIntake
  resolveRunRoute: typeof resolveRunRoute
  executeScheduleActions: typeof executeScheduleActions
  createDefaultScheduleActionDependencies: typeof createDefaultScheduleActionDependencies
  buildDelegatedReceipt: typeof buildDelegatedReceipt
  inferDelegatedTaskProfile: typeof inferDelegatedTaskProfile
  buildFollowupPrompt: typeof buildFollowupPrompt
}

const defaultModuleDependencies: IntakeBridgePassModuleDependencies = {
  analyzeTaskIntake,
  resolveRunRoute,
  executeScheduleActions,
  createDefaultScheduleActionDependencies,
  buildDelegatedReceipt,
  inferDelegatedTaskProfile,
  buildFollowupPrompt,
}

export async function runIntakeBridgePass(
  params: {
    message: string
    originalRequest: string
    sessionId: string
    requestGroupId: string
    model: string | undefined
    workDir: string
    source: "webui" | "cli" | "telegram"
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
    }

    if (delegatedActions.length > 0) {
      const delegatedReceipt = moduleDependencies.buildDelegatedReceipt(intake, delegatedActions, responseParts.length > 0)
      if (delegatedReceipt) responseParts.push(delegatedReceipt)
    }

    for (const delegatedAction of delegatedActions) {
      const delegatedTaskProfile = moduleDependencies.inferDelegatedTaskProfile({
        intake,
        action: delegatedAction,
      })
      const followupPrompt = moduleDependencies.buildFollowupPrompt({
        originalMessage: params.originalRequest,
        intake,
        action: delegatedAction,
        taskProfile: delegatedTaskProfile,
      })
      const route = moduleDependencies.resolveRunRoute({
        preferredTarget:
          getString(delegatedAction.payload.preferred_target)
          || getString(delegatedAction.payload.preferredTarget)
          || intake.intent_envelope.preferred_target,
        taskProfile: delegatedTaskProfile,
        fallbackModel: params.model,
      })

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
        workerRuntime: route.workerRuntime?.kind ?? null,
      })
      dependencies.incrementDelegationTurnCount(params.runId, `${delegatedAction.title} 후속 작업을 시작합니다.`)

      dependencies.startDelegatedRun({
        message: followupPrompt,
        sessionId: params.sessionId,
        taskProfile: dependencies.normalizeTaskProfile(delegatedTaskProfile),
        requestGroupId: params.requestGroupId,
        originalRequest: params.message,
        executionSemantics: intake.intent_envelope.execution_semantics,
        structuredRequest: intake.structured_request,
        intentEnvelope: intake.intent_envelope,
        model: route.model ?? params.model,
        ...(route.providerId ? { providerId: route.providerId } : {}),
        ...(route.provider ? { provider: route.provider } : {}),
        ...(route.workerRuntime ? { workerRuntime: route.workerRuntime } : {}),
        ...(route.targetId ? { targetId: route.targetId } : {}),
        ...(route.targetLabel ? { targetLabel: route.targetLabel } : {}),
        workDir: params.workDir,
        source: params.source,
        skipIntake: true,
        onChunk: params.onChunk,
      })
    }

    if (responseParts.length > 0) {
      return {
        kind: "complete",
        text: responseParts.join("\n\n"),
        eventLabel: "intake 처리 결과 전달",
      }
    }

    if (delegatedActions.length > 0) {
      return {
        kind: "complete",
        text: "후속 실행을 시작했습니다.",
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
