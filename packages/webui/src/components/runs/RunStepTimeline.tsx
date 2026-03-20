import type { RunStep } from "../../contracts/runs"
import { useUiI18n } from "../../lib/ui-i18n"

function dotClass(status: RunStep["status"]) {
  switch (status) {
    case "completed":
      return "bg-green-500"
    case "running":
      return "bg-stone-900"
    case "failed":
      return "bg-red-500"
    case "cancelled":
      return "bg-amber-500"
    default:
      return "bg-stone-300"
  }
}

export function RunStepTimeline({ steps }: { steps: RunStep[] }) {
  const { text, displayText } = useUiI18n()

  return (
    <div className="space-y-3">
      {steps.map((step) => (
        <div key={step.key} className="flex gap-3">
          <div className="mt-1.5 flex flex-col items-center">
            <span className={`h-2.5 w-2.5 rounded-full ${dotClass(step.status)}`} />
            {step.index < steps.length ? <span className="mt-1 h-full w-px bg-stone-200" /> : null}
          </div>
          <div className="pb-3">
            <div className="text-xs font-semibold text-stone-500">{text(`단계 ${step.index}`, `STEP ${step.index}`)}</div>
            <div className="text-sm font-semibold text-stone-900">{displayText(step.title)}</div>
            <div className="mt-1 text-sm leading-6 text-stone-600">{displayText(step.summary || text("대기 중", "Waiting"))}</div>
          </div>
        </div>
      ))}
    </div>
  )
}
