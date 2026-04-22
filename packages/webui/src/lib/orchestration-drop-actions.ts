import type { OrchestrationBoardDraft, PendingDropAction, PendingDropActionOption } from "./orchestration-board"
import { inferAgentSourceLaneId, parseBoardDropTarget, type OrchestrationBoardDropTarget } from "./orchestration-dnd"
import { pickUiText, type UiLanguage } from "../stores/uiLanguage"

export function buildPendingDropAction(input: {
  draft: OrchestrationBoardDraft
  agentId: string
  sourceLaneId?: string | null
  targetLaneId?: string | null
  language: UiLanguage
  now?: number
}): PendingDropAction | null {
  const { draft, agentId, language } = input
  const source = parseBoardDropTarget(input.sourceLaneId ?? inferAgentSourceLaneId(draft, agentId))
  const target = parseBoardDropTarget(input.targetLaneId)
  if (!source || !target || source.laneId === target.laneId) return null

  const t = (ko: string, en: string) => pickUiText(language, ko, en)
  const agent = draft.agents.find((entry) => entry.agentId === agentId)
  if (!agent) return null
  const sourceLabel = source.kind === "team"
    ? draft.teams.find((team) => team.teamId === source.teamId)?.displayName ?? source.teamId
    : t("미배치 영역", "Unassigned lane")
  const targetLabel = target.kind === "team"
    ? draft.teams.find((team) => team.teamId === target.teamId)?.displayName ?? target.teamId
    : target.kind === "unassigned"
      ? t("미배치 영역", "Unassigned lane")
      : target.kind === "archive"
        ? t("보관 영역", "Archive shelf")
        : t("새 팀 생성 영역", "New team drop zone")
  const options = resolveDropActionOptions({
    draft,
    agentId,
    source,
    target,
    language,
  })
  if (options.length === 0) return null

  return {
    entityType: "agent",
    entityId: agentId,
    title: t("드롭 동작 선택", "Choose drop action"),
    summary: target.kind === "team"
      ? t(
          `${agent.displayName}을(를) ${sourceLabel}에서 ${targetLabel}(으)로 어떻게 처리할지 선택하세요.`,
          `Choose how to handle ${agent.displayName} from ${sourceLabel} to ${targetLabel}.`,
        )
      : target.kind === "unassigned"
        ? t(
            `${agent.displayName}을(를) ${sourceLabel}에서 미배치 상태로 되돌립니다.`,
            `Choose how to return ${agent.displayName} from ${sourceLabel} to the unassigned lane.`,
          )
        : target.kind === "archive"
          ? t(
              `${agent.displayName}을(를) 보관하고 활성 팀 연결을 정리할지 선택하세요.`,
              `Choose whether to archive ${agent.displayName} and clear active team links.`,
            )
          : t(
              `${agent.displayName}을(를) 새 팀과 함께 배치할지 결정하세요.`,
              `Choose how to place ${agent.displayName} into a newly created team.`,
            ),
    sourceKind: source.kind,
    targetKind: target.kind,
    ...(source.kind === "team" ? { sourceTeamId: source.teamId } : {}),
    ...(target.kind === "team" ? { targetTeamId: target.teamId } : {}),
    fromLaneId: source.laneId,
    toLaneId: target.laneId,
    options,
    openedAt: input.now ?? Date.now(),
  }
}

function resolveDropActionOptions(input: {
  draft: OrchestrationBoardDraft
  agentId: string
  source: OrchestrationBoardDropTarget
  target: OrchestrationBoardDropTarget
  language: UiLanguage
}): PendingDropActionOption[] {
  const { draft, agentId, source, target, language } = input
  const t = (ko: string, en: string) => pickUiText(language, ko, en)
  const agent = draft.agents.find((entry) => entry.agentId === agentId)
  const agentLabel = agent?.displayName ?? agentId
  const sourceLabel = source.kind === "team"
    ? draft.teams.find((team) => team.teamId === source.teamId)?.displayName ?? source.teamId
    : t("미배치 영역", "Unassigned lane")
  const targetLabel = target.kind === "team"
    ? draft.teams.find((team) => team.teamId === target.teamId)?.displayName ?? target.teamId
    : target.kind === "unassigned"
      ? t("미배치 영역", "Unassigned lane")
      : target.kind === "archive"
        ? t("보관 영역", "Archive shelf")
        : t("새 팀", "New team")
  const alreadyInTargetTeam = target.kind === "team"
    ? draft.memberships.some((link) => link.teamId === target.teamId && link.agentId === agentId && link.status !== "unresolved")
    : false

  if (target.kind === "team") {
    if (source.kind === "unassigned") {
      return [
        option(
          "add_to_team",
          t("이 팀에 추가", "Add to this team"),
          t(`${agentLabel}을(를) ${targetLabel}에 배치합니다.`, `Place ${agentLabel} into ${targetLabel}.`),
          "safe",
          true,
        ),
        option("cancel", t("취소", "Cancel"), t("현재 배치를 그대로 유지합니다.", "Keep the current layout unchanged.")),
      ]
    }
    if (source.kind === "team" && source.teamId !== target.teamId) {
      return [
        ...(!alreadyInTargetTeam ? [option(
          "add_to_team",
          t("이 팀에도 추가", "Add to this team too"),
          t(`${sourceLabel} 소속은 유지하고 ${targetLabel}에도 함께 추가합니다.`, `Keep ${sourceLabel} membership and add ${targetLabel} too.`),
          "safe",
          true,
        )] : []),
        option(
          "move_to_team",
          t("이 팀으로 이동", "Move to this team"),
          t(`${sourceLabel} 소속을 정리하고 ${targetLabel}만 남깁니다.`, `Remove ${sourceLabel} membership and keep only ${targetLabel}.`),
          "warning",
        ),
        option(
          "clone_to_team",
          t("복제해서 추가", "Clone and add"),
          t(`비활성 복제본을 만들어 ${targetLabel}에 추가합니다.`, `Create a disabled copy and add it to ${targetLabel}.`),
          "neutral",
        ),
        option("cancel", t("취소", "Cancel"), t("현재 배치를 그대로 유지합니다.", "Keep the current layout unchanged.")),
      ]
    }
  }

  if (target.kind === "unassigned" && source.kind === "team") {
    return [
      option(
        "unassign",
        t("소속 해제", "Remove from team"),
        t(`${sourceLabel} 소속을 제거하고 미배치 상태로 돌립니다.`, `Remove ${sourceLabel} membership and return the agent to the unassigned lane.`),
        "warning",
        true,
      ),
      option("cancel", t("취소", "Cancel"), t("현재 배치를 그대로 유지합니다.", "Keep the current layout unchanged.")),
    ]
  }

  if (target.kind === "canvas") {
    return [
      option(
        "create_team_and_add",
        t("새 팀 만들고 추가", "Create team and add"),
        t(`${agentLabel}용 새 disabled 팀 lane을 만들고 함께 배치합니다.`, `Create a new disabled team lane for ${agentLabel} and place the agent inside it.`),
        "safe",
        true,
      ),
      option("cancel", t("취소", "Cancel"), t("현재 배치를 그대로 유지합니다.", "Keep the current layout unchanged.")),
    ]
  }

  if (target.kind === "archive") {
    return [
      option(
        "archive",
        t("보관", "Archive"),
        t(`${agentLabel}을(를) 보관 상태로 바꾸고 활성 팀 소속을 정리합니다.`, `Set ${agentLabel} to archived and clear active team memberships.`),
        "danger",
      ),
      option("cancel", t("취소", "Cancel"), t("현재 배치를 그대로 유지합니다.", "Keep the current layout unchanged.")),
    ]
  }

  return []
}

function option(
  id: PendingDropActionOption["id"],
  label: string,
  description: string,
  tone: PendingDropActionOption["tone"] = "neutral",
  recommended = false,
): PendingDropActionOption {
  return {
    id,
    label,
    description,
    tone,
    ...(recommended ? { recommended } : {}),
  }
}
