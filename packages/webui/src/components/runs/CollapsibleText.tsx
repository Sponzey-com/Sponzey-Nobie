import { useState } from "react"

export interface CollapsibleTextProps {
  value: string
  showMoreLabel: string
  showLessLabel: string
  threshold?: number
  clampLines?: number
  className?: string
  buttonClassName?: string
}

export function CollapsibleText({
  value,
  showMoreLabel,
  showLessLabel,
  threshold = 180,
  clampLines = 3,
  className,
  buttonClassName = "mt-1 inline-flex text-xs font-semibold text-stone-700 underline-offset-2 hover:underline",
}: CollapsibleTextProps) {
  const [expanded, setExpanded] = useState(false)
  const canCollapse = value.length > threshold

  return (
    <div className={className}>
      <div
        style={
          canCollapse && !expanded
            ? {
                display: "-webkit-box",
                WebkitBoxOrient: "vertical",
                WebkitLineClamp: clampLines,
                overflow: "hidden",
              }
            : undefined
        }
      >
        {value}
      </div>
      {canCollapse ? (
        <button
          type="button"
          className={buttonClassName}
          aria-expanded={expanded}
          onClick={(event) => {
            event.stopPropagation()
            setExpanded((value) => !value)
          }}
          onKeyDown={(event) => event.stopPropagation()}
        >
          {expanded ? showLessLabel : showMoreLabel}
        </button>
      ) : null}
    </div>
  )
}
