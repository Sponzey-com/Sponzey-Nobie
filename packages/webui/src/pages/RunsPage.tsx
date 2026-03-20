import { useEffect } from "react"
import { EmptyState } from "../components/EmptyState"
import { RunEventFeed } from "../components/runs/RunEventFeed"
import { RunStatusCard } from "../components/runs/RunStatusCard"
import { RunStepTimeline } from "../components/runs/RunStepTimeline"
import { RunSummaryPanel } from "../components/runs/RunSummaryPanel"
import { useUiI18n } from "../lib/ui-i18n"
import { useRunsStore } from "../stores/runs"

export function RunsPage() {
  const { text } = useUiI18n()
  const { runs, selectedRunId, ensureInitialized, selectRun, cancelRun } = useRunsStore()

  useEffect(() => {
    ensureInitialized()
  }, [ensureInitialized])

  const selectedRun = runs.find((run) => run.id === selectedRunId) ?? runs[0] ?? null

  return (
    <div className="flex h-full overflow-hidden bg-stone-100">
      <div className="w-[26rem] shrink-0 border-r border-stone-200 bg-white">
        <div className="border-b border-stone-200 px-5 py-5">
          <div className="text-xs font-semibold uppercase tracking-[0.2em] text-stone-500">Run Monitor</div>
          <div className="mt-2 text-xl font-semibold text-stone-900">{text("실행 상태 모니터", "Run monitor")}</div>
        </div>
        <div className="h-[calc(100%-6.25rem)] overflow-y-auto p-4">
          <div className="space-y-3">
            {runs.map((run) => (
              <RunStatusCard
                key={run.id}
                run={run}
                selected={run.id === selectedRun?.id}
                onSelect={() => selectRun(run.id)}
                onCancel={() => void cancelRun(run.id)}
              />
            ))}
          </div>
        </div>
      </div>

      <div className="flex min-w-0 flex-1 flex-col overflow-y-auto p-6">
        {selectedRun ? (
          <div className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
            <div className="space-y-6">
              <RunSummaryPanel run={selectedRun} />
              <div className="rounded-2xl border border-stone-200 bg-white p-5">
                <div className="mb-4 text-sm font-semibold text-stone-900">{text("단계 타임라인", "Step timeline")}</div>
                <RunStepTimeline steps={selectedRun.steps} />
              </div>
            </div>
            <div className="space-y-6">
              <RunEventFeed events={selectedRun.recentEvents} />
              <div className="rounded-2xl border border-stone-200 bg-white p-5">
                <div className="mb-2 text-sm font-semibold text-stone-900">{text("프롬프트", "Prompt")}</div>
                <p className="text-sm leading-6 text-stone-600">{selectedRun.prompt}</p>
              </div>
            </div>
          </div>
        ) : (
          <EmptyState
            title={text("표시할 run이 없습니다", "No runs to display")}
            description={text("채팅에서 메시지를 보내면 실행 이력이 여기에 표시됩니다.", "Runs created from chat will appear here.")}
          />
        )}
      </div>
    </div>
  )
}
