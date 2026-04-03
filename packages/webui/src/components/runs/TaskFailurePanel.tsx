import type { TaskMonitorFailure } from "../../lib/task-monitor"

export function TaskFailurePanel({
  failure,
  text,
  displayText,
}: {
  failure: TaskMonitorFailure
  text: (ko: string, en: string) => string
  displayText: (value: string) => string
}) {
  return (
    <div className="rounded-2xl border border-red-200 bg-red-50/80 p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-xs font-semibold uppercase tracking-[0.16em] text-red-600">
            {text("실패 원인", "Failure reason")}
          </div>
          <div className="mt-2 text-sm font-semibold text-red-900">{displayText(failure.title)}</div>
        </div>
        <span className="rounded-full bg-white px-2.5 py-1 text-[11px] font-medium text-red-700">
          {displayText(failure.sourceAttemptLabel || failure.status)}
        </span>
      </div>
      <div className="mt-3 break-words text-sm leading-6 text-red-900 [overflow-wrap:anywhere]">
        {displayText(failure.summary)}
      </div>
      {failure.detailLines.length > 0 ? (
        <div className="mt-3 space-y-2">
          {failure.detailLines.map((detail, index) => (
            <div
              key={`${failure.title}:${index}`}
              className="rounded-xl border border-red-100 bg-white/80 px-3 py-2 text-sm leading-6 text-red-800 break-words [overflow-wrap:anywhere]"
            >
              {displayText(detail)}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  )
}
