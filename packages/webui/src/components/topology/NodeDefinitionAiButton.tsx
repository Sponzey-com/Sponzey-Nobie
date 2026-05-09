import * as React from "react"

export interface NodeDefinitionAiButtonProps {
  label?: string
  ariaLabel?: string
  disabled?: boolean
  compact?: boolean
  testId?: string
  onClick?: () => void
}

export function NodeDefinitionAiButton({
  label = "AI",
  ariaLabel = "AI로 다듬기",
  disabled = false,
  compact = true,
  testId = "node-definition-ai-button",
  onClick,
}: NodeDefinitionAiButtonProps) {
  return (
    <button
      type="button"
      aria-label={ariaLabel}
      title={ariaLabel}
      disabled={disabled}
      onClick={onClick}
      className={`${compact ? "h-7 min-w-7 px-2 text-[11px]" : "h-8 px-3 text-xs"} rounded-md border border-sky-200 bg-sky-50 font-semibold text-sky-800 transition hover:border-sky-300 hover:bg-sky-100 disabled:cursor-not-allowed disabled:opacity-50`}
      data-testid={testId}
    >
      {label}
    </button>
  )
}
