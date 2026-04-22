import * as React from "react"
import {
  getOrchestrationBadgeClasses,
  getOrchestrationDisplayFontStyle,
  getOrchestrationMonoFontStyle,
  getOrchestrationSurfaceToneClasses,
  type OrchestrationVisualTone,
} from "../../lib/orchestration-visual-theme"

type NodeMode = "card" | "character"
type NodeKind = "agent" | "team" | "approval" | "capability" | "warning"

export function OrchestrationMapNode({
  kind,
  mode = "card",
  tone = "neutral",
  selected = false,
  dragging = false,
  title,
  subtitle,
  eyebrow,
  avatar,
  configBadges = [],
  runtimeBadges = [],
  detailBadges = [],
  footer,
  onClick,
  draggable = false,
  onMouseDown,
  dataId,
}: {
  kind: NodeKind
  mode?: NodeMode
  tone?: OrchestrationVisualTone
  selected?: boolean
  dragging?: boolean
  title: string
  subtitle?: string
  eyebrow?: string
  avatar?: React.ReactNode
  configBadges?: string[]
  runtimeBadges?: string[]
  detailBadges?: string[]
  footer?: React.ReactNode
  onClick?: () => void
  draggable?: boolean
  onMouseDown?: React.MouseEventHandler<HTMLElement>
  dataId?: string
}) {
  const Component = onClick ? "button" : "div"
  const layoutClass = mode === "character"
    ? "items-center text-center"
    : "items-start text-left"
  const dragCursorClass = draggable ? "cursor-grab active:cursor-grabbing select-none touch-none" : ""

  return (
    <Component
      {...(onClick ? { type: "button", onClick } : {})}
      {...(draggable ? { onMouseDown } : {})}
      onDragStart={draggable ? (event) => event.preventDefault() : undefined}
      data-orchestration-map-node={kind}
      data-orchestration-map-node-mode={mode}
      data-orchestration-map-node-id={dataId ?? ""}
      data-orchestration-map-node-dragging={dragging ? "true" : "false"}
      data-orchestration-map-node-draggable={draggable ? "true" : "false"}
      className={`w-full rounded-[1.5rem] border-[1.5px] px-4 py-4 transition-transform duration-150 hover:-translate-y-[1px] ${getOrchestrationSurfaceToneClasses(tone, selected)} ${
        mode === "character" ? "min-h-[15rem]" : ""
      } ${dragCursorClass} ${dragging ? "ring-1 ring-stone-300/60" : ""}`}
    >
      <div className={`flex ${mode === "character" ? "flex-col" : "items-start"} gap-3 ${layoutClass}`}>
        {avatar ? <div className={mode === "character" ? "" : "pt-0.5"}>{avatar}</div> : null}
        <div className="min-w-0 flex-1">
          {eyebrow ? (
            <div className={`text-[10px] font-semibold uppercase tracking-[0.16em] ${selected ? "text-white/70" : "text-stone-500"}`} style={getOrchestrationMonoFontStyle()}>
              {eyebrow}
            </div>
          ) : null}
          <div className={`truncate ${mode === "character" ? "mt-3 text-lg" : "text-sm"} font-bold`} style={getOrchestrationDisplayFontStyle()}>
            {title}
          </div>
          {subtitle ? (
            <div className={`mt-1 text-xs leading-5 ${selected ? "text-white/75" : "text-stone-600"}`}>
              {subtitle}
            </div>
          ) : null}
        </div>
      </div>

      {configBadges.length > 0 ? (
        <div className={`mt-4 flex flex-wrap gap-2 ${mode === "character" ? "justify-center" : ""}`} data-orchestration-map-node-config="">
          {configBadges.map((badge) => (
            <span key={`config:${badge}`} className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${getOrchestrationBadgeClasses("config", selected)}`}>
              {badge}
            </span>
          ))}
        </div>
      ) : null}

      {runtimeBadges.length > 0 ? (
        <div className={`mt-2 flex flex-wrap gap-2 ${mode === "character" ? "justify-center" : ""}`} data-orchestration-map-node-runtime="">
          {runtimeBadges.map((badge) => (
            <span key={`runtime:${badge}`} className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${getOrchestrationBadgeClasses("runtime", selected)}`}>
              {badge}
            </span>
          ))}
        </div>
      ) : null}

      {detailBadges.length > 0 ? (
        <div className={`mt-3 flex flex-wrap gap-2 ${mode === "character" ? "justify-center" : ""}`} data-orchestration-map-node-detail="">
          {detailBadges.map((badge) => (
            <span key={`detail:${badge}`} className={`rounded-full px-2 py-1 text-[11px] font-semibold ${getOrchestrationBadgeClasses("detail", selected)}`}>
              {badge}
            </span>
          ))}
        </div>
      ) : null}

      {footer ? (
        <div className="mt-4" data-orchestration-map-node-footer="">
          {footer}
        </div>
      ) : null}
    </Component>
  )
}
