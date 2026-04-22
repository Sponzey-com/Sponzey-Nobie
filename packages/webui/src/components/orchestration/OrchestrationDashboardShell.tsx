import * as React from "react"
import type { OrchestrationDashboardActivityItem, OrchestrationDashboardInspectorModel } from "../../lib/orchestration-dashboard-projection"
import type { OrchestrationViewportState } from "../../lib/orchestration-viewport"
import type { UiLanguage } from "../../stores/uiLanguage"
import { OrchestrationActivityBar } from "./OrchestrationActivityBar"
import { OrchestrationFloatingInspector } from "./OrchestrationFloatingInspector"
import { OrchestrationMapToolbar } from "./OrchestrationMapToolbar"

export function OrchestrationDashboardShell({
  language,
  activeTab,
  viewport,
  nodeMode,
  inspector,
  activityItems,
  mapView,
  mobileInspector,
  canEdit = false,
  onCreateAgent,
  onCreateTeam,
  onZoomIn,
  onZoomOut,
  onFitSelection,
  onFitAll,
  onReset,
  onViewportMouseDown,
  onViewportMouseMove,
  onViewportMouseUp,
  onViewportWheel,
}: {
  language: UiLanguage
  activeTab: "map" | "activity" | "approvals"
  viewport: OrchestrationViewportState
  nodeMode: "card" | "character"
  inspector: OrchestrationDashboardInspectorModel
  activityItems: OrchestrationDashboardActivityItem[]
  mapView: React.ReactNode
  mobileInspector?: React.ReactNode
  canEdit?: boolean
  onCreateAgent?: () => void
  onCreateTeam?: () => void
  onZoomIn: () => void
  onZoomOut: () => void
  onFitSelection: () => void
  onFitAll: () => void
  onReset: () => void
  onViewportMouseDown?: React.MouseEventHandler<HTMLDivElement>
  onViewportMouseMove?: React.MouseEventHandler<HTMLDivElement>
  onViewportMouseUp?: React.MouseEventHandler<HTMLDivElement>
  onViewportWheel?: React.WheelEventHandler<HTMLDivElement>
}) {
  return (
    <section data-orchestration-dashboard-shell={activeTab} className="space-y-4">
      {activeTab === "map" ? (
        <>
          <div
            data-orchestration-dashboard-viewport=""
            onMouseDown={onViewportMouseDown}
            onMouseMove={onViewportMouseMove}
            onMouseUp={onViewportMouseUp}
            onMouseLeave={onViewportMouseUp}
            onWheel={onViewportWheel}
            className="relative overflow-hidden rounded-[2rem] border border-stone-200 bg-[color:var(--orchestration-panel)]/90 shadow-[var(--orchestration-shadow-lift)]"
          >
            <div className="pointer-events-none absolute left-4 right-4 top-4 z-10 xl:right-[24rem]">
              <div className="pointer-events-auto">
                <OrchestrationMapToolbar
                  language={language}
                  viewport={viewport}
                  nodeMode={nodeMode}
                  canEdit={canEdit}
                  onCreateAgent={onCreateAgent}
                  onCreateTeam={onCreateTeam}
                  onZoomIn={onZoomIn}
                  onZoomOut={onZoomOut}
                  onFitSelection={onFitSelection}
                  onFitAll={onFitAll}
                  onReset={onReset}
                />
              </div>
            </div>

            <div className="hidden xl:block pointer-events-none absolute right-4 top-4 z-10 w-[22rem] max-w-[calc(100%-2rem)]">
              <OrchestrationFloatingInspector
                language={language}
                inspector={inspector}
                className="pointer-events-auto max-h-[calc(100vh-15rem)] overflow-y-auto"
              />
            </div>

            <div className="min-h-[42rem] overflow-hidden px-4 pb-4 pt-24 xl:pr-[24rem]">
              <div
                data-orchestration-dashboard-canvas=""
                style={{
                  transform: `translate(${viewport.offsetX}px, ${viewport.offsetY}px) scale(${viewport.zoom})`,
                  transformOrigin: "center top",
                }}
                className="transition-transform duration-150"
              >
                {mapView}
              </div>
            </div>
          </div>

          <OrchestrationActivityBar
            language={language}
            tab="activity"
            items={activityItems.slice(0, 3)}
            variant="strip"
          />

          {mobileInspector ? (
            <div className="xl:hidden" data-orchestration-dashboard-mobile-inspector="">
              {mobileInspector}
            </div>
          ) : null}
        </>
      ) : (
        <OrchestrationActivityBar
          language={language}
          tab={activeTab}
          items={activityItems}
          variant="grid"
        />
      )}
    </section>
  )
}
