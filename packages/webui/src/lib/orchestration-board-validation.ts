import type { TopologyEditorGate } from "./setup-visualization-topology"
import type { BoardValidationIssue, BoardValidationSnapshot, OrchestrationBoardDraft } from "./orchestration-board"
import { materializeOrchestrationBoardDraft } from "./orchestration-board"
import { isLegacyOrchestrationId, isOrchestrationEntityId } from "./orchestration-id"
import { pickUiText, type UiLanguage } from "../stores/uiLanguage"

export interface OrchestrationBoardValidationResult {
  snapshot: BoardValidationSnapshot
  summary: {
    errorCount: number
    warningCount: number
    infoCount: number
    blocking: boolean
  }
}

export interface BoardValidationCategorySummary {
  category: BoardValidationIssue["category"]
  label: string
  count: number
  blocking: boolean
}

export function validateOrchestrationBoard(input: {
  draft: OrchestrationBoardDraft
  gate: Pick<TopologyEditorGate, "status" | "canEdit" | "canPersist" | "message" | "reasons">
  language: UiLanguage
  now?: number
}): OrchestrationBoardValidationResult {
  const { draft, gate, language } = input
  const t = (ko: string, en: string) => pickUiText(language, ko, en)
  const issues: BoardValidationIssue[] = []
  const materialized = materializeOrchestrationBoardDraft({ draft })
  const duplicateAgentIds = findDuplicateIds(draft.agents.map((agent) => agent.agentId))
  const duplicateTeamIds = findDuplicateIds(draft.teams.map((team) => team.teamId))

  if (!gate.canEdit || !gate.canPersist) {
    issues.push({
      severity: "error",
      category: "runtime_prerequisite",
      code: "write_gate_locked",
      targetType: "board",
      targetId: "gate:write",
      message: gate.message,
    })
    for (const reason of gate.reasons) {
      issues.push({
        severity: "info",
        category: "runtime_prerequisite",
        code: "write_gate_reason",
        targetType: "board",
        targetId: "gate:reason",
        message: reason,
      })
    }
  }

  for (const agent of draft.agents) {
    if (!isValidBoardId(agent.agentId, "agent")) {
      issues.push({
        severity: "error",
        category: "field",
        code: "invalid_agent_id",
        targetType: "agent",
        targetId: agent.agentId,
        field: "agentId",
        message: t("에이전트 ID는 `agent-...` 형식 또는 기존 legacy ID만 허용됩니다.", "Agent IDs must use the `agent-...` format or an existing legacy ID."),
        agentId: agent.agentId,
      })
    }
    if (duplicateAgentIds.has(agent.agentId)) {
      issues.push({
        severity: "error",
        category: "field",
        code: "duplicate_agent_id",
        targetType: "agent",
        targetId: agent.agentId,
        field: "agentId",
        message: t(`중복된 에이전트 ID ${agent.agentId}`, `Duplicate agent ID ${agent.agentId}`),
        agentId: agent.agentId,
      })
    }
    if (!agent.config.displayName.trim()) {
      issues.push({
        severity: "error",
        category: "field",
        code: "missing_agent_name",
        targetType: "agent",
        targetId: agent.agentId,
        field: "displayName",
        message: t("에이전트 이름은 비어 있을 수 없습니다.", "Agent display name cannot be empty."),
        agentId: agent.agentId,
      })
    }
    if (!agent.config.role.trim()) {
      issues.push({
        severity: "error",
        category: "field",
        code: "missing_agent_role",
        targetType: "agent",
        targetId: agent.agentId,
        field: "role",
        message: t("에이전트 역할은 비어 있을 수 없습니다.", "Agent role cannot be empty."),
        agentId: agent.agentId,
      })
    }
    if (
      agent.config.capabilityPolicy.permissionProfile.riskCeiling === "dangerous"
      || agent.config.capabilityPolicy.permissionProfile.allowScreenControl
      || agent.config.capabilityPolicy.permissionProfile.allowShellExecution
    ) {
      issues.push({
        severity: "warning",
        category: "policy",
        code: "high_risk_agent",
        targetType: "agent",
        targetId: agent.agentId,
        message: t("고위험 권한을 가진 에이전트입니다. 저장 전 검토가 필요합니다.", "This agent carries high-risk permissions and should be reviewed before save."),
        agentId: agent.agentId,
      })
    }
  }

  for (const team of draft.teams) {
    if (!isValidBoardId(team.teamId, "team")) {
      issues.push({
        severity: "error",
        category: "field",
        code: "invalid_team_id",
        targetType: "team",
        targetId: team.teamId,
        field: "teamId",
        message: t("팀 ID는 `team-...` 형식 또는 기존 legacy ID만 허용됩니다.", "Team IDs must use the `team-...` format or an existing legacy ID."),
        teamId: team.teamId,
      })
    }
    if (duplicateTeamIds.has(team.teamId)) {
      issues.push({
        severity: "error",
        category: "field",
        code: "duplicate_team_id",
        targetType: "team",
        targetId: team.teamId,
        field: "teamId",
        message: t(`중복된 팀 ID ${team.teamId}`, `Duplicate team ID ${team.teamId}`),
        teamId: team.teamId,
      })
    }
    if (!team.config.displayName.trim()) {
      issues.push({
        severity: "error",
        category: "field",
        code: "missing_team_name",
        targetType: "team",
        targetId: team.teamId,
        field: "displayName",
        message: t("팀 이름은 비어 있을 수 없습니다.", "Team display name cannot be empty."),
        teamId: team.teamId,
      })
    }
    if (!team.config.purpose.trim()) {
      issues.push({
        severity: "error",
        category: "field",
        code: "missing_team_purpose",
        targetType: "team",
        targetId: team.teamId,
        field: "purpose",
        message: t("팀 목적은 비어 있을 수 없습니다.", "Team purpose cannot be empty."),
        teamId: team.teamId,
      })
    }
    if (team.config.memberAgentIds.length === 0) {
      issues.push({
        severity: "warning",
        category: "membership",
        code: "empty_team",
        targetType: "team",
        targetId: team.teamId,
        message: t("이 팀 lane에는 아직 멤버가 없습니다.", "This team lane does not contain members yet."),
        teamId: team.teamId,
      })
    }
  }

  for (const issue of materialized.membership.issues) {
    const linkId = `membership:${issue.teamId}:${issue.agentId}`
    issues.push({
      severity: issue.severity === "error" ? "error" : "warning",
      category: "membership",
      code: issue.code,
      targetType: "membership",
      targetId: linkId,
      message: issue.message,
      agentId: issue.agentId,
      teamId: issue.teamId,
    })
  }

  const snapshot: BoardValidationSnapshot = {
    generatedAt: input.now ?? Date.now(),
    issues,
  }

  return {
    snapshot,
    summary: {
      errorCount: issues.filter((issue) => issue.severity === "error").length,
      warningCount: issues.filter((issue) => issue.severity === "warning").length,
      infoCount: issues.filter((issue) => issue.severity === "info").length,
      blocking: issues.some((issue) => issue.severity === "error"),
    },
  }
}

export function findValidationIssuesForAgent(snapshot: BoardValidationSnapshot | null | undefined, agentId: string): BoardValidationIssue[] {
  return (snapshot?.issues ?? []).filter((issue) => issue.targetType === "agent"
    ? issue.targetId === agentId
    : issue.agentId === agentId)
}

export function findValidationIssuesForTeam(snapshot: BoardValidationSnapshot | null | undefined, teamId: string): BoardValidationIssue[] {
  return (snapshot?.issues ?? []).filter((issue) => issue.targetType === "team"
    ? issue.targetId === teamId
    : issue.teamId === teamId)
}

export function summarizeBoardValidationCategories(
  snapshot: BoardValidationSnapshot | null | undefined,
  language: UiLanguage,
): BoardValidationCategorySummary[] {
  const issues = snapshot?.issues ?? []
  const counts = new Map<BoardValidationIssue["category"], { count: number; blocking: boolean }>()

  for (const issue of issues) {
    const current = counts.get(issue.category) ?? { count: 0, blocking: false }
    counts.set(issue.category, {
      count: current.count + 1,
      blocking: current.blocking || issue.severity === "error",
    })
  }

  return ([
    "field",
    "membership",
    "policy",
    "runtime_prerequisite",
  ] as const)
    .map((category) => {
      const summary = counts.get(category)
      if (!summary) return null
      return {
        category,
        label: formatBoardValidationCategoryLabel(category, language),
        count: summary.count,
        blocking: summary.blocking,
      }
    })
    .filter(Boolean) as BoardValidationCategorySummary[]
}

export function formatBoardValidationCategoryLabel(
  category: BoardValidationIssue["category"],
  language: UiLanguage,
): string {
  const t = (ko: string, en: string) => pickUiText(language, ko, en)
  switch (category) {
    case "field":
      return t("field", "field")
    case "membership":
      return t("membership", "membership")
    case "policy":
      return t("policy", "policy")
    case "runtime_prerequisite":
      return t("runtime prerequisite", "runtime prerequisite")
    default:
      return category
  }
}

function isValidBoardId(value: string, kind: "agent" | "team"): boolean {
  return isOrchestrationEntityId(value, kind) || isLegacyOrchestrationId(value)
}

function findDuplicateIds(values: string[]): Set<string> {
  const counts = new Map<string, number>()
  for (const value of values.map((item) => item.trim()).filter(Boolean)) {
    counts.set(value, (counts.get(value) ?? 0) + 1)
  }
  return new Set(Array.from(counts.entries()).filter(([, count]) => count > 1).map(([value]) => value))
}
