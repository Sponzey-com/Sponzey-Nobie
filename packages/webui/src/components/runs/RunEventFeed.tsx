import type { RunEvent } from "../../contracts/runs"
import { useUiI18n } from "../../lib/ui-i18n"
import { CollapsibleText } from "./CollapsibleText"

export function RunEventFeed({ events }: { events: RunEvent[] }) {
  const { text, displayText, formatTime } = useUiI18n()

  return (
    <div className="rounded-2xl border border-stone-200 bg-white p-5">
      <div className="mb-4 text-sm font-semibold text-stone-900">{text("최근 이벤트", "Recent events")}</div>
      <div className="space-y-3">
        {events.map((event) => (
          <div key={event.id} className="flex items-start justify-between gap-4 text-sm">
            <CollapsibleText
              value={displayText(event.label)}
              threshold={160}
              clampLines={2}
              showMoreLabel={text("전체 보기", "Show more")}
              showLessLabel={text("접기", "Show less")}
              className="min-w-0 flex-1 break-words text-stone-700 [overflow-wrap:anywhere]"
              buttonClassName="mt-1 inline-flex text-xs font-semibold text-stone-600 underline-offset-2 hover:underline"
            />
            <div className="shrink-0 text-xs text-stone-400">{formatTime(event.at)}</div>
          </div>
        ))}
      </div>
    </div>
  )
}
