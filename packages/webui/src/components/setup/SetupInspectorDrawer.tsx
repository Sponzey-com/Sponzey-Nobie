import * as React from "react"
import { pickUiText, type UiLanguage } from "../../stores/uiLanguage"

export function SetupInspectorDrawer({
  open,
  title,
  description,
  language,
  onClose,
  children,
}: {
  open: boolean
  title: string
  description?: string
  language: UiLanguage
  onClose: () => void
  children: React.ReactNode
}) {
  if (!open) return null

  return (
    <div className="hidden md:block xl:hidden" data-setup-inspector-mode="drawer">
      <div
        className="fixed inset-0 z-40 bg-stone-950/25 backdrop-blur-[1px]"
        aria-hidden="true"
        onClick={onClose}
      />
      <section
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="fixed bottom-[calc(7.5rem+env(safe-area-inset-bottom))] right-5 top-5 z-50 flex w-[min(34rem,calc(100vw-2.5rem))] flex-col overflow-hidden rounded-[2rem] border border-stone-200 bg-[#f7f3eb] shadow-[0_30px_80px_rgba(15,23,42,0.2)]"
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault()
            onClose()
          }
        }}
      >
        <div className="flex items-start justify-between gap-4 border-b border-stone-200 bg-white/90 px-5 py-4">
          <div className="min-w-0">
            <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-stone-500">
              {pickUiText(language, "Inspector", "Inspector")}
            </div>
            <div className="mt-2 text-sm font-semibold text-stone-900">{title}</div>
            {description?.trim() ? (
              <div className="mt-2 text-sm leading-6 text-stone-600">{description}</div>
            ) : null}
          </div>
          <button
            type="button"
            autoFocus
            onClick={onClose}
            className="rounded-xl border border-stone-200 bg-white px-3 py-2 text-xs font-semibold text-stone-700"
          >
            {pickUiText(language, "닫기", "Close")}
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto" data-setup-slot="inspector-mobile">
          {children}
        </div>
      </section>
    </div>
  )
}
