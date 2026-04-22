import * as React from "react"
import type { OrchestrationLegacyToolId, OrchestrationSurfacePolicy } from "../../lib/orchestration-surface-policy"
import { pickUiText, type UiLanguage } from "../../stores/uiLanguage"

export interface OrchestrationLegacyOverlayTool {
  id: OrchestrationLegacyToolId
  panel: React.ReactNode
}

export function OrchestrationLegacyOverlay({
  language,
  policy,
  open,
  activeToolId,
  tools,
  footer,
  onToggleOpen,
  onSelectTool,
}: {
  language: UiLanguage
  policy: OrchestrationSurfacePolicy
  open: boolean
  activeToolId: OrchestrationLegacyToolId
  tools: OrchestrationLegacyOverlayTool[]
  footer?: React.ReactNode
  onToggleOpen?: () => void
  onSelectTool?: (toolId: OrchestrationLegacyToolId) => void
}) {
  const visibleTools = policy.tools.filter((tool) => tool.visibility !== "hidden")
  const activeTool = visibleTools.find((tool) => tool.id === activeToolId) ?? visibleTools[0] ?? null
  const activePanel = tools.find((tool) => tool.id === activeTool?.id)?.panel ?? null
  const t = (ko: string, en: string) => pickUiText(language, ko, en)

  if (!policy.legacySurfaceVisible || visibleTools.length === 0) return null

  return (
    <section
      data-orchestration-legacy-overlay={policy.id}
      data-orchestration-legacy-overlay-open={open ? "true" : "false"}
      className="space-y-4 rounded-[2rem] border border-stone-200 bg-white/95 p-5 shadow-[var(--orchestration-shadow-pop)] backdrop-blur-[2px]"
    >
      <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-stone-500">
            {t("Secondary utility surface", "Secondary utility surface")}
          </div>
          <h2 className="mt-2 text-xl font-semibold text-stone-950">{policy.title}</h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-stone-600">{policy.description}</p>
          <p className="mt-3 max-w-3xl text-sm leading-6 text-stone-500">{policy.secondarySummary}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {policy.badges.map((badge) => (
            <span
              key={badge}
              className="rounded-full border border-stone-200 bg-stone-50 px-3 py-1.5 text-xs font-semibold text-stone-700"
            >
              {badge}
            </span>
          ))}
          {onToggleOpen ? (
            <button
              type="button"
              onClick={onToggleOpen}
              className="rounded-full bg-stone-950 px-4 py-2 text-sm font-semibold text-white"
            >
              {open ? t("보조 surface 접기", "Collapse utilities") : t("보조 surface 열기", "Open utilities")}
            </button>
          ) : null}
        </div>
      </div>

      <div className="flex flex-wrap gap-2" data-orchestration-legacy-tool-row="">
        {visibleTools.map((tool) => (
          <button
            key={tool.id}
            type="button"
            data-orchestration-legacy-tool={tool.id}
            data-orchestration-legacy-tool-emphasis={tool.emphasized ? "true" : "false"}
            onClick={() => onSelectTool?.(tool.id)}
            className={`rounded-full px-3 py-1.5 text-xs font-semibold ${
              activeTool?.id === tool.id
                ? "bg-stone-900 text-white"
                : tool.emphasized
                  ? "border border-amber-200 bg-amber-50 text-amber-900"
                  : "border border-stone-200 bg-white text-stone-700"
            }`}
            title={tool.description}
          >
            {tool.label}
          </button>
        ))}
      </div>

      {open && activeTool ? (
        <div
          data-orchestration-legacy-panel={activeTool.id}
          className="rounded-[1.6rem] border border-stone-200 bg-stone-50 p-4"
        >
          <div className="mb-4">
            <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-stone-500">
              {t("Active utility", "Active utility")}
            </div>
            <div className="mt-2 text-base font-semibold text-stone-950">{activeTool.label}</div>
            <p className="mt-2 text-sm leading-6 text-stone-600">{activeTool.description}</p>
          </div>
          {activePanel}
        </div>
      ) : null}

      {footer ? (
        <div data-orchestration-legacy-footer="">
          {footer}
        </div>
      ) : null}
    </section>
  )
}
