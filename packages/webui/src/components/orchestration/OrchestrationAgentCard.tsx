import * as React from "react"
import type { OrchestrationBoardCardProjection } from "../../lib/orchestration-board-projection"
import { OrchestrationAgentAvatar } from "./OrchestrationAgentAvatar"
import { OrchestrationMapNode } from "./OrchestrationMapNode"

export function OrchestrationAgentCard({
  card,
  mode = "card",
  sourceLaneId,
  draggable = false,
  dragging = false,
  showDiagnostics = true,
  onDragStart,
  onSelect,
}: {
  card: OrchestrationBoardCardProjection
  mode?: "card" | "character"
  sourceLaneId?: string
  draggable?: boolean
  dragging?: boolean
  showDiagnostics?: boolean
  onDragStart?: (event: React.MouseEvent<HTMLElement>, agentId: string, sourceLaneId: string) => void
  onSelect?: (agentId: string) => void
}) {
  return (
    <OrchestrationMapNode
      kind="agent"
      mode={mode}
      tone={card.tone}
      selected={card.selected}
      dragging={dragging}
      title={card.displayName}
      subtitle={card.role}
      eyebrow="Agent"
      avatar={(
        <OrchestrationAgentAvatar
          seed={card.agentId}
          displayName={card.displayName}
          role={card.role}
          mode={mode}
          size={mode === "character" ? "lg" : "md"}
          tone={card.tone}
        />
      )}
      configBadges={card.configBadges}
      runtimeBadges={card.runtimeBadges}
      detailBadges={card.detailBadges}
      footer={showDiagnostics && card.diagnostics.length > 0 ? (
        <div className={`space-y-1 rounded-[1rem] border px-3 py-2 text-xs leading-5 ${
          card.selected
            ? "border-white/20 bg-white/10 text-white/85"
            : card.tone === "danger"
              ? "border-red-200 bg-red-50 text-red-900"
              : "border-amber-200 bg-amber-50 text-amber-900"
        }`}>
          {card.diagnostics.map((diagnostic) => <div key={diagnostic}>{diagnostic}</div>)}
        </div>
      ) : null}
      onClick={onSelect ? () => onSelect(card.agentId) : undefined}
      draggable={Boolean(draggable && sourceLaneId && card.status !== "archived")}
      onMouseDown={draggable && sourceLaneId && card.status !== "archived"
        ? (event) => onDragStart?.(event, card.agentId, sourceLaneId)
        : undefined}
      dataId={card.id}
    />
  )
}
