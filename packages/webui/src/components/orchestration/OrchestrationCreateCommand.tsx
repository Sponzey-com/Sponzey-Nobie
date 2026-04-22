import * as React from "react"
import { pickUiText, type UiLanguage } from "../../stores/uiLanguage"

export interface OrchestrationCreateCommandFeedback {
  tone: "neutral" | "warning" | "error" | "success"
  title: string
  message: string
}

export function OrchestrationCreateCommand({
  language,
  value,
  placeholder,
  examples,
  feedback,
  onChange,
  onChooseExample,
}: {
  language: UiLanguage
  value: string
  placeholder: string
  examples: Array<{ id: string; label: string; command: string }>
  feedback?: OrchestrationCreateCommandFeedback | null
  onChange: (value: string) => void
  onChooseExample: (value: string) => void
}) {
  return (
    <div data-orchestration-create-command="">
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="min-w-0 w-full rounded-[1.2rem] border border-stone-200 bg-white px-4 py-3 text-sm text-stone-900 outline-none focus:border-stone-400"
      />
      <div className="mt-3 flex flex-wrap gap-2" data-orchestration-create-command-chips="">
        {examples.map((example) => (
          <button
            key={example.id}
            type="button"
            onClick={() => onChooseExample(example.command)}
            className="rounded-full border border-stone-200 bg-stone-50 px-3 py-1.5 text-xs font-semibold text-stone-700"
          >
            {example.command}
          </button>
        ))}
      </div>
      <div className="mt-3 grid gap-2 text-xs leading-5 text-stone-500" data-orchestration-create-command-grammar="">
        <div>{pickUiText(language, "문법: <role> team [count]", "Grammar: <role> team [count]")}</div>
        <div>{pickUiText(language, "예시: review squad, workspace operator pair", "Examples: review squad, workspace operator pair")}</div>
      </div>
      {feedback ? (
        <div
          data-orchestration-create-command-feedback={feedback.tone}
          className={`mt-3 rounded-[1.2rem] border px-4 py-3 text-sm leading-6 ${feedbackToneClass(feedback.tone)}`}
        >
          <div className="font-semibold">{feedback.title}</div>
          <div className="mt-1">{feedback.message}</div>
        </div>
      ) : null}
    </div>
  )
}

function feedbackToneClass(tone: OrchestrationCreateCommandFeedback["tone"]): string {
  switch (tone) {
    case "success":
      return "border-emerald-200 bg-emerald-50 text-emerald-900"
    case "warning":
      return "border-amber-200 bg-amber-50 text-amber-900"
    case "error":
      return "border-red-200 bg-red-50 text-red-900"
    case "neutral":
    default:
      return "border-stone-200 bg-stone-50 text-stone-700"
  }
}
