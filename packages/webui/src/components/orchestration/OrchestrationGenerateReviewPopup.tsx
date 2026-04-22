import * as React from "react"
import type { OrchestrationStarterPlan } from "../../lib/orchestration-starter-kits"
import { pickUiText, type UiLanguage } from "../../stores/uiLanguage"

export interface OrchestrationGenerateReviewState {
  mode: "success" | "ambiguous"
  title: string
  summary: string
  notes: string[]
  plan: OrchestrationStarterPlan
}

export function OrchestrationGenerateReviewPopup({
  language,
  review,
  onAccept,
  onAdjust,
  onCancel,
}: {
  language: UiLanguage
  review: OrchestrationGenerateReviewState | null
  onAccept: () => void
  onAdjust: () => void
  onCancel: () => void
}) {
  if (!review) return null

  return (
    <section
      data-orchestration-generate-review={review.mode}
      className="rounded-[1.8rem] border border-stone-200 bg-white/95 p-4 shadow-[var(--orchestration-shadow-pop)] backdrop-blur-[2px]"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-stone-500">
            {pickUiText(language, "Generate review", "Generate review")}
          </div>
          <div className="mt-2 text-base font-semibold text-stone-950">{review.title}</div>
          <p className="mt-2 text-sm leading-6 text-stone-600">{review.summary}</p>
        </div>
        <span className={`rounded-full px-3 py-1 text-xs font-semibold ${review.mode === "ambiguous" ? "bg-amber-100 text-amber-800" : "bg-emerald-100 text-emerald-800"}`}>
          {review.mode === "ambiguous"
            ? pickUiText(language, "확인 필요", "Needs review")
            : pickUiText(language, "적용 가능", "Ready to apply")}
        </span>
      </div>

      <div className="mt-4 rounded-[1.4rem] border border-stone-200 bg-stone-50 p-4" data-orchestration-generate-preview="">
        <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-stone-500">
          {pickUiText(language, "Placement preview", "Placement preview")}
        </div>
        <div className="mt-3 grid gap-3">
          <div className="rounded-[1.2rem] border border-stone-200 bg-white px-4 py-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-sm font-semibold text-stone-950">{review.plan.team.displayName}</div>
                <div className="mt-1 text-xs leading-5 text-stone-500">{review.plan.team.purposePresetId}</div>
              </div>
              <span className="rounded-full bg-stone-100 px-2 py-1 text-[11px] font-semibold text-stone-600">
                {pickUiText(language, "새 team lane", "New team lane")}
              </span>
            </div>
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              {review.plan.agents.map((agent) => (
                <div
                  key={agent.displayName}
                  className="rounded-[1rem] border border-stone-200 bg-stone-50 px-3 py-3"
                  data-orchestration-generate-preview-agent={agent.displayName}
                >
                  <div className="text-sm font-semibold text-stone-900">{agent.displayName}</div>
                  <div className="mt-1 text-xs leading-5 text-stone-500">
                    {agent.rolePresetId} / {agent.riskPresetId} / {agent.capabilityPresetId}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {review.notes.length > 0 ? (
        <div className="mt-4 space-y-2" data-orchestration-generate-review-notes="">
          {review.notes.map((note) => (
            <div key={note} className={`rounded-[1.1rem] border px-4 py-3 text-sm leading-6 ${
              review.mode === "ambiguous" ? "border-amber-200 bg-amber-50 text-amber-900" : "border-stone-200 bg-stone-50 text-stone-700"
            }`}>
              {note}
            </div>
          ))}
        </div>
      ) : null}

      <div className="mt-4 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={onAccept}
          className="rounded-[1.2rem] bg-stone-950 px-4 py-3 text-sm font-semibold text-white"
        >
          {pickUiText(language, "적용", "Accept")}
        </button>
        <button
          type="button"
          onClick={onAdjust}
          className="rounded-[1.2rem] border border-stone-200 bg-white px-4 py-3 text-sm font-semibold text-stone-700"
        >
          {pickUiText(language, "조정", "Adjust")}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-[1.2rem] border border-stone-200 bg-stone-50 px-4 py-3 text-sm font-semibold text-stone-700"
        >
          {pickUiText(language, "취소", "Cancel")}
        </button>
      </div>
    </section>
  )
}
