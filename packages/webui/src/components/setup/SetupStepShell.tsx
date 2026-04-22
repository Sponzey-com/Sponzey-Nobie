import * as React from "react"
import { Link } from "react-router-dom"
import type { CapabilityStatus } from "../../contracts/capabilities"
import type { SetupStepMeta } from "../../contracts/setup"
import { UiLanguageSwitcher } from "../UiLanguageSwitcher"
import type { UiLanguage } from "../../stores/uiLanguage"
import { pickUiText } from "../../stores/uiLanguage"
import { SetupInspectorDrawer } from "./SetupInspectorDrawer"
import { SetupInspectorSheet } from "./SetupInspectorSheet"

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
  canvas,
  legend,
  inspector,
  mobileInspector,
  inspectorTitle,
  inspectorDescription,
  inspectorOpen = false,
  onInspectorOpen,
  onInspectorClose,
  mobileNavigatorOpen = false,
  onMobileNavigatorOpen,
  onMobileNavigatorClose,
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
  canvas?: React.ReactNode
  legend?: React.ReactNode
  inspector?: React.ReactNode
  mobileInspector?: React.ReactNode
  inspectorTitle?: string
  inspectorDescription?: string
  inspectorOpen?: boolean
  onInspectorOpen?: () => void
  onInspectorClose?: () => void
  mobileNavigatorOpen?: boolean
  onMobileNavigatorOpen?: () => void
  onMobileNavigatorClose?: () => void
}) {
  const currentIndex = Math.max(
    0,
    steps.findIndex((step) => step.id === currentStep),
  )
  const progress = steps.length > 0 ? Math.round(((currentIndex + 1) / steps.length) * 100) : 0
  const completedCount = steps.filter((step) => step.completed).length
  const hasDesktopSidePanel = Boolean(inspector || assistPanel)
  const hasVisualizationSlots = Boolean(legend || canvas || mobileInspector)
  const responsiveInspector = mobileInspector ?? inspector
  const responsiveInspectorTitle = inspectorTitle ?? pickUiText(language, "현재 단계 Inspector", "Current step inspector")
  const responsiveInspectorDescription = inspectorDescription ?? pickUiText(language, "선택한 노드와 연결된 편집 패널을 엽니다.", "Opens the editing panel tied to the selected node.")

  return (
    <div className="flex min-h-screen bg-[#efe8db] text-stone-900">
      <aside className="hidden w-[260px] shrink-0 flex-col border-r border-stone-200 bg-[#151515] text-stone-100 md:flex xl:w-[320px]">
        <div className="border-b border-white/10 px-6 py-6">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="text-[11px] font-semibold uppercase tracking-[0.24em] text-stone-500">
                {pickUiText(language, "Nobie 설정", "Nobie Setup")}
              </div>
              <h1 className="mt-2 text-2xl font-semibold leading-tight">{title}</h1>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <Link
                to="/settings"
                className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs font-semibold text-stone-200 transition hover:bg-white/10"
              >
                {pickUiText(language, "설정 화면 열기", "Open settings")}
              </Link>
              <UiLanguageSwitcher className="shrink-0 border-white/10 bg-white/5" />
            </div>
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
                  aria-current={isCurrent ? "step" : undefined}
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
          <div className="h-full overflow-y-auto px-4 py-4 pb-52 sm:px-6 sm:py-6 md:px-8 md:py-8 md:pb-44 xl:px-10 xl:py-10 xl:pb-48">
            <div className="mx-auto w-full max-w-[1120px]">
              <div className="mb-5 flex flex-wrap items-center justify-between gap-3 xl:hidden">
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={onMobileNavigatorOpen}
                    aria-expanded={mobileNavigatorOpen}
                    aria-controls="setup-mobile-steps"
                    className="rounded-2xl border border-stone-200 bg-white px-4 py-2.5 text-sm font-semibold text-stone-700"
                  >
                    {pickUiText(language, "단계 보기", "Steps")}
                  </button>
                  {responsiveInspector ? (
                    <button
                      type="button"
                      onClick={inspectorOpen ? onInspectorClose : onInspectorOpen}
                      aria-expanded={inspectorOpen}
                      aria-controls="setup-responsive-inspector"
                      className="rounded-2xl border border-stone-200 bg-white px-4 py-2.5 text-sm font-semibold text-stone-700"
                    >
                      {inspectorOpen ? pickUiText(language, "Inspector 닫기", "Close inspector") : pickUiText(language, "Inspector 열기", "Open inspector")}
                    </button>
                  ) : null}
                </div>
                <div className="text-xs text-stone-500">
                  Step {String(currentIndex + 1).padStart(2, "0")} / {String(steps.length).padStart(2, "0")}
                </div>
              </div>

              {hasVisualizationSlots ? (
                <div className="space-y-6">
                  {legend ? <div data-setup-slot="legend">{legend}</div> : null}
                  {canvas ? <div data-setup-slot="canvas">{canvas}</div> : null}
                  <div data-setup-slot="content">{children}</div>
                  {responsiveInspector ? <div className="hidden" data-setup-slot="inspector-mobile">{responsiveInspector}</div> : null}
                  {assistPanel ? <div className="xl:hidden" data-setup-mobile-assist="">{assistPanel}</div> : null}
                </div>
              ) : (
                <div className="space-y-6">
                  {children}
                  {assistPanel ? <div className="xl:hidden" data-setup-mobile-assist="">{assistPanel}</div> : null}
                </div>
              )}
            </div>
          </div>
          {footer ? (
            <div className={`fixed bottom-0 left-0 right-0 z-30 border-t border-stone-200 bg-white/95 px-4 py-4 pb-[calc(1rem+env(safe-area-inset-bottom))] shadow-[0_-12px_28px_rgba(15,23,42,0.08)] backdrop-blur sm:px-6 md:left-[260px] md:px-8 md:py-5 xl:left-[320px] xl:px-10 ${hasDesktopSidePanel ? "xl:right-[360px]" : "xl:right-0"}`}>
              {footer}
            </div>
          ) : null}
        </div>
        {hasDesktopSidePanel ? (
          <aside className="hidden w-[360px] shrink-0 border-l border-stone-200 xl:flex xl:flex-col">
            {inspector ? (
              <div
                className={assistPanel ? "min-h-0 flex-1 overflow-y-auto border-b border-stone-200" : "h-full overflow-y-auto"}
                data-setup-slot="inspector"
              >
                {inspector}
              </div>
            ) : null}
            {assistPanel ? (
              <div
                className={inspector ? "min-h-0 flex-1 overflow-y-auto" : "h-full overflow-y-auto"}
                data-setup-slot="assist-panel"
              >
                {assistPanel}
              </div>
            ) : null}
          </aside>
        ) : null}
      </div>

      {responsiveInspector ? (
        <>
          <SetupInspectorDrawer
            open={inspectorOpen}
            title={responsiveInspectorTitle}
            description={responsiveInspectorDescription}
            language={language}
            onClose={() => onInspectorClose?.()}
          >
            <div id="setup-responsive-inspector">{responsiveInspector}</div>
          </SetupInspectorDrawer>
          <SetupInspectorSheet
            open={inspectorOpen}
            title={responsiveInspectorTitle}
            description={responsiveInspectorDescription}
            language={language}
            onClose={() => onInspectorClose?.()}
          >
            <div id="setup-responsive-inspector">{responsiveInspector}</div>
          </SetupInspectorSheet>
        </>
      ) : null}

      {mobileNavigatorOpen ? (
        <div className="md:hidden" id="setup-mobile-steps" data-setup-mobile-panel="steps">
          <div
            className="fixed inset-0 z-40 bg-stone-950/25 backdrop-blur-[1px]"
            aria-hidden="true"
            onClick={() => onMobileNavigatorClose?.()}
          />
          <section
            role="dialog"
            aria-modal="true"
            aria-label={pickUiText(language, "단계 네비게이터", "Step navigator")}
            className="fixed inset-x-3 top-3 z-50 max-h-[70vh] overflow-hidden rounded-[2rem] border border-stone-200 bg-[#151515] text-stone-100 shadow-[0_28px_70px_rgba(15,23,42,0.2)]"
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault()
                onMobileNavigatorClose?.()
              }
            }}
          >
            <div className="flex items-center justify-between gap-3 border-b border-white/10 px-5 py-4">
              <div className="text-sm font-semibold">{pickUiText(language, "단계 네비게이터", "Step navigator")}</div>
              <button
                type="button"
                autoFocus
                onClick={() => onMobileNavigatorClose?.()}
                className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs font-semibold text-stone-200"
              >
                {pickUiText(language, "닫기", "Close")}
              </button>
            </div>
            <div className="max-h-[calc(70vh-4.5rem)] overflow-y-auto px-4 py-4">
              <div className="space-y-2">
                {steps.map((step, index) => {
                  const isCurrent = currentStep === step.id
                  const disabled = step.locked && !isCurrent

                  return (
                    <button
                      key={step.id}
                      type="button"
                      disabled={disabled}
                      aria-current={isCurrent ? "step" : undefined}
                      onClick={() => {
                        if (disabled) return
                        onMobileNavigatorClose?.()
                        onSelectStep(step.id)
                      }}
                      className={`w-full rounded-2xl border px-4 py-4 text-left transition ${
                        isCurrent
                          ? "border-stone-600 bg-stone-800"
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
                      <div className="mt-2 text-sm font-semibold text-white">{step.label}</div>
                      <div className="mt-2 text-xs leading-5 text-stone-400">{step.description}</div>
                    </button>
                  )
                })}
              </div>
            </div>
          </section>
        </div>
      ) : null}
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
