import { useEffect } from "react"
import { EmptyState } from "../components/EmptyState"
import { RunEventFeed } from "../components/runs/RunEventFeed"
import { RunStatusCard } from "../components/runs/RunStatusCard"
import { TaskArtifactPanel } from "../components/runs/TaskArtifactPanel"
import { RunStepTimeline } from "../components/runs/RunStepTimeline"
import { RunSummaryPanel } from "../components/runs/RunSummaryPanel"
import { TaskChecklistPanel } from "../components/runs/TaskChecklistPanel"
import { TaskFailurePanel } from "../components/runs/TaskFailurePanel"
import { buildTaskMonitorCards, describeTaskChecklistProgress, describeTaskDeliveryStatus } from "../lib/task-monitor"
import type { TaskMonitorCard } from "../lib/task-monitor"
import { useUiI18n } from "../lib/ui-i18n"
import { useRunsStore } from "../stores/runs"

function TaskMonitorBadges({
  attemptCount,
  internalAttemptCount,
  checklistLabel,
  deliveryLabel,
  text,
}: {
  attemptCount: number
  internalAttemptCount: number
  checklistLabel: string
  deliveryLabel: string
  text: (ko: string, en: string) => string
}) {
  return (
    <div className="flex flex-wrap gap-2">
      <span className="inline-flex items-center rounded-full bg-stone-100 px-2.5 py-1 text-[11px] text-stone-700">
        {text("실행", "Runs")} {attemptCount}
      </span>
      {internalAttemptCount > 0 ? (
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

  const promptSourceLabel = diagnostics?.promptSourceIds.length
    ? diagnostics.promptSourceIds.join(", ")
    : text("기록 없음", "Not recorded")
  const latencyLabel = diagnostics?.latencyEvents.length
    ? diagnostics.latencyEvents.join(" · ")
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

export function RunsPage() {
  const { text, displayText } = useUiI18n()
  const {
    runs,
    tasks,
    selectedRunId,
    ensureInitialized,
    selectRun,
    cancelRun,
    deleteRunHistory,
    clearHistoricalRunHistory,
  } = useRunsStore()

  useEffect(() => {
    ensureInitialized()
  }, [ensureInitialized])

  const cards = buildTaskMonitorCards(tasks, runs, text)
  const selectedCard = cards.find((card) => card.key === selectedRunId || card.representative.id === selectedRunId) ?? cards[0] ?? null
  const selectedRun = selectedCard?.representative ?? null
  const selectedTimeline = selectedCard?.timeline ?? []
  const selectedRequestText = selectedCard?.requestText ?? selectedRun?.prompt ?? ""
  const selectedInternalAttempts = selectedCard?.internalAttempts ?? []
  const selectedDeliveryLabel = selectedCard ? describeTaskDeliveryStatus(selectedCard.delivery.status, text) : ""
  const historicalCards = cards.filter((card) =>
    ["completed", "failed", "cancelled", "interrupted"].includes(card.representative.status),
  )
  const canDeleteSelected = Boolean(selectedRun && ["completed", "failed", "cancelled", "interrupted"].includes(selectedRun.status))

  async function handleDeleteSelected(): Promise<void> {
    if (!selectedRun) return
    const confirmed = window.confirm(
      text(
        "선택한 실행 기록을 정리할까요? 관련된 하위 실행과 전달 기록도 함께 지워집니다.",
        "Clear the selected activity record? Related child runs and delivery records will also be removed.",
      ),
    )
    if (!confirmed) return
    await deleteRunHistory(selectedRun.id)
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
    await clearHistoricalRunHistory()
  }

  return (
    <div className="flex h-full overflow-hidden bg-stone-100">
      <div className="w-[28rem] shrink-0 border-r border-stone-200 bg-white">
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
        </div>
        <div className="h-[calc(100%-6.25rem)] overflow-y-auto p-4">
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
                  <TaskMonitorBadges
                    attemptCount={card.attempts.length}
                    internalAttemptCount={card.internalAttempts.length}
                    checklistLabel={describeTaskChecklistProgress(card.checklist, text)}
                    deliveryLabel={describeTaskDeliveryStatus(card.delivery.status, text)}
                    text={text}
                  />
                )}
              />
            ))}
          </div>
        </div>
      </div>

      <div className="flex min-w-0 flex-1 flex-col overflow-y-auto p-6">
        {selectedRun ? (
          <div className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
            <div className="space-y-6">
              <RunSummaryPanel
                run={selectedRun}
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
                    {selectedCard ? (
                      <TaskDiagnosticsPanel
                        card={selectedCard}
                        text={text}
                        displayText={displayText}
                      />
                    ) : null}
                    <div className="grid gap-3 md:grid-cols-3">
                      <div className="rounded-xl border border-stone-200 bg-stone-50 px-4 py-3">
                        <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-stone-500">{text("실행 횟수", "Run count")}</div>
                        <div className="mt-2 text-sm font-medium text-stone-900">{selectedCard?.attempts.length ?? 0}</div>
                      </div>
                      <div className="rounded-xl border border-stone-200 bg-stone-50 px-4 py-3">
                        <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-stone-500">{text("내부 재시도", "Internal retries")}</div>
                        <div className="mt-2 text-sm font-medium text-stone-900">{selectedInternalAttempts.length}</div>
                      </div>
                      <div className="rounded-xl border border-stone-200 bg-stone-50 px-4 py-3">
                        <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-stone-500">{text("결과 전달 상태", "Result delivery status")}</div>
                        <div className="mt-2 text-sm font-medium text-stone-900">{selectedDeliveryLabel}</div>
                      </div>
                    </div>
                    {selectedInternalAttempts.length > 0 ? (
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
              <RunEventFeed
                events={selectedTimeline.map((item) => ({
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
