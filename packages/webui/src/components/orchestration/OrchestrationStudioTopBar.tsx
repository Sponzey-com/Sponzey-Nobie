import * as React from "react"
import { pickUiText, type UiLanguage } from "../../stores/uiLanguage"

export function OrchestrationStudioTopBar({
  language,
  dirty,
  selectionLabel,
}: {
  language: UiLanguage
  dirty: boolean
  selectionLabel: string
}) {
  return (
    <section
      data-orchestration-studio-topbar=""
      className="rounded-[2rem] border border-stone-200 bg-white/95 p-5 shadow-[var(--orchestration-shadow-lift)] backdrop-blur-[2px]"
    >
      <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-stone-500">
            {pickUiText(language, "Map Editor", "Map Editor")}
          </div>
          <h2 className="mt-2 text-2xl font-semibold text-stone-950">
            {pickUiText(language, "편집 가능한 팀/에이전트 맵", "Editable team and agent map")}
          </h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-stone-600">
            {pickUiText(
              language,
              "Map이 곧 편집 화면입니다. Team+와 Agent+로 초안을 만들고, 카드를 눌러 quick sheet에서 수정한 뒤 맵 위 메뉴에서 검증과 저장을 처리합니다.",
              "The map is the editor. Create drafts with Team+ and Agent+, edit them in the quick sheet, then validate and save from the in-map menu.",
            )}
          </p>
        </div>
        <div className="flex max-w-[28rem] flex-wrap items-center gap-2 xl:justify-end">
          <span className={`rounded-full px-3 py-1.5 text-xs font-semibold ${dirty ? "border border-amber-200 bg-amber-50 text-amber-900" : "border border-emerald-200 bg-emerald-50 text-emerald-900"}`}>
            {dirty
              ? pickUiText(language, "draft changed", "draft changed")
              : pickUiText(language, "draft synced", "draft synced")}
          </span>
          <span className="rounded-full border border-stone-200 bg-stone-50 px-3 py-1.5 text-xs font-semibold text-stone-700">
            {pickUiText(language, "selection", "selection")} {selectionLabel}
          </span>
        </div>
      </div>
    </section>
  )
}
