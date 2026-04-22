import * as React from "react"

export function OrchestrationDropZone({
  laneId,
  kind,
  eyebrow,
  title,
  description,
  hasDrag = false,
  canDrop = false,
  active = false,
}: {
  laneId: string
  kind: "canvas" | "archive"
  eyebrow: string
  title: string
  description: string
  hasDrag?: boolean
  canDrop?: boolean
  active?: boolean
}) {
  const toneClass = resolveDropZoneToneClass(kind, { hasDrag, canDrop, active })

  return (
    <div
      data-orchestration-drop-zone={laneId}
      data-orchestration-drop-zone-kind={kind}
      data-orchestration-drop-active={active ? "true" : "false"}
      data-orchestration-drop-allowed={canDrop ? "true" : "false"}
      {...(kind === "canvas" ? { "data-orchestration-board-canvas": laneId } : {})}
      className={`rounded-[1.8rem] border border-dashed px-5 py-5 text-sm leading-6 ${toneClass}`}
    >
      <div className="text-[11px] font-semibold uppercase tracking-[0.16em] opacity-75">
        {eyebrow}
      </div>
      <div className="mt-2 text-base font-semibold">{title}</div>
      <div className="mt-2">{description}</div>
    </div>
  )
}

function resolveDropZoneToneClass(
  kind: "canvas" | "archive",
  input: { hasDrag: boolean; canDrop: boolean; active: boolean },
): string {
  if (kind === "archive") {
    if (input.active) {
      return input.canDrop
        ? "border-red-400 bg-red-600 text-white ring-2 ring-red-500 ring-offset-2"
        : "border-red-300 bg-red-50 text-red-900 ring-2 ring-red-300 ring-offset-2"
    }
    if (input.hasDrag) {
      return input.canDrop
        ? "border-red-300 bg-red-50 text-red-900 ring-1 ring-red-200"
        : "border-stone-200 bg-stone-50 text-stone-500 opacity-70"
    }
    return "border-red-200 bg-red-50 text-red-900"
  }

  if (input.active) {
    return input.canDrop
      ? "border-stone-900 bg-stone-900 text-white ring-2 ring-stone-900 ring-offset-2"
      : "border-amber-300 bg-amber-50 text-amber-950 ring-2 ring-amber-300 ring-offset-2"
  }
  if (input.hasDrag) {
    return input.canDrop
      ? "border-stone-300 bg-stone-100 text-stone-800 ring-1 ring-stone-300"
      : "border-stone-200 bg-stone-50 text-stone-500 opacity-70"
  }
  return "border-stone-300 bg-stone-50 text-stone-600"
}
