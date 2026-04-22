import * as React from "react"
import { isLegacyOrchestrationId, isOrchestrationEntityId, type OrchestrationEntityKind } from "../../lib/orchestration-id"
import { pickUiText, type UiLanguage } from "../../stores/uiLanguage"

export function OrchestrationIdField({
  kind,
  language,
  value,
  locked,
  issues = [],
  onChange,
}: {
  kind: OrchestrationEntityKind
  language: UiLanguage
  value: string
  locked: boolean
  issues?: Array<{ severity: "warning" | "error"; message: string }>
  onChange?: (value: string) => void
}) {
  const valid = !value.trim() || isOrchestrationEntityId(value, kind) || isLegacyOrchestrationId(value)
  const issueTone = issues.some((issue) => issue.severity === "error")
    ? "error"
    : issues.length > 0
      ? "warning"
      : null
  return (
    <label className="block" data-orchestration-id-field={kind} data-orchestration-field-state={issueTone ?? (valid ? "normal" : "error")}>
      <span className={`text-xs font-semibold uppercase tracking-[0.16em] ${issueTone === "error" ? "text-red-700" : issueTone === "warning" ? "text-amber-700" : "text-stone-500"}`}>
        {pickUiText(language, "ID", "ID")}
      </span>
      {locked ? (
        <div className={`mt-2 rounded-2xl border px-4 py-3 text-sm font-medium ${
          issueTone === "error"
            ? "border-red-300 bg-red-50 text-red-900"
            : issueTone === "warning"
              ? "border-amber-300 bg-amber-50 text-amber-900"
              : "border-stone-200 bg-stone-100 text-stone-600"
        }`}>
          {value}
        </div>
      ) : (
        <input
          value={value}
          onChange={(event) => onChange?.(event.target.value)}
          className={`mt-2 w-full rounded-2xl border bg-white px-4 py-3 text-sm text-stone-900 outline-none transition ${
            issueTone === "error" || !valid
              ? "border-red-300 focus:border-red-500"
              : issueTone === "warning"
                ? "border-amber-300 focus:border-amber-500"
                : "border-stone-200 focus:border-stone-400"
          }`}
          spellCheck={false}
          autoComplete="off"
        />
      )}
      <div className={`mt-2 text-xs leading-5 ${issueTone === "error" ? "text-red-700" : issueTone === "warning" ? "text-amber-700" : "text-stone-500"}`}>
        {locked
          ? pickUiText(language, "저장된 항목의 ID는 잠겨 있습니다.", "Saved entries keep a locked ID.")
          : pickUiText(language, `${kind}-... prefix 규칙 또는 기존 legacy ID만 허용합니다.`, `Use the ${kind}-... prefix or an existing legacy ID.`)}
      </div>
      {issues.length > 0 ? (
        <div className="mt-2 space-y-1 text-xs leading-5" data-orchestration-field-issues="">
          {issues.map((issue, index) => (
            <div key={`${issue.message}-${index}`} className={issue.severity === "error" ? "text-red-700" : "text-amber-700"}>
              {issue.message}
            </div>
          ))}
        </div>
      ) : null}
    </label>
  )
}
