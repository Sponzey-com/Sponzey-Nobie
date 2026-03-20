import type { CapabilityStatus } from "../../contracts/capabilities"
import type { SetupStepMeta } from "../../contracts/setup"
import { UiLanguageSwitcher } from "../UiLanguageSwitcher"
import type { UiLanguage } from "../../stores/uiLanguage"
import { pickUiText } from "../../stores/uiLanguage"

export function SetupStepShell({
  title,
  description,
  steps,
  currentStep,
  onSelectStep,
  language,
  children,
  footer,
  assistPanel,
}: {
  title: string
  description: string
  steps: SetupStepMeta[]
  currentStep: string
  onSelectStep: (stepId: string) => void
  language: UiLanguage
  children: React.ReactNode
  footer?: React.ReactNode
  assistPanel?: React.ReactNode
}) {
  const currentIndex = Math.max(
    0,
    steps.findIndex((step) => step.id === currentStep),
  )
  const progress = steps.length > 0 ? Math.round(((currentIndex + 1) / steps.length) * 100) : 0
  const completedCount = steps.filter((step) => step.completed).length

  return (
    <div className="flex min-h-screen bg-[#efe8db] text-stone-900">
      <aside className="flex w-[320px] shrink-0 flex-col border-r border-stone-200 bg-[#151515] text-stone-100">
        <div className="border-b border-white/10 px-6 py-6">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="text-[11px] font-semibold uppercase tracking-[0.24em] text-stone-500">
                {pickUiText(language, "Nobie 설정", "Nobie Setup")}
              </div>
              <h1 className="mt-2 text-2xl font-semibold leading-tight">{title}</h1>
            </div>
            <UiLanguageSwitcher className="shrink-0 border-white/10 bg-white/5" />
          </div>
          {description.trim() ? <p className="mt-3 text-sm leading-6 text-stone-400">{description}</p> : null}

          <div className="mt-6 rounded-2xl border border-white/10 bg-white/5 p-4">
            <div className="flex items-center justify-between text-[11px] font-semibold uppercase tracking-[0.2em] text-stone-500">
              <span>{pickUiText(language, "전체 진행", "Overall progress")}</span>
              <span>{progress}%</span>
            </div>
            <div className="mt-3 h-2 overflow-hidden rounded-full bg-white/10">
              <div className="h-full rounded-full bg-white transition-all" style={{ width: `${progress}%` }} />
            </div>
            <div className="mt-3 flex items-center justify-between text-xs text-stone-400">
              <span>
                Step {String(currentIndex + 1).padStart(2, "0")} / {String(steps.length).padStart(2, "0")}
              </span>
              <span>{pickUiText(language, `완료 ${completedCount}개`, `${completedCount} completed`)}</span>
            </div>
          </div>
        </div>

        <nav className="flex-1 overflow-y-auto px-4 py-4">
          <div className="space-y-2">
            {steps.map((step, index) => {
              const isCurrent = currentStep === step.id
              const disabled = step.locked && !isCurrent

              return (
                <button
                  key={step.id}
                  type="button"
                  onClick={() => {
                    if (disabled) return
                    onSelectStep(step.id)
                  }}
                  disabled={disabled}
                  className={`w-full rounded-2xl border px-4 py-4 text-left transition ${
                    isCurrent
                      ? "border-stone-600 bg-stone-800 shadow-[0_0_0_1px_rgba(255,255,255,0.04)]"
                      : disabled
                        ? "cursor-not-allowed border-transparent bg-transparent opacity-70"
                        : "border-transparent bg-transparent hover:border-white/10 hover:bg-white/5"
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-stone-500">
                      Step {String(index + 1).padStart(2, "0")}
                    </span>
                    <CapabilityStateBadge status={step.status} language={language} />
                  </div>

                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <div className="text-sm font-semibold text-white">{step.label}</div>
                    <StepStateBadge current={isCurrent} completed={step.completed} locked={step.locked} language={language} />
                    <span
                      className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                        step.required ? "bg-rose-100 text-rose-700" : "bg-stone-700 text-stone-300"
                      }`}
                    >
                      {step.required ? pickUiText(language, "필수 *", "Required *") : pickUiText(language, "선택", "Optional")}
                    </span>
                  </div>

                  <div className="mt-2 text-xs leading-5 text-stone-400">{step.description}</div>
                  {step.locked && step.lockReason ? (
                    <div className="mt-2 text-[11px] leading-5 text-amber-300">{step.lockReason}</div>
                  ) : step.reason ? (
                    <div className="mt-2 text-[11px] leading-5 text-amber-300">{step.reason}</div>
                  ) : null}
                </button>
              )
            })}
          </div>
        </nav>
      </aside>

      <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden">
        <div className="relative min-w-0 flex-1 overflow-hidden">
          <div className="h-full overflow-y-auto px-8 py-8 pb-44 xl:px-10 xl:py-10 xl:pb-48">
            <div className="mx-auto w-full max-w-[1120px]">{children}</div>
          </div>
          {footer ? <div className="fixed bottom-0 left-[320px] right-0 z-30 border-t border-stone-200 bg-white/95 px-8 py-5 shadow-[0_-12px_28px_rgba(15,23,42,0.08)] backdrop-blur xl:right-[360px] xl:px-10">{footer}</div> : null}
        </div>
        {assistPanel ? <aside className="hidden w-[360px] shrink-0 overflow-y-auto border-l border-stone-200 xl:block">{assistPanel}</aside> : null}
      </div>
    </div>
  )
}

function CapabilityStateBadge({ status, language }: { status: CapabilityStatus; language: UiLanguage }) {
  const styleMap: Record<CapabilityStatus, string> = {
    ready: "border-emerald-200 bg-emerald-50 text-emerald-700",
    disabled: "border-amber-200 bg-amber-50 text-amber-700",
    planned: "border-slate-200 bg-slate-50 text-slate-600",
    error: "border-red-200 bg-red-50 text-red-700",
  }

  const labelMap: Record<CapabilityStatus, string> = {
    ready: pickUiText(language, "준비됨", "Ready"),
    disabled: pickUiText(language, "제한됨", "Limited"),
    planned: pickUiText(language, "예정", "Planned"),
    error: pickUiText(language, "오류", "Error"),
  }

  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold ${styleMap[status]}`}>
      {labelMap[status]}
    </span>
  )
}

function StepStateBadge({
  current,
  completed,
  locked,
  language,
}: {
  current: boolean
  completed: boolean
  locked: boolean
  language: UiLanguage
}) {
  if (locked) {
    return <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-700">{pickUiText(language, "잠김", "Locked")}</span>
  }

  if (completed) {
    return <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">{pickUiText(language, "완료", "Done")}</span>
  }

  if (current) {
    return <span className="rounded-full bg-sky-100 px-2 py-0.5 text-[10px] font-semibold text-sky-700">{pickUiText(language, "진행 중", "Current")}</span>
  }

  return <span className="rounded-full bg-stone-100 px-2 py-0.5 text-[10px] font-semibold text-stone-600">{pickUiText(language, "대기", "Waiting")}</span>
}
