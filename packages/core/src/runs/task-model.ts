import type { RootRun, RunStatus } from "./types.js"

export type TaskAttemptKind =
  | "primary"
  | "followup"
  | "intake_bridge"
  | "approval_continuation"
  | "verification"
  | "filesystem_retry"
  | "truncated_recovery"
  | "scheduled_execution"

export type TaskRecoveryKind = "filesystem" | "truncated_output" | "generic"

export type TaskDeliveryStatus = "not_requested" | "pending" | "delivered" | "failed"

export type TaskActivityKind =
  | "attempt.started"
  | "attempt.awaiting_approval"
  | "attempt.awaiting_user"
  | "attempt.completed"
  | "attempt.failed"
  | "attempt.cancelled"
  | "recovery.started"
  | "recovery.awaiting_approval"
  | "recovery.awaiting_user"
  | "recovery.completed"
  | "recovery.failed"
  | "recovery.cancelled"
  | "delivery.pending"
  | "delivery.delivered"
  | "delivery.failed"

export interface TaskAttemptModel {
  id: string
  taskId: string
  requestGroupId: string
  kind: TaskAttemptKind
  title: string
  prompt: string
  status: RunStatus
  summary: string
  userVisible: boolean
  createdAt: number
  updatedAt: number
}

export interface TaskRecoveryAttemptModel {
  id: string
  taskId: string
  sourceAttemptId?: string
  kind: TaskRecoveryKind
  status: RunStatus
  summary: string
  userVisible: boolean
  createdAt: number
  updatedAt: number
}

export interface TaskDeliveryModel {
  taskId: string
  status: TaskDeliveryStatus
  sourceAttemptId?: string
  channel?: "telegram" | "webui" | "cli" | "unknown"
  summary?: string
}

export interface TaskActivityModel {
  id: string
  taskId: string
  kind: TaskActivityKind
  at: number
  summary: string
  attemptId?: string
  attemptKind?: TaskAttemptKind
  recoveryKind?: TaskRecoveryKind
  runStatus?: RunStatus
}

export interface TaskMonitorModel {
  activeAttemptCount: number
  runningAttemptCount: number
  queuedAttemptCount: number
  visibleAttemptCount: number
  internalAttemptCount: number
  recoveryAttemptCount: number
  activeRecoveryCount: number
  duplicateExecutionRisk: boolean
  awaitingApproval: boolean
  awaitingUser: boolean
  deliveryStatus: TaskDeliveryStatus
}

export interface TaskModel {
  id: string
  requestGroupId: string
  sessionId: string
  source: RootRun["source"]
  anchorRunId: string
  latestAttemptId: string
  runIds: string[]
  title: string
  requestText: string
  summary: string
  status: RunStatus
  canCancel: boolean
  createdAt: number
  updatedAt: number
  attempts: TaskAttemptModel[]
  recoveryAttempts: TaskRecoveryAttemptModel[]
  delivery: TaskDeliveryModel
  monitor: TaskMonitorModel
  activities: TaskActivityModel[]
}

const ACTIVE_RUN_STATUSES: RunStatus[] = ["queued", "running", "awaiting_approval", "awaiting_user"]

function extractPromptField(prompt: string, field: string): string | undefined {
  const match = prompt.match(new RegExp(`^${field}:\\s*(.+)$`, "im"))
  return match?.[1]?.trim() || undefined
}

function isInternalRunPrompt(prompt: string): boolean {
  return prompt.trim().startsWith("[")
}

function classifyAttemptKind(run: RootRun, index: number): TaskAttemptKind {
  const prompt = run.prompt.trim()
  if (prompt.startsWith("[Task Intake Bridge]")) return "intake_bridge"
  if (prompt.startsWith("[Approval Granted Continuation]")) return "approval_continuation"
  if (prompt.startsWith("[Filesystem Verification]")) return "verification"
  if (prompt.startsWith("[Filesystem Execution Required]")) return "filesystem_retry"
  if (prompt.startsWith("[Truncated Output Recovery]")) return "truncated_recovery"
  if (prompt.startsWith("[Scheduled Task]")) return "scheduled_execution"
  return index === 0 ? "primary" : "followup"
}

function isUserVisibleAttemptKind(kind: TaskAttemptKind): boolean {
  switch (kind) {
    case "primary":
    case "followup":
    case "scheduled_execution":
      return true
    default:
      return false
  }
}

function isRecoveryAttemptKind(kind: TaskAttemptKind): boolean {
  return kind === "filesystem_retry" || kind === "truncated_recovery"
}

function mapRecoveryKind(kind: TaskAttemptKind): TaskRecoveryKind {
  switch (kind) {
    case "filesystem_retry":
      return "filesystem"
    case "truncated_recovery":
      return "truncated_output"
    default:
      return "generic"
  }
}

function computeTaskStatus(groupRuns: RootRun[]): RunStatus {
  const statuses = groupRuns.map((run) => run.status)
  if (statuses.includes("awaiting_approval")) return "awaiting_approval"
  if (statuses.includes("awaiting_user")) return "awaiting_user"
  if (statuses.includes("running")) return "running"
  if (statuses.includes("queued")) return "queued"
  if (statuses.includes("failed")) return "failed"
  if (statuses.every((status) => status === "completed")) return "completed"
  if (statuses.includes("interrupted")) return "interrupted"
  if (statuses.includes("cancelled")) return "cancelled"
  return groupRuns[0]?.status ?? "queued"
}

function computeTaskSummary(groupRuns: RootRun[]): string {
  const activeRun = groupRuns
    .filter((run) => ACTIVE_RUN_STATUSES.includes(run.status))
    .sort((a, b) => b.updatedAt - a.updatedAt)[0]
  if (activeRun?.summary?.trim()) return activeRun.summary.trim()
  const latestRun = [...groupRuns].sort((a, b) => b.updatedAt - a.updatedAt)[0]
  return latestRun?.summary?.trim() || latestRun?.prompt?.trim() || ""
}

function computeTaskRequest(groupRuns: RootRun[]): string {
  const latestUserFacingRun = [...groupRuns]
    .sort((a, b) => b.createdAt - a.createdAt)
    .find((run) => run.prompt.trim().length > 0 && !isInternalRunPrompt(run.prompt))

  if (latestUserFacingRun?.prompt.trim()) return latestUserFacingRun.prompt.trim()

  const anchorRun = [...groupRuns].sort((a, b) => a.createdAt - b.createdAt)[0]
  return anchorRun?.prompt?.trim() || ""
}

function detectDeliveryChannel(label: string): "telegram" | "webui" | "cli" | "unknown" {
  const normalized = label.toLowerCase()
  if (normalized.includes("텔레그램") || normalized.includes("telegram")) return "telegram"
  if (normalized.includes("webui")) return "webui"
  if (normalized.includes("cli")) return "cli"
  return "unknown"
}

interface TaskDeliverySignal {
  status: TaskDeliveryStatus
  sourceAttemptId?: string
  channel?: "telegram" | "webui" | "cli" | "unknown"
  summary?: string
  at?: number
  eventId?: string
}

function resolveTaskDeliverySignal(orderedRuns: RootRun[], attempts: TaskAttemptModel[]): TaskDeliverySignal {
  const sourceAttemptId = attempts.at(-1)?.id
  const recentEvents = orderedRuns
    .flatMap((run) => run.recentEvents)
    .reverse()

  const deliveredEvent = recentEvents.find((event) =>
    /(전달 완료|파일 전달 완료|응답 전달 완료|텍스트 전달 완료|message delivered|delivery complete)/i.test(event.label),
  )
  if (deliveredEvent) {
    return {
      status: "delivered",
      ...(sourceAttemptId ? { sourceAttemptId } : {}),
      channel: detectDeliveryChannel(deliveredEvent.label),
      summary: deliveredEvent.label,
      at: deliveredEvent.at,
      eventId: deliveredEvent.id,
    }
  }

  const failedEvent = recentEvents.find((event) =>
    /(전달.*실패|실패.*전달|완료 신호 전달에 실패|delivery failed)/i.test(event.label),
  )
  if (failedEvent) {
    return {
      status: "failed",
      ...(sourceAttemptId ? { sourceAttemptId } : {}),
      channel: detectDeliveryChannel(failedEvent.label),
      summary: failedEvent.label,
      at: failedEvent.at,
      eventId: failedEvent.id,
    }
  }

  const latestRun = [...orderedRuns].sort((a, b) => b.updatedAt - a.updatedAt)[0]
  const pendingDeliverySummary = latestRun
    && /(전달|메신저|telegram|webui|cli)/i.test(`${latestRun.summary}\n${latestRun.prompt}`)
    && ACTIVE_RUN_STATUSES.includes(latestRun.status)
    ? latestRun.summary.trim() || latestRun.prompt.trim()
    : undefined

  if (pendingDeliverySummary && latestRun) {
    return {
      status: "pending",
      ...(sourceAttemptId ? { sourceAttemptId } : {}),
      channel: detectDeliveryChannel(pendingDeliverySummary),
      summary: pendingDeliverySummary,
      at: latestRun.updatedAt,
    }
  }

  return {
    status: "not_requested",
    ...(sourceAttemptId ? { sourceAttemptId } : {}),
  }
}

function deriveTaskDelivery(taskId: string, orderedRuns: RootRun[], attempts: TaskAttemptModel[]): TaskDeliveryModel {
  const signal = resolveTaskDeliverySignal(orderedRuns, attempts)
  return {
    taskId,
    status: signal.status,
    ...(signal.sourceAttemptId ? { sourceAttemptId: signal.sourceAttemptId } : {}),
    ...(signal.channel ? { channel: signal.channel } : {}),
    ...(signal.summary ? { summary: signal.summary } : {}),
  }
}

function isRecoveryAttemptStatusActive(status: RunStatus): boolean {
  return ACTIVE_RUN_STATUSES.includes(status)
}

function resolveTaskActivityKind(status: RunStatus, recovery: boolean): TaskActivityKind | undefined {
  switch (status) {
    case "awaiting_approval":
      return recovery ? "recovery.awaiting_approval" : "attempt.awaiting_approval"
    case "awaiting_user":
      return recovery ? "recovery.awaiting_user" : "attempt.awaiting_user"
    case "completed":
      return recovery ? "recovery.completed" : "attempt.completed"
    case "failed":
      return recovery ? "recovery.failed" : "attempt.failed"
    case "cancelled":
    case "interrupted":
      return recovery ? "recovery.cancelled" : "attempt.cancelled"
    default:
      return undefined
  }
}

function buildTaskActivities(
  taskId: string,
  attempts: TaskAttemptModel[],
  orderedRuns: RootRun[],
): TaskActivityModel[] {
  const activities: TaskActivityModel[] = []

  for (const attempt of attempts) {
    const recovery = isRecoveryAttemptKind(attempt.kind)
    const recoveryKind = recovery ? mapRecoveryKind(attempt.kind) : undefined
    activities.push({
      id: `${attempt.id}:${recovery ? "recovery.started" : "attempt.started"}`,
      taskId,
      kind: recovery ? "recovery.started" : "attempt.started",
      at: attempt.createdAt,
      summary: attempt.summary || attempt.title,
      attemptId: attempt.id,
      attemptKind: attempt.kind,
      ...(recoveryKind ? { recoveryKind } : {}),
      runStatus: attempt.status,
    })

    const statusActivityKind = resolveTaskActivityKind(attempt.status, recovery)
    if (statusActivityKind) {
      activities.push({
        id: `${attempt.id}:${statusActivityKind}`,
        taskId,
        kind: statusActivityKind,
        at: attempt.updatedAt,
        summary: attempt.summary || attempt.title,
        attemptId: attempt.id,
        attemptKind: attempt.kind,
        ...(recoveryKind ? { recoveryKind } : {}),
        runStatus: attempt.status,
      })
    }
  }

  const deliverySignal = resolveTaskDeliverySignal(orderedRuns, attempts)
  if (deliverySignal.status !== "not_requested" && deliverySignal.at !== undefined) {
    activities.push({
      id: deliverySignal.eventId || `${taskId}:delivery:${deliverySignal.status}`,
      taskId,
      kind:
        deliverySignal.status === "pending"
          ? "delivery.pending"
          : deliverySignal.status === "delivered"
            ? "delivery.delivered"
            : "delivery.failed",
      at: deliverySignal.at,
      summary: deliverySignal.summary || deliverySignal.status,
      ...(deliverySignal.sourceAttemptId ? { attemptId: deliverySignal.sourceAttemptId } : {}),
    })
  }

  return activities.sort((a, b) => b.at - a.at)
}

function buildTaskMonitor(
  attempts: TaskAttemptModel[],
  recoveryAttempts: TaskRecoveryAttemptModel[],
  delivery: TaskDeliveryModel,
): TaskMonitorModel {
  const activeAttempts = attempts.filter((attempt) => ACTIVE_RUN_STATUSES.includes(attempt.status))
  return {
    activeAttemptCount: activeAttempts.length,
    runningAttemptCount: attempts.filter((attempt) => attempt.status === "running").length,
    queuedAttemptCount: attempts.filter((attempt) => attempt.status === "queued").length,
    visibleAttemptCount: attempts.filter((attempt) => attempt.userVisible).length,
    internalAttemptCount: attempts.filter((attempt) => !attempt.userVisible).length,
    recoveryAttemptCount: recoveryAttempts.length,
    activeRecoveryCount: recoveryAttempts.filter((attempt) => isRecoveryAttemptStatusActive(attempt.status)).length,
    duplicateExecutionRisk: activeAttempts.length > 1,
    awaitingApproval: activeAttempts.some((attempt) => attempt.status === "awaiting_approval"),
    awaitingUser: activeAttempts.some((attempt) => attempt.status === "awaiting_user"),
    deliveryStatus: delivery.status,
  }
}

export function buildTaskModels(runs: RootRun[]): TaskModel[] {
  const grouped = new Map<string, RootRun[]>()
  for (const run of runs) {
    const key = run.requestGroupId || run.id
    const existing = grouped.get(key)
    if (existing) existing.push(run)
    else grouped.set(key, [run])
  }

  const tasks: TaskModel[] = []

  for (const [, groupRuns] of grouped.entries()) {
    const orderedRuns = [...groupRuns].sort((a, b) => a.createdAt - b.createdAt)
    const latestRun = [...groupRuns].sort((a, b) => b.updatedAt - a.updatedAt)[0]
    const anchorRun = orderedRuns[0]
    if (!anchorRun || !latestRun) continue
    const taskId = anchorRun.requestGroupId || anchorRun.id

    const attempts: TaskAttemptModel[] = orderedRuns.map((run, index) => {
      const kind = classifyAttemptKind(run, index)
      return {
        id: run.id,
        taskId,
        requestGroupId: run.requestGroupId,
        kind,
        title:
          kind === "scheduled_execution"
            ? extractPromptField(run.prompt, "Task")
              || extractPromptField(run.prompt, "Goal")
              || run.title
            : run.title,
        prompt: run.prompt,
        status: run.status,
        summary: run.summary,
        userVisible: isUserVisibleAttemptKind(kind),
        createdAt: run.createdAt,
        updatedAt: run.updatedAt,
      }
    })

    const recoveryAttempts: TaskRecoveryAttemptModel[] = attempts
      .filter((attempt) => isRecoveryAttemptKind(attempt.kind))
      .map((attempt) => {
        const attemptIndex = attempts.findIndex((candidate) => candidate.id === attempt.id)
        const previousAttempt = attemptIndex > 0 ? attempts[attemptIndex - 1] : undefined
        return {
          id: attempt.id,
          taskId,
          ...(previousAttempt ? { sourceAttemptId: previousAttempt.id } : {}),
          kind: mapRecoveryKind(attempt.kind),
          status: attempt.status,
          summary: attempt.summary,
          userVisible: false,
          createdAt: attempt.createdAt,
          updatedAt: attempt.updatedAt,
        }
      })

    const delivery = deriveTaskDelivery(taskId, orderedRuns, attempts)
    const activities = buildTaskActivities(taskId, attempts, orderedRuns)

    tasks.push({
      id: taskId,
      requestGroupId: anchorRun.requestGroupId,
      sessionId: anchorRun.sessionId,
      source: anchorRun.source,
      anchorRunId: anchorRun.id,
      latestAttemptId: latestRun.id,
      runIds: orderedRuns.map((run) => run.id),
      title: anchorRun.title,
      requestText: computeTaskRequest(groupRuns),
      summary: computeTaskSummary(groupRuns),
      status: computeTaskStatus(groupRuns),
      canCancel: groupRuns.some((run) => run.canCancel && ACTIVE_RUN_STATUSES.includes(run.status)),
      createdAt: anchorRun.createdAt,
      updatedAt: latestRun.updatedAt,
      attempts,
      recoveryAttempts,
      delivery,
      monitor: buildTaskMonitor(attempts, recoveryAttempts, delivery),
      activities,
    })
  }

  return tasks.sort((a, b) => b.updatedAt - a.updatedAt)
}
