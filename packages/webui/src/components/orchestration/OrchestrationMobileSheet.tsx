import * as React from "react"
import { trapOrchestrationFocus } from "../../lib/orchestration-shortcuts"
import { getUiAccessibilityPolicy } from "../../lib/ui-performance"
import { pickUiText, type UiLanguage } from "../../stores/uiLanguage"

export function OrchestrationMobileSheet({
  language,
  open,
  title,
  onClose,
  children,
}: {
  language: UiLanguage
  open: boolean
  title: string
  onClose: () => void
  children: React.ReactNode
}) {
  const rootRef = React.useRef<HTMLDivElement | null>(null)
  const accessibility = getUiAccessibilityPolicy("mobile")

  React.useEffect(() => {
    if (!open) return
    rootRef.current?.focus()
  }, [open])

  if (!open) return null

  return (
    <div
      className="xl:hidden fixed inset-x-0 bottom-0 z-[55] flex max-h-[78vh] flex-col rounded-t-[2rem] border border-stone-200 bg-white/98 shadow-[var(--orchestration-shadow-pop)] backdrop-blur-[4px]"
      data-orchestration-mobile-sheet="open"
      style={{ minHeight: accessibility.minTouchTargetPx * 6 }}
    >
      <div className="flex justify-center py-2">
        <div className="h-1.5 w-14 rounded-full bg-stone-300" />
      </div>
      <div
        ref={rootRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        data-orchestration-focus-trap="mobile-sheet"
        className="min-h-0 flex-1 px-4 pb-4 outline-none"
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault()
            onClose()
            return
          }
          trapOrchestrationFocus(event.nativeEvent, rootRef.current)
        }}
      >
        <div className="flex items-center justify-between gap-3 pb-3">
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-stone-500">
              {pickUiText(language, "Mobile sheet", "Mobile sheet")}
            </div>
            <div className="mt-1 text-base font-semibold text-stone-950">{title}</div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full border border-stone-200 bg-white px-4 py-2 text-sm font-semibold text-stone-700"
            style={{ minHeight: accessibility.minTouchTargetPx }}
          >
            {pickUiText(language, "닫기", "Close")}
          </button>
        </div>
        <div className="min-h-0 overflow-y-auto pb-2" data-orchestration-mobile-sheet-body="">
          {children}
        </div>
      </div>
    </div>
  )
}
