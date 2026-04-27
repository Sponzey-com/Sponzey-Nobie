import { pickUiText, type UiLanguage } from "../stores/uiLanguage"

export type AdvancedSettingsTabId =
  | "ai"
  | "orchestration"
  | "channels"
  | "yeonjang"
  | "memory"
  | "schedules"
  | "tool_permissions"
  | "release"

export interface AdvancedSettingsTabDefinition {
  id: AdvancedSettingsTabId
  label: string
  description: string
  capabilityKey: string
  savesDraft: boolean
}

export const ADVANCED_SETTINGS_TAB_ORDER: AdvancedSettingsTabId[] = [
  "ai",
  "orchestration",
  "channels",
  "yeonjang",
  "memory",
  "schedules",
  "tool_permissions",
  "release",
]

export function buildAdvancedSettingsTabs(language: UiLanguage): AdvancedSettingsTabDefinition[] {
  const t = (ko: string, en: string) => pickUiText(language, ko, en)
  return [
    {
      id: "ai",
      label: t("AI 연결", "AI connection"),
      description: t("단일 AI provider, endpoint, 기본 모델, 인증 상태를 관리합니다.", "Manage the single AI provider, endpoint, default model, and credential state."),
      capabilityKey: "ai.backends",
      savesDraft: true,
    },
    {
      id: "orchestration",
      label: t("오케스트레이션", "Orchestration"),
      description: t("마스터 노비와 서브 에이전트 실행 모드를 설정합니다.", "Configure master Nobie and sub-agent execution mode."),
      capabilityKey: "settings.control",
      savesDraft: false,
    },
    {
      id: "channels",
      label: t("채널", "Channels"),
      description: t("WebUI, Telegram, Slack 연결 정보와 smoke 확인을 관리합니다.", "Manage WebUI, Telegram, Slack connection details and smoke checks."),
      capabilityKey: "telegram.channel",
      savesDraft: true,
    },
    {
      id: "yeonjang",
      label: t("연장", "Yeonjang"),
      description: t("MQTT 브로커, 연결 노드, capability, 재연결 상태를 확인합니다.", "Inspect MQTT broker, connected nodes, capabilities, and reconnect state."),
      capabilityKey: "mqtt.broker",
      savesDraft: true,
    },
    {
      id: "memory",
      label: t("메모리", "Memory"),
      description: t("메모리 scope, writeback 후보, 검색 품질 상태를 확인합니다.", "Inspect memory scopes, writeback candidates, and retrieval quality."),
      capabilityKey: "settings.control",
      savesDraft: false,
    },
    {
      id: "schedules",
      label: t("스케줄", "Schedules"),
      description: t("예약 실행 상태와 다음 실행 예정 작업을 확인합니다.", "Inspect scheduled execution health and upcoming runs."),
      capabilityKey: "scheduler.core",
      savesDraft: false,
    },
    {
      id: "tool_permissions",
      label: t("도구 권한", "Tool permissions"),
      description: t("승인 정책, 외부 도구 연결, 활성 지침을 관리합니다.", "Manage approval policy, external tool connections, and active instructions."),
      capabilityKey: "settings.control",
      savesDraft: true,
    },
    {
      id: "release",
      label: t("백업/배포", "Backup and release"),
      description: t("버전, 업데이트, DB 백업, 설정 내보내기, 마이그레이션 상태를 확인합니다.", "Inspect version, updates, DB backup, config export, and migration state."),
      capabilityKey: "settings.control",
      savesDraft: false,
    },
  ]
}

export function isDraftSavingAdvancedSettingsTab(tabId: AdvancedSettingsTabId): boolean {
  return buildAdvancedSettingsTabs("ko").find((tab) => tab.id === tabId)?.savesDraft === true
}

export function hasMultipleAiConnectionCreationTab(tabs: AdvancedSettingsTabDefinition[]): boolean {
  return tabs.some((tab) => /add.*ai|new.*ai|multi.*ai|새.*ai|여러.*ai/i.test(`${tab.id} ${tab.label} ${tab.description}`))
}

export function resolveAdvancedSettingsTabFromPath(pathname: string): AdvancedSettingsTabId {
  const normalized = pathname.toLowerCase()
  if (normalized.startsWith("/advanced/channels")) return "channels"
  if (normalized.startsWith("/advanced/orchestration")) return "orchestration"
  if (normalized.startsWith("/advanced/extensions")) return "yeonjang"
  if (normalized.startsWith("/advanced/memory")) return "memory"
  if (normalized.startsWith("/advanced/tools")) return "tool_permissions"
  if (normalized.startsWith("/advanced/release")) return "release"
  if (normalized.startsWith("/advanced/ai")) return "ai"
  return "ai"
}

export function resolveAdvancedSettingsPath(tabId: AdvancedSettingsTabId): string {
  switch (tabId) {
    case "channels":
      return "/advanced/channels"
    case "orchestration":
      return "/advanced/orchestration"
    case "yeonjang":
      return "/advanced/extensions"
    case "memory":
      return "/advanced/memory"
    case "schedules":
      return "/advanced/schedules"
    case "tool_permissions":
      return "/advanced/tools"
    case "release":
      return "/advanced/release"
    case "ai":
    default:
      return "/advanced/ai"
  }
}
