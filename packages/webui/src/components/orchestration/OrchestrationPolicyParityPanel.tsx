import * as React from "react"
import {
  formatOrchestrationParityPlacement,
  type OrchestrationPolicyParityField,
  type OrchestrationSurfacePolicy,
} from "../../lib/orchestration-surface-policy"
import { pickUiText, type UiLanguage } from "../../stores/uiLanguage"

export function OrchestrationPolicyParityPanel({
  language,
  surfacePolicy,
  fields,
}: {
  language: UiLanguage
  surfacePolicy: OrchestrationSurfacePolicy
  fields: OrchestrationPolicyParityField[]
}) {
  const t = (ko: string, en: string) => pickUiText(language, ko, en)

  return (
    <section
      data-orchestration-policy-parity={surfacePolicy.id}
      className="rounded-[1.6rem] border border-stone-200 bg-white p-4 shadow-[var(--orchestration-shadow-node)]"
    >
      <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-stone-500">
            {t("Policy parity", "Policy parity")}
          </div>
          <div className="mt-2 text-base font-semibold text-stone-950">
            {t("고급 정책 필드 노출 경계", "Advanced policy field exposure boundary")}
          </div>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-stone-600">
            {surfacePolicy.settingsPreviewOnly
              ? t(
                  "Settings에서는 이 필드들을 preview로만 유지합니다. 실제 raw 수정은 `/agents` legacy utility surface에서만 수행합니다.",
                  "Settings keeps these fields in preview only. Real raw edits remain on the `/agents` legacy utility surface.",
                )
              : t(
                  "quick edit를 가볍게 유지하기 위해 이 필드들은 foldout preview와 legacy raw editor로 분리합니다.",
                  "To keep quick edit lightweight, these fields are split between the foldout preview and the legacy raw editor.",
                )}
          </p>
        </div>
        <div className="rounded-[1rem] border border-stone-200 bg-stone-50 px-4 py-3 text-sm leading-6 text-stone-700">
          <div className="font-semibold">{surfacePolicy.title}</div>
          <div className="mt-1">{surfacePolicy.secondarySummary}</div>
        </div>
      </div>

      <div className="mt-4 space-y-3">
        {fields.map((field) => (
          <article
            key={field.id}
            data-orchestration-policy-field={field.id}
            className="rounded-[1.25rem] border border-stone-200 bg-stone-50 p-4"
          >
            <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
              <div>
                <div className="text-sm font-semibold text-stone-950">{field.label}</div>
                <p className="mt-2 max-w-3xl text-sm leading-6 text-stone-600">{field.description}</p>
              </div>
              <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
                <ParityCell
                  label={t("Quick edit", "Quick edit")}
                  value={formatOrchestrationParityPlacement(field.quickEdit, language)}
                  dataKey="quick_edit"
                />
                <ParityCell
                  label={t("Advanced foldout", "Advanced foldout")}
                  value={formatOrchestrationParityPlacement(field.advancedFoldout, language)}
                  dataKey="advanced_foldout"
                />
                <ParityCell
                  label={t("Legacy overlay", "Legacy overlay")}
                  value={formatOrchestrationParityPlacement(field.legacyOverlay, language)}
                  dataKey="legacy_overlay"
                />
                <ParityCell
                  label={t("Settings preview", "Settings preview")}
                  value={formatOrchestrationParityPlacement(field.settingsPreview, language)}
                  dataKey="settings_preview"
                />
              </div>
            </div>
          </article>
        ))}
      </div>
    </section>
  )
}

function ParityCell({
  label,
  value,
  dataKey,
}: {
  label: string
  value: string
  dataKey: string
}) {
  return (
    <div
      data-orchestration-policy-placement={dataKey}
      className="rounded-[1rem] border border-stone-200 bg-white px-3 py-2"
    >
      <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-stone-500">{label}</div>
      <div className="mt-1 text-sm font-semibold text-stone-900">{value}</div>
    </div>
  )
}
