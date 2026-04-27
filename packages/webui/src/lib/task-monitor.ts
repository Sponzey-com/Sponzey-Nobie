import type { RootRun } from "../contracts/runs"
import type {
  TaskActivityKind,
  TaskActivityModel,
  TaskArtifactModel,
  TaskAttemptKind,
  TaskAttemptModel,
  TaskChecklistItemKey,
  TaskChecklistItemModel,
  TaskChecklistItemStatus,
  TaskChecklistModel,
  TaskContinuityModel,
  TaskDeliveryStatus,
  TaskDiagnosticsModel,
  TaskFailureModel,
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

export type TaskMonitorViewMode = "normal" | "diagnostic"

export interface TaskMonitorDelivery {
  status: TaskDeliveryStatus
  channel?: "telegram" | "webui" | "slack" | "cli" | "unknown"
  summary?: string
  artifact?: TaskArtifactModel
}

export interface TaskMonitorChecklistItem {
  key: TaskChecklistItemKey
  label: string
  status: TaskChecklistItemStatus
  summary?: string
}

export type { TaskChecklistItemStatus as TaskMonitorChecklistItemStatus }

export interface TaskMonitorChecklist {
  items: TaskMonitorChecklistItem[]
  completedCount: number
  actionableCount: number
  failedCount: number
}

export interface TaskMonitorFailure extends TaskFailureModel {
  sourceAttemptLabel?: string
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
  checklist: TaskMonitorChecklist
  delivery: TaskMonitorDelivery
  failure?: TaskMonitorFailure
  continuity?: TaskContinuityModel
  diagnostics?: TaskDiagnosticsModel
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
      return text("자동 보강", "Automatic follow-up")
    case "intake_bridge":
      return text("요청 정리 및 대상 선택", "Request triage and target selection")
    case "scheduled_execution":
      return attempt.title || text("예약 실행", "Scheduled run")
    case "approval_continuation":
      return text("승인 후 작업 계속 진행", "Continue after approval")
    case "verification":
      return text("결과 검증", "Result verification")
    case "filesystem_retry":
      return text("실제 파일·폴더 작업 보강", "Real file or folder work follow-up")
    case "truncated_recovery":
      return text("중간 절단 복구", "Truncated output recovery")
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
    return labelByAttemptId.get(activity.attemptId) ?? text("실행 기록", "Run history")
  }

  if ((activity.kind as TaskActivityKind).startsWith("delivery.")) {
    return text("결과 전달", "Result delivery")
  }

  return text("항목", "Item")
}

function describeChecklistItemLabel(key: TaskChecklistItemKey, text: TextFn): string {
  switch (key) {
    case "request":
      return text("요청 확인", "Request confirmed")
    case "execution":
      return text("실행 진행", "Execution")
    case "delivery":
      return text("결과 전달", "Result delivery")
    case "completion":
      return text("완료 확인", "Completion check")
  }
}

function buildChecklist(taskChecklist: TaskChecklistModel, text: TextFn): TaskMonitorChecklist {
  return {
    items: taskChecklist.items.map((item: TaskChecklistItemModel) => ({
      key: item.key,
      label: describeChecklistItemLabel(item.key, text),
      status: item.status,
      ...(item.summary ? { summary: item.summary } : {}),
    })),
    completedCount: taskChecklist.completedCount,
    actionableCount: taskChecklist.actionableCount,
    failedCount: taskChecklist.failedCount,
  }
}

function describeRunScopeLabel(attempt: TaskMonitorAttempt, text: TextFn): string {
  switch (attempt.run?.runScope) {
    case "child":
      return text("서브 에이전트", "Sub-agent")
    case "analysis":
      return text("분석", "Analysis")
    default:
      return text("기본 실행", "Main run")
  }
}

function buildTreeNodes(attempts: TaskMonitorAttempt[], text: TextFn): TaskMonitorTreeNode[] {
  const visibleAttempts = attempts.filter((attempt) => attempt.userVisible)
  const sourceAttempts = visibleAttempts.length > 0 ? visibleAttempts : attempts.slice(0, 1)
  return sourceAttempts.map((attempt, index) => ({
    id: attempt.id,
    label: `${describeRunScopeLabel(attempt, text)} · ${attempt.label}`,
    summary: truncateText(attempt.run?.handoffSummary || attempt.summary || attempt.prompt || attempt.run?.prompt || attempt.label),
    status: attempt.status,
    isRoot: (attempt.run?.runScope ?? "root") === "root" || index === 0,
  }))
}

function buildTimeline(task: TaskModel, attempts: TaskMonitorAttempt[], text: TextFn): TaskMonitorTimelineItem[] {
  const labelByAttemptId = new Map(attempts.map((attempt) => [attempt.id, attempt.label]))
  return [...task.activities]
    .sort((a, b) => (b.at - a.at) || a.id.localeCompare(b.id))
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
  if (!sourceRun || !identityRun) {
    const latestAttempt = [...task.attempts].sort((a, b) => b.updatedAt - a.updatedAt)[0]
    const anchorAttempt = task.attempts.find((attempt) => attempt.id === task.anchorRunId) ?? task.attempts[0]
    if (!latestAttempt && !anchorAttempt) return null

    return {
      id: task.anchorRunId,
      sessionId: task.sessionId,
      requestGroupId: task.requestGroupId,
      lineageRootRunId: task.id,
      runScope: "root",
      title: task.title,
      prompt: task.requestText || latestAttempt?.prompt || anchorAttempt?.prompt || task.title,
      source: task.source,
      status: task.status,
      taskProfile: sourceRun?.taskProfile ?? identityRun?.taskProfile ?? "general_chat",
      contextMode: sourceRun?.contextMode ?? identityRun?.contextMode ?? "full",
      delegationTurnCount: sourceRun?.delegationTurnCount ?? identityRun?.delegationTurnCount ?? 0,
      maxDelegationTurns: sourceRun?.maxDelegationTurns ?? identityRun?.maxDelegationTurns ?? 5,
      currentStepKey: sourceRun?.currentStepKey ?? identityRun?.currentStepKey ?? "executing",
      currentStepIndex: sourceRun?.currentStepIndex ?? identityRun?.currentStepIndex ?? 4,
      totalSteps: sourceRun?.totalSteps ?? identityRun?.totalSteps ?? 9,
      summary: task.summary,
      canCancel: task.canCancel,
      createdAt: task.createdAt,
      updatedAt: task.updatedAt,
      steps: sourceRun?.steps ?? identityRun?.steps ?? [],
      recentEvents: sourceRun?.recentEvents ?? identityRun?.recentEvents ?? [],
    }
  }

  return {
    ...sourceRun,
    id: identityRun.id,
    requestGroupId: task.requestGroupId,
    lineageRootRunId: sourceRun.lineageRootRunId || identityRun.lineageRootRunId,
    runScope: sourceRun.runScope ?? identityRun.runScope,
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
      treeNodes: buildTreeNodes(attempts, text),
      timeline: buildTimeline(task, attempts, text),
      checklist: buildChecklist(task.checklist, text),
      delivery: {
        status: task.delivery.status,
        ...(task.delivery.channel ? { channel: task.delivery.channel } : {}),
        ...(task.delivery.summary ? { summary: task.delivery.summary } : {}),
        ...(task.delivery.artifact ? { artifact: task.delivery.artifact } : {}),
      },
      ...(task.failure
        ? {
            failure: {
              ...task.failure,
              sourceAttemptLabel: task.failure.sourceAttemptId
                ? attempts.find((attempt) => attempt.id === task.failure?.sourceAttemptId)?.label
                : undefined,
            },
          }
        : {}),
      ...(task.continuity ? { continuity: task.continuity } : {}),
      ...(task.diagnostics ? { diagnostics: task.diagnostics } : {}),
      duplicateExecutionRisk: task.monitor.duplicateExecutionRisk,
    })
  }

  return cards.sort((a, b) => b.representative.updatedAt - a.representative.updatedAt)
}

export function filterActiveTaskMonitorCards(cards: TaskMonitorCard[]): TaskMonitorCard[] {
  return cards.filter((card) => ACTIVE_STATUSES.includes(card.representative.status))
}

export function filterTaskTimelineForMode(
  timeline: TaskMonitorTimelineItem[],
  mode: TaskMonitorViewMode,
): TaskMonitorTimelineItem[] {
  if (mode === "diagnostic") return timeline
  return timeline.filter((item) => !isDiagnosticTimelineItem(item))
}

function isDiagnosticTimelineItem(item: TaskMonitorTimelineItem): boolean {
  const label = `${item.runLabel}\n${item.label}`.toLowerCase()
  return /(receipt|recovery|checksum|chunk|memory|vector|prompt source|status_transition_blocked|복구|체크섬|청크|메모리|벡터|프롬프트 출처|반복 중단 키)/i.test(label)
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

export function describeTaskChecklistProgress(checklist: TaskMonitorChecklist, text: TextFn): string {
  if (checklist.actionableCount === 0) return text("없음", "None")
  return `${checklist.completedCount}/${checklist.actionableCount}`
}
