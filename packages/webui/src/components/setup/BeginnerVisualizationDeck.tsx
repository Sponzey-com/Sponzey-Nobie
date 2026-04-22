import * as React from "react"
import type { BeginnerSetupStepId, BeginnerSetupStepStatus } from "../../lib/beginner-setup"
import type { BeginnerVisualizationDeckView } from "../../lib/setup-visualization-beginner"
import { pickUiText, type UiLanguage } from "../../stores/uiLanguage"

export function BeginnerVisualizationDeck({
  deck,
  language,
  onSelect,
}: {
  deck: BeginnerVisualizationDeckView
  language: UiLanguage
  onSelect: (stepId: BeginnerSetupStepId) => void
}) {
  return (
    <div className="space-y-3" data-setup-beginner-deck="">
      {deck.cards.map((card) => {
        const selected = card.id === deck.selectedStepId
        return (
          <button
            key={card.id}
            type="button"
            onClick={() => onSelect(card.id)}
            data-beginner-visual-card={card.id}
            aria-pressed={selected}
            aria-label={`${card.label} | ${card.statusLabel} | ${card.sceneIds.length} ${pickUiText(language, "장면", "scenes")}`}
            className={`w-full rounded-[1.5rem] border p-4 text-left transition ${
              selected
                ? "border-stone-900 bg-white shadow-[0_20px_60px_rgba(15,23,42,0.08)]"
                : "border-stone-200 bg-white/90 hover:border-stone-300 hover:bg-white"
            }`}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-sm font-semibold text-stone-900">{card.label}</div>
                <div className="mt-1 text-xs leading-5 text-stone-500">{card.description}</div>
              </div>
              <span className={`shrink-0 rounded-full border px-2.5 py-1 text-[11px] font-semibold ${stepTone(card.status)}`}>
                {card.statusLabel}
              </span>
            </div>

            <div className="mt-4 rounded-[1.25rem] border border-stone-200 bg-stone-50 p-3">
              <div className="flex items-center justify-between gap-3 text-[11px] font-semibold uppercase tracking-[0.16em] text-stone-500">
                <span>{pickUiText(language, "의미 장면", "Semantic scenes")}</span>
                <span>{card.sceneIds.length}</span>
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                {card.previewNodes.length > 0 ? card.previewNodes.map((node) => (
                  <div key={node.id} className="flex items-center gap-2 rounded-full border border-stone-200 bg-white px-2.5 py-1">
                    <span className={`h-2.5 w-2.5 rounded-full ${nodeTone(node.status)}`} />
                    <span className="text-xs font-medium text-stone-700">{node.label}</span>
                  </div>
                )) : (
                  <div className="rounded-full border border-dashed border-stone-300 px-2.5 py-1 text-xs text-stone-500">
                    {pickUiText(language, "장면 미리보기 없음", "No scene preview")}
                  </div>
                )}
              </div>
            </div>

            <div className="mt-3 flex flex-wrap items-center gap-2">
              {card.semanticStepIds.map((stepId) => (
                <span key={stepId} className="rounded-full bg-stone-100 px-2.5 py-1 text-[11px] font-semibold text-stone-600">
                  {stepId}
                </span>
              ))}
              {card.attentionCount > 0 ? (
                <span className="rounded-full bg-amber-100 px-2.5 py-1 text-[11px] font-semibold text-amber-700">
                  {pickUiText(language, `주의 ${card.attentionCount}`, `${card.attentionCount} attention`)}
                </span>
              ) : null}
            </div>

            {card.relatedConnections.length > 0 ? (
              <div className="mt-3 flex flex-wrap items-center gap-2">
                {card.relatedConnections.map((connection) => (
                  <span key={connection.id} className="rounded-full border border-stone-200 bg-white px-2.5 py-1 text-[11px] text-stone-600">
                    {connection.title}
                  </span>
                ))}
              </div>
            ) : null}
          </button>
        )
      })}
    </div>
  )
}

function stepTone(status: BeginnerSetupStepStatus): string {
  switch (status) {
    case "done":
      return "border-emerald-200 bg-emerald-50 text-emerald-700"
    case "needs_attention":
      return "border-amber-200 bg-amber-50 text-amber-700"
    case "skipped":
    default:
      return "border-stone-200 bg-stone-100 text-stone-600"
  }
}

function nodeTone(status: string): string {
  switch (status) {
    case "ready":
      return "bg-emerald-500"
    case "warning":
    case "required":
      return "bg-amber-500"
    case "error":
      return "bg-red-500"
    case "disabled":
      return "bg-stone-400"
    case "draft":
      return "bg-sky-500"
    case "planned":
    default:
      return "bg-stone-300"
  }
}
