import * as React from "react"
import type { TopologyEditorGate } from "../../lib/setup-visualization-topology"
import { pickUiText, type UiLanguage } from "../../stores/uiLanguage"

export function OrchestrationBoardGateNotice({
  gate,
  language,
  surface,
  entryHref,
}: {
  gate: TopologyEditorGate
  language: UiLanguage
  surface: "page" | "settings"
  entryHref: string
}) {
  const toneClass = gate.status === "disabled"
    ? "border-red-200 bg-red-50 text-red-900"
    : gate.status === "ready"
      ? "border-emerald-200 bg-emerald-50 text-emerald-900"
      : "border-amber-200 bg-amber-50 text-amber-900"
  const actionLabel = surface === "settings"
    ? pickUiText(language, "전체 편집 열기", "Open full editor")
    : pickUiText(language, "이 surface에서 편집 가능", "Editing available on this surface")

  return (
    <div data-orchestration-board-gate={gate.status} className={`rounded-[1.4rem] border px-4 py-4 text-sm leading-6 ${toneClass}`}>
      <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
        <div>
          <div className="font-semibold">{gate.title}</div>
          <div className="mt-1">{gate.message}</div>
          {gate.reasons.length > 1 ? (
            <div className="mt-2 space-y-1 text-xs opacity-85">
              {gate.reasons.slice(1).map((reason) => <div key={reason}>{reason}</div>)}
            </div>
          ) : null}
        </div>
        {surface === "settings" ? (
          <a
            href={entryHref}
            className="inline-flex items-center justify-center rounded-2xl border border-current/20 bg-white/70 px-4 py-2.5 text-sm font-semibold"
          >
            {actionLabel}
          </a>
        ) : (
          <span className="inline-flex items-center rounded-2xl border border-current/20 bg-white/70 px-4 py-2.5 text-sm font-semibold">
            {actionLabel}
          </span>
        )}
      </div>
    </div>
  )
}
