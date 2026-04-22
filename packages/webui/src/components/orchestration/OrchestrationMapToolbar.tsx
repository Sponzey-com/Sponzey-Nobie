import * as React from "react"
import { getUiAccessibilityPolicy } from "../../lib/ui-performance"
import type { OrchestrationViewportState } from "../../lib/orchestration-viewport"
import { pickUiText, type UiLanguage } from "../../stores/uiLanguage"
import { OrchestrationToolbar } from "./OrchestrationToolbar"

export function OrchestrationMapToolbar({
  language,
  viewport,
  nodeMode,
  canEdit = false,
  dirty = false,
  running = false,
  showArchived = false,
  hiddenArchivedCount = 0,
  onCreateAgent,
  onCreateTeam,
  onToggleShowArchived,
  onValidateBoard,
  onSaveBoard,
  onRevert,
  onZoomIn,
  onZoomOut,
  onFitSelection,
  onFitAll,
  onReset,
}: {
  language: UiLanguage
  viewport: OrchestrationViewportState
  nodeMode: "card" | "character"
  canEdit?: boolean
  dirty?: boolean
  running?: boolean
  showArchived?: boolean
  hiddenArchivedCount?: number
  onCreateAgent?: () => void
  onCreateTeam?: () => void
  onToggleShowArchived?: () => void
  onValidateBoard?: () => void
  onSaveBoard?: () => void
  onRevert?: () => void
  onZoomIn: () => void
  onZoomOut: () => void
  onFitSelection: () => void
  onFitAll: () => void
  onReset: () => void
}) {
  const accessibility = getUiAccessibilityPolicy("mobile")

  return (
    <section
      data-orchestration-map-toolbar={nodeMode}
      className="overflow-x-auto rounded-[1.8rem] border border-stone-200 bg-white/92 p-3 shadow-[var(--orchestration-shadow-node)] backdrop-blur-[4px]"
    >
      <div className="flex min-w-max items-center justify-between gap-3 whitespace-nowrap">
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={onCreateAgent}
            disabled={!canEdit || !onCreateAgent}
            data-orchestration-map-create="agent"
            className={toolbarButtonClass(false, "primary")}
            style={{ minHeight: accessibility.minTouchTargetPx }}
          >
            {pickUiText(language, "Agent+", "Agent+")}
          </button>
          <button
            type="button"
            onClick={onCreateTeam}
            disabled={!canEdit || !onCreateTeam}
            data-orchestration-map-create="team"
            className={toolbarButtonClass(false, "primary")}
            style={{ minHeight: accessibility.minTouchTargetPx }}
          >
            {pickUiText(language, "Team+", "Team+")}
          </button>
          <button type="button" onClick={onZoomOut} className={toolbarButtonClass(false)} style={{ minHeight: accessibility.minTouchTargetPx }}>
            -
          </button>
          <button type="button" onClick={onZoomIn} className={toolbarButtonClass(false)} style={{ minHeight: accessibility.minTouchTargetPx }}>
            +
          </button>
          <button type="button" onClick={onFitSelection} className={toolbarButtonClass(false)} style={{ minHeight: accessibility.minTouchTargetPx }}>
            {pickUiText(language, "Fit selection", "Fit selection")}
          </button>
          <button type="button" onClick={onFitAll} className={toolbarButtonClass(false)} style={{ minHeight: accessibility.minTouchTargetPx }}>
            {pickUiText(language, "Fit all", "Fit all")}
          </button>
          <button type="button" onClick={onReset} className={toolbarButtonClass(false)} style={{ minHeight: accessibility.minTouchTargetPx }}>
            {pickUiText(language, "100%", "100%")}
          </button>
        </div>
        <div className="flex shrink-0 items-center justify-end gap-2" data-orchestration-map-actions="">
          <button
            type="button"
            onClick={onRevert}
            disabled={!dirty || running || !onRevert}
            className={toolbarButtonClass(false)}
            style={{ minHeight: accessibility.minTouchTargetPx }}
          >
            {pickUiText(language, "Revert", "Revert")}
          </button>
          <OrchestrationToolbar
            language={language}
            canEdit={canEdit}
            dirty={dirty}
            running={running}
            showArchived={showArchived}
            hiddenArchivedCount={hiddenArchivedCount}
            onToggleShowArchived={onToggleShowArchived}
            onValidateBoard={onValidateBoard}
            onSaveBoard={onSaveBoard}
            showCreateAgentAction={false}
            showCreateTeamAction={false}
            showValidationSummary={false}
            showDefaultHint={false}
            validateLabel={pickUiText(language, "Validate", "Validate")}
            saveLabel={pickUiText(language, "Save draft", "Save draft")}
            runningSaveLabel={pickUiText(language, "Saving draft...", "Saving draft...")}
          />
          <div className="rounded-full border border-stone-200 bg-stone-50 px-3 py-1.5 text-xs font-semibold text-stone-700">
            {pickUiText(language, "Zoom", "Zoom")} {Math.round(viewport.zoom * 100)}%
          </div>
        </div>
      </div>
    </section>
  )
}

function toolbarButtonClass(active: boolean, tone: "default" | "primary" = "default"): string {
  return `rounded-full border px-3 py-1.5 text-xs font-semibold disabled:cursor-not-allowed disabled:opacity-50 ${
    tone === "primary"
      ? "border-stone-950 bg-stone-950 text-white"
      : active
        ? "border-stone-950 bg-stone-950 text-white"
        : "border-stone-200 bg-white text-stone-700"
  }`
}
