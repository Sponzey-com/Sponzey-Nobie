import * as React from "react"
import type { NodeDefinitionField } from "../../lib/node-definition-suggestion"

export interface NodeFieldLockToggleProps {
  field: NodeDefinitionField
  label: string
  locked: boolean
  disabled?: boolean
  onToggle: (field: NodeDefinitionField, locked: boolean) => void
}

export function NodeFieldLockToggle({
  field,
  label,
  locked,
  disabled = false,
  onToggle,
}: NodeFieldLockToggleProps) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => onToggle(field, !locked)}
      className={`h-7 rounded-md border px-2 text-[11px] font-semibold ${
        locked
          ? "border-stone-300 bg-stone-100 text-stone-700"
          : "border-emerald-200 bg-emerald-50 text-emerald-800"
      } disabled:cursor-not-allowed disabled:opacity-50`}
      aria-pressed={locked}
      aria-label={`${label} ${locked ? "유지" : "갱신 가능"}`}
      data-testid="node-field-lock-toggle"
      data-field={field}
      data-locked={locked ? "true" : "false"}
    >
      {locked ? "유지" : "갱신 가능"}
    </button>
  )
}
