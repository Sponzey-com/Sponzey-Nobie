import type {
  OrchestrationAgentRegistryEntry,
  OrchestrationRegistrySnapshot,
  OrchestrationTeamRegistryEntry,
} from "../contracts/orchestration-api"
import type { BoardValidationSnapshot } from "./orchestration-board"
import { formatBoardValidationCategoryLabel, summarizeBoardValidationCategories } from "./orchestration-board-validation"
import {
  buildOrchestrationAgentConfigBadges,
  buildOrchestrationAgentDetailBadges,
  buildOrchestrationAgentRuntimeBadges,
  resolveOrchestrationAgentTone,
} from "./orchestration-status"
import type { VisualizationStatus } from "./setup-visualization"
import { pickUiText, type UiLanguage } from "../stores/uiLanguage"
import { riskText } from "./orchestration-ui"

export interface OrchestrationBoardCardProjection {
  id: string
  agentId: string
  displayName: string
  role: string
  status: OrchestrationAgentRegistryEntry["status"]
  tone: "ready" | "warning" | "danger" | "disabled" | "neutral"
  configBadges: string[]
  runtimeBadges: string[]
  detailBadges: string[]
  badges: string[]
  diagnostics: string[]
  teamIds: string[]
  selected: boolean
}

export interface OrchestrationBoardLaneProjection {
  id: string
  kind: "unassigned" | "team"
  tone: "ready" | "warning" | "danger" | "disabled" | "neutral"
  displayName: string
  description: string
  status: VisualizationStatus
  cards: OrchestrationBoardCardProjection[]
  badges: string[]
  diagnostics: string[]
  selected: boolean
  teamId?: string
}

export interface OrchestrationBoardDiagnosticProjection {
  id: string
  tone: "info" | "warning" | "error"
  label: string
  message: string
}

export interface OrchestrationBoardSelectedEntity {
  id: string
  kind: "agent" | "team"
  tone: "ready" | "warning" | "danger" | "disabled" | "neutral"
  eyebrow: string
  title: string
  summary: string
  badges: string[]
  details: string[]
}

export interface OrchestrationBoardProjection {
  lanes: OrchestrationBoardLaneProjection[]
  diagnostics: OrchestrationBoardDiagnosticProjection[]
  selectedEntity: OrchestrationBoardSelectedEntity | null
  counts: {
    teams: number
    agents: number
    unassignedAgents: number
  }
}

export function buildOrchestrationBoardProjection(input: {
  snapshot?: OrchestrationRegistrySnapshot | null
  agents: OrchestrationAgentRegistryEntry[]
  teams: OrchestrationTeamRegistryEntry[]
  language: UiLanguage
  selectedEntityId?: string | null
  showArchived?: boolean
  validationSnapshot?: BoardValidationSnapshot | null
  preserveTeamOrder?: boolean
  preserveAgentOrder?: boolean
}): OrchestrationBoardProjection {
  const { snapshot, agents, teams, language, selectedEntityId } = input
  const t = (ko: string, en: string) => pickUiText(language, ko, en)
  const showArchived = input.showArchived ?? false
  const validationIssues = input.validationSnapshot?.issues ?? []
  const visibleAgents = showArchived ? agents : agents.filter((agent) => agent.status !== "archived")
  const visibleTeams = showArchived ? teams : teams.filter((team) => team.status !== "archived")
  const hiddenArchivedAgents = agents.length - visibleAgents.length
  const hiddenArchivedTeams = teams.length - visibleTeams.length
  const agentMap = new Map(visibleAgents.map((agent) => [agent.agentId, agent]))
  const teamMap = new Map(visibleTeams.map((team) => [team.teamId, team]))
  const referencedByExistingTeam = new Set<string>()
  const teamLanePairs = new Set<string>()

  const lanes: OrchestrationBoardLaneProjection[] = []

  for (const team of (input.preserveTeamOrder ? [...visibleTeams] : sortTeams(visibleTeams))) {
    const memberIds = uniqueValues([
      ...team.memberAgentIds,
      ...agents
        .filter((agent) => agent.teamIds.includes(team.teamId))
        .map((agent) => agent.agentId),
    ])
    const cards = memberIds
      .map((agentId) => agentMap.get(agentId))
      .filter(Boolean)
      .map((agent) => {
        referencedByExistingTeam.add(agent!.agentId)
        teamLanePairs.add(`${team.teamId}::${agent!.agentId}`)
        return buildBoardCard(agent!, language, selectedEntityId === `agent:${agent!.agentId}`, validationIssues)
      })
      .sort(compareCards)
    const unresolvedMembers = uniqueValues([
      ...team.unresolvedMemberAgentIds,
      ...(snapshot?.membershipEdges ?? [])
        .filter((edge) => edge.teamId === team.teamId && edge.status === "unresolved")
        .map((edge) => edge.agentId),
    ])
    const desyncedAgents = uniqueValues(cards
      .map((card) => card.agentId)
      .filter((agentId) => {
        const teamOwnsAgent = team.memberAgentIds.includes(agentId)
        const agentOwnsTeam = agentMap.get(agentId)?.teamIds.includes(team.teamId) ?? false
        return teamOwnsAgent !== agentOwnsTeam
      }))
    const empty = cards.length === 0
    const validationDiagnostics = validationIssues
      .filter((issue) => issue.targetType === "team"
        ? issue.targetId === team.teamId
        : issue.teamId === team.teamId)
      .map((issue) => `${formatBoardValidationCategoryLabel(issue.category, language)}: ${issue.message}`)
    const teamHasBlockingIssues = validationIssues.some((issue) =>
      issue.severity === "error" && (issue.targetType === "team" ? issue.targetId === team.teamId : issue.teamId === team.teamId))
    const validationBadges = summarizeValidationIssueBadges(
      validationIssues.filter((issue) => issue.targetType === "team"
        ? issue.targetId === team.teamId
        : issue.teamId === team.teamId),
      language,
    )
    const tone = team.status === "archived" || team.status === "disabled"
      ? "disabled"
      : teamHasBlockingIssues
        ? "danger"
        : unresolvedMembers.length > 0 || desyncedAgents.length > 0 || empty || validationDiagnostics.length > 0
        ? "warning"
        : "ready"
    lanes.push({
      id: `lane:team:${team.teamId}`,
      kind: "team",
      tone,
      displayName: resolveBoardTeamLabel(team.displayName, language),
      description: summarizePurpose(team.purpose),
      status: team.status === "archived" || team.status === "disabled"
        ? "disabled"
        : unresolvedMembers.length > 0 || desyncedAgents.length > 0 || empty
          ? "warning"
          : "ready",
      cards,
      badges: [
        team.status,
        `${cards.length} ${t("에이전트", "agents")}`,
        ...(unresolvedMembers.length > 0 ? [`${unresolvedMembers.length} ${t("누락", "missing")}`] : []),
        ...(validationDiagnostics.length > 0 ? [`${validationDiagnostics.length} ${t("이슈", "issues")}`] : []),
        ...validationBadges,
      ],
      diagnostics: [
        ...(empty ? [t("현재 이 팀에 배치된 실제 에이전트가 없습니다.", "This team currently has no assigned agents.")] : []),
        ...(unresolvedMembers.length > 0 ? [t(`누락된 멤버 ${unresolvedMembers.length}개`, `${unresolvedMembers.length} missing members`)] : []),
        ...(desyncedAgents.length > 0 ? [t(`team/member 불일치 ${desyncedAgents.length}건`, `${desyncedAgents.length} membership mismatches`)] : []),
        ...validationDiagnostics,
      ],
      selected: selectedEntityId === `team:${team.teamId}`,
      teamId: team.teamId,
    })
  }

  const unassignedCards = (input.preserveAgentOrder ? [...visibleAgents] : sortAgents(visibleAgents))
    .filter((agent) => {
      const knownTeams = agent.teamIds.filter((teamId) => teamMap.has(teamId))
      return knownTeams.length === 0 || !referencedByExistingTeam.has(agent.agentId)
    })
    .map((agent) => buildBoardCard(agent, language, selectedEntityId === `agent:${agent.agentId}`, validationIssues))

  lanes.unshift({
    id: "lane:unassigned",
    kind: "unassigned",
    tone: "neutral",
    displayName: t("Independent Agents", "Independent Agents"),
    description: t("팀 없이 독립적으로 운영되는 에이전트이거나, 현재 유효한 팀 참조가 없는 에이전트입니다.", "Agents operating independently without a team, or agents whose team reference is not currently valid."),
    status: unassignedCards.length > 0 ? "ready" : "planned",
    cards: unassignedCards,
    badges: [`${unassignedCards.length} ${t("에이전트", "agents")}`],
    diagnostics: [],
    selected: false,
  })

  return {
    lanes,
    diagnostics: buildBoardDiagnostics({
      snapshot,
      agents: visibleAgents,
      teams: visibleTeams,
      unassignedCards,
      teamLanePairs,
      language,
      hiddenArchivedAgents,
      hiddenArchivedTeams,
      showArchived,
      validationSnapshot: input.validationSnapshot,
    }),
    selectedEntity: buildSelectedEntity({ selectedEntityId, agents, teams, language, validationSnapshot: input.validationSnapshot }),
    counts: {
      teams: visibleTeams.length,
      agents: visibleAgents.length,
      unassignedAgents: unassignedCards.length,
    },
  }
}

function buildBoardCard(
  agent: OrchestrationAgentRegistryEntry,
  language: UiLanguage,
  selected: boolean,
  validationIssues: BoardValidationSnapshot["issues"],
): OrchestrationBoardCardProjection {
  const agentIssues = validationIssues
    .filter((issue) => issue.targetType === "agent"
      ? issue.targetId === agent.agentId
      : issue.agentId === agent.agentId)
  const errorCount = agentIssues.filter((issue) => issue.severity === "error").length
  const diagnostics = agentIssues.map((issue) => `${formatBoardValidationCategoryLabel(issue.category, language)}: ${issue.message}`)
  const categoryBadges = summarizeValidationIssueBadges(agentIssues, language)
  const tone = errorCount > 0
    ? "danger"
    : resolveOrchestrationAgentTone({
        agent,
        diagnosticsCount: agentIssues.length,
      })
  return {
    id: `agent:${agent.agentId}`,
    agentId: agent.agentId,
    displayName: resolveBoardAgentLabel(agent.displayName, language),
    role: agent.role,
    status: agent.status,
    tone,
    configBadges: buildOrchestrationAgentConfigBadges(agent, language),
    runtimeBadges: buildOrchestrationAgentRuntimeBadges(agent, language),
    detailBadges: buildOrchestrationAgentDetailBadges({
      agent,
      diagnosticsCount: agentIssues.length,
      language,
    }).concat(categoryBadges),
    badges: [
      ...buildOrchestrationAgentConfigBadges(agent, language),
      ...buildOrchestrationAgentDetailBadges({
        agent,
        diagnosticsCount: agentIssues.length,
        language,
      }),
      ...categoryBadges,
      ...buildOrchestrationAgentRuntimeBadges(agent, language),
    ],
    diagnostics,
    teamIds: agent.teamIds,
    selected,
  }
}

function buildBoardDiagnostics(input: {
  snapshot?: OrchestrationRegistrySnapshot | null
  agents: OrchestrationAgentRegistryEntry[]
  teams: OrchestrationTeamRegistryEntry[]
  unassignedCards: OrchestrationBoardCardProjection[]
  teamLanePairs: Set<string>
  language: UiLanguage
  hiddenArchivedAgents: number
  hiddenArchivedTeams: number
  showArchived: boolean
  validationSnapshot?: BoardValidationSnapshot | null
}): OrchestrationBoardDiagnosticProjection[] {
  const { snapshot, agents, teams, unassignedCards, teamLanePairs, language, hiddenArchivedAgents, hiddenArchivedTeams, showArchived, validationSnapshot } = input
  const t = (ko: string, en: string) => pickUiText(language, ko, en)
  const unresolvedMemberships = snapshot?.membershipEdges.filter((edge) => edge.status === "unresolved").length
    ?? teams.reduce((count, team) => count + team.unresolvedMemberAgentIds.length, 0)
  const emptyTeams = teams.filter((team) => {
    const laneMembers = agents.filter((agent) => teamLanePairs.has(`${team.teamId}::${agent.agentId}`))
    return laneMembers.length === 0
  }).length
  const disabledAgents = agents.filter((agent) => agent.status === "disabled").length
  const archivedAgents = agents.filter((agent) => agent.status === "archived").length
  const diagnostics: OrchestrationBoardDiagnosticProjection[] = []

  if (unresolvedMemberships > 0) {
    diagnostics.push({
      id: "diagnostic:unresolved",
      tone: "error",
      label: t("누락된 연결", "Missing links"),
      message: t(`현재 registry에 없는 멤버 연결 ${unresolvedMemberships}건이 숨겨져 있습니다.`, `${unresolvedMemberships} member links point to missing agents.`),
    })
  }
  if (emptyTeams > 0) {
    diagnostics.push({
      id: "diagnostic:empty-teams",
      tone: "warning",
      label: t("빈 팀", "Empty teams"),
      message: t(`에이전트가 없는 팀 ${emptyTeams}개가 있습니다.`, `${emptyTeams} team lanes do not contain agents.`),
    })
  }
  if (unassignedCards.length > 0) {
    diagnostics.push({
      id: "diagnostic:unassigned",
      tone: "info",
      label: t("독립 에이전트", "Independent agents"),
      message: t(`팀 없이 운영 중인 에이전트 ${unassignedCards.length}개가 있습니다.`, `${unassignedCards.length} agents are currently operating without a team.`),
    })
  }
  if (disabledAgents > 0 || archivedAgents > 0) {
    diagnostics.push({
      id: "diagnostic:inactive-agents",
      tone: "info",
      label: t("비활성 카드", "Inactive cards"),
      message: t(`disabled ${disabledAgents} / archived ${archivedAgents} 상태는 보드에 muted badge로만 표시됩니다.`, `disabled ${disabledAgents} / archived ${archivedAgents} entries stay visible with muted badges.`),
    })
  }
  if (!showArchived && (hiddenArchivedAgents > 0 || hiddenArchivedTeams > 0)) {
    diagnostics.push({
      id: "diagnostic:hidden-archived",
      tone: "info",
      label: t("숨겨진 보관 항목", "Hidden archived entries"),
      message: t(
        `archived 에이전트 ${hiddenArchivedAgents} / 팀 ${hiddenArchivedTeams}개는 기본 보드에서 숨겨집니다.`,
        `archived agents ${hiddenArchivedAgents} / teams ${hiddenArchivedTeams} stay hidden from the default board.`,
      ),
    })
  }
  if ((validationSnapshot?.issues.length ?? 0) > 0) {
    const errorCount = validationSnapshot!.issues.filter((issue) => issue.severity === "error").length
    const warningCount = validationSnapshot!.issues.filter((issue) => issue.severity === "warning").length
    const categorySummary = summarizeBoardValidationCategories(validationSnapshot, language)
      .map((item) => `${item.label} ${item.count}`)
      .join(" / ")
    diagnostics.push({
      id: "diagnostic:validation",
      tone: errorCount > 0 ? "error" : "warning",
      label: t("보드 검증", "Board validation"),
      message: t(
        `error ${errorCount} / warning ${warningCount} 이슈가 보드에 매핑되어 있습니다. ${categorySummary}`,
        `error ${errorCount} / warning ${warningCount} issues are currently mapped onto the board. ${categorySummary}`,
      ),
    })
  }
  return diagnostics
}

function buildSelectedEntity(input: {
  selectedEntityId?: string | null
  agents: OrchestrationAgentRegistryEntry[]
  teams: OrchestrationTeamRegistryEntry[]
  language: UiLanguage
  validationSnapshot?: BoardValidationSnapshot | null
}): OrchestrationBoardSelectedEntity | null {
  const { selectedEntityId, agents, teams, language, validationSnapshot } = input
  if (!selectedEntityId) return null
  const t = (ko: string, en: string) => pickUiText(language, ko, en)

  if (selectedEntityId.startsWith("agent:")) {
    const agentId = selectedEntityId.slice("agent:".length)
    const agent = agents.find((entry) => entry.agentId === agentId)
    if (!agent) return null
    const hasBlockingIssues = (validationSnapshot?.issues ?? []).some((issue) =>
      issue.severity === "error" && (issue.targetType === "agent" ? issue.targetId === agent.agentId : issue.agentId === agent.agentId))
    const tone = agent.status === "archived" || agent.status === "disabled"
      ? "disabled"
      : hasBlockingIssues
        ? "danger"
        : agent.permissionProfile.riskCeiling === "dangerous" || agent.permissionProfile.allowShellExecution || agent.permissionProfile.allowScreenControl
        ? "warning"
        : "ready"
    return {
      id: selectedEntityId,
      kind: "agent",
      tone,
      eyebrow: t("서브 에이전트", "Sub-agent"),
      title: resolveBoardAgentLabel(agent.displayName, language),
      summary: agent.role,
      badges: [
        agent.status,
        riskText(agent.permissionProfile.riskCeiling, language),
        `${t("팀", "Teams")} ${agent.teamIds.length}`,
      ],
      details: [
        `${t("ID", "ID")}: ${agent.agentId}`,
        `${t("전문 태그", "Specialties")}: ${agent.specialtyTags.join(", ") || "-"}`,
        `${t("스킬/MCP/도구", "Skill/MCP/Tools")}: ${
          [
            ...agent.skillMcpSummary.enabledSkillIds,
            ...agent.skillMcpSummary.enabledMcpServerIds,
            ...agent.skillMcpSummary.enabledToolNames,
          ].join(", ") || "-"
        }`,
        ...((validationSnapshot?.issues ?? [])
          .filter((issue) => issue.targetType === "agent" ? issue.targetId === agent.agentId : issue.agentId === agent.agentId)
          .map((issue) => `${t("검증", "Validation")} / ${formatBoardValidationCategoryLabel(issue.category, language)}: ${issue.message}`)),
      ],
    }
  }

  if (selectedEntityId.startsWith("team:")) {
    const teamId = selectedEntityId.slice("team:".length)
    const team = teams.find((entry) => entry.teamId === teamId)
    if (!team) return null
    const hasBlockingIssues = (validationSnapshot?.issues ?? []).some((issue) =>
      issue.severity === "error" && (issue.targetType === "team" ? issue.targetId === team.teamId : issue.teamId === team.teamId))
    const tone = team.status === "archived" || team.status === "disabled"
      ? "disabled"
      : hasBlockingIssues
        ? "danger"
        : team.unresolvedMemberAgentIds.length > 0 || team.memberAgentIds.length === 0
        ? "warning"
        : "ready"
    return {
      id: selectedEntityId,
      kind: "team",
      tone,
      eyebrow: t("팀", "Team"),
      title: resolveBoardTeamLabel(team.displayName, language),
      summary: team.purpose,
      badges: [
        team.status,
        `${t("멤버", "Members")} ${team.memberAgentIds.length}`,
        ...(team.unresolvedMemberAgentIds.length > 0 ? [`${t("누락", "Missing")} ${team.unresolvedMemberAgentIds.length}`] : []),
      ],
      details: [
        `${t("ID", "ID")}: ${team.teamId}`,
        `${t("역할 힌트", "Role hints")}: ${team.roleHints.join(", ") || "-"}`,
        `${t("멤버 ID", "Member IDs")}: ${team.memberAgentIds.join(", ") || "-"}`,
        ...((validationSnapshot?.issues ?? [])
          .filter((issue) => issue.targetType === "team" ? issue.targetId === team.teamId : issue.teamId === team.teamId)
          .map((issue) => `${t("검증", "Validation")} / ${formatBoardValidationCategoryLabel(issue.category, language)}: ${issue.message}`)),
      ],
    }
  }

  return null
}

function summarizePurpose(value: string): string {
  const trimmed = value.trim()
  if (!trimmed) return ""
  if (trimmed.length <= 92) return trimmed
  return `${trimmed.slice(0, 89).trimEnd()}...`
}

function resolveBoardAgentLabel(value: string, language: UiLanguage): string {
  return value.trim() || pickUiText(language, "이름 없는 에이전트", "Untitled agent")
}

function resolveBoardTeamLabel(value: string, language: UiLanguage): string {
  return value.trim() || pickUiText(language, "이름 없는 팀", "Untitled team")
}

function summarizeValidationIssueBadges(
  issues: BoardValidationSnapshot["issues"],
  language: UiLanguage,
): string[] {
  const counts = new Map<string, number>()
  for (const issue of issues) {
    const label = formatBoardValidationCategoryLabel(issue.category, language)
    counts.set(label, (counts.get(label) ?? 0) + 1)
  }
  return Array.from(counts.entries()).map(([label, count]) => `${label} ${count}`)
}

function compareCards(left: OrchestrationBoardCardProjection, right: OrchestrationBoardCardProjection): number {
  return statusRank(left.status) - statusRank(right.status)
    || left.displayName.localeCompare(right.displayName)
    || left.agentId.localeCompare(right.agentId)
}

function sortAgents(agents: OrchestrationAgentRegistryEntry[]): OrchestrationAgentRegistryEntry[] {
  return [...agents].sort((left, right) =>
    statusRank(left.status) - statusRank(right.status)
    || left.displayName.localeCompare(right.displayName)
    || left.agentId.localeCompare(right.agentId),
  )
}

function sortTeams(teams: OrchestrationTeamRegistryEntry[]): OrchestrationTeamRegistryEntry[] {
  return [...teams].sort((left, right) =>
    statusRank(left.status) - statusRank(right.status)
    || left.displayName.localeCompare(right.displayName)
    || left.teamId.localeCompare(right.teamId),
  )
}

function statusRank(status: string): number {
  switch (status) {
    case "enabled":
      return 0
    case "disabled":
      return 1
    case "archived":
      return 2
    default:
      return 3
  }
}

function uniqueValues(values: string[]): string[] {
  return Array.from(new Set(values.map((item) => item.trim()).filter(Boolean)))
}
