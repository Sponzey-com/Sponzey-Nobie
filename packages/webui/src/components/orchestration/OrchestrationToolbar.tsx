import * as React from "react"
import { pickUiText, type UiLanguage } from "../../stores/uiLanguage"

export function OrchestrationToolbar({
  language,
  canEdit,
  dirty,
  running = false,
  showArchived,
  hiddenArchivedCount = 0,
  validationSummary,
  onCreateAgent,
  onCreateTeam,
  onToggleShowArchived,
  onValidateBoard,
  onSaveBoard,
  showCreateAgentAction = true,
  showCreateTeamAction = true,
  showValidateAction = true,
  showSaveAction = true,
  showArchivedToggle = true,
  showValidationSummary = true,
  showDefaultHint = true,
  validateLabel,
  saveLabel,
  runningSaveLabel,
}: {
  language: UiLanguage
  canEdit: boolean
  dirty: boolean
  running?: boolean
  showArchived: boolean
  hiddenArchivedCount?: number
  validationSummary?: { errorCount: number; warningCount: number } | null
  onCreateAgent?: () => void
  onCreateTeam?: () => void
  onToggleShowArchived?: () => void
  onValidateBoard?: () => void
  onSaveBoard?: () => void
  showCreateAgentAction?: boolean
  showCreateTeamAction?: boolean
  showValidateAction?: boolean
  showSaveAction?: boolean
  showArchivedToggle?: boolean
  showValidationSummary?: boolean
  showDefaultHint?: boolean
  validateLabel?: string
  saveLabel?: string
  runningSaveLabel?: string
}) {
  return (
    <div className="flex flex-wrap items-center gap-2" data-orchestration-toolbar="">
      {showCreateTeamAction ? (
        <button
          type="button"
          onClick={onCreateTeam}
          disabled={!canEdit || !onCreateTeam}
          className="rounded-2xl border border-stone-200 bg-white px-4 py-2.5 text-sm font-semibold text-stone-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {pickUiText(language, "새 팀", "New team")}
        </button>
      ) : null}
      {showCreateAgentAction ? (
        <button
          type="button"
          onClick={onCreateAgent}
          disabled={!canEdit || !onCreateAgent}
          className="rounded-2xl border border-stone-200 bg-white px-4 py-2.5 text-sm font-semibold text-stone-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {pickUiText(language, "새 에이전트", "New agent")}
        </button>
      ) : null}
      {showValidateAction ? (
        <button
          type="button"
          onClick={onValidateBoard}
          disabled={!canEdit || !dirty || running || !onValidateBoard}
          className="rounded-2xl border border-stone-200 bg-white px-4 py-2.5 text-sm font-semibold text-stone-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {validateLabel ?? pickUiText(language, "검증", "Validate")}
        </button>
      ) : null}
      {showSaveAction ? (
        <button
          type="button"
          onClick={onSaveBoard}
          disabled={!canEdit || !dirty || running || !onSaveBoard}
          className="rounded-2xl bg-stone-900 px-4 py-2.5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
        >
          {running
            ? (runningSaveLabel ?? pickUiText(language, "저장 중...", "Saving..."))
            : (saveLabel ?? pickUiText(language, "저장", "Save"))}
        </button>
      ) : null}
      {showArchivedToggle ? (
        <button
          type="button"
          onClick={onToggleShowArchived}
          className={`rounded-2xl px-4 py-2.5 text-sm font-semibold ${
            showArchived
              ? "bg-stone-900 text-white"
              : "border border-stone-200 bg-white text-stone-700"
          }`}
          data-orchestration-toolbar-archived={showArchived ? "visible" : "hidden"}
        >
          {showArchived
            ? pickUiText(language, "보관 숨기기", "Hide archived")
            : pickUiText(language, "보관 보기", "Show archived")}
          {hiddenArchivedCount > 0 && !showArchived ? ` (${hiddenArchivedCount})` : ""}
        </button>
      ) : null}
      {showValidationSummary && validationSummary ? (
        <div className="rounded-2xl bg-stone-100 px-3 py-2 text-xs font-medium text-stone-600">
          {pickUiText(language, `error ${validationSummary.errorCount} / warning ${validationSummary.warningCount}`, `error ${validationSummary.errorCount} / warning ${validationSummary.warningCount}`)}
        </div>
      ) : null}
      {showDefaultHint ? (
        <div className="rounded-2xl bg-stone-100 px-3 py-2 text-xs font-medium text-stone-600">
          {pickUiText(language, "새 카드와 새 lane은 기본적으로 disabled 상태로 시작합니다.", "New cards and lanes start disabled until you explicitly enable them.")}
        </div>
      ) : null}
    </div>
  )
}
