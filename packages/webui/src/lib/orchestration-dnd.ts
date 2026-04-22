import type { BoardDragState, OrchestrationBoardDraft } from "./orchestration-board"

export const BOARD_CANVAS_LANE_ID = "lane:canvas"
export const BOARD_UNASSIGNED_LANE_ID = "lane:unassigned"
export const BOARD_ARCHIVE_LANE_ID = "lane:archive"

export type OrchestrationBoardDropTarget =
  | { kind: "team"; laneId: string; teamId: string }
  | { kind: "unassigned"; laneId: typeof BOARD_UNASSIGNED_LANE_ID }
  | { kind: "canvas"; laneId: typeof BOARD_CANVAS_LANE_ID }
  | { kind: "archive"; laneId: typeof BOARD_ARCHIVE_LANE_ID }

export function parseBoardDropTarget(laneId?: string | null): OrchestrationBoardDropTarget | null {
  if (!laneId) return null
  if (laneId === BOARD_UNASSIGNED_LANE_ID) return { kind: "unassigned", laneId }
  if (laneId === BOARD_CANVAS_LANE_ID) return { kind: "canvas", laneId }
  if (laneId === BOARD_ARCHIVE_LANE_ID) return { kind: "archive", laneId }
  if (laneId.startsWith("lane:team:")) {
    return {
      kind: "team",
      laneId,
      teamId: laneId.slice("lane:team:".length),
    }
  }
  return null
}

export function inferAgentSourceLaneId(draft: OrchestrationBoardDraft, agentId: string): string {
  const activeMembership = draft.memberships.find((link) => link.agentId === agentId && link.status !== "unresolved")
  if (activeMembership) return `lane:team:${activeMembership.teamId}`
  return BOARD_UNASSIGNED_LANE_ID
}

export function beginBoardDrag(agentId: string, sourceLaneId: string): BoardDragState {
  return {
    entityType: "agent",
    entityId: agentId,
    sourceLaneId,
    overLaneId: sourceLaneId,
    phase: "dragging",
  }
}

export function beginBoardTeamDrag(teamId: string, sourceLaneId: string): BoardDragState {
  return {
    entityType: "team",
    entityId: teamId,
    sourceLaneId,
    overLaneId: sourceLaneId,
    phase: "dragging",
  }
}

export function updateBoardDragTarget(dragState: BoardDragState | null, overLaneId?: string | null): BoardDragState | null {
  if (!dragState) return dragState
  return {
    ...dragState,
    overLaneId: overLaneId ?? null,
  }
}

export function canDropAgentOnLane(input: {
  draft: OrchestrationBoardDraft
  agentId: string
  sourceLaneId?: string | null
  targetLaneId?: string | null
}): boolean {
  const { draft, agentId } = input
  const agent = draft.agents.find((entry) => entry.agentId === agentId)
  const source = parseBoardDropTarget(input.sourceLaneId ?? inferAgentSourceLaneId(draft, agentId))
  const target = parseBoardDropTarget(input.targetLaneId)
  if (!agent || agent.status === "archived" || !source || !target) return false
  if (source.laneId === target.laneId) return false

  if (source.kind === "team") {
    const sourceTeam = draft.teams.find((team) => team.teamId === source.teamId)
    if (!sourceTeam || sourceTeam.status === "archived") return false
  }

  if (target.kind === "team") {
    return draft.teams.some((team) => team.teamId === target.teamId && team.status !== "archived")
  }
  if (target.kind === "unassigned") {
    return source.kind === "team"
  }
  if (target.kind === "archive") {
    return source.kind === "team" || source.kind === "unassigned"
  }
  return source.kind === "team" || source.kind === "unassigned"
}

export function canDropTeamOnLane(input: {
  draft: OrchestrationBoardDraft
  teamId: string
  sourceLaneId?: string | null
  targetLaneId?: string | null
}): boolean {
  const team = input.draft.teams.find((entry) => entry.teamId === input.teamId)
  if (!team || team.status === "archived") return false
  const source = parseBoardDropTarget(input.sourceLaneId ?? `lane:team:${input.teamId}`)
  const target = parseBoardDropTarget(input.targetLaneId)
  if (!source || !target || source.laneId === target.laneId) return false
  if (source.kind !== "team") return false
  if (target.kind === "archive") return true
  if (target.kind !== "team") return false
  return input.draft.teams.some((entry) => entry.teamId === target.teamId && entry.status !== "archived")
}
