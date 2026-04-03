import type { TaskMonitorChecklist, TaskMonitorChecklistItem, TaskMonitorChecklistItemStatus } from "../../lib/task-monitor"

function describeChecklistMarker(status: TaskMonitorChecklistItemStatus): string {
  switch (status) {
    case "completed":
      return "[x]"
    case "running":
      return "[~]"
    case "failed":
      return "[!]"
    case "cancelled":
      return "[-]"
    case "not_required":
      return "[·]"
    default:
      return "[ ]"
  }
}

function describeChecklistStatus(status: TaskMonitorChecklistItemStatus, text: (ko: string, en: string) => string): string {
  switch (status) {
    case "completed":
      return text("완료", "Completed")
    case "running":
      return text("진행 중", "Running")
    case "failed":
      return text("실패", "Failed")
    case "cancelled":
      return text("취소", "Cancelled")
    case "not_required":
      return text("불필요", "Not required")
    default:
      return text("대기", "Pending")
  }
}

function resolveChecklistTone(status: TaskMonitorChecklistItemStatus): string {
  switch (status) {
    case "completed":
      return "border-emerald-200 bg-emerald-50/80 text-emerald-700"
    case "running":
      return "border-blue-200 bg-blue-50/80 text-blue-700"
    case "failed":
      return "border-red-200 bg-red-50/80 text-red-700"
    case "cancelled":
      return "border-amber-200 bg-amber-50/80 text-amber-700"
    case "not_required":
      return "border-stone-200 bg-stone-100 text-stone-500"
    default:
      return "border-stone-200 bg-stone-100 text-stone-600"
  }
}

function ChecklistRow({
  item,
  text,
  displayText,
}: {
  item: TaskMonitorChecklistItem
  text: (ko: string, en: string) => string
  displayText: (value: string) => string
}) {
  return (
    <div className="rounded-xl border border-stone-200 bg-white px-3 py-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-3">
            <span className="font-mono text-xs font-semibold text-stone-500">{describeChecklistMarker(item.status)}</span>
            <span className="text-sm font-medium text-stone-900">{item.label}</span>
          </div>
          {item.summary ? (
            <div className="mt-2 break-words pl-9 text-sm leading-6 text-stone-600 [overflow-wrap:anywhere]">
              {displayText(item.summary)}
            </div>
          ) : null}
        </div>
        <span className={`shrink-0 rounded-full border px-2.5 py-1 text-[11px] font-medium ${resolveChecklistTone(item.status)}`}>
          {describeChecklistStatus(item.status, text)}
        </span>
      </div>
    </div>
  )
}

export function TaskChecklistPanel({
  checklist,
  text,
  displayText,
}: {
  checklist: TaskMonitorChecklist
  text: (ko: string, en: string) => string
  displayText: (value: string) => string
}) {
  return (
    <div className="rounded-2xl border border-stone-200 bg-stone-50/70 p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-xs font-semibold uppercase tracking-[0.16em] text-stone-500">
            {text("체크리스트 진행", "Checklist progress")}
          </div>
          <div className="mt-2 text-sm font-semibold text-stone-900">
            {text("요청을 단계별 상태로 추적합니다.", "Track the request as step-by-step status.")}
          </div>
        </div>
        <span className="rounded-full bg-white px-3 py-1 text-xs font-semibold text-stone-700">
          {checklist.completedCount}/{checklist.actionableCount}
        </span>
      </div>
      <div className="mt-3 space-y-2">
        {checklist.items.map((item) => (
          <ChecklistRow
            key={item.key}
            item={item}
            text={text}
            displayText={displayText}
          />
        ))}
      </div>
    </div>
  )
}
