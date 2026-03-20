import type { SetupChecksResponse } from "../../api/adapters/types"
import type { CapabilityStatus } from "../../contracts/capabilities"
import type { SetupStepMeta } from "../../contracts/setup"
import { useUiI18n } from "../../lib/ui-i18n"

export function SetupAssistPanel({
  currentStep,
  currentIndex,
  totalSteps,
  checks,
  lastSavedAt,
  lastError,
}: {
  currentStep: SetupStepMeta
  currentIndex: number
  totalSteps: number
  checks: SetupChecksResponse | null
  lastSavedAt: number | null
  lastError: string
}) {
  const progress = totalSteps > 0 ? Math.round(((currentIndex + 1) / totalSteps) * 100) : 0
  const { text, displayText, formatTime } = useUiI18n()

  return (
    <div className="flex h-full flex-col gap-4 bg-[#f7f2e8] p-6">
      <section className="rounded-3xl border border-stone-200 bg-white p-5 shadow-sm">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-stone-400">{text("현재 단계", "Current Step")}</div>
            <div className="mt-2 text-lg font-semibold text-stone-900">{currentStep.label}</div>
            <p className="mt-2 text-sm leading-6 text-stone-600">{currentStep.description}</p>
          </div>
          <span
            className={`rounded-full px-3 py-1 text-xs font-semibold ${
              currentStep.required ? "bg-rose-100 text-rose-700" : "bg-stone-100 text-stone-600"
            }`}
          >
            {currentStep.required ? text("필수 *", "Required *") : text("선택", "Optional")}
          </span>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          <StepStatusChip step={currentStep} text={text} />
          <CapabilityStateChip status={currentStep.status} text={text} />
        </div>

        <div className="mt-5">
          <div className="flex items-center justify-between text-xs font-semibold uppercase tracking-[0.18em] text-stone-400">
            <span>{text("전체 진행", "Overall Progress")}</span>
            <span>
              {String(currentIndex + 1).padStart(2, "0")} / {String(totalSteps).padStart(2, "0")}
            </span>
          </div>
          <div className="mt-2 h-2 overflow-hidden rounded-full bg-stone-100">
            <div className="h-full rounded-full bg-stone-900 transition-all" style={{ width: `${progress}%` }} />
          </div>
        </div>

        {currentStep.locked && currentStep.lockReason ? (
          <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 px-3 py-3 text-sm leading-6 text-amber-700">
            {displayText(currentStep.lockReason)}
          </div>
        ) : null}
      </section>

      <section className="rounded-3xl border border-stone-200 bg-white p-5 shadow-sm">
        <div className="text-sm font-semibold text-stone-900">{text("이 단계에서 할 일", "What to Do in This Step")}</div>
        <div className="mt-4 space-y-3">
          {currentStep.highlights.map((item, index) => (
            <div key={`${currentStep.id}-${index}`} className="flex gap-3">
              <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-stone-900 text-xs font-semibold text-white">
                {index + 1}
              </span>
              <div className="text-sm leading-6 text-stone-700">{item}</div>
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-3xl border border-stone-200 bg-white p-5 shadow-sm">
        <div className="text-sm font-semibold text-stone-900">{text("현재 상태", "Current Status")}</div>
        <div className="mt-4 grid gap-3">
          <StatusRow label={text("설정 완료", "Setup Complete")} value={checks?.setupCompleted ? text("예", "Yes") : text("아니오", "No")} tone={checks?.setupCompleted ? "ready" : "idle"} />
          <StatusRow label={text("텔레그램 연결 정보", "Telegram Configuration")} value={checks?.telegramConfigured ? text("입력됨", "Configured") : text("없음", "Missing")} tone={checks?.telegramConfigured ? "ready" : "idle"} />
          <StatusRow label={text("웹 인증", "Web Authentication")} value={checks?.authEnabled ? text("켜짐", "On") : text("꺼짐", "Off")} tone={checks?.authEnabled ? "ready" : "idle"} />
          <StatusRow label="Scheduler" value={checks?.schedulerEnabled ? text("사용 가능", "Available") : text("준비 안 됨", "Not Ready")} tone={checks?.schedulerEnabled ? "ready" : "idle"} />
        </div>
      </section>

      <section className="rounded-3xl border border-stone-200 bg-white p-5 shadow-sm">
        <div className="text-sm font-semibold text-stone-900">{text("저장 상태", "Save Status")}</div>
        <div className="mt-3 text-sm leading-6 text-stone-600">
          {lastSavedAt
            ? `${text("마지막 저장", "Last saved")} ${formatTime(lastSavedAt, {
                hour: "2-digit",
                minute: "2-digit",
                second: "2-digit",
                hour12: false,
              })}`
            : text("아직 저장된 변경이 없습니다.", "There are no saved changes yet.")}
        </div>
        {lastError ? (
          <div className="mt-3 rounded-2xl border border-red-200 bg-red-50 px-3 py-3 text-sm leading-6 text-red-700">
            {displayText(lastError)}
          </div>
        ) : (
          <div className="mt-3 rounded-2xl border border-stone-200 bg-stone-50 px-3 py-3 text-sm leading-6 text-stone-600">
            {text("오른쪽 패널에서는 현재 단계, 검사 결과, 저장 상태를 한 번에 확인할 수 있습니다.", "The right panel shows the current step, check results, and save status together.")}
          </div>
        )}
      </section>
    </div>
  )
}

function StepStatusChip({
  step,
  text,
}: {
  step: SetupStepMeta
  text: (ko: string, en: string) => string
}) {
  if (step.locked) {
    return <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-semibold text-amber-700">{text("잠김", "Locked")}</span>
  }

  if (step.completed) {
    return <span className="rounded-full bg-emerald-100 px-3 py-1 text-xs font-semibold text-emerald-700">{text("완료", "Completed")}</span>
  }

  return <span className="rounded-full bg-sky-100 px-3 py-1 text-xs font-semibold text-sky-700">{text("진행 중", "In Progress")}</span>
}

function CapabilityStateChip({
  status,
  text,
}: {
  status: CapabilityStatus
  text: (ko: string, en: string) => string
}) {
  const labelMap: Record<CapabilityStatus, string> = {
    ready: text("준비됨", "Ready"),
    disabled: text("제한됨", "Limited"),
    planned: text("예정", "Planned"),
    error: text("오류", "Error"),
  }

  const styleMap: Record<CapabilityStatus, string> = {
    ready: "bg-emerald-50 text-emerald-700",
    disabled: "bg-amber-50 text-amber-700",
    planned: "bg-slate-100 text-slate-700",
    error: "bg-red-50 text-red-700",
  }

  return <span className={`rounded-full px-3 py-1 text-xs font-semibold ${styleMap[status]}`}>{labelMap[status]}</span>
}

function StatusRow({
  label,
  value,
  tone,
}: {
  label: string
  value: string
  tone: "ready" | "idle"
}) {
  return (
    <div className="rounded-2xl border border-stone-200 bg-stone-50 px-4 py-3">
      <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-stone-400">{label}</div>
      <div className="mt-2 flex items-center gap-2 text-sm font-semibold text-stone-900">
        <span className={`h-2.5 w-2.5 rounded-full ${tone === "ready" ? "bg-emerald-500" : "bg-stone-300"}`} />
        <span>{value}</span>
      </div>
    </div>
  )
}
