import * as React from "react"
import type { BoardValidationSnapshot } from "../../lib/orchestration-board"
import { summarizeBoardValidationCategories } from "../../lib/orchestration-board-validation"
import type { OrchestrationSaveResultState } from "./OrchestrationSaveResultToast"
import { pickUiText, type UiLanguage } from "../../stores/uiLanguage"

export function OrchestrationValidationRibbon({
  language,
  validationSnapshot,
  validationSummary,
  saveResult,
  savePlanCount,
}: {
  language: UiLanguage
  validationSnapshot?: BoardValidationSnapshot | null
  validationSummary?: { errorCount: number; warningCount: number } | null
  saveResult?: OrchestrationSaveResultState | null
  savePlanCount?: number | null
}) {
  const hasValidationIssues = ((validationSummary?.errorCount ?? 0) + (validationSummary?.warningCount ?? 0)) > 0
  const hasVisibleSaveStatus = saveResult?.status === "running" || saveResult?.status === "validated" || saveResult?.status === "stored"
  if (hasValidationIssues || !hasVisibleSaveStatus) return null

  const tone = saveResult?.status === "blocked"
    ? "border-red-200 bg-red-50 text-red-900"
    : (validationSummary?.errorCount ?? 0) > 0
      ? "border-red-200 bg-red-50 text-red-900"
      : (validationSummary?.warningCount ?? 0) > 0 || saveResult?.status === "partial"
        ? "border-amber-200 bg-amber-50 text-amber-900"
        : "border-emerald-200 bg-emerald-50 text-emerald-900"
  const categories = summarizeBoardValidationCategories(validationSnapshot, language)
  const stages = buildValidationStages(language, saveResult)
  const summaryText = saveResult?.summary
    ?? pickUiText(
      language,
      `error ${validationSummary?.errorCount ?? 0} / warning ${validationSummary?.warningCount ?? 0}`,
      `error ${validationSummary?.errorCount ?? 0} / warning ${validationSummary?.warningCount ?? 0}`,
    )

  return (
    <section
      data-orchestration-validation-ribbon=""
      className={`rounded-[1.4rem] border px-4 py-3 text-sm leading-6 shadow-[var(--orchestration-shadow-pop)] backdrop-blur-[6px] ${tone}`}
    >
      <div className="flex flex-wrap items-center gap-2">
        <div className="font-semibold">{summaryText}</div>
        {validationSummary ? (
          <span className="rounded-full border border-current/20 bg-white/40 px-3 py-1 text-[11px] font-semibold">
            {pickUiText(
              language,
              `error ${validationSummary.errorCount} / warning ${validationSummary.warningCount}`,
              `error ${validationSummary.errorCount} / warning ${validationSummary.warningCount}`,
            )}
          </span>
        ) : null}
        {typeof savePlanCount === "number" && savePlanCount > 0 ? (
          <span className="rounded-full border border-current/20 bg-white/40 px-3 py-1 text-[11px] font-semibold">
            {pickUiText(language, `ordered persist ${savePlanCount}`, `ordered persist ${savePlanCount}`)}
          </span>
        ) : null}
      </div>

      {hasSaveStatus ? (
        <div className="mt-2 flex flex-wrap gap-2" data-orchestration-validation-stages="">
          {stages.map((stage) => (
            <span
              key={stage.id}
              data-orchestration-validation-stage={stage.id}
              className={`rounded-full px-3 py-1 text-[11px] font-semibold ${stageToneClass(stage.state)}`}
            >
              {stage.label}
            </span>
          ))}
        </div>
      ) : null}

      {categories.length > 0 ? (
        <div className="mt-2 flex flex-wrap gap-2" data-orchestration-validation-categories="">
          {categories.map((category) => (
            <span
              key={category.category}
              data-orchestration-validation-category={category.category}
              className={`rounded-full px-3 py-1 text-[11px] font-semibold ${
                category.blocking
                  ? "border border-red-200 bg-white/70 text-red-900"
                  : "border border-current/20 bg-white/40"
              }`}
            >
              {category.label} {category.count}
            </span>
          ))}
        </div>
      ) : null}
    </section>
  )
}

function buildValidationStages(language: UiLanguage, result: OrchestrationSaveResultState | null | undefined): Array<{
  id: "validate" | "save_draft" | "publish"
  label: string
  state: "idle" | "ready" | "blocked" | "partial" | "done" | "placeholder"
}> {
  const t = (ko: string, en: string) => pickUiText(language, ko, en)
  switch (result?.status) {
    case "running":
      return [
        { id: "validate", label: t("Validate", "Validate"), state: "ready" },
        { id: "save_draft", label: t("Save draft", "Save draft"), state: "ready" },
        { id: "publish", label: t("Publish placeholder", "Publish placeholder"), state: "placeholder" },
      ]
    case "validated":
      return [
        { id: "validate", label: t("Validate", "Validate"), state: "done" },
        { id: "save_draft", label: t("Save draft", "Save draft"), state: "ready" },
        { id: "publish", label: t("Publish placeholder", "Publish placeholder"), state: "placeholder" },
      ]
    case "stored":
      return [
        { id: "validate", label: t("Validate", "Validate"), state: "done" },
        { id: "save_draft", label: t("Save draft", "Save draft"), state: "done" },
        { id: "publish", label: t("Publish placeholder", "Publish placeholder"), state: "placeholder" },
      ]
    case "partial":
      return [
        { id: "validate", label: t("Validate", "Validate"), state: "done" },
        { id: "save_draft", label: t("Save draft", "Save draft"), state: "partial" },
        { id: "publish", label: t("Publish placeholder", "Publish placeholder"), state: "placeholder" },
      ]
    case "blocked":
      return [
        { id: "validate", label: t("Validate", "Validate"), state: "blocked" },
        { id: "save_draft", label: t("Save draft", "Save draft"), state: "idle" },
        { id: "publish", label: t("Publish placeholder", "Publish placeholder"), state: "placeholder" },
      ]
    default:
      return [
        { id: "validate", label: t("Validate", "Validate"), state: "idle" },
        { id: "save_draft", label: t("Save draft", "Save draft"), state: "idle" },
        { id: "publish", label: t("Publish placeholder", "Publish placeholder"), state: "placeholder" },
      ]
  }
}

function stageToneClass(state: "idle" | "ready" | "blocked" | "partial" | "done" | "placeholder"): string {
  switch (state) {
    case "done":
      return "border border-emerald-200 bg-white/80 text-emerald-900"
    case "ready":
      return "border border-sky-200 bg-white/80 text-sky-900"
    case "blocked":
      return "border border-red-200 bg-white/80 text-red-900"
    case "partial":
      return "border border-amber-200 bg-white/80 text-amber-900"
    case "placeholder":
      return "border border-dashed border-current/25 bg-white/30 text-current"
    case "idle":
    default:
      return "border border-current/20 bg-white/40 text-current"
  }
}
