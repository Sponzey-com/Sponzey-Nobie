import { basename, resolve } from "node:path"
import { homedir } from "node:os"
import { buildArtifactApiUrls, guessArtifactMimeType } from "../artifacts/lifecycle.js"
import type { TaskContinuitySnapshot } from "../db/index.js"
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
export type TaskFailureKind = "execution" | "recovery" | "delivery"
export type TaskChecklistItemKey = "request" | "execution" | "delivery" | "completion"
export type TaskChecklistItemStatus = "pending" | "running" | "completed" | "failed" | "cancelled" | "not_required"

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
  channel?: "telegram" | "webui" | "slack" | "cli" | "unknown"
  summary?: string
  artifact?: TaskArtifactModel
}

export interface TaskArtifactModel {
  filePath?: string
  fileName: string
  url?: string
  mimeType?: string
}

export interface TaskFailureModel {
  kind: TaskFailureKind
  status: Extract<RunStatus, "failed" | "cancelled" | "interrupted">
  title: string
  summary: string
  detailLines: string[]
  sourceAttemptId?: string
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

export interface TaskChecklistItemModel {
  key: TaskChecklistItemKey
  status: TaskChecklistItemStatus
  summary?: string
}

export interface TaskChecklistModel {
  items: TaskChecklistItemModel[]
  completedCount: number
  actionableCount: number
  failedCount: number
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

export interface TaskContinuityModel {
  lineageRootRunId: string
  parentRunId?: string
  handoffSummary?: string
  lastGoodState?: string
  pendingApprovals: string[]
  pendingDelivery: string[]
  lastToolReceipt?: string
  lastDeliveryReceipt?: string
  failedRecoveryKey?: string
  failureKind?: string
  recoveryBudget?: string
  status?: string
  updatedAt: number
}

export interface TaskDiagnosticsModel {
  promptSourceIds: string[]
  promptSources: TaskPromptSourceDiagnosticModel[]
  promptSourceVersion?: string
  latencyEvents: string[]
  memoryEvents: string[]
  toolEvents: string[]
  deliveryEvents: string[]
  recoveryEvents: string[]
  lastRecoveryKey?: string
  recoveryBudget?: string
}

export interface TaskPromptSourceDiagnosticModel {
  sourceId: string
  locale?: string
  version?: string
  checksum?: string
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
  failure?: TaskFailureModel
  checklist: TaskChecklistModel
  monitor: TaskMonitorModel
  continuity?: TaskContinuityModel
  diagnostics?: TaskDiagnosticsModel
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

function computeTaskStatus(params: {
  groupRuns: RootRun[]
  attempts: TaskAttemptModel[]
  delivery: TaskDeliveryModel
}): RunStatus {
  const statuses = params.groupRuns.map((run) => run.status)
  const activeVisibleAttempts = params.attempts.filter((attempt) =>
    attempt.userVisible && ACTIVE_RUN_STATUSES.includes(attempt.status),
  )
  const activeAttempts = params.attempts.filter((attempt) => ACTIVE_RUN_STATUSES.includes(attempt.status))

  if (activeVisibleAttempts.some((attempt) => attempt.status === "awaiting_approval")) return "awaiting_approval"
  if (activeVisibleAttempts.some((attempt) => attempt.status === "awaiting_user")) return "awaiting_user"
  if (activeVisibleAttempts.some((attempt) => attempt.status === "running")) return "running"
  if (activeVisibleAttempts.some((attempt) => attempt.status === "queued")) return "queued"
  if (params.delivery.status === "delivered" && activeVisibleAttempts.length === 0) return "completed"
  if (activeAttempts.some((attempt) => attempt.status === "awaiting_approval")) return "awaiting_approval"
  if (activeAttempts.some((attempt) => attempt.status === "awaiting_user")) return "awaiting_user"
  if (activeAttempts.some((attempt) => attempt.status === "running")) return "running"
  if (activeAttempts.some((attempt) => attempt.status === "queued")) return "queued"
  if (statuses.includes("failed")) return "failed"
  if (statuses.every((status) => status === "completed")) return "completed"
  if (statuses.includes("interrupted")) return "interrupted"
  if (statuses.includes("cancelled")) return "cancelled"
  if (statuses.includes("awaiting_approval")) return "awaiting_approval"
  if (statuses.includes("awaiting_user")) return "awaiting_user"
  if (statuses.includes("running")) return "running"
  if (statuses.includes("queued")) return "queued"
  return params.groupRuns[0]?.status ?? "queued"
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

function detectDeliveryChannel(label: string): "telegram" | "webui" | "slack" | "cli" | "unknown" {
  const normalized = label.toLowerCase()
  if (normalized.includes("텔레그램") || normalized.includes("telegram")) return "telegram"
  if (normalized.includes("webui")) return "webui"
  if (normalized.includes("slack")) return "slack"
  if (normalized.includes("cli")) return "cli"
  return "unknown"
}

function mapRunStatusToChecklistStatus(status: RunStatus): TaskChecklistItemStatus {
  switch (status) {
    case "queued":
      return "pending"
    case "running":
    case "awaiting_approval":
    case "awaiting_user":
      return "running"
    case "completed":
      return "completed"
    case "cancelled":
    case "interrupted":
      return "cancelled"
    default:
      return "failed"
  }
}

function isExecutionAttemptKind(kind: TaskAttemptKind): boolean {
  switch (kind) {
    case "primary":
    case "followup":
    case "approval_continuation":
    case "scheduled_execution":
      return true
    default:
      return false
  }
}

function mapTerminalFailureStatus(status: TaskFailureModel["status"]): Extract<TaskChecklistItemStatus, "failed" | "cancelled"> {
  return status === "cancelled" || status === "interrupted" ? "cancelled" : "failed"
}

interface TaskDeliverySignal {
  status: TaskDeliveryStatus
  sourceAttemptId?: string
  channel?: "telegram" | "webui" | "slack" | "cli" | "unknown"
  summary?: string
  artifact?: TaskArtifactModel
  at?: number
  eventId?: string
}

function expandDisplayPath(value: string): string {
  if (value.startsWith("~/")) return resolve(homedir(), value.slice(2))
  return value
}

function guessMimeTypeFromPath(filePath: string): string | undefined {
  return guessArtifactMimeType(filePath)
}

function buildArtifactUrl(filePath: string): string | undefined {
  const expandedPath = expandDisplayPath(filePath)
  return buildArtifactApiUrls(expandedPath)?.previewUrl
}

function extractArtifactFromUrl(url: string): TaskArtifactModel | undefined {
  if (!url.startsWith("/api/artifacts/")) return undefined
  const pathWithoutQuery = url.split("?")[0] ?? url
  const fileName = decodeURIComponent(pathWithoutQuery.split("/").filter(Boolean).at(-1) ?? "artifact")
  const mimeType = guessMimeTypeFromPath(fileName)
  return {
    fileName,
    url,
    ...(mimeType ? { mimeType } : {}),
  }
}

function extractDeliveredArtifact(summary: string): TaskArtifactModel | undefined {
  const match = summary.match(/파일 전달 완료:\s*(.+)$/)
  const rawPath = match?.[1]?.trim()
  if (!rawPath) return undefined
  const urlArtifact = extractArtifactFromUrl(rawPath)
  if (urlArtifact) return urlArtifact
  const resolvedPath = expandDisplayPath(rawPath)
  const artifactUrl = buildArtifactUrl(resolvedPath)
  const mimeType = guessMimeTypeFromPath(resolvedPath)

  return {
    filePath: resolvedPath,
    fileName: basename(resolvedPath),
    ...(artifactUrl ? { url: artifactUrl } : {}),
    ...(mimeType ? { mimeType } : {}),
  }
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
    const deliveredArtifact = extractDeliveredArtifact(deliveredEvent.label)
    return {
      status: "delivered",
      ...(sourceAttemptId ? { sourceAttemptId } : {}),
      channel: detectDeliveryChannel(deliveredEvent.label),
      summary: deliveredEvent.label,
      ...(deliveredArtifact ? { artifact: deliveredArtifact } : {}),
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
    ...(signal.artifact ? { artifact: signal.artifact } : {}),
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

function mapContinuitySnapshot(snapshot: TaskContinuitySnapshot | undefined): TaskContinuityModel | undefined {
  if (!snapshot) return undefined
  return {
    lineageRootRunId: snapshot.lineageRootRunId,
    ...(snapshot.parentRunId ? { parentRunId: snapshot.parentRunId } : {}),
    ...(snapshot.handoffSummary ? { handoffSummary: snapshot.handoffSummary } : {}),
    ...(snapshot.lastGoodState ? { lastGoodState: snapshot.lastGoodState } : {}),
    pendingApprovals: snapshot.pendingApprovals,
    pendingDelivery: snapshot.pendingDelivery,
    ...(snapshot.lastToolReceipt ? { lastToolReceipt: snapshot.lastToolReceipt } : {}),
    ...(snapshot.lastDeliveryReceipt ? { lastDeliveryReceipt: snapshot.lastDeliveryReceipt } : {}),
    ...(snapshot.failedRecoveryKey ? { failedRecoveryKey: snapshot.failedRecoveryKey } : {}),
    ...(snapshot.failureKind ? { failureKind: snapshot.failureKind } : {}),
    ...(snapshot.recoveryBudget ? { recoveryBudget: snapshot.recoveryBudget } : {}),
    ...(snapshot.status ? { status: snapshot.status } : {}),
    updatedAt: snapshot.updatedAt,
  }
}

function extractPromptSourceIds(snapshot: Record<string, unknown> | undefined): string[] {
  return extractPromptSources(snapshot).map((source) => source.sourceId)
}

function extractPromptSources(snapshot: Record<string, unknown> | undefined): TaskPromptSourceDiagnosticModel[] {
  const sources = Array.isArray(snapshot?.sources) ? snapshot.sources : []
  return sources
    .map((source) => {
      if (!source || typeof source !== "object") return undefined
      const candidate = source as {
        sourceId?: unknown
        locale?: unknown
        version?: unknown
        checksum?: unknown
      }
      const sourceId = typeof candidate.sourceId === "string" ? candidate.sourceId.trim() : ""
      if (!sourceId) return undefined
      return {
        sourceId,
        ...(typeof candidate.locale === "string" && candidate.locale.trim() ? { locale: candidate.locale.trim() } : {}),
        ...(typeof candidate.version === "string" && candidate.version.trim() ? { version: candidate.version.trim() } : {}),
        ...(typeof candidate.checksum === "string" && candidate.checksum.trim() ? { checksum: candidate.checksum.trim() } : {}),
      }
    })
    .filter((value): value is TaskPromptSourceDiagnosticModel => Boolean(value))
}

function extractPromptSourceVersion(snapshot: Record<string, unknown> | undefined): string | undefined {
  const assemblyVersion = snapshot?.assemblyVersion
  return typeof assemblyVersion === "number" ? `assembly:${assemblyVersion}` : undefined
}

function buildTaskDiagnostics(
  orderedRuns: RootRun[],
  latestRun: RootRun,
  continuity: TaskContinuityModel | undefined,
): TaskDiagnosticsModel | undefined {
  const eventLabels = orderedRuns.flatMap((run) => run.recentEvents.map((event) => event.label.trim()).filter(Boolean))
  const latencyEvents = eventLabels.filter((label) => /(?:^|\b)(?:prompt|memory|first_chunk|preflight)[_a-z]*=\d+ms\b/i.test(label))
  const memoryEvents = eventLabels.filter((label) => /(?:memory|메모리|vector|벡터|index)/i.test(label))
  const toolEvents = eventLabels.filter((label) => /(?:tool|도구|실행 도구|tool receipt|last tool|lastToolReceipt)/i.test(label))
  const deliveryEvents = eventLabels.filter((label) => /(?:delivery|전달|telegram|slack|webui|artifact|파일 전달|last delivery|lastDeliveryReceipt)/i.test(label))
  const recoveryEvents = eventLabels.filter((label) => /(?:recovery|복구|재시도|duplicate|반복|중단|한도)/i.test(label))
  const promptSourceIds = extractPromptSourceIds(latestRun.promptSourceSnapshot)
  const promptSources = extractPromptSources(latestRun.promptSourceSnapshot)
  const promptSourceVersion = extractPromptSourceVersion(latestRun.promptSourceSnapshot)
  const lastRecoveryKey = continuity?.failedRecoveryKey
  const recoveryBudget = continuity?.recoveryBudget

  if (
    promptSourceIds.length === 0
    && !promptSourceVersion
    && latencyEvents.length === 0
    && memoryEvents.length === 0
    && toolEvents.length === 0
    && deliveryEvents.length === 0
    && recoveryEvents.length === 0
    && !lastRecoveryKey
    && !recoveryBudget
  ) {
    return undefined
  }

  return {
    promptSourceIds,
    promptSources,
    ...(promptSourceVersion ? { promptSourceVersion } : {}),
    latencyEvents: [...new Set(latencyEvents)].slice(-8),
    memoryEvents: [...new Set(memoryEvents)].slice(-8),
    toolEvents: [...new Set(toolEvents)].slice(-8),
    deliveryEvents: [...new Set(deliveryEvents)].slice(-8),
    recoveryEvents: [...new Set(recoveryEvents)].slice(-8),
    ...(lastRecoveryKey ? { lastRecoveryKey } : {}),
    ...(recoveryBudget ? { recoveryBudget } : {}),
  }
}

function getFailureDetailLines(run: RootRun, summary: string): string[] {
  const detailLines = [...run.recentEvents]
    .sort((a, b) => b.at - a.at)
    .map((event) => event.label.trim())
    .filter((label) => label.length > 0 && label !== summary)

  return [...new Set(detailLines)].slice(0, 3)
}

function describeFailureOutcome(status: Extract<RunStatus, "failed" | "cancelled" | "interrupted">): string {
  switch (status) {
    case "cancelled":
      return "취소"
    case "interrupted":
      return "중단"
    default:
      return "실패"
  }
}

function describeAttemptFailureTitle(
  kind: TaskAttemptKind,
  status: Extract<RunStatus, "failed" | "cancelled" | "interrupted">,
): string {
  const outcome = describeFailureOutcome(status)

  switch (kind) {
    case "intake_bridge":
      return `요청 해석 ${outcome}`
    case "verification":
      return `결과 검증 ${outcome}`
    case "filesystem_retry":
      return `파일 작업 재시도 ${outcome}`
    case "truncated_recovery":
      return `중간 절단 복구 ${outcome}`
    case "scheduled_execution":
      return `예약 실행 ${outcome}`
    default:
      return `실행 ${outcome}`
  }
}

function deriveTaskFailure(
  orderedRuns: RootRun[],
  attempts: TaskAttemptModel[],
  delivery: TaskDeliveryModel,
): TaskFailureModel | undefined {
  if (delivery.status === "failed") {
    const sourceRun = delivery.sourceAttemptId
      ? orderedRuns.find((run) => run.id === delivery.sourceAttemptId)
      : undefined
    const summary =
      delivery.summary?.trim()
      || [...(sourceRun?.recentEvents ?? [])].sort((a, b) => b.at - a.at)[0]?.label?.trim()
      || sourceRun?.summary?.trim()
      || "결과 전달 중 오류가 발생했습니다."

    return {
      kind: "delivery",
      status: "failed",
      title: "전달 실패",
      summary,
      detailLines: sourceRun ? getFailureDetailLines(sourceRun, summary) : [],
      ...(delivery.sourceAttemptId ? { sourceAttemptId: delivery.sourceAttemptId } : {}),
    }
  }

  const failedRun = [...orderedRuns]
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .find((run): run is RootRun & { status: Extract<RunStatus, "failed" | "cancelled" | "interrupted"> } =>
      run.status === "failed" || run.status === "cancelled" || run.status === "interrupted",
    )
  if (!failedRun) return undefined

  const failedAttempt = attempts.find((attempt) => attempt.id === failedRun.id)
  const summary =
    [...failedRun.recentEvents].sort((a, b) => b.at - a.at)[0]?.label?.trim()
    || failedRun.summary.trim()
    || failedAttempt?.summary?.trim()
    || describeAttemptFailureTitle(failedAttempt?.kind ?? "followup", failedRun.status)

  return {
    kind: failedAttempt && isRecoveryAttemptKind(failedAttempt.kind) ? "recovery" : "execution",
    status: failedRun.status,
    title: describeAttemptFailureTitle(failedAttempt?.kind ?? "followup", failedRun.status),
    summary,
    detailLines: getFailureDetailLines(failedRun, summary),
    sourceAttemptId: failedRun.id,
  }
}

function buildTaskChecklist(params: {
  attempts: TaskAttemptModel[]
  delivery: TaskDeliveryModel
  failure?: TaskFailureModel
  status: RunStatus
  summary: string
}): TaskChecklistModel {
  const terminalFailure = params.failure && !ACTIVE_RUN_STATUSES.includes(params.status) ? params.failure : undefined
  const intakeAttempt = [...params.attempts].reverse().find((attempt) => attempt.kind === "intake_bridge")
  const executionAttempts = params.attempts.filter((attempt) => isExecutionAttemptKind(attempt.kind))
  const latestExecutionAttempt = executionAttempts.at(-1)
  const activeExecutionAttempt = [...executionAttempts].reverse().find((attempt) => ACTIVE_RUN_STATUSES.includes(attempt.status))
  const completedExecutionAttempt = [...executionAttempts].reverse().find((attempt) => attempt.status === "completed")

  const requestItem: TaskChecklistItemModel = (() => {
    if (!intakeAttempt) {
      return {
        key: "request",
        status: "completed",
        ...(params.attempts[0]?.summary ? { summary: params.attempts[0].summary } : {}),
      }
    }

    if (executionAttempts.length > 0) {
      return {
        key: "request",
        status: "completed",
        ...(intakeAttempt.summary ? { summary: intakeAttempt.summary } : {}),
      }
    }

    return {
      key: "request",
      status: mapRunStatusToChecklistStatus(intakeAttempt.status),
      ...(intakeAttempt.summary ? { summary: intakeAttempt.summary } : {}),
    }
  })()

  const executionItem: TaskChecklistItemModel = (() => {
    if (terminalFailure && terminalFailure.kind !== "delivery") {
      return {
        key: "execution",
        status: mapTerminalFailureStatus(terminalFailure.status),
        summary: terminalFailure.summary,
      }
    }

    if (activeExecutionAttempt) {
      return {
        key: "execution",
        status: "running",
        ...(activeExecutionAttempt.summary ? { summary: activeExecutionAttempt.summary } : {}),
      }
    }

    if (completedExecutionAttempt || params.delivery.status === "delivered" || params.delivery.status === "failed" || params.status === "completed") {
      const summary = completedExecutionAttempt?.summary || latestExecutionAttempt?.summary || params.summary
      return {
        key: "execution",
        status: "completed",
        ...(summary ? { summary } : {}),
      }
    }

    if (latestExecutionAttempt) {
      return {
        key: "execution",
        status: mapRunStatusToChecklistStatus(latestExecutionAttempt.status),
        ...(latestExecutionAttempt.summary ? { summary: latestExecutionAttempt.summary } : {}),
      }
    }

    return {
      key: "execution",
      status: "pending",
    }
  })()

  const deliveryItem: TaskChecklistItemModel = (() => {
    switch (params.delivery.status) {
      case "delivered":
        return {
          key: "delivery",
          status: "completed",
          ...(params.delivery.summary ? { summary: params.delivery.summary } : {}),
        }
      case "failed":
        return {
          key: "delivery",
          status: "failed",
          ...(params.delivery.summary ? { summary: params.delivery.summary } : {}),
        }
      case "pending":
        return {
          key: "delivery",
          status: "running",
          ...(params.delivery.summary ? { summary: params.delivery.summary } : {}),
        }
      default:
        return {
          key: "delivery",
          status: "not_required",
        }
    }
  })()

  const completionItem: TaskChecklistItemModel = (() => {
    if (terminalFailure) {
      return {
        key: "completion",
        status: mapTerminalFailureStatus(terminalFailure.status),
        summary: terminalFailure.summary,
      }
    }

    switch (params.status) {
      case "completed":
        return {
          key: "completion",
          status: "completed",
          ...(params.summary ? { summary: params.summary } : {}),
        }
      case "queued":
        return {
          key: "completion",
          status: "pending",
          ...(params.summary ? { summary: params.summary } : {}),
        }
      case "cancelled":
      case "interrupted":
        return {
          key: "completion",
          status: "cancelled",
          ...(params.summary ? { summary: params.summary } : {}),
        }
      case "failed":
        return {
          key: "completion",
          status: "failed",
          ...(params.summary ? { summary: params.summary } : {}),
        }
      default:
        return {
          key: "completion",
          status: "running",
          ...(params.summary ? { summary: params.summary } : {}),
        }
    }
  })()

  const items = [requestItem, executionItem, deliveryItem, completionItem]
  const actionableItems = items.filter((item) => item.status !== "not_required")

  return {
    items,
    completedCount: actionableItems.filter((item) => item.status === "completed").length,
    actionableCount: actionableItems.length,
    failedCount: actionableItems.filter((item) => item.status === "failed" || item.status === "cancelled").length,
  }
}

export function buildTaskModels(
  runs: RootRun[],
  continuitySnapshots: TaskContinuitySnapshot[] = [],
): TaskModel[] {
  const grouped = new Map<string, RootRun[]>()
  const continuityByLineage = new Map(continuitySnapshots.map((snapshot) => [snapshot.lineageRootRunId, snapshot]))
  for (const run of runs) {
    const key = run.lineageRootRunId || run.requestGroupId || run.id
    const existing = grouped.get(key)
    if (existing) existing.push(run)
    else grouped.set(key, [run])
  }

  const tasks: TaskModel[] = []

  for (const [, groupRuns] of grouped.entries()) {
    const orderedRuns = [...groupRuns].sort((a, b) => a.createdAt - b.createdAt)
    const latestRun = [...groupRuns].sort((a, b) => b.updatedAt - a.updatedAt)[0]
    const anchorRun = [...orderedRuns].find((run) => run.runScope === "root" || !run.parentRunId) ?? orderedRuns[0]
    if (!anchorRun || !latestRun) continue
    const taskId = anchorRun.lineageRootRunId || anchorRun.requestGroupId || anchorRun.id
    const summary = computeTaskSummary(groupRuns)

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
    const status = computeTaskStatus({ groupRuns, attempts, delivery })
    const failure = deriveTaskFailure(orderedRuns, attempts, delivery)
    const activities = buildTaskActivities(taskId, attempts, orderedRuns)
    const continuity = mapContinuitySnapshot(continuityByLineage.get(taskId))
    const diagnostics = buildTaskDiagnostics(orderedRuns, latestRun, continuity)
    const checklist = buildTaskChecklist({
      attempts,
      delivery,
      ...(failure ? { failure } : {}),
      status,
      summary,
    })

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
      summary,
      status,
      canCancel: ACTIVE_RUN_STATUSES.includes(status)
        && attempts.some((attempt) => ACTIVE_RUN_STATUSES.includes(attempt.status)),
      createdAt: anchorRun.createdAt,
      updatedAt: latestRun.updatedAt,
      attempts,
      recoveryAttempts,
      delivery,
      ...(failure ? { failure } : {}),
      checklist,
      monitor: buildTaskMonitor(attempts, recoveryAttempts, delivery),
      ...(continuity ? { continuity } : {}),
      ...(diagnostics ? { diagnostics } : {}),
      activities,
    })
  }

  return tasks.sort((a, b) => b.updatedAt - a.updatedAt)
}
