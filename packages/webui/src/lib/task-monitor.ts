import type { RootRun } from "../contracts/runs"
import type {
  TaskActivityKind,
  TaskActivityModel,
  TaskAttemptKind,
  TaskAttemptModel,
  TaskDeliveryStatus,
  TaskModel,
} from "../contracts/tasks"

type TextFn = (ko: string, en: string) => string

export interface TaskMonitorAttempt {
  id: string
  kind: TaskAttemptKind
  label: string
  prompt: string
  status: RootRun["status"]
  summary: string
  userVisible: boolean
  run?: RootRun
}

export interface TaskMonitorTreeNode {
  id: string
  label: string
  summary?: string
  status: RootRun["status"]
  isRoot?: boolean
}

export interface TaskMonitorTimelineItem {
  id: string
  at: number
  label: string
  runLabel: string
}

export interface TaskMonitorDelivery {
  status: TaskDeliveryStatus
  channel?: "telegram" | "webui" | "cli" | "unknown"
  summary?: string
}

export interface TaskMonitorCard {
  key: string
  representative: RootRun
  runs: RootRun[]
  requestText: string
  attempts: TaskMonitorAttempt[]
  visibleAttempts: TaskMonitorAttempt[]
  internalAttempts: TaskMonitorAttempt[]
  treeNodes: TaskMonitorTreeNode[]
  timeline: TaskMonitorTimelineItem[]
  delivery: TaskMonitorDelivery
  duplicateExecutionRisk: boolean
}

const ACTIVE_STATUSES: RootRun["status"][] = ["queued", "running", "awaiting_approval", "awaiting_user"]

function truncateText(value: string, maxLength = 120): string {
  const normalized = value.replace(/\s+/g, " ").trim()
  if (normalized.length <= maxLength) return normalized
  return `${normalized.slice(0, maxLength - 1)}…`
}

function describeAttemptLabel(attempt: TaskAttemptModel, text: TextFn): string {
  switch (attempt.kind) {
    case "primary":
      return text("사용자 요청", "User request")
    case "followup":
      return text("후속 시도", "Follow-up attempt")
    case "intake_bridge":
      return text("작업 분해 및 대상 선택", "Task intake and target selection")
    case "scheduled_execution":
      return attempt.title || text("예약 작업 실행", "Scheduled task execution")
    case "approval_continuation":
      return text("승인 후 작업 계속 진행", "Continue after approval")
    case "verification":
      return text("결과 검증", "Result verification")
    case "filesystem_retry":
      return text("실제 파일·폴더 작업 재시도", "Retry real file or folder work")
    case "truncated_recovery":
      return text("중간 절단 복구 재시도", "Retry truncated output recovery")
  }
}

function describeActivityLabel(activity: TaskActivityModel, text: TextFn): string {
  switch (activity.kind) {
    case "delivery.pending":
      return text("전달 대기", "Delivery pending")
    case "delivery.delivered":
      return text("전달 완료", "Delivery delivered")
    case "delivery.failed":
      return text("전달 실패", "Delivery failed")
    default:
      return activity.summary
  }
}

function describeActivityOwner(
  activity: TaskActivityModel,
  labelByAttemptId: Map<string, string>,
  text: TextFn,
): string {
  if (activity.attemptId) {
    return labelByAttemptId.get(activity.attemptId) ?? text("태스크 시도", "Task attempt")
  }

  if ((activity.kind as TaskActivityKind).startsWith("delivery.")) {
    return text("전달", "Delivery")
  }

  return text("태스크", "Task")
}

function buildTreeNodes(attempts: TaskMonitorAttempt[]): TaskMonitorTreeNode[] {
  const visibleAttempts = attempts.filter((attempt) => attempt.userVisible)
  const sourceAttempts = visibleAttempts.length > 0 ? visibleAttempts : attempts.slice(0, 1)
  return sourceAttempts.map((attempt, index) => ({
    id: attempt.id,
    label: attempt.label,
    summary: truncateText(attempt.summary || attempt.prompt || attempt.run?.prompt || attempt.label),
    status: attempt.status,
    isRoot: index === 0,
  }))
}

function buildTimeline(task: TaskModel, attempts: TaskMonitorAttempt[], text: TextFn): TaskMonitorTimelineItem[] {
  const labelByAttemptId = new Map(attempts.map((attempt) => [attempt.id, attempt.label]))
  return [...task.activities]
    .sort((a, b) => b.at - a.at)
    .slice(0, 20)
    .map((activity) => ({
      id: activity.id,
      at: activity.at,
      label: describeActivityLabel(activity, text),
      runLabel: describeActivityOwner(activity, labelByAttemptId, text),
    }))
}

function buildRepresentativeRun(task: TaskModel, runsById: Map<string, RootRun>): RootRun | null {
  const latestRun = runsById.get(task.latestAttemptId)
  const anchorRun = runsById.get(task.anchorRunId)
  const sourceRun = latestRun ?? anchorRun
  const identityRun = anchorRun ?? latestRun
  if (!sourceRun || !identityRun) return null

  return {
    ...sourceRun,
    id: identityRun.id,
    requestGroupId: task.requestGroupId,
    title: task.title,
    prompt: task.requestText || identityRun.prompt,
    createdAt: task.createdAt,
    status: task.status,
    summary: task.summary,
    canCancel: task.canCancel,
    updatedAt: task.updatedAt,
  }
}

export function buildTaskMonitorCards(tasks: TaskModel[], runs: RootRun[], text: TextFn): TaskMonitorCard[] {
  const runsById = new Map(runs.map((run) => [run.id, run]))
  const cards: TaskMonitorCard[] = []

  for (const task of tasks) {
    const groupRuns = task.runIds
      .map((runId) => runsById.get(runId))
      .filter((run): run is RootRun => Boolean(run))
      .sort((a, b) => b.updatedAt - a.updatedAt)
    const representative = buildRepresentativeRun(task, runsById)
    if (!representative) continue

    const attempts = task.attempts.map((attempt) => ({
      id: attempt.id,
      kind: attempt.kind,
      label: describeAttemptLabel(attempt, text),
      prompt: attempt.prompt,
      status: attempt.status,
      summary: attempt.summary,
      userVisible: attempt.userVisible,
      run: runsById.get(attempt.id),
    }))
    const visibleAttempts = attempts.filter((attempt) => attempt.userVisible)
    const internalAttempts = attempts.filter((attempt) => !attempt.userVisible)

    cards.push({
      key: task.id,
      representative,
      runs: groupRuns,
      requestText: task.requestText,
      attempts,
      visibleAttempts,
      internalAttempts,
      treeNodes: buildTreeNodes(attempts),
      timeline: buildTimeline(task, attempts, text),
      delivery: task.delivery,
      duplicateExecutionRisk: task.monitor.duplicateExecutionRisk,
    })
  }

  return cards.sort((a, b) => b.representative.updatedAt - a.representative.updatedAt)
}

export function filterActiveTaskMonitorCards(cards: TaskMonitorCard[]): TaskMonitorCard[] {
  return cards.filter((card) => ACTIVE_STATUSES.includes(card.representative.status))
}

export function describeTaskDeliveryStatus(status: TaskDeliveryStatus, text: TextFn): string {
  switch (status) {
    case "delivered":
      return text("전달 완료", "Delivered")
    case "failed":
      return text("전달 실패", "Delivery failed")
    case "pending":
      return text("전달 대기", "Delivery pending")
    default:
      return text("전달 없음", "No delivery")
  }
}
