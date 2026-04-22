import * as React from "react"
import type { PendingDropAction, PendingDropActionOption } from "../../lib/orchestration-board"
import { trapOrchestrationFocus } from "../../lib/orchestration-shortcuts"
import { pickUiText, type UiLanguage } from "../../stores/uiLanguage"

export function OrchestrationDropMenu({
  pendingDrop,
  language,
  onChoose,
  onCancel,
}: {
  pendingDrop: PendingDropAction
  language: UiLanguage
  onChoose: (optionId: PendingDropActionOption["id"]) => void
  onCancel?: () => void
}) {
  const rootRef = React.useRef<HTMLElement | null>(null)

  React.useEffect(() => {
    rootRef.current?.focus()
  }, [pendingDrop.entityId, pendingDrop.openedAt])

  return (
    <section
      ref={rootRef}
      role="dialog"
      aria-modal="true"
      aria-label={pendingDrop.title}
      tabIndex={-1}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault()
          if (onCancel) onCancel()
          else onChoose("cancel")
          return
        }
        trapOrchestrationFocus(event.nativeEvent, rootRef.current)
      }}
      className="rounded-[1.6rem] border border-stone-200 bg-white p-5 shadow-sm"
      data-orchestration-drop-menu={pendingDrop.entityId}
      data-orchestration-focus-trap="drop-menu"
    >
      <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-stone-500">
        {pickUiText(language, "드롭 액션", "Drop action")}
      </div>
      <h3 className="mt-2 text-lg font-semibold text-stone-950">{pendingDrop.title}</h3>
      <p className="mt-2 text-sm leading-6 text-stone-600">{pendingDrop.summary}</p>
      <div className="mt-3 flex flex-wrap gap-2" data-orchestration-drop-menu-hints="">
        <span className="rounded-full border border-stone-200 bg-stone-50 px-3 py-1 text-xs font-semibold text-stone-700">
          {pickUiText(language, "Tab으로 옵션 이동", "Tab to move across options")}
        </span>
        <span className="rounded-full border border-stone-200 bg-stone-50 px-3 py-1 text-xs font-semibold text-stone-700">
          {pickUiText(language, "Esc로 닫기", "Esc to close")}
        </span>
      </div>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        {pendingDrop.options.map((option) => (
          <button
            key={option.id}
            type="button"
            onClick={() => onChoose(option.id)}
            data-orchestration-drop-option={option.id}
            className={`rounded-[1.4rem] border px-4 py-3 text-left transition ${optionToneClass(option)}`}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="text-sm font-semibold">{option.label}</div>
              {option.recommended ? (
                <span className="rounded-full bg-white/80 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-stone-700">
                  {pickUiText(language, "추천", "Recommended")}
                </span>
              ) : null}
            </div>
            <div className={`mt-2 text-xs leading-5 ${option.id === "cancel" ? "text-stone-500" : "opacity-80"}`}>
              {option.description}
            </div>
          </button>
        ))}
      </div>
    </section>
  )
}

function optionToneClass(option: PendingDropActionOption): string {
  if (option.id === "cancel") return "border-stone-200 bg-stone-50 text-stone-700 hover:border-stone-300"
  switch (option.tone) {
    case "safe":
      return "border-emerald-300 bg-emerald-50 text-emerald-950 hover:border-emerald-400"
    case "warning":
      return "border-amber-300 bg-amber-50 text-amber-950 hover:border-amber-400"
    case "danger":
      return "border-red-300 bg-red-50 text-red-950 hover:border-red-400"
    case "neutral":
    default:
      return "border-stone-900 bg-stone-900 text-white hover:bg-stone-800"
  }
}
