import type { RunEvent } from "../../contracts/runs"
import { useUiI18n } from "../../lib/ui-i18n"

export function RunEventFeed({ events }: { events: RunEvent[] }) {
  const { text, displayText, formatTime } = useUiI18n()

  return (
    <div className="rounded-2xl border border-stone-200 bg-white p-5">
      <div className="mb-4 text-sm font-semibold text-stone-900">{text("최근 이벤트", "Recent events")}</div>
      <div className="space-y-3">
        {events.map((event) => (
          <div key={event.id} className="flex items-start justify-between gap-4 text-sm">
            <div className="text-stone-700">{displayText(event.label)}</div>
            <div className="shrink-0 text-xs text-stone-400">{formatTime(event.at)}</div>
          </div>
        ))}
      </div>
    </div>
  )
}
