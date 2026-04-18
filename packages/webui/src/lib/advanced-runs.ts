import type { RetrievalTimeline } from "../api/client"
import type { DoctorReport, DoctorStatus } from "../contracts/doctor"
import type { OperationsHealthStatus, OperationsSummary, StaleRunCleanupResult } from "../contracts/operations"
import type { RunStatus } from "../contracts/runs"
import type { TaskMonitorCard } from "./task-monitor"

type TextFn = (ko: string, en: string) => string

export type AdvancedRunStatusKind =
  | "queued"
  | "running"
  | "approval_waiting"
  | "user_waiting"
  | "completed"
  | "delivery_failed"
  | "recovery"
  | "failed"
  | "cancelled"
  | "interrupted"

export type AdvancedStatusTone = "stone" | "blue" | "amber" | "emerald" | "rose" | "red"

export interface AdvancedRunStatusView {
  kind: AdvancedRunStatusKind
  label: string
  tone: AdvancedStatusTone
  summary: string
  requiresAction: boolean
  delivered: boolean
}

export interface AdvancedRunListItemView {
  key: string
  title: string
  requestText: string
  status: AdvancedRunStatusView
  sourceLabel: string
  channelLabel: string
  requesterLabel: string
  startedAt: number
  updatedAt: number
  finishedAt: number | null
  resultSummary: string
  actionHint: string
  attemptCount: number
  internalAttemptCount: number
  duplicateExecutionRisk: boolean
}

export interface AdvancedRunSummaryCard {
  id: "total" | "approval" | "delivery_failed" | "recovery" | "completed"
  label: string
  value: number
  tone: AdvancedStatusTone
}

export type AdvancedDiagnosticStatusKind = OperationsHealthStatus | "idle"

export interface AdvancedDiagnosticStatusView {
  key: "channel" | "scheduler" | "memory" | "web_retrieval" | "yeonjang"
  label: string
  status: AdvancedDiagnosticStatusKind
  summary: string
  action: string
}

export interface AdvancedDoctorGuideView {
  key: string
  label: string
  status: DoctorStatus
  message: string
  guide: string
}

export interface AdvancedCleanupNotice {
  kind: "success" | "error"
  message: string
  auditHint: string
}

const TERMINAL_FAILURE_STATUSES = new Set<RunStatus>(["failed", "cancelled", "interrupted"])

function truncate(value: string, maxLength = 160): string {
  const normalized = value.replace(/\s+/g, " ").trim()
  if (normalized.length <= maxLength) return normalized
  return `${normalized.slice(0, maxLength - 1)}...`
}

function sourceLabel(source: TaskMonitorCard["representative"]["source"], text: TextFn): string {
  switch (source) {
    case "telegram":
      return "Telegram"
    case "slack":
      return "Slack"
    case "cli":
      return "CLI"
    case "webui":
      return text("웹 채팅", "Web chat")
  }
}

function channelLabel(card: TaskMonitorCard, text: TextFn): string {
  if (card.delivery.channel && card.delivery.channel !== "unknown") return sourceLabel(card.delivery.channel, text)
  return sourceLabel(card.representative.source, text)
}

function actionHintForStatus(kind: AdvancedRunStatusKind, text: TextFn): string {
  switch (kind) {
    case "approval_waiting":
      return text("채팅 또는 승인 UI에서 승인/거부를 처리해야 합니다.", "Approve or deny from chat or the approval UI.")
    case "user_waiting":
      return text("사용자 추가 입력이 필요한 상태입니다.", "Additional user input is required.")
    case "delivery_failed":
      return text("실행 결과는 만들어졌지만 채널 전달이 실패했습니다. 채널 권한과 수신 대상을 확인하세요.", "The result exists, but channel delivery failed. Check channel permissions and target IDs.")
    case "recovery":
      return text("복구 루틴이 개입했습니다. 반복 중단 키와 최근 정상 상태를 확인하세요.", "Recovery is involved. Check the duplicate stop key and last good state.")
    case "failed":
      return text("실행 실패 원인과 재시도 가능 여부를 확인하세요.", "Review the failure cause and whether retry is safe.")
    case "cancelled":
      return text("사용자 또는 시스템에 의해 취소된 항목입니다.", "The item was cancelled by a user or the system.")
    case "interrupted":
      return text("중단 처리된 항목입니다. 오래된 대기 정리 또는 런타임 종료 가능성을 확인하세요.", "The item was interrupted. Check stale cleanup or runtime shutdown.")
    case "queued":
    case "running":
      return text("현재 처리 중입니다.", "Currently in progress.")
    case "completed":
      return text("추가 조치가 필요 없습니다.", "No further action is required.")
  }
}

function mapRunStatus(status: RunStatus, text: TextFn): AdvancedRunStatusView {
  switch (status) {
    case "queued":
      return { kind: "queued", label: text("대기", "Queued"), tone: "stone", summary: text("실행 순서를 기다리고 있습니다.", "Waiting for execution."), requiresAction: false, delivered: false }
    case "running":
      return { kind: "running", label: text("진행 중", "Running"), tone: "blue", summary: text("작업을 처리 중입니다.", "The work is running."), requiresAction: false, delivered: false }
    case "awaiting_approval":
      return { kind: "approval_waiting", label: text("승인 대기", "Approval waiting"), tone: "amber", summary: text("도구 실행 승인이 필요합니다.", "Tool approval is required."), requiresAction: true, delivered: false }
    case "awaiting_user":
      return { kind: "user_waiting", label: text("입력 대기", "User input waiting"), tone: "amber", summary: text("사용자 입력을 기다립니다.", "Waiting for user input."), requiresAction: true, delivered: false }
    case "completed":
      return { kind: "completed", label: text("완료", "Completed"), tone: "emerald", summary: text("실행이 완료됐습니다.", "Execution completed."), requiresAction: false, delivered: false }
    case "failed":
      return { kind: "failed", label: text("실행 실패", "Run failed"), tone: "red", summary: text("실행 자체가 실패했습니다.", "The execution failed."), requiresAction: true, delivered: false }
    case "cancelled":
      return { kind: "cancelled", label: text("취소됨", "Cancelled"), tone: "stone", summary: text("작업이 취소됐습니다.", "The work was cancelled."), requiresAction: false, delivered: false }
    case "interrupted":
      return { kind: "interrupted", label: text("중단됨", "Interrupted"), tone: "rose", summary: text("작업이 중단 처리됐습니다.", "The work was interrupted."), requiresAction: true, delivered: false }
  }
}

function hasRecoverySignal(card: TaskMonitorCard): boolean {
  return Boolean(
    card.failure?.kind === "recovery"
    || card.continuity?.failedRecoveryKey
    || card.diagnostics?.recoveryEvents.length
    || card.attempts.some((attempt) => attempt.kind === "filesystem_retry" || attempt.kind === "truncated_recovery"),
  )
}

export function classifyAdvancedRunStatus(card: TaskMonitorCard, text: TextFn): AdvancedRunStatusView {
  if (card.delivery.status === "delivered") {
    return {
      kind: "completed",
      label: text("전달 완료", "Delivered"),
      tone: "emerald",
      summary: TERMINAL_FAILURE_STATUSES.has(card.representative.status)
        ? text("결과 전달은 완료됐습니다. 이후 내부 상태 변경은 별도 진단에서 확인합니다.", "Result delivery completed. Later internal state changes are shown separately in diagnostics.")
        : text("결과가 사용자 채널에 전달됐습니다.", "The result was delivered to the user channel."),
      requiresAction: false,
      delivered: true,
    }
  }

  if (card.delivery.status === "failed") {
    return {
      kind: "delivery_failed",
      label: text("전달 실패", "Delivery failed"),
      tone: "rose",
      summary: text("실행 결과 생성 후 사용자 채널 전달이 실패했습니다.", "The result was produced, but delivery to the user channel failed."),
      requiresAction: true,
      delivered: false,
    }
  }

  if (card.representative.status === "awaiting_approval" || card.continuity?.pendingApprovals.length) {
    return {
      kind: "approval_waiting",
      label: text("승인 대기", "Approval waiting"),
      tone: "amber",
      summary: text("도구 실행 승인 응답을 기다리고 있습니다.", "Waiting for a tool approval response."),
      requiresAction: true,
      delivered: false,
    }
  }

  if (card.representative.status === "awaiting_user") {
    return mapRunStatus("awaiting_user", text)
  }

  if (hasRecoverySignal(card)) {
    return {
      kind: "recovery",
      label: text("복구 확인", "Recovery"),
      tone: "amber",
      summary: text("복구 루틴 또는 반복 중단 신호가 있습니다.", "Recovery or duplicate-stop signals are present."),
      requiresAction: true,
      delivered: false,
    }
  }

  return mapRunStatus(card.representative.status, text)
}

export function buildAdvancedRunListItems(cards: TaskMonitorCard[], text: TextFn): AdvancedRunListItemView[] {
  return cards.map((card) => {
    const status = classifyAdvancedRunStatus(card, text)
    const resultSummary = truncate(card.delivery.summary || card.failure?.summary || card.representative.summary || card.requestText || card.representative.title)
    return {
      key: card.key,
      title: card.representative.title || truncate(card.requestText, 80) || text("제목 없음", "Untitled"),
      requestText: card.requestText,
      status,
      sourceLabel: sourceLabel(card.representative.source, text),
      channelLabel: channelLabel(card, text),
      requesterLabel: card.representative.targetLabel || sourceLabel(card.representative.source, text),
      startedAt: card.representative.createdAt,
      updatedAt: card.representative.updatedAt,
      finishedAt: ["completed", "failed", "cancelled", "interrupted"].includes(card.representative.status) ? card.representative.updatedAt : null,
      resultSummary,
      actionHint: actionHintForStatus(status.kind, text),
      attemptCount: card.attempts.length,
      internalAttemptCount: card.internalAttempts.length,
      duplicateExecutionRisk: card.duplicateExecutionRisk,
    }
  })
}

export function buildAdvancedRunSummaryCards(items: AdvancedRunListItemView[], text: TextFn): AdvancedRunSummaryCard[] {
  const count = (predicate: (item: AdvancedRunListItemView) => boolean) => items.filter(predicate).length
  return [
    { id: "total", label: text("전체", "Total"), value: items.length, tone: "stone" },
    { id: "approval", label: text("승인 대기", "Approval"), value: count((item) => item.status.kind === "approval_waiting"), tone: "amber" },
    { id: "delivery_failed", label: text("전달 실패", "Delivery failed"), value: count((item) => item.status.kind === "delivery_failed"), tone: "rose" },
    { id: "recovery", label: text("복구 확인", "Recovery"), value: count((item) => item.status.kind === "recovery"), tone: "amber" },
    { id: "completed", label: text("완료/전달", "Done/delivered"), value: count((item) => item.status.kind === "completed"), tone: "emerald" },
  ]
}

function combineHealthStatus(a: OperationsHealthStatus, b: OperationsHealthStatus): OperationsHealthStatus {
  if (a === "down" || b === "down") return "down"
  if (a === "degraded" || b === "degraded") return "degraded"
  return "ok"
}

export function buildAdvancedDiagnosticStatuses(
  summary: OperationsSummary | null,
  retrievalTimeline: RetrievalTimeline | null,
  text: TextFn,
): AdvancedDiagnosticStatusView[] {
  const memoryStatus = summary ? combineHealthStatus(summary.health.memory.status, summary.health.vector.status) : "idle"
  const webSummary = retrievalTimeline?.summary
  const webStatus: AdvancedDiagnosticStatusKind = webSummary
    ? webSummary.conflicts > 0 || webSummary.stops > 0
      ? "degraded"
      : webSummary.total > 0
        ? "ok"
        : "idle"
    : "idle"
  const webText = webSummary
    ? text(`검색 시도 ${webSummary.attempts}회, 후보 ${webSummary.candidates}개, 검증 ${webSummary.verdicts}개`, `${webSummary.attempts} attempts, ${webSummary.candidates} candidates, ${webSummary.verdicts} verdicts`)
    : text("선택 항목의 진단 보기에서 검색 근거를 확인합니다.", "Open diagnostics for the selected item to view retrieval evidence.")

  return [
    {
      key: "channel",
      label: text("채널", "Channel"),
      status: summary?.health.channel.status ?? "idle",
      summary: summary?.health.channel.reason ?? text("채널 상태를 아직 불러오지 않았습니다.", "Channel health is not loaded yet."),
      action: text("반복 전달 실패와 채널 Smoke 결과를 함께 확인합니다.", "Review repeated delivery failures and channel smoke results together."),
    },
    {
      key: "scheduler",
      label: text("스케줄", "Scheduler"),
      status: summary?.health.schedule.status ?? "idle",
      summary: summary?.health.schedule.reason ?? text("스케줄 상태를 아직 불러오지 않았습니다.", "Scheduler health is not loaded yet."),
      action: text("오래된 예약 실행과 stale wait를 정리합니다.", "Clean stale scheduled runs and waits."),
    },
    {
      key: "memory",
      label: text("메모리/벡터", "Memory/vector"),
      status: memoryStatus,
      summary: summary
        ? text(`메모리 ${summary.health.memory.status}, 벡터 ${summary.health.vector.status}`, `memory ${summary.health.memory.status}, vector ${summary.health.vector.status}`)
        : text("메모리 상태를 아직 불러오지 않았습니다.", "Memory health is not loaded yet."),
      action: text("진단 보기에서 선택 실행의 메모리 참조 추적을 확인합니다.", "Use diagnostics to inspect memory access for the selected run."),
    },
    {
      key: "web_retrieval",
      label: text("웹 검색", "Web retrieval"),
      status: webStatus,
      summary: webText,
      action: text("검색은 느슨하게 수집하고 완료 검증은 근거 타임라인에서 확인합니다.", "Collect web evidence leniently and validate completion through the evidence timeline."),
    },
    {
      key: "yeonjang",
      label: text("연장", "Yeonjang"),
      status: summary?.health.channel.status ?? "idle",
      summary: text("연장 도구 오류는 채널/도구 반복 오류와 감사 로그에서 추적합니다.", "Yeonjang tool issues are tracked through channel/tool repeated issues and audit logs."),
      action: text("전체 내부 이벤트와 원본 런타임 상태는 어드민 모드에서 확인합니다.", "Use admin mode for full internal events and raw runtime state."),
    },
  ]
}

export function buildDoctorActionGuides(report: DoctorReport | null, text: TextFn): AdvancedDoctorGuideView[] {
  if (!report) {
    return [{ key: "doctor-not-loaded", label: text("진단 대기", "Doctor not loaded"), status: "unknown", message: text("진단 결과를 아직 불러오지 않았습니다.", "Doctor report has not been loaded yet."), guide: text("진단 보기를 열거나 다시 확인을 실행하세요.", "Open diagnostics or run the check again.") }]
  }

  const visibleChecks = report.checks.filter((check) => check.status !== "ok")
  const checks = visibleChecks.length > 0 ? visibleChecks : report.checks.slice(0, 3)
  if (checks.length === 0) {
    return [{ key: "doctor-ok", label: text("진단 정상", "Doctor OK"), status: report.overallStatus, message: text("표시할 문제 항목이 없습니다.", "No actionable diagnostics."), guide: text("문제가 발생하면 전체 진단을 다시 실행하세요.", "Run full diagnostics if a problem appears.") }]
  }

  return checks.slice(0, 6).map((check) => ({
    key: check.name,
    label: check.name,
    status: check.status,
    message: check.message,
    guide: check.guide || text("관련 설정과 최근 로그를 확인하세요.", "Check related settings and recent logs."),
  }))
}

export function buildCleanupNoticeFromDeleteResult(deletedRunCount: number, text: TextFn): AdvancedCleanupNotice {
  return {
    kind: "success",
    message: text(`실행 기록 ${deletedRunCount}건을 정리했습니다.`, `Cleared ${deletedRunCount} activity record(s).`),
    auditHint: text("정리 결과는 감사/진단 로그에서 추적할 수 있습니다.", "Cleanup results can be traced in audit and diagnostic logs."),
  }
}

export function buildCleanupNoticeFromStaleResult(result: StaleRunCleanupResult, text: TextFn): AdvancedCleanupNotice {
  return {
    kind: "success",
    message: text(`오래된 대기 ${result.cleanedRunCount}건을 중단 처리했고 ${result.skippedRunCount}건은 건너뛰었습니다.`, `Interrupted ${result.cleanedRunCount} stale wait(s) and skipped ${result.skippedRunCount}.`),
    auditHint: text("중단 처리된 항목은 실행 현황과 감사/진단 로그에서 확인하세요.", "Review interrupted items in activity monitor and audit/diagnostic logs."),
  }
}
