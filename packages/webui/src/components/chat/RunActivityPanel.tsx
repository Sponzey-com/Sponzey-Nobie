import type { RootRun } from "../../contracts/runs"
import { useUiI18n } from "../../lib/ui-i18n"
import { toRunStatusText } from "../runs/runLabels"

function getActivityLabel(run: RootRun, text: (ko: string, en: string) => string): string {
  switch (run.currentStepKey) {
    case "received":
    case "classified":
    case "target_selected":
      return text("대화 준비 중", "Preparing the conversation")
    case "executing":
    case "reviewing":
    case "finalizing":
      return text("작업 진행 중", "Working")
    case "awaiting_approval":
      return text("승인 대기 중", "Waiting for approval")
    case "awaiting_user":
      return text("추가 입력 대기 중", "Waiting for user input")
    default:
      return text("작업 상태", "Task status")
  }
}

export function RunActivityPanel({ run }: { run: RootRun }) {
  const recentEvents = run.recentEvents.slice(0, 3)
  const { text, displayText, language } = useUiI18n()

  return (
    <div className="mb-4 min-w-0 rounded-2xl border border-amber-200 bg-amber-50/80 px-4 py-4">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="text-xs font-semibold uppercase tracking-[0.18em] text-amber-700">{getActivityLabel(run, text)}</div>
          <div className="mt-2 break-words text-sm font-semibold text-stone-900 [overflow-wrap:anywhere]">
            {text(`단계 ${run.currentStepIndex}/${run.totalSteps}`, `Step ${run.currentStepIndex}/${run.totalSteps}`)} · {run.title}
          </div>
        </div>
        <div className="rounded-full bg-white/80 px-3 py-1 text-[11px] font-semibold text-amber-800">
          {toRunStatusText(run.status, language)}
        </div>
      </div>

      <div className="mt-3 rounded-xl bg-white/80 px-4 py-3">
        <div className="text-xs font-semibold text-stone-500">{text("현재 상황", "Current situation")}</div>
        <div className="mt-2 break-words text-sm leading-6 text-stone-700 [overflow-wrap:anywhere]">{displayText(run.summary)}</div>
      </div>

      {recentEvents.length > 0 ? (
        <div className="mt-3">
          <div className="text-xs font-semibold text-stone-500">{text("최근 액션", "Recent actions")}</div>
          <div className="mt-2 space-y-2">
            {recentEvents.map((event) => (
              <div
                key={event.id}
                className="break-words rounded-xl bg-white/70 px-3 py-2 text-sm text-stone-700 [overflow-wrap:anywhere]"
              >
                {displayText(event.label)}
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  )
}
