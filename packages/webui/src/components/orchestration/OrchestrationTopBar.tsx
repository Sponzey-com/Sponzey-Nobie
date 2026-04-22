import * as React from "react"
import { pickUiText, type UiLanguage } from "../../stores/uiLanguage"
import type { OrchestrationSummaryCard } from "../../lib/orchestration-ui"
import type { OrchestrationDashboardFallback, OrchestrationDashboardTab } from "../../lib/orchestration-dashboard-projection"

const TAB_ORDER: OrchestrationDashboardTab[] = ["map", "activity", "approvals", "utilities"]

export function OrchestrationTopBar({
  language,
  activeTab,
  onChange,
  summary,
}: {
  language: UiLanguage
  activeTab: OrchestrationDashboardTab
  onChange: (tab: OrchestrationDashboardTab) => void
  summary: OrchestrationSummaryCard[]
  fallback?: OrchestrationDashboardFallback
}) {
  return (
    <section
      data-orchestration-topbar={activeTab}
      className="rounded-[2rem] border border-stone-200 bg-white/90 p-5 shadow-[var(--orchestration-shadow-lift)] backdrop-blur-[2px]"
    >
      <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
        <div className="space-y-3">
          <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-stone-500">
            {pickUiText(language, "Command Center", "Command Center")}
          </div>
          <div>
            <h1 className="text-2xl font-semibold text-stone-950">
              {pickUiText(language, "에이전트/팀 맵", "Agent and team map")}
            </h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-stone-600">
              {pickUiText(
                language,
                "기본 앱 사이드바는 유지하고, 오른쪽 content viewport에서 map editor, activity, approvals, utilities를 전환합니다.",
                "Keep the default app sidebar and switch the map editor, activity, approvals, and utilities inside the right content viewport.",
              )}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {TAB_ORDER.map((tab) => (
              <button
                key={tab}
                type="button"
                onClick={() => onChange(tab)}
                data-orchestration-topbar-tab={tab}
                data-orchestration-topbar-active={activeTab === tab ? "true" : "false"}
                className={`rounded-full border px-4 py-2 text-sm font-semibold transition-colors ${
                  activeTab === tab
                    ? "border-stone-950 bg-stone-950 text-white"
                    : "border-stone-200 bg-stone-50 text-stone-700 hover:bg-stone-100"
                }`}
              >
                {labelForTab(tab, language)}
              </button>
            ))}
          </div>
        </div>

        <div className="flex max-w-2xl flex-wrap items-start justify-end gap-2">
          {summary.map((card) => (
            <span
              key={card.id}
              className="rounded-full border border-stone-200 bg-stone-50 px-3 py-1.5 text-xs font-semibold text-stone-700"
            >
              {card.label} {card.value}
            </span>
          ))}
        </div>
      </div>
    </section>
  )
}

function labelForTab(tab: OrchestrationDashboardTab, language: UiLanguage): string {
  switch (tab) {
    case "map":
      return pickUiText(language, "Map", "Map")
    case "activity":
      return pickUiText(language, "Activity", "Activity")
    case "approvals":
      return pickUiText(language, "Approvals", "Approvals")
    case "utilities":
      return pickUiText(language, "Utilities", "Utilities")
  }
}
