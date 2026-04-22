import type {
  OrchestrationAgentRegistryEntry,
  OrchestrationRegistrySnapshot,
  OrchestrationTeamRegistryEntry,
} from "../contracts/orchestration-api"
import type { OrchestrationBoardProjection } from "./orchestration-board-projection"
import type { OrchestrationSummaryCard, RelationshipGraphView } from "./orchestration-ui"
import type { TopologyInspectorModel, YeonjangCapabilityProjection } from "./setup-visualization-topology"
import { pickUiText, type UiLanguage } from "../stores/uiLanguage"

export type OrchestrationDashboardTab = "map" | "activity" | "approvals" | "utilities"

export interface OrchestrationDashboardFallback {
  state: "ready" | "graph_only" | "registry_only" | "summary_only" | "empty"
  tone: "ready" | "warning" | "danger" | "neutral"
  title: string
  description: string
  sourceBadges: string[]
}

export interface OrchestrationDashboardActivityItem {
  id: string
  tab: "activity" | "approvals"
  tone: "ready" | "warning" | "danger" | "neutral"
  title: string
  description: string
  badge: string
  entityId?: string
}

export interface OrchestrationDashboardInspectorModel {
  id: string
  tone: "ready" | "warning" | "disabled" | "neutral"
  eyebrow: string
  title: string
  summary: string
  configBadges: string[]
  runtimeBadges: string[]
  details: string[]
}

export function buildOrchestrationDashboardFallback(input: {
  snapshot?: OrchestrationRegistrySnapshot | null
  graphView?: RelationshipGraphView | null
  summary: OrchestrationSummaryCard[]
  language: UiLanguage
}): OrchestrationDashboardFallback {
  const { snapshot, graphView, summary, language } = input
  const t = (ko: string, en: string) => pickUiText(language, ko, en)
  const agentCount = snapshot?.agents.length ?? 0
  const teamCount = snapshot?.teams.length ?? 0
  const hasRegistry = agentCount > 0 || teamCount > 0
  const hasGraph = Boolean(graphView && (graphView.nodes.length > 0 || graphView.edges.length > 0))
  const hasMeaningfulSummary = summary.some((card) => card.value !== "0" && card.value !== "0/0")

  if (hasRegistry && hasGraph) {
    return {
      state: "ready",
      tone: "ready",
      title: t("라이브 맵 준비", "Live map ready"),
      description: t(
        "registry와 relationship graph가 모두 있으므로 팀 lane, agent card, approval 흐름을 함께 읽을 수 있습니다.",
        "Registry and relationship graph are both available, so team lanes, agent cards, and approval flow can be read together.",
      ),
      sourceBadges: [t("registry", "registry"), t("graph", "graph"), t("summary", "summary")],
    }
  }

  if (hasGraph) {
    return {
      state: "graph_only",
      tone: "warning",
      title: t("그래프 우선 미리보기", "Graph-first preview"),
      description: t(
        "relationship graph는 있지만 registry 세부 정보가 부족해 일부 card는 요약 badge만 보여줍니다.",
        "The relationship graph is present, but registry detail is limited, so some cards only show summary badges.",
      ),
      sourceBadges: [t("graph", "graph"), t("summary", "summary")],
    }
  }

  if (hasRegistry) {
    return {
      state: "registry_only",
      tone: "warning",
      title: t("레지스트리 우선 미리보기", "Registry-first preview"),
      description: t(
        "registry는 있지만 runtime graph가 없어 lane과 card 중심으로만 구조를 보여줍니다.",
        "Registry data is available, but the runtime graph is not, so the structure stays lane-and-card focused.",
      ),
      sourceBadges: [t("registry", "registry"), t("summary", "summary")],
    }
  }

  if (hasMeaningfulSummary) {
    return {
      state: "summary_only",
      tone: "neutral",
      title: t("요약만 있는 상태", "Summary-only state"),
      description: t(
        "아직 실제 에이전트나 팀 registry가 비어 있어 summary 카드와 안내 문구만 먼저 보여줍니다.",
        "The registry does not yet contain real agents or teams, so the surface starts with summary cards and guidance only.",
      ),
      sourceBadges: [t("summary", "summary")],
    }
  }

  return {
    state: "empty",
    tone: "neutral",
    title: t("비어 있는 맵", "Empty map"),
    description: t(
        "아직 구성된 팀과 에이전트가 없습니다. 이름과 설명을 넣어 바로 초안을 추가할 수 있습니다.",
        "There are no configured teams or agents yet. Add a draft directly with a name and description.",
    ),
    sourceBadges: [t("empty", "empty")],
  }
}

export function buildOrchestrationDashboardActivityItems(input: {
  agents: OrchestrationAgentRegistryEntry[]
  summary: OrchestrationSummaryCard[]
  boardProjection: OrchestrationBoardProjection
  graphView: RelationshipGraphView
  yeonjangProjection: YeonjangCapabilityProjection
  language: UiLanguage
}): OrchestrationDashboardActivityItem[] {
  const { agents, summary, boardProjection, graphView, yeonjangProjection, language } = input
  const t = (ko: string, en: string) => pickUiText(language, ko, en)
  const items: OrchestrationDashboardActivityItem[] = []

  for (const agent of agents) {
    if (agent.currentLoad.failedSubSessions > 0) {
      items.push({
        id: `activity:failed:${agent.agentId}`,
        tab: "activity",
        tone: "danger",
        title: t(`${agent.displayName} 실패 감지`, `${agent.displayName} failure detected`),
        description: t(
          `실패한 서브세션 ${agent.currentLoad.failedSubSessions}개가 남아 있어 재시도 또는 검토가 필요합니다.`,
          `${agent.currentLoad.failedSubSessions} failed sub-session(s) remain and need retry or review.`,
        ),
        badge: t("failed", "failed"),
        entityId: `agent:${agent.agentId}`,
      })
    } else if (agent.currentLoad.activeSubSessions > 0) {
      items.push({
        id: `activity:active:${agent.agentId}`,
        tab: "activity",
        tone: "ready",
        title: t(`${agent.displayName} 실행 중`, `${agent.displayName} running`),
        description: t(
          `현재 ${agent.currentLoad.activeSubSessions}개 세션이 실행 중입니다.`,
          `${agent.currentLoad.activeSubSessions} session(s) are active right now.`,
        ),
        badge: t("running", "running"),
        entityId: `agent:${agent.agentId}`,
      })
    } else if (agent.currentLoad.queuedSubSessions > 0) {
      items.push({
        id: `activity:queued:${agent.agentId}`,
        tab: "activity",
        tone: "warning",
        title: t(`${agent.displayName} 대기열`, `${agent.displayName} queued`),
        description: t(
          `대기 중인 세션 ${agent.currentLoad.queuedSubSessions}개가 있습니다.`,
          `${agent.currentLoad.queuedSubSessions} session(s) are queued.`,
        ),
        badge: t("queued", "queued"),
        entityId: `agent:${agent.agentId}`,
      })
    }
  }

  for (const relation of yeonjangProjection.relations) {
    if (relation.state === "approved_to_control") continue
    items.push({
      id: `approval:${relation.agentId}`,
      tab: "approvals",
      tone: relation.state === "blocked" ? "danger" : "warning",
      title: relation.state === "blocked"
        ? t(`${relation.agentLabel} 차단`, `${relation.agentLabel} blocked`)
        : t(`${relation.agentLabel} 승인 대기`, `${relation.agentLabel} awaiting approval`),
      description: relation.description,
      badge: relation.approvalPolicyLabel,
      entityId: `agent:${relation.agentId}`,
    })
  }

  const unresolvedCard = summary.find((card) => card.id === "membership")
  if (unresolvedCard && unresolvedCard.value !== "0") {
    items.push({
      id: "activity:membership",
      tab: "activity",
      tone: unresolvedCard.tone === "danger" ? "danger" : "warning",
      title: unresolvedCard.label,
      description: unresolvedCard.description,
      badge: unresolvedCard.value,
    })
  }

  for (const diagnostic of boardProjection.diagnostics.slice(0, 3)) {
    items.push({
      id: `diagnostic:${diagnostic.id}`,
      tab: "activity",
      tone: diagnostic.tone === "error" ? "danger" : diagnostic.tone === "warning" ? "warning" : "neutral",
      title: diagnostic.label,
      description: diagnostic.message,
      badge: t("board", "board"),
    })
  }

  for (const diagnostic of graphView.diagnostics.slice(0, 2)) {
    items.push({
      id: `graph:${diagnostic}`,
      tab: "activity",
      tone: "warning",
      title: t("관계도 진단", "Graph diagnostic"),
      description: diagnostic,
      badge: t("graph", "graph"),
    })
  }

  return items.sort(compareDashboardActivityItems)
}

export function filterOrchestrationDashboardActivityItems(
  items: OrchestrationDashboardActivityItem[],
  tab: Extract<OrchestrationDashboardTab, "activity" | "approvals">,
): OrchestrationDashboardActivityItem[] {
  return items.filter((item) => item.tab === tab)
}

export function buildOrchestrationDashboardInspector(input: {
  selectedAgent: OrchestrationAgentRegistryEntry | null
  selectedTeam: OrchestrationTeamRegistryEntry | null
  boardProjection: OrchestrationBoardProjection
  topologyInspector?: TopologyInspectorModel | null
  summary: OrchestrationSummaryCard[]
  language: UiLanguage
}): OrchestrationDashboardInspectorModel {
  const { selectedAgent, selectedTeam, boardProjection, topologyInspector, summary, language } = input
  const t = (ko: string, en: string) => pickUiText(language, ko, en)

  if (selectedAgent) {
    const card = boardProjection.lanes
      .flatMap((lane) => lane.cards)
      .find((entry) => entry.agentId === selectedAgent.agentId)

    return {
      id: `agent:${selectedAgent.agentId}`,
      tone: card?.tone ?? "neutral",
      eyebrow: t("Agent", "Agent"),
      title: selectedAgent.displayName,
      summary: selectedAgent.role,
      configBadges: card?.configBadges ?? [selectedAgent.status],
      runtimeBadges: card?.runtimeBadges ?? [],
      details: [
        ...(card?.diagnostics ?? []),
        t(`팀 ${selectedAgent.teamIds.length}`, `Teams ${selectedAgent.teamIds.length}`),
        selectedAgent.delegationEnabled ? t("위임 활성", "Delegation enabled") : t("위임 비활성", "Delegation disabled"),
      ],
    }
  }

  if (selectedTeam) {
    const lane = boardProjection.lanes.find((entry) => entry.teamId === selectedTeam.teamId)
    return {
      id: `team:${selectedTeam.teamId}`,
      tone: lane?.tone ?? "neutral",
      eyebrow: t("Team", "Team"),
      title: selectedTeam.displayName,
      summary: selectedTeam.purpose,
      configBadges: lane?.badges.slice(0, 2) ?? [selectedTeam.status],
      runtimeBadges: [],
      details: [
        ...(lane?.diagnostics ?? []),
        t(`멤버 ${selectedTeam.memberAgentIds.length}`, `Members ${selectedTeam.memberAgentIds.length}`),
      ],
    }
  }

  if (topologyInspector) {
    return {
      id: topologyInspector.id,
      tone: topologyInspector.tone === "error"
        ? "warning"
        : topologyInspector.tone,
      eyebrow: t("Capability", "Capability"),
      title: topologyInspector.title,
      summary: topologyInspector.summary,
      configBadges: topologyInspector.badges,
      runtimeBadges: [],
      details: topologyInspector.details,
    }
  }

  return {
    id: "dashboard:overview",
    tone: "neutral",
    eyebrow: t("Command Center", "Command Center"),
    title: t("오케스트레이션 맵", "Orchestration map"),
    summary: t(
      "team lane, agent card, approval 흐름을 하나의 content viewport에서 확인합니다.",
      "View team lanes, agent cards, and approval flow inside one content viewport.",
    ),
    configBadges: summary.slice(0, 2).map((card) => `${card.label} ${card.value}`),
    runtimeBadges: summary.slice(2, 4).map((card) => `${card.label} ${card.value}`),
    details: summary.map((card) => `${card.label}: ${card.description}`),
  }
}

function compareDashboardActivityItems(
  left: OrchestrationDashboardActivityItem,
  right: OrchestrationDashboardActivityItem,
): number {
  return activityToneWeight(right.tone) - activityToneWeight(left.tone)
}

function activityToneWeight(tone: OrchestrationDashboardActivityItem["tone"]): number {
  switch (tone) {
    case "danger":
      return 4
    case "warning":
      return 3
    case "ready":
      return 2
    case "neutral":
    default:
      return 1
  }
}
