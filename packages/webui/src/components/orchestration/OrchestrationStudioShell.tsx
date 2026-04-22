import * as React from "react"
import { trapOrchestrationFocus } from "../../lib/orchestration-shortcuts"
import { getOrchestrationStudioShellLayout } from "../../lib/orchestration-shell-layout"
import { pickUiText, type UiLanguage } from "../../stores/uiLanguage"

export function OrchestrationStudioShell({
  language,
  surface,
  sheetOpen,
  topBar,
  mapToolbar,
  validationRibbon,
  mapView,
  quickEditSheet,
  mobileSheet,
  saveFooter,
  viewportTransform,
  onViewportMouseDown,
  onViewportMouseMove,
  onViewportMouseUp,
  onViewportWheel,
  onCloseQuickEdit,
}: {
  language: UiLanguage
  surface: "page" | "settings"
  sheetOpen: boolean
  topBar: React.ReactNode
  mapToolbar?: React.ReactNode
  validationRibbon?: React.ReactNode
  mapView: React.ReactNode
  quickEditSheet: React.ReactNode
  mobileSheet?: React.ReactNode
  saveFooter?: React.ReactNode
  viewportTransform: string
  onViewportMouseDown?: React.MouseEventHandler<HTMLDivElement>
  onViewportMouseMove?: React.MouseEventHandler<HTMLDivElement>
  onViewportMouseUp?: React.MouseEventHandler<HTMLDivElement>
  onViewportWheel?: React.WheelEventHandler<HTMLDivElement>
  onCloseQuickEdit?: () => void
}) {
  const layout = getOrchestrationStudioShellLayout({ surface, sheetOpen })
  const sheetRef = React.useRef<HTMLDivElement | null>(null)

  return (
    <section
      data-orchestration-studio-shell={surface}
      data-orchestration-studio-sheet-open={sheetOpen ? "true" : "false"}
      data-orchestration-studio-sheet-mode={layout.sheetMode}
      className={layout.root}
    >
      <div className={layout.chromeStack}>
        {topBar}
      </div>

      <div className={layout.viewportGrid}>
        <div className={`${layout.mapStage} relative`}>
          <div
            data-orchestration-studio-map-stage=""
            onMouseDown={onViewportMouseDown}
            onMouseMove={onViewportMouseMove}
            onMouseUp={onViewportMouseUp}
            onMouseLeave={onViewportMouseUp}
            onWheel={onViewportWheel}
            className="overflow-hidden rounded-[2rem] border border-stone-200 bg-[color:var(--orchestration-panel)]/90 shadow-[var(--orchestration-shadow-lift)]"
          >
            {mapToolbar ? (
              <div className={`pointer-events-none absolute left-4 top-4 z-10 right-4 ${sheetOpen ? "xl:right-[24rem]" : ""}`}>
                <div className="pointer-events-auto">
                  {mapToolbar}
                </div>
              </div>
            ) : null}
            {validationRibbon ? (
              <div className="pointer-events-none absolute inset-x-4 bottom-4 z-10 flex justify-center">
                <div className="pointer-events-auto w-[min(760px,100%)]">
                  {validationRibbon}
                </div>
              </div>
            ) : null}
            <div className="min-h-[36rem] px-4 pb-4 pt-24 sm:min-h-[40rem] xl:min-h-[46rem] xl:pr-[24rem]">
              <div
                data-orchestration-studio-map-canvas=""
                style={{
                  transform: viewportTransform,
                  transformOrigin: "center top",
                }}
                className="transition-transform duration-150"
              >
                {mapView}
              </div>
            </div>
          </div>
          <aside className={`${layout.sheetColumn} pointer-events-none absolute right-4 top-4 z-10 hidden xl:block`}>
            <div
              ref={sheetRef}
              role="dialog"
              aria-modal="false"
              aria-label={pickUiText(language, "Quick sheet", "Quick sheet")}
              tabIndex={-1}
              onKeyDown={(event) => {
                if (event.key === "Escape" && sheetOpen && onCloseQuickEdit) {
                  event.preventDefault()
                  onCloseQuickEdit()
                  return
                }
                trapOrchestrationFocus(event.nativeEvent, sheetRef.current)
              }}
              data-orchestration-studio-sheet={sheetOpen ? "open" : "closed"}
              data-orchestration-focus-trap="quick-sheet"
              className="pointer-events-auto w-[22rem] max-w-[calc(100vw-3rem)] space-y-3 rounded-[2rem] border border-stone-200 bg-white/95 p-4 shadow-[var(--orchestration-shadow-pop)] backdrop-blur-[6px]"
            >
              <div className="flex items-center justify-between gap-3">
                <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-stone-500">
                  {pickUiText(language, "Quick sheet", "Quick sheet")}
                </div>
                {sheetOpen && onCloseQuickEdit ? (
                  <button
                    type="button"
                    onClick={onCloseQuickEdit}
                    className="rounded-full border border-stone-200 bg-white px-3 py-1.5 text-xs font-semibold text-stone-600"
                  >
                    {pickUiText(language, "닫기", "Close")}
                  </button>
                ) : null}
              </div>
              {quickEditSheet}
            </div>
          </aside>
        </div>
      </div>

      {mobileSheet ? <div data-orchestration-studio-mobile-sheet="">{mobileSheet}</div> : null}

      {saveFooter ? <div className={layout.footer}>{saveFooter}</div> : null}
    </section>
  )
}
