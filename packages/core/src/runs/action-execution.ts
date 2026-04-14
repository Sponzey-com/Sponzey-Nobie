import crypto from "node:crypto"
import { getSchedule, insertSchedule, updateSchedule, upsertScheduleMemoryEntry } from "../db/index.js"
import { getConfig } from "../config/index.js"
import { storeMemorySync } from "../memory/store.js"
import type {
  TaskExecutionSemantics,
  TaskIntakeActionItem,
  TaskIntakeResult,
  TaskIntentEnvelope,
  TaskStructuredRequest,
} from "../agent/intake.js"
import { isValidCron, isValidTimeZone, normalizeScheduleTimezone } from "../scheduler/cron.js"
import {
  reconcileScheduleExecution,
  removeManagedScheduleExecution,
  type ScheduleExecutionDriver,
} from "../scheduler/system-cron.js"
import type { AgentContextMode } from "../agent/index.js"
import type { RunChunkDeliveryHandler } from "./delivery.js"
import { buildScheduledFollowupPrompt, extractDirectChannelDeliveryText, getScheduledRunExecutionOptions } from "./scheduled.js"
import { buildStructuredExecutionBrief } from "./request-prompt.js"
import type { TaskProfile } from "./types.js"

export interface ScheduleActionExecutionResult {
  ok: boolean
  message: string
  detail: string
  successCount: number
  failureCount: number
  receipts: ScheduleActionReceipt[]
}

export type ScheduleActionReceipt =
  | {
      kind: "schedule_create_one_time"
      title: string
      task: string
      runAtMs: number
      scheduleText: string
      source: "webui" | "cli" | "telegram" | "slack"
      destination: string
      taskProfile: TaskProfile
      directDelivery: boolean
      preferredTarget: string
      immediateCompletionText?: string
    }
  | {
      kind: "schedule_create_recurring"
      scheduleId: string
      title: string
      task: string
      cron: string
      scheduleText: string
      timezone?: string
      source: "webui" | "cli" | "telegram" | "slack"
      targetSessionId?: string
      originRunId: string
      originRequestGroupId: string
      driver: ScheduleExecutionDriver
      driverReason?: string
    }
  | {
      kind: "schedule_cancel"
      cancelledScheduleIds: string[]
      cancelledNames: string[]
    }

export interface ScheduleDelayedRunRequest {
  runAtMs: number
  message: string
  sessionId: string
  originRunId?: string
  originRequestGroupId?: string
  model: string | undefined
  originalRequest?: string
  executionSemantics?: TaskExecutionSemantics
  structuredRequest?: TaskStructuredRequest
  intentEnvelope?: TaskIntentEnvelope
  workDir?: string
  source: "webui" | "cli" | "telegram" | "slack"
  onChunk: RunChunkDeliveryHandler | undefined
  immediateCompletionText?: string
  preferredTarget?: string
  taskProfile?: TaskProfile
  toolsEnabled?: boolean
  contextMode?: AgentContextMode
}

export interface ScheduleActionExecutionParams {
  runId: string
  message: string
  originalRequest: string
  sessionId: string
  requestGroupId: string
  model: string | undefined
  workDir?: string | undefined
  source: "webui" | "cli" | "telegram" | "slack"
  onChunk: RunChunkDeliveryHandler | undefined
}

export interface ScheduleActionDependencies {
  scheduleDelayedRun: (params: ScheduleDelayedRunRequest) => void
  createRecurringSchedule: (params: {
    title: string
    task: string
    cron: string
    timezone?: string
    source: "webui" | "cli" | "telegram" | "slack"
    sessionId: string
    originRunId: string
    originRequestGroupId: string
    model: string | undefined
  }) => {
    scheduleId: string
    targetSessionId?: string
    driver: ScheduleExecutionDriver
    reason?: string | undefined
  }
  cancelSchedules: (scheduleIds: string[]) => string[]
}

function defaultScheduleActionReceipts(): ScheduleActionReceipt[] {
  return []
}

function describeDefaultScheduleDestination(source: ScheduleActionExecutionParams["source"]): string {
  return source === "telegram" || source === "slack" ? `${source} current session` : `${source} current session`
}

export function createDefaultScheduleActionDependencies(
  overrides: Pick<ScheduleActionDependencies, "scheduleDelayedRun">,
): ScheduleActionDependencies {
  return {
    scheduleDelayedRun: overrides.scheduleDelayedRun,
    createRecurringSchedule: (params) => {
      const now = Date.now()
      const scheduleId = crypto.randomUUID()
      const targetSessionId = params.source === "telegram" || params.source === "slack" ? params.sessionId : undefined
      const config = getConfig()
      const timezone = normalizeScheduleTimezone(params.timezone, config.scheduler.timezone || config.profile.timezone)
      insertSchedule({
        id: scheduleId,
        name: params.title,
        cron_expression: params.cron,
        timezone,
        prompt: params.task,
        enabled: 1,
        target_channel: params.source === "telegram" ? "telegram" : params.source === "slack" ? "slack" : "agent",
        target_session_id: targetSessionId ?? null,
        execution_driver: "internal",
        origin_run_id: params.originRunId,
        origin_request_group_id: params.originRequestGroupId,
        model: params.model ?? null,
        max_retries: 3,
        timeout_sec: 300,
        created_at: now,
        updated_at: now,
      })
      upsertScheduleMemoryEntry({
        scheduleId,
        prompt: params.task,
        ...(targetSessionId ? { sessionId: targetSessionId } : {}),
        requestGroupId: params.originRequestGroupId,
        title: params.title,
        cronExpression: params.cron,
        enabled: true,
        metadata: {
          source: params.source,
          timezone,
          originRunId: params.originRunId,
          originRequestGroupId: params.originRequestGroupId,
          targetChannel: params.source === "telegram" ? "telegram" : params.source === "slack" ? "slack" : "agent",
        },
      })
      storeMemorySync({
        content: [
          `예약 이름: ${params.title}`,
          `예약 주기: ${params.cron}`,
          `예약 시간대: ${timezone}`,
          `실행 내용: ${params.task}`,
          `전달 채널: ${params.source}`,
        ].join("\n"),
        scope: "schedule",
        scheduleId,
        requestGroupId: scheduleId,
        type: "project_note",
        importance: "medium",
      })
      const execution = reconcileScheduleExecution(scheduleId)
      return {
        scheduleId,
        ...(targetSessionId ? { targetSessionId } : {}),
        ...execution,
      }
    },
    cancelSchedules: (scheduleIds) => {
      const cancelledNames: string[] = []
      for (const scheduleId of scheduleIds) {
        const schedule = getSchedule(scheduleId)
        if (!schedule) continue
        updateSchedule(scheduleId, { enabled: 0 })
        upsertScheduleMemoryEntry({
          scheduleId,
          prompt: schedule.prompt,
          ...(schedule.target_session_id ? { sessionId: schedule.target_session_id } : {}),
          ...(schedule.origin_request_group_id ? { requestGroupId: schedule.origin_request_group_id } : {}),
          title: schedule.name,
          cronExpression: schedule.cron_expression,
          enabled: false,
          metadata: {
            cancelledAt: Date.now(),
            ...(schedule.timezone ? { timezone: schedule.timezone } : {}),
          },
        })
        removeManagedScheduleExecution(scheduleId)
        cancelledNames.push(schedule.name)
      }
      return cancelledNames
    },
  }
}

export function inferDelegatedTaskProfile(params: {
  intake: TaskIntakeResult
  action: TaskIntakeActionItem
}): string {
  const payload = params.action.payload
  const explicit = getString(payload.task_profile) || getString(payload.taskProfile)
  if (explicit) return explicit
  return normalizeTaskProfile(params.intake.intent.category === "schedule_request" ? "operations" : "general_chat")
}

export function buildFollowupPrompt(params: {
  originalMessage: string
  intake: TaskIntakeResult
  action: TaskIntakeActionItem
  taskProfile: string
}): string {
  const payload = params.action.payload
  const goal = getString(payload.goal) || params.action.title
  const context = getString(payload.context) || params.intake.intent.summary || params.originalMessage
  const successCriteria = toStringList(payload.success_criteria)
  const constraints = toStringList(payload.constraints)
  const preferredTarget =
    getString(payload.preferred_target)
    || getString(payload.preferredTarget)
    || params.intake.intent_envelope.preferred_target
  const requiresFilesystemMutation = params.intake.intent_envelope.execution_semantics.filesystemEffect === "mutate"

  return buildStructuredExecutionBrief({
    header: "[Task Execution Brief]",
    originalRequest: params.originalMessage,
    structuredRequest: {
      ...params.intake.structured_request,
      target: params.intake.intent_envelope.target.trim() || goal,
      to: params.intake.intent_envelope.destination.trim() || params.intake.structured_request.to,
      context: params.intake.intent_envelope.context.length > 0
        ? params.intake.intent_envelope.context
        : [context],
      normalized_english:
        params.intake.intent_envelope.normalized_english.trim()
        || params.intake.structured_request.normalized_english.trim(),
      complete_condition: params.intake.intent_envelope.complete_condition.length > 0
        ? params.intake.intent_envelope.complete_condition
        : params.intake.structured_request.complete_condition,
    },
    executionSemantics: params.intake.intent_envelope.execution_semantics,
    extraSections: [
      `작업 프로필: ${params.taskProfile}`,
      preferredTarget ? `선호 대상: ${preferredTarget}` : "",
      successCriteria.length > 0 ? ["성공 조건:", ...successCriteria.map((item) => `- ${item}`)].join("\n") : "",
      constraints.length > 0 ? ["제약 사항:", ...constraints.map((item) => `- ${item}`)].join("\n") : "",
    ].filter(Boolean),
    closingLines: [
      "사용자가 지정한 이름, 따옴표 안 문자열, 파일명, 폴더명, 경로, 언어를 그대로 유지하세요. 폴더명 같은 리터럴을 번역하지 마세요.",
      "최종 답변은 원래 사용자 요청과 같은 언어로 작성하세요. 사용자가 번역을 요청하지 않았다면 언어를 바꾸지 마세요.",
      requiresFilesystemMutation
        ? "이 요청은 실제 로컬 파일 또는 폴더 변경이 필요합니다. 로컬 도구를 사용해 실제로 생성하거나 수정하세요. 코드 조각, 설명문, 수동 안내만 남기고 끝내지 마세요."
        : "지금 실제 작업을 수행하세요. 다시 intake 접수 메시지를 만들지 말고, 실제 결과를 만들어 내세요.",
    ],
  })
}

export function executeScheduleActions(
  actions: TaskIntakeActionItem[],
  intake: TaskIntakeResult,
  params: ScheduleActionExecutionParams,
  dependencies: ScheduleActionDependencies,
): ScheduleActionExecutionResult {
  if (actions.length === 0) {
    const receipt = intake.user_message.text.trim()
    return {
      ok: false,
      message: receipt || "일정 요청을 해석했지만 생성할 스케줄 정보가 부족합니다.",
      detail: "일정 생성 항목이 없습니다.",
      successCount: 0,
      failureCount: 1,
      receipts: defaultScheduleActionReceipts(),
    }
  }

  if (actions.length === 1) {
    return executeScheduleAction(actions[0], intake, params, intake.user_message.text.trim(), dependencies)
  }

  const results = actions.map((action) => executeScheduleAction(action, intake, params, "", dependencies))
  const receipt = intake.user_message.text.trim() || "여러 예약 작업을 접수했습니다."
  const hasCreate = actions.some((action) => action.type === "create_schedule")
  const heading = results.every((result) => result.ok)
    ? hasCreate ? "일정 요청을 처리했습니다." : "예약 변경을 처리했습니다."
    : hasCreate ? "일부 일정 생성에 실패했습니다." : "일부 예약 변경에 실패했습니다."

  return {
    ok: results.every((result) => result.ok),
    message: [receipt, "", heading, ...results.map((result) => `- ${result.detail}`)].join("\n"),
    detail: results.map((result) => result.detail).join(" / "),
    successCount: results.filter((result) => result.ok).length,
    failureCount: results.filter((result) => !result.ok).length,
    receipts: results.flatMap((result) => result.receipts),
  }
}

function executeScheduleAction(
  action: TaskIntakeActionItem | undefined,
  intake: TaskIntakeResult,
  params: ScheduleActionExecutionParams,
  receipt: string,
  dependencies: ScheduleActionDependencies,
): ScheduleActionExecutionResult {
  if (!action || action.type === "create_schedule") {
    return executeCreateScheduleAction(action, intake, params, receipt, dependencies)
  }
  if (action.type === "cancel_schedule") {
    return executeCancelScheduleAction(action, intake, receipt, dependencies)
  }

  return {
    ok: false,
    message: receipt || "현재 이 일정 요청 유형은 아직 처리할 수 없습니다.",
    detail: action.title,
    successCount: 0,
    failureCount: 1,
    receipts: defaultScheduleActionReceipts(),
  }
}

function executeCreateScheduleAction(
  action: TaskIntakeActionItem | undefined,
  intake: TaskIntakeResult,
  params: ScheduleActionExecutionParams,
  receipt: string,
  dependencies: ScheduleActionDependencies,
): ScheduleActionExecutionResult {
  if (!action) {
    return {
      ok: false,
      message: receipt || "일정 요청을 해석했지만 생성할 스케줄 정보가 부족합니다.",
      detail: "일정 생성 정보가 부족합니다.",
      successCount: 0,
      failureCount: 1,
      receipts: defaultScheduleActionReceipts(),
    }
  }

  const title = getString(action.payload.title) || "Scheduled Task"
  const task = getString(action.payload.task) || intake.intent.summary || title
  const cron = getString(action.payload.cron) || intake.scheduling.cron
  const runAt = getString(action.payload.run_at) || intake.scheduling.run_at
  const actionScheduleText = getString(action.payload.schedule_text)
  const timezone = getString(action.payload.timezone)

  if (runAt) {
    const scheduledAt = Date.parse(runAt)
    if (Number.isNaN(scheduledAt)) {
      return {
        ok: false,
        message: receipt
          ? `${receipt}\n\n일정 생성 실패: run_at 형식이 올바르지 않습니다.`
          : "일정 생성 실패: run_at 형식이 올바르지 않습니다.",
        detail: `${actionScheduleText ?? title}: run_at 형식이 올바르지 않습니다.`,
        successCount: 0,
        failureCount: 1,
        receipts: defaultScheduleActionReceipts(),
      }
    }

    const followup = getFollowupRunPayload(action)
    const immediateCompletionText = followup.literalText ?? extractDirectChannelDeliveryText(task)
    const scheduledTaskProfile = normalizeTaskProfile(followup.taskProfile ?? "general_chat")
    const executionOptions = getScheduledRunExecutionOptions(task, scheduledTaskProfile)
    dependencies.scheduleDelayedRun({
      runAtMs: scheduledAt,
      message: buildScheduledFollowupPrompt({
        task,
        goal: followup.goal ?? task,
        taskProfile: scheduledTaskProfile,
        preferredTarget: followup.preferredTarget ?? intake.intent_envelope.preferred_target,
        toolsEnabled: executionOptions.toolsEnabled,
        destination: followup.destination ?? intake.intent_envelope.destination,
      }),
      sessionId: params.sessionId,
      originRunId: params.runId,
      originRequestGroupId: params.requestGroupId,
      model: params.model,
      originalRequest: params.originalRequest,
      executionSemantics: intake.intent_envelope.execution_semantics,
      structuredRequest: intake.structured_request,
      intentEnvelope: intake.intent_envelope,
      source: params.source,
      onChunk: params.onChunk,
      ...(immediateCompletionText ? { immediateCompletionText } : {}),
      toolsEnabled: executionOptions.toolsEnabled,
      contextMode: executionOptions.contextMode,
      ...(params.workDir ? { workDir: params.workDir } : {}),
      ...(followup.preferredTarget ? { preferredTarget: followup.preferredTarget } : {}),
      taskProfile: scheduledTaskProfile,
    })

    const scheduleText = actionScheduleText || new Date(scheduledAt).toLocaleString("ko-KR")
    const destination = followup.destination ?? intake.intent_envelope.destination ?? describeDefaultScheduleDestination(params.source)
    return {
      ok: true,
      message: receipt
        ? `${receipt}\n\n일회성 예약 실행이 저장되었습니다.\n- 이름: ${title}\n- 실행 시각: ${scheduleText}`
        : `일회성 예약 실행이 저장되었습니다.\n- 이름: ${title}\n- 실행 시각: ${scheduleText}`,
      detail: `${scheduleText}: ${task}`,
      successCount: 1,
      failureCount: 0,
      receipts: [{
        kind: "schedule_create_one_time",
        title,
        task,
        runAtMs: scheduledAt,
        scheduleText,
        source: params.source,
        destination,
        taskProfile: scheduledTaskProfile,
        directDelivery: Boolean(immediateCompletionText),
        preferredTarget: followup.preferredTarget ?? intake.intent_envelope.preferred_target,
        ...(immediateCompletionText ? { immediateCompletionText } : {}),
      }],
    }
  }

  if (!cron || !isValidCron(cron)) {
    const reason = intake.scheduling.failure_reason
      ?? "현재 실행 브리지에서는 유효한 cron 일정이 필요합니다."
    return {
      ok: false,
      message: receipt
        ? `${receipt}\n\n일정 생성 실패: ${reason}`
        : `일정 생성 실패: ${reason}`,
      detail: `${actionScheduleText ?? title}: ${reason}`,
      successCount: 0,
      failureCount: 1,
      receipts: defaultScheduleActionReceipts(),
    }
  }
  if (timezone && !isValidTimeZone(timezone)) {
    return {
      ok: false,
      message: receipt
        ? `${receipt}\n\n일정 생성 실패: timezone 형식이 올바르지 않습니다.`
        : "일정 생성 실패: timezone 형식이 올바르지 않습니다.",
      detail: `${actionScheduleText ?? title}: timezone 형식이 올바르지 않습니다.`,
      successCount: 0,
      failureCount: 1,
      receipts: defaultScheduleActionReceipts(),
    }
  }

  const executionSync = dependencies.createRecurringSchedule({
    title,
    task,
    cron,
    ...(timezone ? { timezone } : {}),
    source: params.source,
    sessionId: params.sessionId,
    originRunId: params.runId,
    originRequestGroupId: params.requestGroupId,
    model: params.model,
  })
  const scheduleText = actionScheduleText || cron
  const driverLabel = executionSync.reason
    ? `내부 scheduler (${executionSync.reason})`
    : executionSync.driver === "internal"
      ? "내부 scheduler"
      : "시스템 스케줄러"

  return {
    ok: true,
    message: receipt
      ? `${receipt}\n\n스케줄이 저장되었습니다.\n- 이름: ${title}\n- 일정: ${scheduleText}\n- 실행 방식: ${driverLabel}`
      : `스케줄이 저장되었습니다.\n- 이름: ${title}\n- 일정: ${scheduleText}\n- 실행 방식: ${driverLabel}`,
    detail: `${scheduleText}: ${task}`,
    successCount: 1,
    failureCount: 0,
    receipts: [{
      kind: "schedule_create_recurring",
      scheduleId: executionSync.scheduleId,
      title,
      task,
      cron,
      scheduleText,
      ...(timezone ? { timezone } : {}),
      source: params.source,
      ...(executionSync.targetSessionId ? { targetSessionId: executionSync.targetSessionId } : {}),
      originRunId: params.runId,
      originRequestGroupId: params.requestGroupId,
      driver: executionSync.driver,
      ...(executionSync.reason ? { driverReason: executionSync.reason } : {}),
    }],
  }
}

function executeCancelScheduleAction(
  action: TaskIntakeActionItem,
  intake: TaskIntakeResult,
  receipt: string,
  dependencies: ScheduleActionDependencies,
): ScheduleActionExecutionResult {
  const scheduleIds = Array.isArray(action.payload.schedule_ids)
    ? action.payload.schedule_ids.filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    : []

  if (scheduleIds.length === 0) {
    return {
      ok: false,
      message: receipt || "취소할 예약 알림을 찾지 못했습니다.",
      detail: "취소 대상 스케줄 ID가 없습니다.",
      successCount: 0,
      failureCount: 1,
      receipts: defaultScheduleActionReceipts(),
    }
  }

  const cancelledNames = dependencies.cancelSchedules(scheduleIds)
  if (cancelledNames.length === 0) {
    return {
      ok: false,
      message: receipt || "취소할 예약 알림을 찾지 못했습니다.",
      detail: "활성 예약 알림을 찾지 못했습니다.",
      successCount: 0,
      failureCount: 1,
      receipts: defaultScheduleActionReceipts(),
    }
  }

  const summary = cancelledNames.length === 1
    ? `"${cancelledNames[0]}" 예약 알림을 취소했습니다.`
    : `${cancelledNames.length}개의 예약 알림을 취소했습니다.\n- ${cancelledNames.join("\n- ")}`

  return {
    ok: true,
    message: receipt ? `${receipt}\n\n${summary}` : summary,
    detail: cancelledNames.join(", "),
    successCount: cancelledNames.length,
    failureCount: 0,
    receipts: [{
      kind: "schedule_cancel",
      cancelledScheduleIds: scheduleIds,
      cancelledNames,
    }],
  }
}

function getFollowupRunPayload(action: TaskIntakeActionItem): {
  goal?: string
  literalText?: string
  destination?: string
  taskProfile?: string
  preferredTarget?: string
} {
  const payload = action.payload.followup_run_payload
  if (!payload || typeof payload !== "object") {
    return {}
  }

  const record = payload as Record<string, unknown>
  const goal = getString(record.goal)
  const literalText = getString(record.literal_text) || getString(record.literalText)
  const destination = getString(record.destination)
  const taskProfile = getString(record.task_profile) || getString(record.taskProfile)
  const preferredTarget = getString(record.preferred_target) || getString(record.preferredTarget)

  return {
    ...(goal ? { goal } : {}),
    ...(literalText ? { literalText } : {}),
    ...(destination ? { destination } : {}),
    ...(taskProfile ? { taskProfile } : {}),
    ...(preferredTarget ? { preferredTarget } : {}),
  }
}

function getString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined
}

function normalizeTaskProfile(taskProfile: string | undefined): TaskProfile {
  switch (taskProfile) {
    case "planning":
    case "coding":
    case "review":
    case "research":
    case "private_local":
    case "summarization":
    case "operations":
      return taskProfile
    default:
      return "general_chat"
  }
}

function toStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
}
