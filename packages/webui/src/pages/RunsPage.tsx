import { useEffect } from "react"
import { EmptyState } from "../components/EmptyState"
import { RunEventFeed } from "../components/runs/RunEventFeed"
import { RunStatusCard } from "../components/runs/RunStatusCard"
import { RunStepTimeline } from "../components/runs/RunStepTimeline"
import { RunSummaryPanel } from "../components/runs/RunSummaryPanel"
import { buildTaskMonitorCards, describeTaskDeliveryStatus } from "../lib/task-monitor"
import { useUiI18n } from "../lib/ui-i18n"
import { useRunsStore } from "../stores/runs"

function TaskMonitorBadges({
  attemptCount,
  internalAttemptCount,
  deliveryLabel,
  text,
}: {
  attemptCount: number
  internalAttemptCount: number
  deliveryLabel: string
  text: (ko: string, en: string) => string
}) {
  return (
    <div className="flex flex-wrap gap-2">
      <span className="inline-flex items-center rounded-full bg-stone-100 px-2.5 py-1 text-[11px] text-stone-700">
        {text("시도", "Attempts")} {attemptCount}
      </span>
      {internalAttemptCount > 0 ? (
        <span className="inline-flex items-center rounded-full bg-amber-50 px-2.5 py-1 text-[11px] text-amber-700">
          {text("내부 시도", "Internal")} {internalAttemptCount}
        </span>
      ) : null}
      <span className="inline-flex items-center rounded-full bg-stone-100 px-2.5 py-1 text-[11px] text-stone-700">
        {text("전달", "Delivery")} {deliveryLabel}
      </span>
    </div>
  )
}

export function RunsPage() {
  const { text, displayText } = useUiI18n()
  const { runs, tasks, selectedRunId, ensureInitialized, selectRun, cancelRun } = useRunsStore()

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

  return (
    <div className="flex h-full overflow-hidden bg-stone-100">
      <div className="w-[28rem] shrink-0 border-r border-stone-200 bg-white">
        <div className="border-b border-stone-200 px-5 py-5">
          <div className="text-xs font-semibold uppercase tracking-[0.2em] text-stone-500">Task Monitor</div>
          <div className="mt-2 text-xl font-semibold text-stone-900">{text("태스크 상태 모니터", "Task monitor")}</div>
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
                    <div className="grid gap-3 md:grid-cols-3">
                      <div className="rounded-xl border border-stone-200 bg-stone-50 px-4 py-3">
                        <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-stone-500">{text("태스크 시도", "Task attempts")}</div>
                        <div className="mt-2 text-sm font-medium text-stone-900">{selectedCard?.attempts.length ?? 0}</div>
                      </div>
                      <div className="rounded-xl border border-stone-200 bg-stone-50 px-4 py-3">
                        <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-stone-500">{text("내부 시도", "Internal attempts")}</div>
                        <div className="mt-2 text-sm font-medium text-stone-900">{selectedInternalAttempts.length}</div>
                      </div>
                      <div className="rounded-xl border border-stone-200 bg-stone-50 px-4 py-3">
                        <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-stone-500">{text("전달 상태", "Delivery status")}</div>
                        <div className="mt-2 text-sm font-medium text-stone-900">{selectedDeliveryLabel}</div>
                      </div>
                    </div>
                    {selectedInternalAttempts.length > 0 ? (
                      <div className="rounded-2xl border border-stone-200 bg-stone-50 px-4 py-4">
                        <div className="text-xs font-semibold text-stone-500">{text("내부 디버그 시도", "Internal debug attempts")}</div>
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
                <div className="mb-4 text-sm font-semibold text-stone-900">{text("단계 타임라인", "Step timeline")}</div>
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
            title={text("표시할 태스크가 없습니다", "No tasks to display")}
            description={text("채팅에서 메시지를 보내면 태스크 이력이 여기에 표시됩니다.", "Tasks created from chat will appear here.")}
          />
        )}
      </div>
    </div>
  )
}
