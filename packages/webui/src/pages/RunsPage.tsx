import { useEffect, useState } from "react"
import { Link } from "react-router-dom"
import { api, type ChannelSmokeChannel, type ChannelSmokeRunSummary, type MemoryAccessTraceItem, type RetrievalTimeline } from "../api/client"
import { EmptyState } from "../components/EmptyState"
import { RunEventFeed } from "../components/runs/RunEventFeed"
import { RunStatusCard } from "../components/runs/RunStatusCard"
import { TaskArtifactPanel } from "../components/runs/TaskArtifactPanel"
import { RunStepTimeline } from "../components/runs/RunStepTimeline"
import { RunSummaryPanel } from "../components/runs/RunSummaryPanel"
import { TaskChecklistPanel } from "../components/runs/TaskChecklistPanel"
import { TaskFailurePanel } from "../components/runs/TaskFailurePanel"
import {
  buildAdvancedDiagnosticStatuses,
  buildAdvancedRunListItems,
  buildAdvancedRunSummaryCards,
  buildCleanupNoticeFromDeleteResult,
  buildCleanupNoticeFromStaleResult,
  buildDoctorActionGuides,
  type AdvancedCleanupNotice,
  type AdvancedDiagnosticStatusKind,
  type AdvancedDiagnosticStatusView,
  type AdvancedDoctorGuideView,
  type AdvancedRunListItemView,
  type AdvancedRunSummaryCard,
  type AdvancedRunStatusView,
  type AdvancedStatusTone,
} from "../lib/advanced-runs"
import { buildTaskMonitorCards, describeTaskChecklistProgress, describeTaskDeliveryStatus, filterTaskTimelineForMode } from "../lib/task-monitor"
import type { TaskMonitorCard, TaskMonitorViewMode } from "../lib/task-monitor"
import type { DoctorReport, DoctorStatus } from "../contracts/doctor"
import type { OperationsHealthItem, OperationsSummary } from "../contracts/operations"
import { useUiI18n } from "../lib/ui-i18n"
import { useRunsStore } from "../stores/runs"

function TaskMonitorBadges({
  attemptCount,
  internalAttemptCount,
  checklistLabel,
  deliveryLabel,
  showDiagnostics = false,
  text,
}: {
  attemptCount: number
  internalAttemptCount: number
  checklistLabel: string
  deliveryLabel: string
  showDiagnostics?: boolean
  text: (ko: string, en: string) => string
}) {
  return (
    <div className="flex flex-wrap gap-2">
      <span className="inline-flex items-center rounded-full bg-stone-100 px-2.5 py-1 text-[11px] text-stone-700">
        {text("실행", "Runs")} {attemptCount}
      </span>
      {showDiagnostics && internalAttemptCount > 0 ? (
        <span className="inline-flex items-center rounded-full bg-amber-50 px-2.5 py-1 text-[11px] text-amber-700">
          {text("내부 재시도", "Internal retries")} {internalAttemptCount}
        </span>
      ) : null}
      <span className="inline-flex items-center rounded-full bg-stone-100 px-2.5 py-1 text-[11px] text-stone-700">
        {text("진행 단계", "Progress")} {checklistLabel}
      </span>
      <span className="inline-flex items-center rounded-full bg-stone-100 px-2.5 py-1 text-[11px] text-stone-700">
        {text("결과 전달", "Result delivery")} {deliveryLabel}
      </span>
    </div>
  )
}

function advancedToneClassName(tone: AdvancedStatusTone): string {
  switch (tone) {
    case "blue":
      return "border-sky-100 bg-sky-50 text-sky-800"
    case "amber":
      return "border-amber-100 bg-amber-50 text-amber-800"
    case "emerald":
      return "border-emerald-100 bg-emerald-50 text-emerald-800"
    case "rose":
      return "border-rose-100 bg-rose-50 text-rose-800"
    case "red":
      return "border-red-100 bg-red-50 text-red-800"
    case "stone":
      return "border-stone-200 bg-stone-50 text-stone-700"
  }
}

function diagnosticToneClassName(status: AdvancedDiagnosticStatusKind): string {
  switch (status) {
    case "ok":
      return "border-emerald-100 bg-emerald-50 text-emerald-800"
    case "degraded":
      return "border-amber-100 bg-amber-50 text-amber-800"
    case "down":
      return "border-rose-100 bg-rose-50 text-rose-800"
    case "idle":
      return "border-stone-200 bg-stone-50 text-stone-700"
  }
}

function doctorToneClassName(status: DoctorStatus): string {
  switch (status) {
    case "ok":
      return "border-emerald-100 bg-emerald-50 text-emerald-800"
    case "warning":
      return "border-amber-100 bg-amber-50 text-amber-800"
    case "blocked":
      return "border-red-100 bg-red-50 text-red-800"
    case "unknown":
      return "border-stone-200 bg-stone-50 text-stone-700"
  }
}

function AdvancedRunStatusPill({ status }: { status: AdvancedRunStatusView }) {
  return (
    <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-semibold ${advancedToneClassName(status.tone)}`}>
      {status.label}
    </span>
  )
}

function AdvancedRunSummaryStrip({ cards }: { cards: AdvancedRunSummaryCard[] }) {
  return (
    <div className="mt-4 grid grid-cols-2 gap-2 xl:grid-cols-5">
      {cards.map((card) => (
        <div key={card.id} className={`rounded-xl border px-3 py-2 ${advancedToneClassName(card.tone)}`}>
          <div className="text-[11px] font-semibold opacity-80">{card.label}</div>
          <div className="mt-1 text-lg font-semibold">{card.value}</div>
        </div>
      ))}
    </div>
  )
}

function AdvancedRunListMeta({ item, formatTime, text, displayText }: {
  item: AdvancedRunListItemView
  formatTime: (value: number) => string
  text: (ko: string, en: string) => string
  displayText: (value: string) => string
}) {
  return (
    <div className="mt-3 space-y-2">
      <div className="flex flex-wrap gap-2 text-[11px] text-stone-600">
        <AdvancedRunStatusPill status={item.status} />
        <span className="rounded-full bg-stone-100 px-2.5 py-1">{text("채널", "Channel")} {item.channelLabel}</span>
        <span className="rounded-full bg-stone-100 px-2.5 py-1">{text("요청자", "Requester")} {displayText(item.requesterLabel)}</span>
      </div>
      <div className="grid gap-1 text-[11px] leading-4 text-stone-500">
        <div>{text("시작", "Started")}: {formatTime(item.startedAt)}</div>
        <div>{text("최근", "Updated")}: {formatTime(item.updatedAt)}</div>
        <div className="break-words [overflow-wrap:anywhere]">{displayText(item.resultSummary || item.actionHint)}</div>
      </div>
    </div>
  )
}

function AdvancedRunOperationalPanel({ item, text, displayText, formatTime }: {
  item: AdvancedRunListItemView
  text: (ko: string, en: string) => string
  displayText: (value: string) => string
  formatTime: (value: number) => string
}) {
  return (
    <div className="rounded-2xl border border-stone-200 bg-white p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-sm font-semibold text-stone-900">{text("운영 요약", "Operational summary")}</div>
          <div className="mt-1 text-xs leading-5 text-stone-500">
            {text("실행 상태, 전달 상태, 요청 채널을 분리해서 표시합니다.", "Shows execution, delivery, and request channel separately.")}
          </div>
        </div>
        <AdvancedRunStatusPill status={item.status} />
      </div>
      <div className="mt-4 grid gap-3 text-xs text-stone-600 md:grid-cols-2">
        <div className="rounded-xl border border-stone-200 bg-stone-50 px-3 py-2">
          <div className="font-semibold text-stone-800">{text("요청 채널", "Request channel")}</div>
          <div className="mt-1">{item.sourceLabel}</div>
        </div>
        <div className="rounded-xl border border-stone-200 bg-stone-50 px-3 py-2">
          <div className="font-semibold text-stone-800">{text("결과 채널", "Result channel")}</div>
          <div className="mt-1">{item.channelLabel}</div>
        </div>
        <div className="rounded-xl border border-stone-200 bg-stone-50 px-3 py-2">
          <div className="font-semibold text-stone-800">{text("시작", "Started")}</div>
          <div className="mt-1">{formatTime(item.startedAt)}</div>
        </div>
        <div className="rounded-xl border border-stone-200 bg-stone-50 px-3 py-2">
          <div className="font-semibold text-stone-800">{item.finishedAt ? text("종료", "Finished") : text("최근 갱신", "Updated")}</div>
          <div className="mt-1">{formatTime(item.finishedAt ?? item.updatedAt)}</div>
        </div>
      </div>
      <div className="mt-4 rounded-xl border border-stone-200 bg-stone-50 px-3 py-3 text-xs leading-5 text-stone-600">
        <div className="font-semibold text-stone-800">{text("상태 설명", "Status note")}</div>
        <div className="mt-1 break-words [overflow-wrap:anywhere]">{displayText(item.status.summary)}</div>
        <div className="mt-2 break-words [overflow-wrap:anywhere]">{displayText(item.actionHint)}</div>
        {item.duplicateExecutionRisk ? (
          <div className="mt-2 rounded-lg border border-amber-100 bg-amber-50 px-3 py-2 text-amber-800">
            {text("중복 응답 또는 중복 도구 실행 위험이 감지됐습니다.", "Duplicate answer or duplicate tool execution risk detected.")}
          </div>
        ) : null}
      </div>
    </div>
  )
}

function AdvancedDiagnosticsSummaryPanel({
  statuses,
  doctorGuides,
  doctorLoading,
  doctorError,
  onRefreshDoctor,
  text,
  displayText,
}: {
  statuses: AdvancedDiagnosticStatusView[]
  doctorGuides: AdvancedDoctorGuideView[]
  doctorLoading: boolean
  doctorError: string
  onRefreshDoctor: () => void
  text: (ko: string, en: string) => string
  displayText: (value: string) => string
}) {
  return (
    <div className="rounded-2xl border border-stone-200 bg-white p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-sm font-semibold text-stone-900">{text("진단 요약", "Diagnostics summary")}</div>
          <div className="mt-1 text-xs leading-5 text-stone-500">
            {text("고급 화면은 조치 중심 요약만 보여주고 원본 이벤트는 어드민/감사 화면으로 분리합니다.", "Advanced view shows action-oriented summaries; raw events are kept in admin/audit views.")}
          </div>
        </div>
        <button
          type="button"
          onClick={onRefreshDoctor}
          disabled={doctorLoading}
          className="rounded-xl border border-stone-200 px-3 py-2 text-xs font-semibold text-stone-700 transition hover:bg-stone-50 disabled:cursor-not-allowed disabled:border-stone-100 disabled:text-stone-400"
        >
          {doctorLoading ? text("확인 중", "Checking") : text("진단 갱신", "Refresh doctor")}
        </button>
      </div>
      <div className="mt-4 grid gap-2 md:grid-cols-2">
        {statuses.map((status) => (
          <div key={status.key} className={`rounded-xl border px-3 py-3 text-xs leading-5 ${diagnosticToneClassName(status.status)}`}>
            <div className="font-semibold">{status.label} · {status.status}</div>
            <div className="mt-1 break-words [overflow-wrap:anywhere]">{displayText(status.summary)}</div>
            <div className="mt-1 opacity-80">{displayText(status.action)}</div>
          </div>
        ))}
      </div>
      {doctorError ? <div className="mt-4 rounded-xl border border-rose-100 bg-rose-50 px-3 py-2 text-xs text-rose-700">{displayText(doctorError)}</div> : null}
      <div className="mt-4 space-y-2">
        {doctorGuides.map((guide) => (
          <div key={guide.key} className={`rounded-xl border px-3 py-3 text-xs leading-5 ${doctorToneClassName(guide.status)}`}>
            <div className="font-semibold">{displayText(guide.label)} · {guide.status}</div>
            <div className="mt-1 break-words [overflow-wrap:anywhere]">{displayText(guide.message)}</div>
            <div className="mt-1 opacity-80">{displayText(guide.guide)}</div>
          </div>
        ))}
      </div>
      <div className="mt-4 flex flex-wrap gap-2 text-xs">
        <Link to="/advanced/audit" className="rounded-xl border border-stone-200 px-3 py-2 font-semibold text-stone-700 hover:bg-stone-50">
          {text("감사 로그 열기", "Open audit logs")}
        </Link>
        <Link to="/admin" className="rounded-xl border border-stone-200 px-3 py-2 font-semibold text-stone-700 hover:bg-stone-50">
          {text("어드민 원본 보기", "Open admin raw view")}
        </Link>
      </div>
    </div>
  )
}

function TaskDiagnosticsPanel({
  card,
  text,
  displayText,
}: {
  card: TaskMonitorCard
  text: (ko: string, en: string) => string
  displayText: (value: string) => string
}) {
  const diagnostics = card.diagnostics
  const continuity = card.continuity
  const hasDetails = Boolean(
    diagnostics
    || continuity?.lastGoodState
    || continuity?.pendingApprovals.length
    || continuity?.pendingDelivery.length
    || continuity?.failedRecoveryKey,
  )
  if (!hasDetails) return null

  const promptSourceLabel = diagnostics?.promptSources.length
    ? diagnostics.promptSources.map((source) => {
        const version = source.version ? `@${source.version}` : ""
        const checksum = source.checksum ? ` #${source.checksum.slice(0, 8)}` : ""
        const locale = source.locale ? ` (${source.locale})` : ""
        return `${source.sourceId}${version}${checksum}${locale}`
      }).join(", ")
    : diagnostics?.promptSourceIds.length
      ? diagnostics.promptSourceIds.join(", ")
    : text("기록 없음", "Not recorded")
  const latencyLabel = diagnostics?.latencyEvents.length
    ? diagnostics.latencyEvents.join(" · ")
    : text("기록 없음", "Not recorded")
  const memoryLabel = diagnostics?.memoryEvents.length
    ? diagnostics.memoryEvents.join(" · ")
    : text("기록 없음", "Not recorded")
  const toolLabel = diagnostics?.toolEvents.length
    ? diagnostics.toolEvents.join(" · ")
    : continuity?.lastToolReceipt
      ? continuity.lastToolReceipt
      : text("기록 없음", "Not recorded")
  const deliveryTraceLabel = diagnostics?.deliveryEvents.length
    ? diagnostics.deliveryEvents.join(" · ")
    : continuity?.lastDeliveryReceipt
      ? continuity.lastDeliveryReceipt
      : text("기록 없음", "Not recorded")
  const recoveryLabel = diagnostics?.recoveryEvents.length
    ? diagnostics.recoveryEvents.join(" · ")
    : text("기록 없음", "Not recorded")
  const pendingApprovalLabel = continuity?.pendingApprovals.length
    ? continuity.pendingApprovals.join(", ")
    : text("없음", "None")
  const pendingDeliveryLabel = continuity?.pendingDelivery.length
    ? continuity.pendingDelivery.join(", ")
    : text("없음", "None")

  return (
    <div className="rounded-2xl border border-stone-200 bg-stone-50 px-4 py-4">
      <div className="text-xs font-semibold text-stone-500">{text("운영 진단", "Operational diagnostics")}</div>
      <div className="mt-3 grid gap-3 text-xs leading-5 text-stone-600 md:grid-cols-2">
        <div className="rounded-xl border border-stone-200 bg-white px-3 py-2">
          <div className="font-semibold text-stone-800">{text("프롬프트 출처", "Prompt sources")}</div>
          <div className="mt-1 break-words [overflow-wrap:anywhere]">{displayText(promptSourceLabel)}</div>
        </div>
        <div className="rounded-xl border border-stone-200 bg-white px-3 py-2">
          <div className="font-semibold text-stone-800">{text("응답 지연 기록", "Latency trace")}</div>
          <div className="mt-1 break-words [overflow-wrap:anywhere]">{displayText(latencyLabel)}</div>
        </div>
        <div className="rounded-xl border border-stone-200 bg-white px-3 py-2">
          <div className="font-semibold text-stone-800">{text("메모리·벡터 기록", "Memory and vector trace")}</div>
          <div className="mt-1 break-words [overflow-wrap:anywhere]">{displayText(memoryLabel)}</div>
        </div>
        <div className="rounded-xl border border-stone-200 bg-white px-3 py-2">
          <div className="font-semibold text-stone-800">{text("도구 실행 기록", "Tool receipt trace")}</div>
          <div className="mt-1 break-words [overflow-wrap:anywhere]">{displayText(toolLabel)}</div>
        </div>
        <div className="rounded-xl border border-stone-200 bg-white px-3 py-2">
          <div className="font-semibold text-stone-800">{text("결과 전달 기록", "Delivery receipt trace")}</div>
          <div className="mt-1 break-words [overflow-wrap:anywhere]">{displayText(deliveryTraceLabel)}</div>
        </div>
        <div className="rounded-xl border border-stone-200 bg-white px-3 py-2">
          <div className="font-semibold text-stone-800">{text("복구 기록", "Recovery trace")}</div>
          <div className="mt-1 break-words [overflow-wrap:anywhere]">{displayText(recoveryLabel)}</div>
        </div>
        <div className="rounded-xl border border-stone-200 bg-white px-3 py-2">
          <div className="font-semibold text-stone-800">{text("대기 중인 승인", "Pending approvals")}</div>
          <div className="mt-1 break-words [overflow-wrap:anywhere]">{displayText(pendingApprovalLabel)}</div>
        </div>
        <div className="rounded-xl border border-stone-200 bg-white px-3 py-2">
          <div className="font-semibold text-stone-800">{text("대기 중인 전달", "Pending delivery")}</div>
          <div className="mt-1 break-words [overflow-wrap:anywhere]">{displayText(pendingDeliveryLabel)}</div>
        </div>
      </div>
      {continuity?.lastGoodState || continuity?.failedRecoveryKey || diagnostics?.recoveryEvents.length ? (
        <div className="mt-3 rounded-xl border border-stone-200 bg-white px-3 py-2 text-xs leading-5 text-stone-600">
          {continuity?.lastGoodState ? <div>{text("최근 정상 상태", "Last good state")}: {displayText(continuity.lastGoodState)}</div> : null}
          {continuity?.failedRecoveryKey ? <div>{text("반복 중단 키", "Duplicate stop key")}: {displayText(continuity.failedRecoveryKey)}</div> : null}
          {diagnostics?.recoveryEvents.length ? <div>{text("복구 기록", "Recovery trace")}: {displayText(diagnostics.recoveryEvents.join(" · "))}</div> : null}
        </div>
      ) : null}
    </div>
  )
}

function statusLabel(status: OperationsHealthItem["status"], text: (ko: string, en: string) => string): string {
  switch (status) {
    case "ok":
      return text("정상", "OK")
    case "degraded":
      return text("저하", "Degraded")
    case "down":
      return text("장애", "Down")
  }
}

function statusClassName(status: OperationsHealthItem["status"]): string {
  switch (status) {
    case "ok":
      return "border-emerald-100 bg-emerald-50 text-emerald-800"
    case "degraded":
      return "border-amber-100 bg-amber-50 text-amber-800"
    case "down":
      return "border-rose-100 bg-rose-50 text-rose-800"
  }
}

function healthItemLabel(key: OperationsHealthItem["key"], text: (ko: string, en: string) => string): string {
  switch (key) {
    case "overall":
      return text("전체", "Overall")
    case "memory":
      return text("메모리", "Memory")
    case "vector":
      return text("벡터", "Vector")
    case "schedule":
      return text("예약", "Schedule")
    case "channel":
      return text("채널", "Channel")
  }
}

function issueKindLabel(kind: OperationsSummary["repeatedIssues"][number]["kind"], text: (ko: string, en: string) => string): string {
  switch (kind) {
    case "memory":
      return text("메모리", "Memory")
    case "vector":
      return text("벡터", "Vector")
    case "schedule":
      return text("예약", "Schedule")
    case "channel":
      return text("채널", "Channel")
    case "tool":
      return text("도구", "Tool")
    case "provider":
      return text("AI 연결", "AI connection")
    case "run":
      return text("실행", "Run")
  }
}

function OperationsHealthPanel({
  summary,
  diagnosticMode,
  cleanupRunning,
  onCleanupStale,
  text,
  displayText,
  formatTime,
}: {
  summary: OperationsSummary | null
  diagnosticMode: boolean
  cleanupRunning: boolean
  onCleanupStale: () => void
  text: (ko: string, en: string) => string
  displayText: (value: string) => string
  formatTime: (value: number) => string
}) {
  if (!summary) {
    return (
      <div className="rounded-2xl border border-stone-200 bg-white p-5 text-sm text-stone-500">
        {text("운영 상태를 불러오는 중입니다.", "Loading operational health.")}
      </div>
    )
  }

  const healthItems = [summary.health.overall, summary.health.memory, summary.health.vector, summary.health.schedule, summary.health.channel]
  const staleTotal = summary.stale.total

  return (
    <div className="rounded-2xl border border-stone-200 bg-white p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-sm font-semibold text-stone-900">{text("운영 상태", "Operational health")}</div>
          <div className="mt-1 text-xs leading-5 text-stone-500">
            {text("반복 오류와 오래된 대기 상태를 요약합니다.", "Summarizes repeated issues and stale waiting states.")}
          </div>
        </div>
        <button
          type="button"
          onClick={onCleanupStale}
          disabled={cleanupRunning || staleTotal === 0}
          className="rounded-xl border border-stone-200 px-3 py-2 text-xs font-semibold text-stone-700 transition hover:bg-stone-50 disabled:cursor-not-allowed disabled:border-stone-100 disabled:text-stone-400"
        >
          {cleanupRunning ? text("정리 중", "Cleaning") : text("오래된 대기 정리", "Clean stale waits")}
        </button>
      </div>
      <div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-5">
        {healthItems.map((item) => (
          <div key={item.key} className={`rounded-xl border px-3 py-3 ${statusClassName(item.status)}`}>
            <div className="text-[11px] font-semibold">{healthItemLabel(item.key, text)}</div>
            <div className="mt-1 text-sm font-semibold">{statusLabel(item.status, text)}</div>
            {diagnosticMode ? (
              <div className="mt-1 text-[11px] leading-4 opacity-80">
                {displayText(item.reason)}{item.lastAt ? ` · ${formatTime(item.lastAt)}` : ""}
              </div>
            ) : null}
          </div>
        ))}
      </div>
      <div className="mt-4 grid gap-3 md:grid-cols-2">
        <div className="rounded-xl border border-stone-200 bg-stone-50 px-4 py-3">
          <div className="text-xs font-semibold text-stone-600">{text("반복 오류", "Repeated issues")}</div>
          <div className="mt-2 space-y-2 text-xs text-stone-600">
            {summary.repeatedIssues.length > 0 ? summary.repeatedIssues.slice(0, 5).map((issue) => (
              <div key={issue.key} className="rounded-lg border border-stone-200 bg-white px-3 py-2">
                <div className="flex items-center justify-between gap-3">
                  <span className="font-semibold text-stone-800">{issueKindLabel(issue.kind, text)}</span>
                  <span>{statusLabel(issue.status, text)} · {issue.count}</span>
                </div>
                <div className="mt-1 break-words leading-5 [overflow-wrap:anywhere]">
                  {displayText(issue.sample)}{diagnosticMode && issue.lastAt ? ` · ${formatTime(issue.lastAt)}` : ""}
                </div>
              </div>
            )) : (
              <div className="rounded-lg border border-dashed border-stone-200 bg-white px-3 py-3 text-stone-500">
                {text("반복 오류가 없습니다.", "No repeated issues.")}
              </div>
            )}
          </div>
        </div>
        <div className="rounded-xl border border-stone-200 bg-stone-50 px-4 py-3">
          <div className="text-xs font-semibold text-stone-600">{text("오래된 대기", "Stale waits")}</div>
          <div className="mt-2 text-sm font-semibold text-stone-900">{staleTotal}</div>
          <div className="mt-1 text-xs leading-5 text-stone-500">
            {text(
              `승인 대기 ${summary.stale.pendingApprovals.length}개, 전달 대기 ${summary.stale.pendingDeliveries.length}개, 실행 대기 ${summary.stale.runs.length}개`,
              `${summary.stale.pendingApprovals.length} approvals, ${summary.stale.pendingDeliveries.length} deliveries, ${summary.stale.runs.length} runs`,
            )}
          </div>
          {diagnosticMode && staleTotal > 0 ? (
            <div className="mt-3 space-y-2 text-xs text-stone-600">
              {[...summary.stale.pendingApprovals, ...summary.stale.pendingDeliveries, ...summary.stale.runs].slice(0, 5).map((item) => (
                <div key={item.runId} className="rounded-lg border border-stone-200 bg-white px-3 py-2">
                  <div className="font-semibold text-stone-800">{displayText(item.reason)}</div>
                  <div className="mt-1 break-words [overflow-wrap:anywhere]">{item.runId} · {formatTime(item.updatedAt)}</div>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  )
}

function MemoryTracePanel({
  traces,
  loading,
  error,
  text,
  displayText,
  formatTime,
}: {
  traces: MemoryAccessTraceItem[]
  loading: boolean
  error: string
  text: (ko: string, en: string) => string
  displayText: (value: string) => string
  formatTime: (value: number) => string
}) {
  return (
    <div className="rounded-2xl border border-stone-200 bg-white p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-sm font-semibold text-stone-900">{text("메모리 참조 추적", "Memory access trace")}</div>
          <div className="mt-1 text-xs leading-5 text-stone-500">
            {text("답변에 사용된 메모리 chunk와 source checksum을 운영 진단용으로 표시합니다.", "Shows memory chunks and source checksums used by the answer for diagnostics.")}
          </div>
        </div>
        <span className="rounded-full bg-stone-100 px-2.5 py-1 text-[11px] font-semibold text-stone-600">
          {traces.length}
        </span>
      </div>
      {error ? <div className="mt-3 rounded-xl border border-rose-100 bg-rose-50 px-3 py-2 text-xs text-rose-700">{displayText(error)}</div> : null}
      <div className="mt-4 space-y-2">
        {traces.length > 0 ? traces.slice(0, 8).map((trace) => {
          const score = trace.score == null ? "n/a" : Number(trace.score).toFixed(3)
          const checksum = trace.source_checksum ? trace.source_checksum.slice(0, 12) : "n/a"
          return (
            <div key={trace.id} className="rounded-xl border border-stone-200 bg-stone-50 px-3 py-3 text-xs text-stone-600">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-semibold text-stone-900">{displayText(trace.scope ?? "unknown")} · {displayText(trace.result_source)}</span>
                <span>{formatTime(trace.created_at)}</span>
              </div>
              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                <div>{text("청크", "Chunk")}: {displayText(trace.chunk_id ?? "n/a")}</div>
                <div>{text("체크섬", "Checksum")}: {displayText(checksum)}</div>
                <div>{text("점수", "Score")}: {score}</div>
                <div>{text("지연", "Latency")}: {trace.latency_ms ?? 0}ms</div>
              </div>
              <div className="mt-2 break-words text-stone-500 [overflow-wrap:anywhere]">
                {displayText(trace.reason ?? "accepted")}
              </div>
            </div>
          )
        }) : (
          <div className="rounded-xl border border-dashed border-stone-200 bg-stone-50 px-3 py-3 text-xs text-stone-500">
            {loading ? text("메모리 추적을 불러오는 중입니다.", "Loading memory trace.") : text("이 실행의 메모리 참조 기록이 없습니다.", "No memory trace for this run.")}
          </div>
        )}
      </div>
    </div>
  )
}

function RetrievalEvidencePanel({
  timeline,
  loading,
  error,
  text,
  displayText,
  formatTime,
}: {
  timeline: RetrievalTimeline | null
  loading: boolean
  error: string
  text: (ko: string, en: string) => string
  displayText: (value: string) => string
  formatTime: (value: number) => string
}) {
  const summary = timeline?.summary ?? null
  const events = timeline?.events ?? []
  return (
    <div className="rounded-2xl border border-stone-200 bg-white p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-sm font-semibold text-stone-900">{text("검색 근거", "Retrieval evidence")}</div>
          <div className="mt-1 text-xs leading-5 text-stone-500">
            {text("검색, 후보값, 검증, 전달 상태를 control timeline에서 재구성합니다.", "Reconstructs search, candidates, verdicts, and delivery from the control timeline.")}
          </div>
        </div>
        <span className="rounded-full bg-stone-100 px-2.5 py-1 text-[11px] font-semibold text-stone-600">
          {summary?.total ?? 0}
        </span>
      </div>
      {error ? <div className="mt-3 rounded-xl border border-rose-100 bg-rose-50 px-3 py-2 text-xs text-rose-700">{displayText(error)}</div> : null}
      {summary ? (
        <div className="mt-4 grid gap-2 sm:grid-cols-3">
          <div className="rounded-xl border border-stone-200 bg-stone-50 px-3 py-2 text-xs text-stone-600">{text("시도", "Attempts")}: {summary.attempts}</div>
          <div className="rounded-xl border border-stone-200 bg-stone-50 px-3 py-2 text-xs text-stone-600">{text("후보/검증", "Candidates/Verdicts")}: {summary.candidates}/{summary.verdicts}</div>
          <div className="rounded-xl border border-stone-200 bg-stone-50 px-3 py-2 text-xs text-stone-600">{text("전달", "Delivery")}: {displayText(summary.finalDeliveryStatus ?? "unknown")}</div>
          <div className="rounded-xl border border-stone-200 bg-stone-50 px-3 py-2 text-xs text-stone-600">{text("중복 억제", "Dedupe")}: {summary.dedupeSuppressed}</div>
          <div className="rounded-xl border border-stone-200 bg-stone-50 px-3 py-2 text-xs text-stone-600">{text("충돌", "Conflicts")}: {summary.conflicts}</div>
          <div className="rounded-xl border border-stone-200 bg-stone-50 px-3 py-2 text-xs text-stone-600">{text("중단 사유", "Stop reason")}: {displayText(summary.stopReason ?? "none")}</div>
        </div>
      ) : null}
      <div className="mt-4 space-y-2">
        {events.length > 0 ? events.slice(0, 12).map((event) => {
          const sourceLabel = [event.source.toolName, event.source.method, event.source.domain].filter(Boolean).join(" · ")
          const verdictLabel = event.verdict.acceptedValue
            ? `${event.verdict.acceptedValue}${event.verdict.sufficiency ? ` · ${event.verdict.sufficiency}` : ""}`
            : event.verdict.sufficiency ?? event.verdict.rejectionReason ?? ""
          return (
            <div key={event.id} className="rounded-xl border border-stone-200 bg-stone-50 px-3 py-3 text-xs text-stone-600">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-semibold text-stone-900">{displayText(event.kind)} · {displayText(event.eventType)}</span>
                <span>{formatTime(event.at)}</span>
              </div>
              <div className="mt-1 break-words leading-5 [overflow-wrap:anywhere]">{displayText(event.summary)}</div>
              {sourceLabel || verdictLabel || event.duplicate ? (
                <div className="mt-2 flex flex-wrap gap-2 text-[11px] text-stone-500">
                  {sourceLabel ? <span className="rounded-full bg-white px-2 py-1">{displayText(sourceLabel)}</span> : null}
                  {verdictLabel ? <span className="rounded-full bg-white px-2 py-1">{displayText(verdictLabel)}</span> : null}
                  {event.duplicate ? <span className="rounded-full bg-amber-50 px-2 py-1 text-amber-700">duplicate {event.duplicate.kind} #{event.duplicate.occurrence}</span> : null}
                </div>
              ) : null}
            </div>
          )
        }) : (
          <div className="rounded-xl border border-dashed border-stone-200 bg-stone-50 px-3 py-3 text-xs text-stone-500">
            {loading ? text("검색 근거를 불러오는 중입니다.", "Loading retrieval evidence.") : text("이 실행의 검색 근거 기록이 없습니다.", "No retrieval evidence for this run.")}
          </div>
        )}
      </div>
    </div>
  )
}

function ChannelSmokePanel({
  text,
  formatTime,
}: {
  text: (ko: string, en: string) => string
  formatTime: (value: number) => string
}) {
  const [runs, setRuns] = useState<ChannelSmokeRunSummary[]>([])
  const [loading, setLoading] = useState(false)
  const [runningChannel, setRunningChannel] = useState<ChannelSmokeChannel | "all" | null>(null)
  const [error, setError] = useState("")

  async function loadRuns(): Promise<void> {
    setLoading(true)
    try {
      const response = await api.channelSmokeRuns(5)
      setRuns(response.runs)
      setError("")
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }

  async function startDryRun(channel: ChannelSmokeChannel | "all"): Promise<void> {
    setRunningChannel(channel)
    try {
      await api.startChannelSmokeRun({ mode: "dry-run", ...(channel === "all" ? {} : { channel }) })
      await loadRuns()
      setError("")
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setRunningChannel(null)
    }
  }

  useEffect(() => {
    void loadRuns()
  }, [])

  const channels: Array<{ key: ChannelSmokeChannel | "all"; label: string }> = [
    { key: "all", label: text("전체", "All") },
    { key: "webui", label: "WebUI" },
    { key: "telegram", label: "Telegram" },
    { key: "slack", label: "Slack" },
  ]

  return (
    <div className="rounded-2xl border border-stone-200 bg-white p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-sm font-semibold text-stone-900">{text("채널 Smoke", "Channel smoke")}</div>
          <div className="mt-1 text-xs leading-5 text-stone-500">
            {text("WebUI, Telegram, Slack 전달 경로와 승인 UI를 dry-run으로 점검합니다.", "Checks WebUI, Telegram, and Slack delivery paths and approval UI with dry-run smoke tests.")}
          </div>
        </div>
        <button
          type="button"
          onClick={() => void loadRuns()}
          disabled={loading || runningChannel !== null}
          className="rounded-xl border border-stone-200 px-3 py-2 text-xs font-semibold text-stone-700 transition hover:bg-stone-50 disabled:cursor-not-allowed disabled:border-stone-100 disabled:text-stone-400"
        >
          {loading ? text("갱신 중", "Refreshing") : text("새로고침", "Refresh")}
        </button>
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        {channels.map((channel) => (
          <button
            key={channel.key}
            type="button"
            onClick={() => void startDryRun(channel.key)}
            disabled={runningChannel !== null}
            className="rounded-xl border border-stone-200 px-3 py-2 text-xs font-semibold text-stone-700 transition hover:bg-stone-50 disabled:cursor-not-allowed disabled:border-stone-100 disabled:text-stone-400"
          >
            {runningChannel === channel.key ? text("실행 중", "Running") : text(`${channel.label} 점검`, `${channel.label} check`)}
          </button>
        ))}
      </div>
      {error ? (
        <div className="mt-4 rounded-xl border border-rose-100 bg-rose-50 px-3 py-2 text-xs leading-5 text-rose-700">
          {error}
        </div>
      ) : null}
      <div className="mt-4 space-y-2">
        {runs.length > 0 ? runs.map((run) => (
          <div key={run.id} className="rounded-xl border border-stone-200 bg-stone-50 px-3 py-3 text-xs text-stone-600">
            <div className="flex items-center justify-between gap-3">
              <span className="font-semibold text-stone-900">{run.status}</span>
              <span>{formatTime(run.startedAt)}</span>
            </div>
            <div className="mt-1 leading-5 text-stone-500">{run.summary ?? text("요약 없음", "No summary")}</div>
            <div className="mt-2 flex flex-wrap gap-2">
              <span className="rounded-full bg-white px-2 py-1">{text("통과", "Passed")} {run.counts.passed}</span>
              <span className="rounded-full bg-white px-2 py-1">{text("실패", "Failed")} {run.counts.failed}</span>
              <span className="rounded-full bg-white px-2 py-1">{text("건너뜀", "Skipped")} {run.counts.skipped}</span>
            </div>
          </div>
        )) : (
          <div className="rounded-xl border border-dashed border-stone-200 bg-stone-50 px-3 py-3 text-xs text-stone-500">
            {loading ? text("결과를 불러오는 중입니다.", "Loading results.") : text("아직 smoke 결과가 없습니다.", "No smoke results yet.")}
          </div>
        )}
      </div>
    </div>
  )
}

export function RunsPage() {
  const { text, displayText, formatTime } = useUiI18n()
  const {
    runs,
    tasks,
    operationsSummary,
    selectedRunId,
    ensureInitialized,
    selectRun,
    cancelRun,
    deleteRunHistory,
    clearHistoricalRunHistory,
    cleanupStaleRuns,
  } = useRunsStore()
  const [viewMode, setViewMode] = useState<TaskMonitorViewMode>("normal")
  const [cleanupRunning, setCleanupRunning] = useState(false)
  const [cleanupNotice, setCleanupNotice] = useState<AdvancedCleanupNotice | null>(null)
  const [doctorReport, setDoctorReport] = useState<DoctorReport | null>(null)
  const [doctorLoading, setDoctorLoading] = useState(false)
  const [doctorError, setDoctorError] = useState("")
  const [memoryTrace, setMemoryTrace] = useState<MemoryAccessTraceItem[]>([])
  const [memoryTraceLoading, setMemoryTraceLoading] = useState(false)
  const [memoryTraceError, setMemoryTraceError] = useState("")
  const [retrievalTimeline, setRetrievalTimeline] = useState<RetrievalTimeline | null>(null)
  const [retrievalTimelineLoading, setRetrievalTimelineLoading] = useState(false)
  const [retrievalTimelineError, setRetrievalTimelineError] = useState("")

  useEffect(() => {
    ensureInitialized()
  }, [ensureInitialized])

  const cards = buildTaskMonitorCards(tasks, runs, text)
  const advancedRunItems = buildAdvancedRunListItems(cards, text)
  const advancedRunSummaryCards = buildAdvancedRunSummaryCards(advancedRunItems, text)
  const selectedCard = cards.find((card) => card.key === selectedRunId || card.representative.id === selectedRunId) ?? cards[0] ?? null
  const selectedAdvancedRunItem = advancedRunItems.find((item) => item.key === selectedCard?.key) ?? advancedRunItems[0] ?? null
  const selectedRun = selectedCard?.representative ?? null
  const selectedTimeline = selectedCard?.timeline ?? []
  const visibleTimeline = filterTaskTimelineForMode(selectedTimeline, viewMode)
  const selectedRequestText = selectedCard?.requestText ?? selectedRun?.prompt ?? ""
  const selectedInternalAttempts = selectedCard?.internalAttempts ?? []
  const selectedDeliveryLabel = selectedCard ? describeTaskDeliveryStatus(selectedCard.delivery.status, text) : ""
  const diagnosticMode = viewMode === "diagnostic"
  const historicalCards = cards.filter((card) =>
    ["completed", "failed", "cancelled", "interrupted"].includes(card.representative.status),
  )
  const canDeleteSelected = Boolean(selectedRun && ["completed", "failed", "cancelled", "interrupted"].includes(selectedRun.status))
  const diagnosticStatuses = buildAdvancedDiagnosticStatuses(operationsSummary, retrievalTimeline, text)
  const doctorGuides = buildDoctorActionGuides(doctorReport, text)

  async function refreshDoctor(): Promise<void> {
    setDoctorLoading(true)
    try {
      const response = await api.doctor("quick")
      setDoctorReport(response.report)
      setDoctorError("")
    } catch (error) {
      setDoctorError(error instanceof Error ? error.message : String(error))
    } finally {
      setDoctorLoading(false)
    }
  }

  useEffect(() => {
    if (!diagnosticMode || doctorReport || doctorLoading) return
    void refreshDoctor()
  }, [diagnosticMode])

  useEffect(() => {
    if (!diagnosticMode || !selectedRun) {
      setMemoryTrace([])
      setMemoryTraceError("")
      setMemoryTraceLoading(false)
      return
    }
    let cancelled = false
    setMemoryTraceLoading(true)
    api.runMemoryTrace(selectedRun.id, 100).then(
      (response) => {
        if (cancelled) return
        setMemoryTrace(response.traces)
        setMemoryTraceError("")
      },
      (error) => {
        if (cancelled) return
        setMemoryTrace([])
        setMemoryTraceError(error instanceof Error ? error.message : String(error))
      },
    ).finally(() => {
      if (!cancelled) setMemoryTraceLoading(false)
    })
    return () => { cancelled = true }
  }, [diagnosticMode, selectedRun?.id])

  useEffect(() => {
    if (!diagnosticMode || !selectedRun) {
      setRetrievalTimeline(null)
      setRetrievalTimelineError("")
      setRetrievalTimelineLoading(false)
      return
    }
    let cancelled = false
    setRetrievalTimelineLoading(true)
    api.runRetrievalTimeline(selectedRun.id, 500).then(
      (response) => {
        if (cancelled) return
        setRetrievalTimeline(response.timeline)
        setRetrievalTimelineError("")
      },
      (error) => {
        if (cancelled) return
        setRetrievalTimeline(null)
        setRetrievalTimelineError(error instanceof Error ? error.message : String(error))
      },
    ).finally(() => {
      if (!cancelled) setRetrievalTimelineLoading(false)
    })
    return () => { cancelled = true }
  }, [diagnosticMode, selectedRun?.id])

  async function handleDeleteSelected(): Promise<void> {
    if (!selectedRun) return
    const confirmed = window.confirm(
      text(
        "선택한 실행 기록을 정리할까요? 관련된 하위 실행과 전달 기록도 함께 지워집니다.",
        "Clear the selected activity record? Related child runs and delivery records will also be removed.",
      ),
    )
    if (!confirmed) return
    try {
      const result = await deleteRunHistory(selectedRun.id)
      setCleanupNotice(buildCleanupNoticeFromDeleteResult(result.deletedRunCount, text))
    } catch (error) {
      setCleanupNotice({
        kind: "error",
        message: error instanceof Error ? error.message : String(error),
        auditHint: text("실행 기록 정리에 실패했습니다. 감사 로그와 서버 로그를 확인하세요.", "Failed to clear activity history. Check audit logs and server logs."),
      })
    }
  }

  async function handleClearHistoricalHistory(): Promise<void> {
    if (historicalCards.length === 0) return
    const confirmed = window.confirm(
      text(
        "완료된 이전 실행 기록을 모두 정리할까요? 현재 진행 중인 항목은 남겨둡니다.",
        "Clear all completed past activity records? Active items will be kept.",
      ),
    )
    if (!confirmed) return
    try {
      const result = await clearHistoricalRunHistory()
      setCleanupNotice(buildCleanupNoticeFromDeleteResult(result.deletedRunCount, text))
    } catch (error) {
      setCleanupNotice({
        kind: "error",
        message: error instanceof Error ? error.message : String(error),
        auditHint: text("이전 기록 정리에 실패했습니다. 감사 로그와 서버 로그를 확인하세요.", "Failed to clear past activity history. Check audit logs and server logs."),
      })
    }
  }

  async function handleCleanupStaleRuns(): Promise<void> {
    if (!operationsSummary || operationsSummary.stale.total === 0 || cleanupRunning) return
    const confirmed = window.confirm(
      text(
        "오래된 승인/전달/실행 대기 상태를 정리할까요? 진행 중인 항목은 삭제하지 않고 중단 처리만 합니다.",
        "Clean stale approval, delivery, and run waits? Active items will not be deleted; they will be marked interrupted.",
      ),
    )
    if (!confirmed) return
    setCleanupRunning(true)
    try {
      const result = await cleanupStaleRuns()
      setCleanupNotice(buildCleanupNoticeFromStaleResult(result, text))
    } catch (error) {
      setCleanupNotice({
        kind: "error",
        message: error instanceof Error ? error.message : String(error),
        auditHint: text("오래된 대기 정리에 실패했습니다. 운영 상태와 감사 로그를 확인하세요.", "Failed to clean stale waits. Check operational health and audit logs."),
      })
    } finally {
      setCleanupRunning(false)
    }
  }

  return (
    <div className="flex h-full overflow-hidden bg-stone-100">
      <div className="flex w-[28rem] shrink-0 flex-col border-r border-stone-200 bg-white">
        <div className="border-b border-stone-200 px-5 py-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-xs font-semibold uppercase tracking-[0.2em] text-stone-500">{text("실행 현황", "Activity Monitor")}</div>
              <div className="mt-2 text-xl font-semibold text-stone-900">{text("실행 현황", "Activity monitor")}</div>
              <div className="mt-2 text-xs leading-5 text-stone-500">
                {text("현재 진행 중이거나 최근에 처리된 항목을 한곳에서 확인합니다. 모두 같은 AI 연결을 공유합니다.", "Review active and recent items in one place. They all share the same AI connection.")}
              </div>
            </div>
            <button
              type="button"
              onClick={() => void handleClearHistoricalHistory()}
              disabled={historicalCards.length === 0}
              className="rounded-xl border border-stone-200 px-3 py-2 text-xs font-semibold text-stone-700 transition hover:bg-stone-50 disabled:cursor-not-allowed disabled:border-stone-100 disabled:text-stone-400"
            >
              {text("이전 기록 정리", "Clear past items")}
            </button>
          </div>
          <div className="mt-4 inline-flex rounded-2xl border border-stone-200 bg-stone-50 p-1">
            {(["normal", "diagnostic"] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                onClick={() => setViewMode(mode)}
                className={`rounded-xl px-3 py-1.5 text-xs font-semibold transition ${viewMode === mode ? "bg-white text-stone-900 shadow-sm" : "text-stone-500 hover:text-stone-800"}`}
              >
                {mode === "normal" ? text("일반 보기", "Normal") : text("진단 보기", "Diagnostics")}
              </button>
            ))}
          </div>
          <AdvancedRunSummaryStrip cards={advancedRunSummaryCards} />
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          <div className="space-y-3">
            {cards.map((card) => (
              <RunStatusCard
                key={card.key}
                run={card.representative}
                treeNodes={card.treeNodes}
                selected={card.key === selectedCard?.key}
                onSelect={() => selectRun(card.key)}
                onCancel={card.representative.canCancel ? () => void cancelRun(card.representative.id) : undefined}
                extraContent={(
                  <div className="space-y-3">
                    {advancedRunItems.find((item) => item.key === card.key) ? (
                      <AdvancedRunListMeta
                        item={advancedRunItems.find((item) => item.key === card.key)!}
                        formatTime={formatTime}
                        text={text}
                        displayText={displayText}
                      />
                    ) : null}
                    <TaskMonitorBadges
                      attemptCount={card.attempts.length}
                      internalAttemptCount={card.internalAttempts.length}
                      checklistLabel={describeTaskChecklistProgress(card.checklist, text)}
                      deliveryLabel={describeTaskDeliveryStatus(card.delivery.status, text)}
                      showDiagnostics={diagnosticMode}
                      text={text}
                    />
                  </div>
                )}
              />
            ))}
          </div>
        </div>
      </div>

      <div className="flex min-w-0 flex-1 flex-col overflow-y-auto p-6">
        {cleanupNotice ? (
          <div className={`mb-4 rounded-2xl border px-4 py-3 text-sm leading-6 ${cleanupNotice.kind === "success" ? "border-emerald-100 bg-emerald-50 text-emerald-800" : "border-rose-100 bg-rose-50 text-rose-800"}`}>
            <div className="font-semibold">{displayText(cleanupNotice.message)}</div>
            <div className="text-xs opacity-80">{displayText(cleanupNotice.auditHint)}</div>
          </div>
        ) : null}
        {selectedRun ? (
          <div className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
            <div className="space-y-6">
              {selectedAdvancedRunItem ? (
                <AdvancedRunOperationalPanel
                  item={selectedAdvancedRunItem}
                  text={text}
                  displayText={displayText}
                  formatTime={formatTime}
                />
              ) : null}
              <RunSummaryPanel
                run={selectedRun}
                diagnosticMode={diagnosticMode}
                extraContent={(
                  <div className="space-y-4">
                    <div className="flex flex-wrap justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => void handleDeleteSelected()}
                        disabled={!canDeleteSelected}
                        className="rounded-xl border border-stone-200 px-3 py-2 text-xs font-semibold text-stone-700 transition hover:bg-stone-50 disabled:cursor-not-allowed disabled:border-stone-100 disabled:text-stone-400"
                      >
                        {text("이 항목 정리", "Clear this item")}
                      </button>
                    </div>
                    <TaskChecklistPanel
                      checklist={selectedCard?.checklist ?? {
                        items: [],
                        completedCount: 0,
                        actionableCount: 0,
                        failedCount: 0,
                      }}
                      text={text}
                      displayText={displayText}
                    />
                    {selectedCard?.failure ? (
                      <TaskFailurePanel
                        failure={selectedCard.failure}
                        text={text}
                        displayText={displayText}
                      />
                    ) : null}
                    {selectedCard?.delivery.artifact ? (
                      <TaskArtifactPanel
                        artifact={selectedCard.delivery.artifact}
                        title={text("전달된 파일", "Delivered file")}
                        text={text}
                      />
                    ) : null}
                    {diagnosticMode && selectedCard ? (
                      <TaskDiagnosticsPanel
                        card={selectedCard}
                        text={text}
                        displayText={displayText}
                      />
                    ) : null}
                    <div className={`grid gap-3 ${diagnosticMode ? "md:grid-cols-3" : "md:grid-cols-2"}`}>
                      <div className="rounded-xl border border-stone-200 bg-stone-50 px-4 py-3">
                        <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-stone-500">{text("실행 횟수", "Run count")}</div>
                        <div className="mt-2 text-sm font-medium text-stone-900">{selectedCard?.attempts.length ?? 0}</div>
                      </div>
                      {diagnosticMode ? (
                        <div className="rounded-xl border border-stone-200 bg-stone-50 px-4 py-3">
                          <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-stone-500">{text("내부 재시도", "Internal retries")}</div>
                          <div className="mt-2 text-sm font-medium text-stone-900">{selectedInternalAttempts.length}</div>
                        </div>
                      ) : null}
                      <div className="rounded-xl border border-stone-200 bg-stone-50 px-4 py-3">
                        <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-stone-500">{text("결과 전달 상태", "Result delivery status")}</div>
                        <div className="mt-2 text-sm font-medium text-stone-900">{selectedDeliveryLabel}</div>
                      </div>
                    </div>
                    {diagnosticMode && selectedInternalAttempts.length > 0 ? (
                      <div className="rounded-2xl border border-stone-200 bg-stone-50 px-4 py-4">
                        <div className="text-xs font-semibold text-stone-500">{text("내부 재시도 기록", "Internal retry history")}</div>
                        <div className="mt-3 space-y-2">
                          {selectedInternalAttempts.map((attempt) => (
                            <div key={attempt.id} className="rounded-xl border border-stone-200 bg-white px-3 py-2.5">
                              <div className="text-sm font-medium text-stone-900">{attempt.label}</div>
                              <div className="mt-1 break-words text-xs text-stone-500 [overflow-wrap:anywhere]">
                                {displayText(attempt.summary || attempt.prompt || attempt.run?.prompt || attempt.label)}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    ) : null}
                  </div>
                )}
              />
              <div className="rounded-2xl border border-stone-200 bg-white p-5">
                <div className="mb-4 text-sm font-semibold text-stone-900">{text("진행 단계", "Progress steps")}</div>
                <RunStepTimeline steps={selectedRun.steps} />
              </div>
            </div>
            <div className="space-y-6">
              <OperationsHealthPanel
                summary={operationsSummary}
                diagnosticMode={diagnosticMode}
                cleanupRunning={cleanupRunning}
                onCleanupStale={() => void handleCleanupStaleRuns()}
                text={text}
                displayText={displayText}
                formatTime={formatTime}
              />
              <AdvancedDiagnosticsSummaryPanel
                statuses={diagnosticStatuses}
                doctorGuides={doctorGuides}
                doctorLoading={doctorLoading}
                doctorError={doctorError}
                onRefreshDoctor={() => void refreshDoctor()}
                text={text}
                displayText={displayText}
              />
              {diagnosticMode ? (
                <MemoryTracePanel
                  traces={memoryTrace}
                  loading={memoryTraceLoading}
                  error={memoryTraceError}
                  text={text}
                  displayText={displayText}
                  formatTime={formatTime}
                />
              ) : null}
              {diagnosticMode ? (
                <RetrievalEvidencePanel
                  timeline={retrievalTimeline}
                  loading={retrievalTimelineLoading}
                  error={retrievalTimelineError}
                  text={text}
                  displayText={displayText}
                  formatTime={formatTime}
                />
              ) : null}
              <ChannelSmokePanel text={text} formatTime={formatTime} />
              <RunEventFeed
                events={visibleTimeline.map((item) => ({
                  id: item.id,
                  at: item.at,
                  label: `[${item.runLabel}] ${displayText(item.label)}`,
                }))}
              />
              <div className="rounded-2xl border border-stone-200 bg-white p-5">
                <div className="mb-2 text-sm font-semibold text-stone-900">{text("원래 요청", "Original request")}</div>
                <p className="text-sm leading-6 text-stone-600">{selectedRequestText}</p>
              </div>
            </div>
          </div>
        ) : (
          <EmptyState
            title={text("표시할 항목이 없습니다", "No items to display")}
            description={text("채팅에서 메시지를 보내면 실행 이력이 여기에 표시됩니다.", "Items created from chat will appear here.")}
          />
        )}
      </div>
    </div>
  )
}
