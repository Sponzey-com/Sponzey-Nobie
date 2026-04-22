import * as React from "react"
import type { OrchestrationBoardProjection } from "../../lib/orchestration-board-projection"
import type { TopologyEditorGate } from "../../lib/setup-visualization-topology"
import { pickUiText, type UiLanguage } from "../../stores/uiLanguage"
import { OrchestrationBoardEditor } from "./OrchestrationBoardEditor"

export function OrchestrationStudioPreview({
  language,
  projection,
  gate,
  entryHref,
  selectedTitle,
  secondaryBadges = [],
  secondaryNote,
  onSelectAgent,
  onSelectTeam,
}: {
  language: UiLanguage
  projection: OrchestrationBoardProjection
  gate: TopologyEditorGate
  entryHref: string
  selectedTitle: string
  secondaryBadges?: string[]
  secondaryNote?: string
  onSelectAgent?: (agentId: string) => void
  onSelectTeam?: (teamId: string) => void
}) {
  return (
    <section
      data-orchestration-studio-preview=""
      className="space-y-4 rounded-[2rem] border border-stone-200 bg-white/95 p-5 shadow-[var(--orchestration-shadow-lift)] backdrop-blur-[2px]"
    >
      <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-stone-500">
            {pickUiText(language, "Studio preview", "Studio preview")}
          </div>
          <h2 className="mt-2 text-xl font-semibold text-stone-950">
            {pickUiText(language, "설정 탭용 얕은 미리보기", "Shallow preview for Settings")}
          </h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-stone-600">
            {pickUiText(
              language,
              "Settings에서는 같은 map projection을 읽기 전용으로만 보여주고, 실제 저장과 quick-edit는 `/agents` 편집 화면에서 진행합니다.",
              "Settings keeps the same map projection in read-only form, while real saving and quick edit stay in the `/agents` editor.",
            )}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-full border border-stone-200 bg-stone-50 px-3 py-1.5 text-xs font-semibold text-stone-700">
            {pickUiText(language, "selection", "selection")} {selectedTitle}
          </span>
          <a
            href={entryHref}
            className="rounded-full bg-stone-950 px-4 py-2 text-sm font-semibold text-white"
          >
            {pickUiText(language, "Open Editor", "Open Editor")}
          </a>
        </div>
      </div>

      {secondaryBadges.length > 0 || secondaryNote ? (
        <div
          data-orchestration-studio-preview-secondary=""
          className="rounded-[1.4rem] border border-stone-200 bg-stone-50 p-4"
        >
          {secondaryBadges.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {secondaryBadges.map((badge) => (
                <span
                  key={badge}
                  className="rounded-full border border-stone-200 bg-white px-3 py-1.5 text-xs font-semibold text-stone-700"
                >
                  {badge}
                </span>
              ))}
            </div>
          ) : null}
          {secondaryNote ? (
            <p className={`text-sm leading-6 text-stone-600 ${secondaryBadges.length > 0 ? "mt-3" : ""}`}>
              {secondaryNote}
            </p>
          ) : null}
        </div>
      ) : null}

      <OrchestrationBoardEditor
        projection={projection}
        gate={gate}
        language={language}
        surface="settings"
        entryHref={entryHref}
        layout="dashboard"
        nodeMode="card"
        onSelectAgent={onSelectAgent}
        onSelectTeam={onSelectTeam}
      />
    </section>
  )
}
