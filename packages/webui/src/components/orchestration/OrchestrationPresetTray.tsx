import * as React from "react"
import type { AgentRolePresetId, TeamPurposePresetId } from "../../lib/orchestration-presets"
import { pickUiText, type UiLanguage } from "../../stores/uiLanguage"
import { OrchestrationPresetPicker } from "./OrchestrationPresetPicker"

export function OrchestrationPresetTray({
  language,
  kind,
  onClose,
  onChooseAgentPreset,
  onChooseTeamPreset,
}: {
  language: UiLanguage
  kind: "agent" | "team" | null
  onClose: () => void
  onChooseAgentPreset: (presetId: AgentRolePresetId) => void
  onChooseTeamPreset: (presetId: TeamPurposePresetId) => void
}) {
  if (!kind) return null

  return (
    <section
      data-orchestration-preset-tray={kind}
      className="rounded-[1.8rem] border border-stone-200 bg-white/95 p-4 shadow-[var(--orchestration-shadow-node)] backdrop-blur-[2px]"
    >
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-stone-500">
          {pickUiText(language, "Preset tray", "Preset tray")}
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded-full border border-stone-200 bg-white px-3 py-1.5 text-xs font-semibold text-stone-600"
        >
          {pickUiText(language, "닫기", "Close")}
        </button>
      </div>
      <OrchestrationPresetPicker
        kind={kind}
        language={language}
        onClose={onClose}
        onChooseAgentPreset={onChooseAgentPreset}
        onChooseTeamPreset={onChooseTeamPreset}
      />
    </section>
  )
}
