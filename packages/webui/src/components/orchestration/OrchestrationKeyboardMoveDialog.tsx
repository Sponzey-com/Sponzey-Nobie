import * as React from "react"
import { getOrchestrationShortcutHints, trapOrchestrationFocus } from "../../lib/orchestration-shortcuts"
import { pickUiText, type UiLanguage } from "../../stores/uiLanguage"

export interface OrchestrationKeyboardMoveOption {
  laneId: string
  label: string
  description: string
}

export function OrchestrationKeyboardMoveDialog({
  language,
  open,
  agentLabel,
  sourceLaneId,
  targetLaneId,
  sourceOptions,
  targetOptions,
  onSourceChange,
  onTargetChange,
  onConfirm,
  onClose,
}: {
  language: UiLanguage
  open: boolean
  agentLabel: string
  sourceLaneId: string
  targetLaneId: string
  sourceOptions: OrchestrationKeyboardMoveOption[]
  targetOptions: OrchestrationKeyboardMoveOption[]
  onSourceChange: (laneId: string) => void
  onTargetChange: (laneId: string) => void
  onConfirm: () => void
  onClose: () => void
}) {
  const rootRef = React.useRef<HTMLDivElement | null>(null)
  const hints = React.useMemo(() => getOrchestrationShortcutHints(language), [language])
  const t = (ko: string, en: string) => pickUiText(language, ko, en)

  React.useEffect(() => {
    if (!open) return
    rootRef.current?.focus()
  }, [open])

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-[60] flex items-end justify-center bg-stone-950/35 px-4 py-4 md:items-center"
      data-orchestration-keyboard-move-backdrop=""
    >
      <div
        ref={rootRef}
        role="dialog"
        aria-modal="true"
        aria-label={t("키보드 이동", "Keyboard move")}
        tabIndex={-1}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault()
            onClose()
            return
          }
          trapOrchestrationFocus(event.nativeEvent, rootRef.current)
        }}
        data-orchestration-keyboard-move={agentLabel}
        data-orchestration-focus-trap="keyboard-move"
        className="w-full max-w-3xl rounded-[2rem] border border-stone-200 bg-white p-5 shadow-[var(--orchestration-shadow-pop)]"
      >
        <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-stone-500">
              {t("Keyboard move", "Keyboard move")}
            </div>
            <h2 className="mt-2 text-xl font-semibold text-stone-950">{agentLabel}</h2>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-stone-600">
              {t(
                "drag/drop 대신 source lane과 target lane을 고른 뒤 기존 drop action popup과 같은 의미로 진행합니다.",
                "Pick a source lane and a target lane instead of dragging, then continue through the same drop-action flow.",
              )}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full border border-stone-200 bg-white px-4 py-2 text-sm font-semibold text-stone-700"
          >
            {t("닫기", "Close")}
          </button>
        </div>

        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <ChoiceGroup
            language={language}
            title={t("Source lane", "Source lane")}
            value={sourceLaneId}
            options={sourceOptions}
            onChange={onSourceChange}
          />
          <ChoiceGroup
            language={language}
            title={t("Target lane", "Target lane")}
            value={targetLaneId}
            options={targetOptions}
            onChange={onTargetChange}
          />
        </div>

        <div className="mt-4 rounded-[1.3rem] border border-stone-200 bg-stone-50 p-4">
          <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-stone-500">
            {t("Shortcut legend", "Shortcut legend")}
          </div>
          <div className="mt-3 flex flex-wrap gap-2" data-orchestration-shortcut-hints="">
            {hints.map((hint) => (
              <span
                key={hint.action}
                data-orchestration-shortcut={hint.action}
                className="rounded-full border border-stone-200 bg-white px-3 py-1.5 text-xs font-semibold text-stone-700"
              >
                {hint.combo} · {hint.label}
              </span>
            ))}
          </div>
        </div>

        <div className="mt-4 flex flex-wrap justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-full border border-stone-200 bg-white px-4 py-2 text-sm font-semibold text-stone-700"
          >
            {t("취소", "Cancel")}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={!sourceLaneId || !targetLaneId || sourceLaneId === targetLaneId}
            className="rounded-full bg-stone-950 px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
          >
            {t("다음 액션 열기", "Open next action")}
          </button>
        </div>
      </div>
    </div>
  )
}

function ChoiceGroup({
  language,
  title,
  value,
  options,
  onChange,
}: {
  language: UiLanguage
  title: string
  value: string
  options: OrchestrationKeyboardMoveOption[]
  onChange: (laneId: string) => void
}) {
  return (
    <section className="rounded-[1.4rem] border border-stone-200 bg-stone-50 p-4">
      <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-stone-500">{title}</div>
      <div className="mt-3 space-y-2">
        {options.map((option) => (
          <button
            key={option.laneId}
            type="button"
            aria-pressed={value === option.laneId}
            data-orchestration-keyboard-move-option={option.laneId}
            onClick={() => onChange(option.laneId)}
            className={`w-full rounded-[1.2rem] border px-4 py-3 text-left ${
              value === option.laneId
                ? "border-stone-950 bg-stone-950 text-white"
                : "border-stone-200 bg-white text-stone-700"
            }`}
          >
            <div className="text-sm font-semibold">{option.label}</div>
            <div className={`mt-1 text-xs leading-5 ${value === option.laneId ? "text-white/80" : "text-stone-500"}`}>
              {option.description}
            </div>
          </button>
        ))}
      </div>
    </section>
  )
}
