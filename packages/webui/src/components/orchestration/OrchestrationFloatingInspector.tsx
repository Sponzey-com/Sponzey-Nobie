import * as React from "react"
import type { OrchestrationDashboardInspectorModel } from "../../lib/orchestration-dashboard-projection"
import { pickUiText, type UiLanguage } from "../../stores/uiLanguage"

export function OrchestrationFloatingInspector({
  language,
  inspector,
  className = "",
}: {
  language: UiLanguage
  inspector: OrchestrationDashboardInspectorModel
  className?: string
}) {
  return (
    <aside
      data-orchestration-floating-inspector={inspector.id}
      className={`rounded-[1.8rem] border border-stone-200 bg-white/95 p-5 shadow-[var(--orchestration-shadow-pop)] backdrop-blur-[2px] ${className}`.trim()}
    >
      <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-stone-500">
        {inspector.eyebrow}
      </div>
      <div className="mt-2 text-xl font-semibold text-stone-950">{inspector.title}</div>
      <p className="mt-2 text-sm leading-6 text-stone-600">{inspector.summary}</p>

      {inspector.configBadges.length > 0 ? (
        <div className="mt-4 flex flex-wrap gap-2" data-orchestration-floating-inspector-config="">
          {inspector.configBadges.map((badge) => (
            <span key={`config:${badge}`} className="rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-[11px] font-semibold text-amber-900">
              {badge}
            </span>
          ))}
        </div>
      ) : null}

      {inspector.runtimeBadges.length > 0 ? (
        <div className="mt-2 flex flex-wrap gap-2" data-orchestration-floating-inspector-runtime="">
          {inspector.runtimeBadges.map((badge) => (
            <span key={`runtime:${badge}`} className="rounded-full border border-sky-200 bg-sky-50 px-2.5 py-1 text-[11px] font-semibold text-sky-900">
              {badge}
            </span>
          ))}
        </div>
      ) : null}

      <div className="mt-4 space-y-2" data-orchestration-floating-inspector-details="">
        {inspector.details.length > 0 ? inspector.details.map((detail) => (
          <div key={detail} className="rounded-[1rem] border border-stone-200 bg-stone-50 px-3 py-2 text-sm leading-6 text-stone-700">
            {detail}
          </div>
        )) : (
          <div className="rounded-[1rem] border border-dashed border-stone-300 bg-stone-50 px-3 py-3 text-sm leading-6 text-stone-500">
            {pickUiText(language, "선택된 항목의 추가 정보가 여기에 표시됩니다.", "More detail about the selected item appears here.")}
          </div>
        )}
      </div>
    </aside>
  )
}
