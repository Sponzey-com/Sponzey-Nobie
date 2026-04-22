import * as React from "react"
import {
  AGENT_ROLE_PRESETS,
  TEAM_PURPOSE_PRESETS,
  type AgentRolePresetId,
  type TeamPurposePresetId,
} from "../../lib/orchestration-presets"
import { pickUiText, type UiLanguage } from "../../stores/uiLanguage"

export function OrchestrationPresetPicker({
  kind,
  language,
  onChooseAgentPreset,
  onChooseTeamPreset,
  onClose,
}: {
  kind: "agent" | "team"
  language: UiLanguage
  onChooseAgentPreset?: (presetId: AgentRolePresetId) => void
  onChooseTeamPreset?: (presetId: TeamPurposePresetId) => void
  onClose?: () => void
}) {
  const t = (ko: string, en: string) => pickUiText(language, ko, en)

  return (
    <section className="rounded-[1.6rem] border border-stone-200 bg-white p-5 shadow-sm" data-orchestration-preset-picker={kind}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-stone-500">
            {kind === "agent" ? t("에이전트 프리셋", "Agent presets") : t("팀 프리셋", "Team presets")}
          </div>
          <div className="mt-2 text-base font-semibold text-stone-950">
            {kind === "agent"
              ? t("역할을 먼저 고르세요", "Pick a starting role")
              : t("팀 목적을 먼저 고르세요", "Pick a team purpose")}
          </div>
          <p className="mt-2 text-sm leading-6 text-stone-600">
            {kind === "agent"
              ? t("역할을 고르면 기본 권한과 allowlist는 안전한 기본값으로 채워지고, 생성 직후 quick edit sheet에서 바로 수정할 수 있습니다.", "Choosing a role seeds safe defaults for permissions and allowlists, then opens quick edit immediately.")
              : t("팀 목적을 고르면 purpose와 기본 role hint가 채워지고, 생성 직후 quick edit sheet에서 이름을 바로 수정할 수 있습니다.", "Choosing a team purpose seeds purpose and role hints, then opens quick edit immediately.")}
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded-full border border-stone-200 bg-white px-3 py-1.5 text-xs font-semibold text-stone-600"
        >
          {t("닫기", "Close")}
        </button>
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-3">
        {kind === "agent"
          ? (Object.values(AGENT_ROLE_PRESETS).map((preset) => (
              <button
                key={preset.id}
                type="button"
                onClick={() => onChooseAgentPreset?.(preset.id)}
                className="rounded-[1.4rem] border border-stone-200 bg-stone-50 p-4 text-left transition hover:border-stone-400 hover:bg-white"
                data-orchestration-agent-preset={preset.id}
              >
                <div className="text-sm font-semibold text-stone-950">{preset.label}</div>
                <div className="mt-2 text-sm leading-6 text-stone-600">{preset.role}</div>
                <div className="mt-3 text-xs leading-5 text-stone-500">
                  {preset.specialtyTags.join(", ")}
                </div>
              </button>
            )))
          : (Object.values(TEAM_PURPOSE_PRESETS).map((preset) => (
              <button
                key={preset.id}
                type="button"
                onClick={() => onChooseTeamPreset?.(preset.id)}
                className="rounded-[1.4rem] border border-stone-200 bg-stone-50 p-4 text-left transition hover:border-stone-400 hover:bg-white"
                data-orchestration-team-preset={preset.id}
              >
                <div className="text-sm font-semibold text-stone-950">{preset.label}</div>
                <div className="mt-2 text-sm leading-6 text-stone-600">{preset.purpose}</div>
                <div className="mt-3 text-xs leading-5 text-stone-500">
                  {t("리드", "Lead")}: {preset.primaryRoleHint}
                </div>
              </button>
            )))}
      </div>
    </section>
  )
}
