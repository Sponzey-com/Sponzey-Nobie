import * as React from "react"
import type { OrchestrationBoardProjection } from "../../lib/orchestration-board-projection"
import type { BoardDragState, PendingDropAction, PendingDropActionOption } from "../../lib/orchestration-board"
import type { TopologyEditorGate } from "../../lib/setup-visualization-topology"
import { pickUiText, type UiLanguage } from "../../stores/uiLanguage"
import { BOARD_ARCHIVE_LANE_ID, BOARD_CANVAS_LANE_ID } from "../../lib/orchestration-dnd"
import { OrchestrationBoardGateNotice } from "./OrchestrationBoardGateNotice"
import { OrchestrationBoardLane } from "./OrchestrationBoardLane"
import { OrchestrationDropMenu } from "./OrchestrationDropMenu"
import { OrchestrationDropZone } from "./OrchestrationDropZone"

export function OrchestrationBoardEditor({
  projection,
  gate,
  language,
  surface,
  entryHref,
  layout = "standard",
  nodeMode = "card",
  toolbar,
  quickEditSheet,
  onCreateAgent,
  onCreateTeam,
  onCreateAgentInTeam,
  onArchiveTeam,
  dragState,
  dropAvailability,
  pendingDrop,
  onChooseDropOption,
  onCancelDropOption,
  onDragStartAgent,
  onDragStartTeam,
  onSelectAgent,
  onSelectTeam,
}: {
  projection: OrchestrationBoardProjection
  gate: TopologyEditorGate
  language: UiLanguage
  surface: "page" | "settings"
  entryHref: string
  layout?: "standard" | "dashboard"
  nodeMode?: "card" | "character"
  toolbar?: React.ReactNode
  quickEditSheet?: React.ReactNode
  onCreateAgent?: () => void
  onCreateTeam?: () => void
  onCreateAgentInTeam?: (teamId: string | null) => void
  onArchiveTeam?: (teamId: string) => void
  dragState?: BoardDragState | null
  dropAvailability?: Record<string, boolean>
  pendingDrop?: PendingDropAction | null
  onChooseDropOption?: (optionId: PendingDropActionOption["id"]) => void
  onCancelDropOption?: () => void
  onDragStartAgent?: (event: React.MouseEvent<HTMLElement>, agentId: string, sourceLaneId: string) => void
  onDragStartTeam?: (event: React.MouseEvent<HTMLElement>, teamId: string, sourceLaneId: string) => void
  onSelectAgent?: (agentId: string) => void
  onSelectTeam?: (teamId: string) => void
}) {
  const title = surface === "settings"
    ? pickUiText(language, "에이전트/팀 메인 보드", "Agents and teams main board")
    : pickUiText(language, "메인 보드", "Main board")
  const description = surface === "settings"
    ? pickUiText(language, "Settings 탭에서도 실제 편집 surface와 같은 lane/card 구조를 그대로 미리 봅니다.", "The settings tab uses the same lane/card structure as the full editing surface.")
    : pickUiText(language, "리스트보다 먼저 팀 lane과 unassigned agent를 한 화면에서 읽을 수 있도록 정리한 주화면입니다.", "The primary surface reads team lanes and unassigned agents before any list or form-heavy editor.")
  const selected = projection.selectedEntity
  const dashboardLayout = layout === "dashboard"
  const hasDrag = Boolean(dragState)
  const agentDragEnabled = Boolean(
    surface === "page"
    && gate.canEdit
    && onDragStartAgent,
  )
  const teamDragEnabled = Boolean(surface === "page" && gate.canEdit && onDragStartTeam)
  const hasDropAvailability = Boolean(dropAvailability && Object.keys(dropAvailability).length > 0)
  const draggingAgent = dragState?.entityType === "agent"
  const draggingTeam = dragState?.entityType === "team"
  const canvasDropAllowed = draggingAgent && (hasDropAvailability ? Boolean(dropAvailability?.[BOARD_CANVAS_LANE_ID]) : surface === "page" && gate.canEdit)
  const archiveDropAllowed = hasDrag && (hasDropAvailability ? Boolean(dropAvailability?.[BOARD_ARCHIVE_LANE_ID]) : surface === "page" && gate.canEdit)

  return (
    <section
      className={dashboardLayout ? "" : "rounded-[2rem] border border-stone-200 bg-white p-6 shadow-sm"}
      data-orchestration-board-surface={surface}
      data-orchestration-board-layout={layout}
    >
      {!dashboardLayout ? (
        <>
          <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
            <div>
              <div className="text-xs font-semibold uppercase tracking-[0.18em] text-stone-400">
                {pickUiText(language, "Main board", "Main board")}
              </div>
              <h2 className="mt-2 text-xl font-semibold text-stone-950">{title}</h2>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-stone-600">{description}</p>
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              <MetricCard
                label={pickUiText(language, "팀", "Teams")}
                value={String(projection.counts.teams)}
              />
              <MetricCard
                label={pickUiText(language, "에이전트", "Agents")}
                value={String(projection.counts.agents)}
              />
              <MetricCard
                label={pickUiText(language, "미배치", "Unassigned")}
                value={String(projection.counts.unassignedAgents)}
              />
            </div>
          </div>

          <div className="mt-5">
            <OrchestrationBoardGateNotice gate={gate} language={language} surface={surface} entryHref={entryHref} />
          </div>
        </>
      ) : null}

      {!dashboardLayout && surface === "page" ? (
        <div className="mt-4 flex flex-wrap gap-2" data-orchestration-board-actions="">
          {toolbar ?? (
            <>
              <button
                type="button"
                onClick={onCreateTeam}
                disabled={!gate.canEdit || !onCreateTeam}
                className="rounded-2xl border border-stone-200 bg-white px-4 py-2.5 text-sm font-semibold text-stone-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {pickUiText(language, "새 팀", "New team")}
              </button>
              <button
                type="button"
                onClick={onCreateAgent}
                disabled={!gate.canEdit || !onCreateAgent}
                className="rounded-2xl border border-stone-200 bg-white px-4 py-2.5 text-sm font-semibold text-stone-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {pickUiText(language, "새 에이전트", "New agent")}
              </button>
            </>
          )}
        </div>
      ) : null}

      <div className={`grid gap-4 ${dashboardLayout ? "" : "mt-5 xl:grid-cols-[minmax(0,1.7fr)_minmax(320px,0.9fr)]"}`}>
        <div className="grid gap-4 xl:grid-cols-2">
          {surface === "page" && !dashboardLayout && draggingAgent ? (
            <>
              <OrchestrationDropZone
                laneId={BOARD_CANVAS_LANE_ID}
                kind="canvas"
                eyebrow={pickUiText(language, "Canvas Drop Zone", "Canvas Drop Zone")}
                title={resolveCanvasZoneText(language, {
                  hasDrag,
                  allowed: canvasDropAllowed,
                  active: dragState?.overLaneId === BOARD_CANVAS_LANE_ID,
                }).title}
                description={resolveCanvasZoneText(language, {
                  hasDrag,
                  allowed: canvasDropAllowed,
                  active: dragState?.overLaneId === BOARD_CANVAS_LANE_ID,
                }).description}
                hasDrag={draggingAgent && gate.canEdit}
                canDrop={canvasDropAllowed}
                active={dragState?.overLaneId === BOARD_CANVAS_LANE_ID}
              />
              <OrchestrationDropZone
                laneId={BOARD_ARCHIVE_LANE_ID}
                kind="archive"
                eyebrow={pickUiText(language, "Archive Drop Zone", "Archive Drop Zone")}
                title={resolveArchiveZoneText(language, {
                  hasDrag,
                  entityType: dragState?.entityType ?? null,
                  allowed: archiveDropAllowed,
                  active: dragState?.overLaneId === BOARD_ARCHIVE_LANE_ID,
                }).title}
                description={resolveArchiveZoneText(language, {
                  hasDrag,
                  entityType: dragState?.entityType ?? null,
                  allowed: archiveDropAllowed,
                  active: dragState?.overLaneId === BOARD_ARCHIVE_LANE_ID,
                }).description}
                hasDrag={hasDrag && gate.canEdit}
                canDrop={archiveDropAllowed}
                active={dragState?.overLaneId === BOARD_ARCHIVE_LANE_ID}
              />
            </>
          ) : null}
          {projection.lanes.map((lane) => (
            <OrchestrationBoardLane
              key={lane.id}
              lane={lane}
              language={language}
              nodeMode={nodeMode}
              showLaneActions={surface === "page" && !dashboardLayout}
              actionLocked={!gate.canEdit}
              hasDrag={hasDrag && surface === "page" && gate.canEdit}
              canDrop={hasDrag && surface === "page" && gate.canEdit && (hasDropAvailability ? Boolean(dropAvailability?.[lane.id]) : true)}
              dropActive={dragState?.overLaneId === lane.id}
              dragSource={dragState?.sourceLaneId === lane.id}
              dragEntityType={dragState?.entityType ?? null}
              draggingAgentId={dragState?.entityType === "agent" ? dragState.entityId : null}
              draggableCards={agentDragEnabled}
              draggableLane={teamDragEnabled && lane.kind === "team"}
              draggingTeam={draggingTeam && lane.teamId === dragState?.entityId}
              showDiagnostics={!dashboardLayout}
              onDragStartAgent={onDragStartAgent}
              onDragStartTeam={onDragStartTeam}
              onSelectAgent={onSelectAgent}
              onSelectTeam={onSelectTeam}
              onCreateAgentInTeam={onCreateAgentInTeam}
              onCreateTeam={onCreateTeam}
              onArchiveTeam={onArchiveTeam}
            />
          ))}
        </div>

        {!dashboardLayout ? (
          <aside className="space-y-4">
            {quickEditSheet ? (
              <div data-orchestration-board-sheet="">
                {quickEditSheet}
              </div>
            ) : null}
            <section className="rounded-[1.6rem] border border-stone-200 bg-stone-50 p-5" data-orchestration-board-selection={selected?.id ?? "none"}>
              <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-stone-500">
                {pickUiText(language, "선택된 항목", "Selected item")}
              </div>
              {selected ? (
                <div className="mt-3">
                  <div className={`inline-flex rounded-full px-2 py-1 text-[11px] font-semibold ${selectedToneClass(selected.tone)}`}>
                    {selected.eyebrow}
                  </div>
                  <div className="mt-3 text-lg font-semibold text-stone-950">{selected.title}</div>
                  <div className="mt-2 text-sm leading-6 text-stone-600">{selected.summary}</div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {selected.badges.map((badge) => (
                      <span key={badge} className="rounded-full bg-white px-2 py-1 text-[11px] font-semibold text-stone-600 ring-1 ring-stone-200">
                        {badge}
                      </span>
                    ))}
                  </div>
                  <div className="mt-4 space-y-2 text-sm leading-6 text-stone-700">
                    {selected.details.map((detail) => <div key={detail}>{detail}</div>)}
                  </div>
                </div>
              ) : (
                <div className="mt-3 rounded-[1.2rem] border border-dashed border-stone-300 bg-white px-4 py-4 text-sm leading-6 text-stone-500">
                  {pickUiText(language, "lane 또는 card를 선택하면 여기에 핵심 정보가 정리됩니다.", "Select a lane or card to inspect the key summary here.")}
                </div>
              )}
            </section>

            <details className="rounded-[1.6rem] border border-stone-200 bg-stone-50 p-5" data-orchestration-board-diagnostics="">
              <summary className="cursor-pointer list-none text-sm font-semibold text-stone-950">
                {pickUiText(language, "숨겨진 진단 보기", "Reveal hidden diagnostics")}
              </summary>
              <div className="mt-4 space-y-3">
                {projection.diagnostics.length > 0 ? projection.diagnostics.map((item) => (
                  <div key={item.id} className={`rounded-[1.2rem] border px-4 py-3 text-sm leading-6 ${diagnosticToneClass(item.tone)}`}>
                    <div className="font-semibold">{item.label}</div>
                    <div className="mt-1">{item.message}</div>
                  </div>
                )) : (
                  <div className="rounded-[1.2rem] border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
                    {pickUiText(language, "현재 숨겨진 진단 이슈는 없습니다.", "There are no hidden diagnostic issues right now.")}
                  </div>
                )}
              </div>
            </details>

            {pendingDrop && onChooseDropOption ? (
              <OrchestrationDropMenu
                pendingDrop={pendingDrop}
                language={language}
                onChoose={onChooseDropOption}
                onCancel={onCancelDropOption}
              />
            ) : null}
          </aside>
        ) : pendingDrop && onChooseDropOption ? (
          <div className="xl:col-span-2">
            <OrchestrationDropMenu
              pendingDrop={pendingDrop}
              language={language}
              onChoose={onChooseDropOption}
              onCancel={onCancelDropOption}
            />
          </div>
        ) : null}
      </div>
    </section>
  )
}

function resolveCanvasZoneText(
  language: UiLanguage,
  input: { hasDrag: boolean; allowed: boolean; active?: boolean | null },
): { title: string; description: string } {
  const t = (ko: string, en: string) => pickUiText(language, ko, en)
  if (!input.hasDrag) {
    return {
      title: t("여기에 드롭해서 새 팀 만들기", "Drop here to create a new team"),
      description: t("기존 팀 대신 새 lane을 만들고 agent를 추가하는 경로입니다.", "Use this target to create a new lane instead of dropping into an existing team."),
    }
  }
  if (input.allowed) {
    return {
      title: input.active ? t("놓으면 새 팀 생성 메뉴 열기", "Release to open new-team actions") : t("여기에 드롭해서 새 팀 만들기", "Drop here to create a new team"),
      description: t("새 disabled 팀 lane을 만들고 agent를 함께 배치할지 다음 팝업에서 확정합니다.", "The popup will confirm creating a new disabled team lane and placing the agent inside it."),
    }
  }
  return {
    title: t("이 카드로는 새 팀 생성 불가", "This card cannot create a new team here"),
    description: t("보관된 카드나 유효하지 않은 드래그는 새 팀 생성 대상으로 사용할 수 없습니다.", "Archived cards or invalid drags cannot use the new-team target."),
  }
}

function resolveArchiveZoneText(
  language: UiLanguage,
  input: { hasDrag: boolean; allowed: boolean; active?: boolean | null; entityType?: "agent" | "team" | null },
): { title: string; description: string } {
  const t = (ko: string, en: string) => pickUiText(language, ko, en)
  const teamDrag = input.entityType === "team"
  if (!input.hasDrag) {
    return {
      title: t("여기에 드롭해서 보관", "Drop here to archive"),
      description: t("활성 팀 소속을 정리하고 카드를 보관 상태로 전환합니다.", "Clear active team memberships and switch the card to archived."),
    }
  }
  if (input.allowed) {
    return {
      title: input.active
        ? teamDrag ? t("놓으면 팀 보관", "Release to archive team") : t("놓으면 보관 메뉴 열기", "Release to open archive action")
        : teamDrag ? t("팀 보관 대상", "Archive team") : t("보관 대상", "Archive target"),
      description: teamDrag
        ? t("팀 lane 자체를 archived 상태로 전환하고 보관 보기에서만 남깁니다.", "The entire team lane switches to archived and stays only in the archived view.")
        : t("보관은 미배치와 다릅니다. 상태를 archived로 바꾸고 활성 팀 연결을 정리합니다.", "Archive is different from unassign. It changes the status to archived and clears active team links."),
    }
  }
  return {
    title: teamDrag ? t("이 팀은 보관 불가", "This team cannot be archived here") : t("이 카드에는 보관 불가", "This card cannot be archived here"),
    description: teamDrag
      ? t("이미 보관된 팀이거나 현재 드래그 상태로는 보관 영역을 사용할 수 없습니다.", "The team is already archived or the current drag state cannot use the archive target.")
      : t("이미 보관된 카드이거나 현재 드래그 상태로는 보관 영역을 사용할 수 없습니다.", "The card is already archived or the current drag state cannot use the archive target."),
  }
}

function MetricCard({ label, value }: { label: string; value: string }) {
  return (
    <article className="rounded-[1.4rem] border border-stone-200 bg-stone-50 px-4 py-3">
      <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-stone-500">{label}</div>
      <div className="mt-2 text-lg font-semibold text-stone-950">{value}</div>
    </article>
  )
}

function selectedToneClass(tone: "ready" | "warning" | "danger" | "disabled" | "neutral"): string {
  switch (tone) {
    case "ready":
      return "bg-emerald-100 text-emerald-800"
    case "danger":
      return "bg-red-100 text-red-800"
    case "warning":
      return "bg-amber-100 text-amber-800"
    case "disabled":
      return "bg-stone-200 text-stone-700"
    case "neutral":
    default:
      return "bg-sky-100 text-sky-800"
  }
}

function diagnosticToneClass(tone: "info" | "warning" | "error"): string {
  switch (tone) {
    case "error":
      return "border-red-200 bg-red-50 text-red-900"
    case "warning":
      return "border-amber-200 bg-amber-50 text-amber-900"
    case "info":
    default:
      return "border-stone-200 bg-white text-stone-700"
  }
}
