import * as React from "react"
import { OrchestrationCreateCommand, type OrchestrationCreateCommandFeedback } from "./OrchestrationCreateCommand"
import { ORCHESTRATION_STARTER_COMMAND_CHIPS } from "../../lib/orchestration-starter-kits"
import { pickUiText, type UiLanguage } from "../../stores/uiLanguage"

export function OrchestrationGenerateBar({
  language,
  value,
  feedback,
  onChange,
  onGenerate,
  onChooseExample,
  onOpenAgentPresets,
  onOpenTeamPresets,
}: {
  language: UiLanguage
  value: string
  feedback?: OrchestrationCreateCommandFeedback | null
  onChange: (value: string) => void
  onGenerate: () => void
  onChooseExample: (value: string) => void
  onOpenAgentPresets: () => void
  onOpenTeamPresets: () => void
}) {
  return (
    <section
      data-orchestration-generate-bar=""
      className="rounded-[1.8rem] border border-stone-200 bg-white/95 p-4 shadow-[var(--orchestration-shadow-node)] backdrop-blur-[2px]"
    >
      <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-stone-500">
        {pickUiText(language, "Generate bar", "Generate bar")}
      </div>
      <div className="mt-3 flex flex-col gap-3 xl:flex-row">
        <div className="min-w-0 flex-1">
          <OrchestrationCreateCommand
            language={language}
            value={value}
            placeholder={pickUiText(language, "예: research team 3, review squad", "Example: research team 3, review squad")}
            examples={ORCHESTRATION_STARTER_COMMAND_CHIPS}
            feedback={feedback}
            onChange={onChange}
            onChooseExample={onChooseExample}
          />
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={onGenerate}
            className="rounded-[1.2rem] bg-stone-950 px-4 py-3 text-sm font-semibold text-white"
          >
            {pickUiText(language, "Open starter", "Open starter")}
          </button>
          <button
            type="button"
            onClick={onOpenAgentPresets}
            className="rounded-[1.2rem] border border-stone-200 bg-white px-4 py-3 text-sm font-semibold text-stone-700"
          >
            {pickUiText(language, "Agent presets", "Agent presets")}
          </button>
          <button
            type="button"
            onClick={onOpenTeamPresets}
            className="rounded-[1.2rem] border border-stone-200 bg-white px-4 py-3 text-sm font-semibold text-stone-700"
          >
            {pickUiText(language, "Team presets", "Team presets")}
          </button>
        </div>
      </div>
      <p className="mt-3 text-sm leading-6 text-stone-600">
        {pickUiText(
          language,
          "제한된 문법과 starter kit만 허용합니다. 모호한 입력은 바로 저장하지 않고 review popup으로 보냅니다.",
          "Only constrained grammar and starter kits are allowed. Ambiguous input goes to a review popup instead of being stored directly.",
        )}
      </p>
    </section>
  )
}
