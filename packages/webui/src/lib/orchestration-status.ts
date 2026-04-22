import type { OrchestrationAgentRegistryEntry } from "../contracts/orchestration-api"
import type { AgentStatus, SubAgentConfig } from "../contracts/sub-agent-orchestration"
import { pickUiText, type UiLanguage } from "../stores/uiLanguage"
import { riskText } from "./orchestration-ui"

export const ORCHESTRATION_EDITABLE_AGENT_STATUSES = ["disabled", "enabled", "archived"] as const

export type EditableOrchestrationAgentStatus = (typeof ORCHESTRATION_EDITABLE_AGENT_STATUSES)[number]

export function buildOrchestrationAgentConfigBadges(
  agent: Pick<OrchestrationAgentRegistryEntry, "status" | "permissionProfile">,
  language: UiLanguage,
): string[] {
  return [
    agent.status,
    riskText(agent.permissionProfile.riskCeiling, language),
  ]
}

export function buildOrchestrationAgentRuntimeBadges(
  agent: Pick<OrchestrationAgentRegistryEntry, "currentLoad">,
  language: UiLanguage,
): string[] {
  return [summarizeOrchestrationAgentRuntime(agent, language)]
}

export function summarizeOrchestrationAgentRuntime(
  agent: Pick<OrchestrationAgentRegistryEntry, "currentLoad">,
  language: UiLanguage,
): string {
  const t = (ko: string, en: string) => pickUiText(language, ko, en)
  if (agent.currentLoad.failedSubSessions > 0) return t("실패 감지", "Failed")
  if (agent.currentLoad.activeSubSessions > 0) return t("실행 중", "Running")
  if (agent.currentLoad.queuedSubSessions > 0) return t("대기열", "Queued")
  return t("유휴", "Idle")
}

export function resolveOrchestrationAgentTone(input: {
  agent: Pick<OrchestrationAgentRegistryEntry, "status" | "permissionProfile">
  diagnosticsCount?: number
}): "ready" | "warning" | "disabled" | "neutral" {
  const { agent, diagnosticsCount = 0 } = input
  const highRisk = agent.permissionProfile.riskCeiling === "dangerous"
    || agent.permissionProfile.allowScreenControl
    || agent.permissionProfile.allowShellExecution

  if (agent.status === "archived" || agent.status === "disabled") return "disabled"
  if (agent.status === "degraded" || highRisk || diagnosticsCount > 0) return "warning"
  if (agent.status === "enabled") return "ready"
  return "neutral"
}

export function buildOrchestrationAgentDetailBadges(input: {
  agent: Pick<OrchestrationAgentRegistryEntry, "status" | "delegationEnabled">
  diagnosticsCount?: number
  language: UiLanguage
}): string[] {
  const { agent, diagnosticsCount = 0, language } = input
  const t = (ko: string, en: string) => pickUiText(language, ko, en)

  return [
    agent.delegationEnabled ? t("위임 on", "Delegation on") : t("위임 off", "Delegation off"),
    ...(agent.status === "degraded" ? [t("복구 필요", "Recovery needed")] : []),
    ...(diagnosticsCount > 0 ? [`${diagnosticsCount} ${t("이슈", "issues")}`] : []),
  ]
}

export function buildOrchestrationAgentPolicySummary(config: SubAgentConfig, language: UiLanguage): string[] {
  const t = (ko: string, en: string) => pickUiText(language, ko, en)
  return [
    `${t("메모리", "Memory")} ${formatMemoryVisibility(config.memoryPolicy.visibility, language)}`,
    config.delegation.enabled ? t("위임 on", "Delegation on") : t("위임 off", "Delegation off"),
    `${t("병렬", "Parallel")} ${config.delegation.maxParallelSessions}`,
    `${t("동시 호출", "Concurrent")} ${config.capabilityPolicy.rateLimit.maxConcurrentCalls}`,
  ]
}

export function formatMemoryVisibility(
  visibility: SubAgentConfig["memoryPolicy"]["visibility"],
  language: UiLanguage,
): string {
  const t = (ko: string, en: string) => pickUiText(language, ko, en)
  switch (visibility) {
    case "coordinator_visible":
      return t("코디네이터 공유", "Coordinator visible")
    case "team_visible":
      return t("팀 공유", "Team visible")
    case "private":
    default:
      return t("private", "private")
  }
}

export function describeOrchestrationAgentDegradedRecovery(language: UiLanguage): string {
  return pickUiText(
    language,
    "degraded 상태는 일반 토글이 아니라 진단과 복구 흐름으로 다룹니다.",
    "Degraded is handled through diagnostics and recovery, not as a direct status toggle.",
  )
}

export function isEditableOrchestrationAgentStatus(status: AgentStatus): status is EditableOrchestrationAgentStatus {
  return ORCHESTRATION_EDITABLE_AGENT_STATUSES.includes(status as EditableOrchestrationAgentStatus)
}
