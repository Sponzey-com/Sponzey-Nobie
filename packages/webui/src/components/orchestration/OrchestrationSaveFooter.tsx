import * as React from "react"
import type { BoardValidationSnapshot } from "../../lib/orchestration-board"
import { summarizeBoardValidationCategories } from "../../lib/orchestration-board-validation"
import type { OrchestrationSavePlan } from "../../lib/orchestration-save-plan"
import type { OrchestrationSaveResultState } from "./OrchestrationSaveResultToast"
import { OrchestrationSaveResultToast } from "./OrchestrationSaveResultToast"
import { OrchestrationToolbar } from "./OrchestrationToolbar"
import { getOrchestrationShortcutHints } from "../../lib/orchestration-shortcuts"
import { pickUiText, type UiLanguage } from "../../stores/uiLanguage"

export function OrchestrationSaveFooter({
  language,
  canEdit,
  dirty,
  running,
  validationSnapshot,
  validationSummary,
  savePlan,
  result,
  onValidate,
  onSave,
  onRevert,
}: {
  language: UiLanguage
  canEdit: boolean
  dirty: boolean
  running: boolean
  validationSnapshot?: BoardValidationSnapshot | null
  validationSummary?: { errorCount: number; warningCount: number } | null
  savePlan?: OrchestrationSavePlan | null
  result?: OrchestrationSaveResultState | null
  onValidate: () => void
  onSave: () => void
  onRevert: () => void
}) {
  const categories = summarizeBoardValidationCategories(validationSnapshot, language)
  const recoveryNote = resolveRecoveryNote(language, result)
  const shortcuts = getOrchestrationShortcutHints(language)

  return (
    <section data-orchestration-save-footer="">
      <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
        <div className="space-y-3">
          <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-stone-500">
            {pickUiText(language, "Save footer", "Save footer")}
          </div>
          <p className="max-w-2xl text-sm leading-6 text-stone-600">
            {pickUiText(
              language,
              "`Validate -> Save draft -> Publish placeholder` 순서를 유지하고, publish는 아직 안내 placeholder로만 남깁니다.",
              "Keep the `Validate -> Save draft -> Publish placeholder` order, while publish stays an informational placeholder for now.",
            )}
          </p>

          <div className="flex flex-wrap gap-2" data-orchestration-save-stage-semantics="">
            <StagePill label={pickUiText(language, "Validate", "Validate")} tone="ready" />
            <StagePill label={pickUiText(language, "Save draft", "Save draft")} tone="ready" />
            <StagePill label={pickUiText(language, "Publish placeholder", "Publish placeholder")} tone="placeholder" />
          </div>

          <div className="flex flex-wrap gap-2" data-orchestration-save-shortcuts="">
            {shortcuts.map((shortcut) => (
              <span
                key={shortcut.action}
                data-orchestration-shortcut={shortcut.action}
                className="rounded-full border border-stone-200 bg-white px-3 py-1 text-[11px] font-semibold text-stone-700"
              >
                {shortcut.combo}
              </span>
            ))}
          </div>

          {savePlan ? (
            <div className="rounded-[1.2rem] border border-stone-200 bg-stone-50 px-4 py-3 text-sm leading-6 text-stone-700" data-orchestration-save-plan-preview="">
              <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-stone-500">
                {pickUiText(language, "Ordered persist", "Ordered persist")}
              </div>
              <div className="mt-2">
                {savePlan.instructions.length > 0
                  ? savePlan.instructions.slice(0, 3).map((instruction, index) => (
                    <div key={instruction.key} data-orchestration-save-plan-item={instruction.key}>
                      {index + 1}. {instruction.key}
                    </div>
                  ))
                  : pickUiText(language, "아직 저장할 instruction이 없습니다.", "There are no save instructions yet.")}
                {savePlan.instructions.length > 3 ? (
                  <div className="mt-1 text-xs text-stone-500">
                    {pickUiText(language, `외 ${savePlan.instructions.length - 3}개`, `${savePlan.instructions.length - 3} more`)}
                  </div>
                ) : null}
              </div>
            </div>
          ) : null}

          {categories.length > 0 ? (
            <div className="flex flex-wrap gap-2" data-orchestration-save-validation-categories="">
              {categories.map((category) => (
                <span
                  key={category.category}
                  className={`rounded-full px-3 py-1 text-[11px] font-semibold ${
                    category.blocking
                      ? "border border-red-200 bg-red-50 text-red-900"
                      : "border border-amber-200 bg-amber-50 text-amber-900"
                  }`}
                >
                  {category.label} {category.count}
                </span>
              ))}
            </div>
          ) : null}

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={onRevert}
              disabled={!dirty || running}
              className="rounded-full border border-stone-200 bg-white px-3 py-1.5 text-xs font-semibold text-stone-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {pickUiText(language, "Revert", "Revert")}
            </button>
            <button
              type="button"
              disabled
              className="rounded-full border border-dashed border-stone-300 bg-stone-50 px-3 py-1.5 text-xs font-semibold text-stone-500"
            >
              {pickUiText(language, "Publish placeholder", "Publish placeholder")}
            </button>
          </div>

          {recoveryNote ? (
            <div className="rounded-[1.2rem] border border-stone-200 bg-white px-4 py-3 text-sm leading-6 text-stone-700" data-orchestration-save-recovery-note="">
              {recoveryNote}
            </div>
          ) : null}
        </div>

        <OrchestrationToolbar
          language={language}
          canEdit={canEdit}
          dirty={dirty}
          running={running}
          showArchived={false}
          hiddenArchivedCount={0}
          validationSummary={validationSummary}
          onValidateBoard={onValidate}
          onSaveBoard={onSave}
          showCreateAgentAction={false}
          showCreateTeamAction={false}
          showArchivedToggle={false}
          showValidationSummary={true}
          showDefaultHint={false}
          validateLabel={pickUiText(language, "Validate", "Validate")}
          saveLabel={pickUiText(language, "Save draft", "Save draft")}
          runningSaveLabel={pickUiText(language, "Saving draft...", "Saving draft...")}
        />
      </div>
      <div className="mt-3">
        <OrchestrationSaveResultToast language={language} result={result ?? null} />
      </div>
    </section>
  )
}

function resolveRecoveryNote(language: UiLanguage, result: OrchestrationSaveResultState | null | undefined): string | null {
  switch (result?.status) {
    case "partial":
      return pickUiText(
        language,
        "partial 저장 후에는 실패한 항목만 draft에 남깁니다. Review 후 Save draft를 다시 누르면 remaining instruction만 재시도합니다.",
        "After a partial save, only failed entries remain in draft. Review them and choose Save draft again to retry the remaining instructions.",
      )
    case "blocked":
      return pickUiText(
        language,
        "validationOnly preflight가 막히면 persist는 시작하지 않습니다. 먼저 blocking issue를 수정한 뒤 Validate 또는 Save draft를 다시 실행해야 합니다.",
        "If validationOnly preflight is blocked, persist does not start. Fix the blocking issues first, then run Validate or Save draft again.",
      )
    case "stored":
      return pickUiText(
        language,
        "save draft는 validationOnly preflight와 ordered persist를 모두 통과한 뒤 reload까지 마친 상태입니다.",
        "Save draft means validationOnly preflight, ordered persist, and reload all completed successfully.",
      )
    default:
      return null
  }
}

function StagePill({
  label,
  tone,
}: {
  label: string
  tone: "ready" | "placeholder"
}) {
  return (
    <span className={`rounded-full px-3 py-1 text-[11px] font-semibold ${
      tone === "ready"
        ? "border border-sky-200 bg-sky-50 text-sky-900"
        : "border border-dashed border-stone-300 bg-stone-50 text-stone-600"
    }`}>
      {label}
    </span>
  )
}
