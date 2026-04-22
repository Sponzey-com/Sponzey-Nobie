import * as React from "react"
import type { OrchestrationBoardLaneProjection } from "../../lib/orchestration-board-projection"
import { pickUiText, type UiLanguage } from "../../stores/uiLanguage"
import { OrchestrationAgentCard } from "./OrchestrationAgentCard"

export function OrchestrationBoardLane({
  lane,
  language,
  nodeMode = "card",
  showLaneActions = false,
  actionLocked = false,
  hasDrag = false,
  canDrop = false,
  dropActive = false,
  dragSource = false,
  dragEntityType = null,
  draggingAgentId,
  draggableCards = false,
  draggableLane = false,
  draggingTeam = false,
  showDiagnostics = true,
  onDragStartAgent,
  onDragStartTeam,
  onSelectAgent,
  onSelectTeam,
  onCreateAgentInTeam,
  onCreateTeam,
  onArchiveTeam,
}: {
  lane: OrchestrationBoardLaneProjection
  language: UiLanguage
  nodeMode?: "card" | "character"
  showLaneActions?: boolean
  actionLocked?: boolean
  hasDrag?: boolean
  canDrop?: boolean
  dropActive?: boolean
  dragSource?: boolean
  dragEntityType?: "agent" | "team" | null
  draggingAgentId?: string | null
  draggableCards?: boolean
  draggableLane?: boolean
  draggingTeam?: boolean
  showDiagnostics?: boolean
  onDragStartAgent?: (event: React.MouseEvent<HTMLElement>, agentId: string, sourceLaneId: string) => void
  onDragStartTeam?: (event: React.MouseEvent<HTMLElement>, teamId: string, sourceLaneId: string) => void
  onSelectAgent?: (agentId: string) => void
  onSelectTeam?: (teamId: string) => void
  onCreateAgentInTeam?: (teamId: string | null) => void
  onCreateTeam?: () => void
  onArchiveTeam?: (teamId: string) => void
}) {
  const laneClickable = lane.kind === "team" && lane.teamId && onSelectTeam
  const Header = laneClickable ? "button" : "div"
  const highlightClass = dropActive
    ? canDrop
      ? "ring-2 ring-stone-900 ring-offset-2"
      : "border-red-300 bg-red-50 text-red-950 ring-2 ring-red-400 ring-offset-2"
    : hasDrag
      ? canDrop
        ? "ring-1 ring-emerald-300"
        : "opacity-70"
      : ""
  const previewToneClass = canDrop
    ? lane.selected
      ? "border-white/20 bg-white/10 text-white/85"
      : "border-emerald-200 bg-emerald-50 text-emerald-900"
    : lane.selected
      ? "border-white/20 bg-white/10 text-white/80"
      : "border-stone-200 bg-stone-50 text-stone-500"
  const preview = resolveLaneDropPreview({
    laneKind: lane.kind,
    language,
    canDrop,
    active: dropActive,
    dragEntityType,
  })

  if (lane.kind === "unassigned") {
    if (lane.cards.length === 0 && !hasDrag) return null

    return (
      <div
        data-orchestration-board-lane={lane.id}
        data-orchestration-board-loose-agents=""
        data-orchestration-board-drop-active={dropActive ? "true" : "false"}
        data-orchestration-board-drop-allowed={canDrop ? "true" : "false"}
        data-orchestration-board-drag-source={dragSource ? "true" : "false"}
        className="space-y-3"
      >
        {lane.cards.length > 0 ? (
          <div className={`grid gap-3 ${nodeMode === "character" ? "sm:grid-cols-2 xl:grid-cols-3" : "xl:grid-cols-2"}`}>
            {lane.cards.map((card) => (
              <OrchestrationAgentCard
                key={card.id}
                card={card}
                mode={nodeMode}
                sourceLaneId={lane.id}
                dragging={draggingAgentId === card.agentId}
                draggable={draggableCards}
                showDiagnostics={showDiagnostics}
                onDragStart={onDragStartAgent}
                onSelect={onSelectAgent}
              />
            ))}
          </div>
        ) : null}

        {hasDrag && preview ? (
          <div className={`max-w-xl rounded-[1.2rem] border border-dashed px-4 py-3 text-xs leading-5 ${previewToneClass}`}>
            <div className="font-semibold">{preview.title}</div>
            <div className="mt-1">{preview.detail}</div>
          </div>
        ) : null}
      </div>
    )
  }

  return (
    <section
      data-orchestration-board-lane={lane.id}
      data-orchestration-board-drop-active={dropActive ? "true" : "false"}
      data-orchestration-board-drop-allowed={canDrop ? "true" : "false"}
      data-orchestration-board-drag-source={dragSource ? "true" : "false"}
      data-orchestration-board-lane-draggable={draggableLane ? "true" : "false"}
      onMouseDown={draggableLane && lane.teamId
        ? (event) => {
            const target = event.target as HTMLElement | null
            if (target?.closest("[data-orchestration-map-node]")) return
            if (target?.closest("[data-orchestration-board-lane-actions]")) return
            if (target?.closest("input, textarea, select, a")) return
            onDragStartTeam?.(event, lane.teamId!, lane.id)
          }
        : undefined}
      className={`rounded-[1.8rem] border px-5 py-5 ${laneToneClass(lane.tone)} ${
        highlightClass
      } ${dragSource ? "opacity-80" : ""} ${draggingTeam ? "ring-1 ring-stone-300/60" : ""}`}
    >
      <Header
        {...(laneClickable ? { type: "button", onClick: () => onSelectTeam?.(lane.teamId!) } : {})}
        {...(draggableLane && lane.teamId ? {
          onMouseDown: (event: React.MouseEvent<HTMLElement>) => onDragStartTeam?.(event, lane.teamId!, lane.id),
        } : {})}
        className={`${laneClickable ? "w-full text-left" : ""} ${draggableLane ? "cursor-grab active:cursor-grabbing touch-none select-none" : ""}`}
      >
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <div className="truncate text-base font-semibold">{lane.displayName}</div>
              <span className={`rounded-full px-2 py-1 text-[11px] font-semibold ${lane.selected ? "bg-white/15 text-white" : "bg-white text-stone-600 ring-1 ring-stone-200"}`}>
                {lane.status}
              </span>
            </div>
            <div className={`mt-2 text-sm leading-6 ${lane.selected ? "text-white/80" : "text-stone-600"}`}>{lane.description}</div>
          </div>
          <div className="flex flex-wrap gap-2">
            {lane.badges.map((badge) => (
              <span key={badge} className={`rounded-full px-2 py-1 text-[11px] font-semibold ${lane.selected ? "bg-white/15 text-white" : "bg-white text-stone-600 ring-1 ring-stone-200"}`}>
                {badge}
              </span>
            ))}
          </div>
        </div>
      </Header>

      {showLaneActions ? (
        <div
          className="mt-4 flex flex-wrap gap-2"
          data-orchestration-board-lane-actions={lane.id}
        >
          {lane.kind === "team" && lane.teamId ? (
            <>
              <LaneActionButton
                label={pickUiText(language, "이 팀에 에이전트 추가", "Add agent here")}
                disabled={actionLocked || !onCreateAgentInTeam}
                onClick={() => onCreateAgentInTeam?.(lane.teamId!)}
              />
              <LaneActionButton
                label={pickUiText(language, "팀 수정", "Edit team")}
                disabled={!onSelectTeam}
                onClick={() => onSelectTeam?.(lane.teamId!)}
              />
              <LaneActionButton
                label={pickUiText(language, "팀 보관", "Archive team")}
                disabled={actionLocked || !onArchiveTeam}
                tone="danger"
                onClick={() => onArchiveTeam?.(lane.teamId!)}
              />
            </>
          ) : (
            <>
              <LaneActionButton
                label={pickUiText(language, "새 에이전트", "New agent")}
                disabled={actionLocked || !onCreateAgentInTeam}
                onClick={() => onCreateAgentInTeam?.(null)}
              />
              <LaneActionButton
                label={pickUiText(language, "새 팀", "New team")}
                disabled={actionLocked || !onCreateTeam}
                onClick={() => onCreateTeam?.()}
              />
            </>
          )}
        </div>
      ) : null}

      {lane.cards.length > 0 ? (
        <div className={`mt-4 ${nodeMode === "character" ? "grid gap-3 sm:grid-cols-2" : "space-y-3"}`}>
          {lane.cards.map((card) => (
            <OrchestrationAgentCard
              key={card.id}
              card={card}
              mode={nodeMode}
              sourceLaneId={lane.id}
              dragging={draggingAgentId === card.agentId}
              draggable={draggableCards}
              showDiagnostics={showDiagnostics}
              onDragStart={onDragStartAgent}
              onSelect={onSelectAgent}
            />
          ))}
        </div>
      ) : (
        <div className={`mt-4 rounded-[1.25rem] border border-dashed px-4 py-4 text-sm leading-6 ${lane.selected ? "border-white/30 bg-white/10 text-white/85" : "border-stone-300 bg-white/60 text-stone-500"}`}>
          {lane.kind === "unassigned"
            ? pickUiText(language, "아직 미배치 에이전트가 없습니다.", "No unassigned agents.")
            : pickUiText(language, "이 lane에는 아직 에이전트가 없습니다.", "No agents in this lane yet.")}
        </div>
      )}

      {hasDrag && preview ? (
        <div className={`mt-4 rounded-[1.2rem] border border-dashed px-4 py-3 text-xs leading-5 ${previewToneClass}`}>
          <div className="font-semibold">{preview.title}</div>
          <div className="mt-1">{preview.detail}</div>
        </div>
      ) : null}

      {showDiagnostics && lane.diagnostics.length > 0 ? (
        <div className={`mt-4 space-y-2 rounded-[1.2rem] border px-4 py-3 text-xs leading-5 ${
          lane.selected
            ? "border-white/20 bg-white/10 text-white/85"
            : lane.tone === "danger"
              ? "border-red-200 bg-red-50 text-red-900"
              : "border-amber-200 bg-amber-50 text-amber-900"
        }`}>
          {lane.diagnostics.map((diagnostic) => (
            <div key={diagnostic}>{diagnostic}</div>
          ))}
        </div>
      ) : null}
    </section>
  )
}

function resolveLaneDropPreview(input: {
  laneKind: OrchestrationBoardLaneProjection["kind"]
  language: UiLanguage
  canDrop: boolean
  active: boolean
  dragEntityType: "agent" | "team" | null
}): { title: string; detail: string } | null {
  const t = (ko: string, en: string) => pickUiText(input.language, ko, en)
  if (input.laneKind === "unassigned") {
    if (input.dragEntityType === "team") return null
    if (input.canDrop) {
      return {
        title: input.active ? t("놓으면 미배치로 전환", "Release to return to unassigned") : t("미배치로 되돌리기", "Return to unassigned"),
        detail: t("이 팀 소속만 해제하고 카드는 유지합니다.", "Remove the current team membership while keeping the card."),
      }
    }
    return null
  }

  if (input.dragEntityType === "team") {
    if (!input.canDrop) return null
    return {
      title: input.active ? t("놓으면 팀 순서 변경", "Release to reorder team lane") : t("팀 순서 변경", "Reorder team lane"),
      detail: t("현재 팀 lane의 위치만 바꾸고 소속 에이전트 구성은 그대로 유지합니다.", "Only the team lane order changes. The agents inside the team stay as they are."),
    }
  }

  if (input.canDrop) {
    return {
      title: input.active ? t("놓으면 팀 액션 열기", "Release to open team actions") : t("팀 액션 후보", "Team action target"),
      detail: t("추가, 이동, 복제 중 어떤 결과로 처리할지 다음 팝업에서 고릅니다.", "The popup will let you choose whether to add, move, or clone the card."),
    }
  }
  return null
}

function laneToneClass(tone: OrchestrationBoardLaneProjection["tone"]): string {
  switch (tone) {
    case "ready":
      return "border-emerald-200 bg-gradient-to-b from-emerald-50 to-white text-emerald-950"
    case "danger":
      return "border-red-200 bg-gradient-to-b from-red-50 to-white text-red-950"
    case "warning":
      return "border-amber-200 bg-gradient-to-b from-amber-50 to-white text-amber-950"
    case "disabled":
      return "border-stone-200 bg-gradient-to-b from-stone-100 to-white text-stone-700"
    case "neutral":
    default:
      return "border-stone-200 bg-gradient-to-b from-stone-50 to-white text-stone-950"
  }
}

function LaneActionButton({
  label,
  disabled = false,
  tone = "neutral",
  onClick,
}: {
  label: string
  disabled?: boolean
  tone?: "neutral" | "danger"
  onClick: () => void
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={(event) => {
        event.stopPropagation()
        onClick()
      }}
      className={`rounded-full px-3 py-1.5 text-xs font-semibold disabled:cursor-not-allowed disabled:opacity-50 ${
        tone === "danger"
          ? "border border-red-200 bg-red-50 text-red-900"
          : "border border-stone-200 bg-white text-stone-700"
      }`}
    >
      {label}
    </button>
  )
}
