import * as React from "react"
import type { OrchestrationDashboardActivityItem } from "../../lib/orchestration-dashboard-projection"
import { pickUiText, type UiLanguage } from "../../stores/uiLanguage"

export function OrchestrationActivityBar({
  language,
  tab,
  items,
  variant = "grid",
}: {
  language: UiLanguage
  tab: "activity" | "approvals"
  items: OrchestrationDashboardActivityItem[]
  variant?: "grid" | "strip"
}) {
  if (variant === "strip") {
    return (
      <section
        data-orchestration-activity-bar={tab}
        data-orchestration-activity-variant="strip"
        className="rounded-[1.8rem] border border-stone-200 bg-white/92 px-4 py-3 shadow-[var(--orchestration-shadow-node)] backdrop-blur-[2px]"
      >
        <div className="flex items-center gap-3 overflow-x-auto">
          <div className="shrink-0 text-[11px] font-semibold uppercase tracking-[0.16em] text-stone-500">
            {tab === "activity"
              ? pickUiText(language, "Live activity", "Live activity")
              : pickUiText(language, "Approvals", "Approvals")}
          </div>
          {items.length > 0 ? items.map((item) => (
            <article
              key={item.id}
              data-orchestration-activity-item={item.id}
              className={`min-w-[220px] shrink-0 rounded-[1.1rem] border px-3 py-2 ${activityToneClass(item.tone)}`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="text-sm font-semibold">{item.title}</div>
                <span className="rounded-full bg-white/80 px-2 py-0.5 text-[10px] font-semibold">{item.badge}</span>
              </div>
              <p className="mt-1 text-xs leading-5 opacity-85">{item.description}</p>
            </article>
          )) : (
            <div className="rounded-[1.1rem] border border-dashed border-stone-300 bg-stone-50 px-4 py-3 text-sm leading-6 text-stone-500">
              {tab === "activity"
                ? pickUiText(language, "현재 표시할 activity 항목이 없습니다.", "There are no activity items to show right now.")
                : pickUiText(language, "현재 대기 중인 approval 항목이 없습니다.", "There are no approval items waiting right now.")}
            </div>
          )}
        </div>
      </section>
    )
  }

  return (
    <section
      data-orchestration-activity-bar={tab}
      data-orchestration-activity-variant="grid"
      className="rounded-[1.8rem] border border-stone-200 bg-white/90 p-4 shadow-[var(--orchestration-shadow-node)] backdrop-blur-[2px]"
    >
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-stone-500">
            {tab === "activity"
              ? pickUiText(language, "Activity rail", "Activity rail")
              : pickUiText(language, "Approval rail", "Approval rail")}
          </div>
          <div className="mt-1 text-base font-semibold text-stone-950">
            {tab === "activity"
              ? pickUiText(language, "최근 런타임과 경고", "Recent runtime and warnings")
              : pickUiText(language, "승인과 차단 상태", "Approvals and blocked states")}
          </div>
        </div>
        <span className="rounded-full border border-stone-200 bg-stone-50 px-3 py-1 text-xs font-semibold text-stone-700">
          {items.length}
        </span>
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {items.length > 0 ? items.map((item) => (
          <article
            key={item.id}
            data-orchestration-activity-item={item.id}
            className={`rounded-[1.2rem] border px-4 py-3 ${activityToneClass(item.tone)}`}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="text-sm font-semibold">{item.title}</div>
              <span className="rounded-full bg-white/80 px-2 py-1 text-[11px] font-semibold">{item.badge}</span>
            </div>
            <p className="mt-2 text-sm leading-6 opacity-85">{item.description}</p>
          </article>
        )) : (
          <div className="rounded-[1.2rem] border border-dashed border-stone-300 bg-stone-50 px-4 py-4 text-sm leading-6 text-stone-500 md:col-span-2 xl:col-span-3">
            {tab === "activity"
              ? pickUiText(language, "현재 표시할 activity 항목이 없습니다.", "There are no activity items to show right now.")
              : pickUiText(language, "현재 대기 중인 approval 항목이 없습니다.", "There are no approval items waiting right now.")}
          </div>
        )}
      </div>
    </section>
  )
}

function activityToneClass(tone: OrchestrationDashboardActivityItem["tone"]): string {
  switch (tone) {
    case "danger":
      return "border-red-200 bg-red-50 text-red-950"
    case "warning":
      return "border-amber-200 bg-amber-50 text-amber-950"
    case "ready":
      return "border-emerald-200 bg-emerald-50 text-emerald-950"
    case "neutral":
    default:
      return "border-stone-200 bg-stone-50 text-stone-800"
  }
}
