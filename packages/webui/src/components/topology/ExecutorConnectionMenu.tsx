import * as React from "react"
import type {
  ExecutorConnectionDraft,
  ExecutorDraft,
} from "../../lib/executor-graph"
import {
  recommendExecutorConnectionRelations,
  type ExecutorRelationRecommendation,
} from "../../lib/executor-relation-inference"
import { useUiI18n } from "../../lib/ui-i18n"

export interface ExecutorConnectionMenuProps {
  source: ExecutorDraft
  target: ExecutorDraft
  connection?: ExecutorConnectionDraft | null
  recommendations?: ExecutorRelationRecommendation[]
  onSelectRecommendation?: (recommendation: ExecutorRelationRecommendation) => void
}

export function ExecutorConnectionMenu({
  source,
  target,
  connection,
  recommendations,
  onSelectRecommendation,
}: ExecutorConnectionMenuProps) {
  const { text } = useUiI18n()
  const resolvedRecommendations = React.useMemo(
    () => recommendations ?? recommendExecutorConnectionRelations({ source, target }),
    [recommendations, source, target],
  )
  const chips = resolvedRecommendations.slice(0, 3)
  const activeRelation = connection?.inferredRelation ?? "handoff"

  return (
    <aside
      className="rounded-md border border-stone-200 bg-white px-2.5 py-2"
      data-testid="executor-connection-menu"
      data-source-executor-id={source.id}
      data-target-executor-id={target.id}
      data-active-relation={activeRelation}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-[11px] font-semibold text-stone-500">
          {text("연결 의미", "Connection meaning")}
        </div>
        <span className="rounded-full bg-stone-100 px-2 py-0.5 text-[10px] font-semibold text-stone-700">
          {connection?.label ?? text("넘김", "Handoff")}
        </span>
      </div>
      <div className="mt-2 flex flex-wrap gap-1.5" data-testid="executor-connection-recommendation-chips">
        {chips.map((recommendation) => (
          <button
            key={recommendation.relation}
            type="button"
            onClick={() => onSelectRecommendation?.(recommendation)}
            title={text(recommendation.reasonKo, recommendation.reasonEn)}
            className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold ${
              recommendation.relation === activeRelation
                ? "border-stone-900 bg-stone-900 text-white"
                : "border-stone-200 bg-stone-50 text-stone-700"
            }`}
            data-testid="executor-connection-recommendation-chip"
            data-relation={recommendation.relation}
            data-confidence={recommendation.confidence}
          >
            {recommendation.label}
          </button>
        ))}
      </div>
    </aside>
  )
}
