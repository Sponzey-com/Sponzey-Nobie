import type { UiMode } from "../api/client"
import {
  type UiRouteInventoryItem,
  type UiRouteMigrationResult,
  getDeprecatedUiRoutes,
  getUiRouteInventory,
  resolveLegacyAdvancedRoute,
  resolveModeSwitchRoute,
  resolveRollbackRoute,
  resolveRouteMigration,
} from "./route-migration"

export {
  getDeprecatedUiRoutes,
  getUiRouteInventory,
  resolveLegacyAdvancedRoute,
  resolveModeSwitchRoute,
  resolveRollbackRoute,
  resolveRouteMigration,
  type UiRouteInventoryItem,
  type UiRouteMigrationResult,
}

export interface UiNavItem {
  path: string
  labelKo: string
  labelEn: string
  capabilityKey?: string
  descriptionKo?: string
  descriptionEn?: string
  adminOnly?: boolean
}

const BEGINNER_NAV: UiNavItem[] = [
  {
    path: "/chat",
    labelKo: "홈/채팅",
    labelEn: "Home / Chat",
    capabilityKey: "chat.workspace",
    descriptionKo: "요청과 결과 확인",
    descriptionEn: "Requests and results",
  },
  {
    path: "/setup",
    labelKo: "처음 설정",
    labelEn: "First setup",
    capabilityKey: "setup.wizard",
    descriptionKo: "필수 연결 구성",
    descriptionEn: "Required connections",
  },
  {
    path: "/tasks",
    labelKo: "작업 확인",
    labelEn: "Tasks",
    capabilityKey: "runs.monitor",
    descriptionKo: "진행 중 작업 요약",
    descriptionEn: "Active task summary",
  },
  {
    path: "/status",
    labelKo: "연결 상태",
    labelEn: "Status",
    capabilityKey: "dashboard.overview",
    descriptionKo: "연결 상태 요약",
    descriptionEn: "Connection summary",
  },
]

const ADVANCED_NAV: UiNavItem[] = [
  { path: "/advanced/chat", labelKo: "대화", labelEn: "Chat", capabilityKey: "chat.workspace" },
  { path: "/advanced/runs", labelKo: "실행 현황", labelEn: "Runs", capabilityKey: "runs.monitor" },
  {
    path: "/advanced/topology",
    labelKo: "토폴로지",
    labelEn: "Topology",
    capabilityKey: "settings.control",
  },
  {
    path: "/advanced/ai",
    labelKo: "AI 연결",
    labelEn: "AI Connections",
    capabilityKey: "ai.backends",
  },
  {
    path: "/advanced/channels",
    labelKo: "채널",
    labelEn: "Channels",
    capabilityKey: "telegram.channel",
  },
  {
    path: "/advanced/extensions",
    labelKo: "연장",
    labelEn: "Extensions",
    capabilityKey: "mqtt.broker",
  },
  {
    path: "/advanced/schedules",
    labelKo: "스케줄",
    labelEn: "Schedules",
    capabilityKey: "scheduler.core",
  },
  {
    path: "/advanced/memory",
    labelKo: "메모리",
    labelEn: "Memory",
    capabilityKey: "memory.semantic_search",
  },
  {
    path: "/advanced/tools",
    labelKo: "도구 권한",
    labelEn: "Tool Permissions",
    capabilityKey: "settings.control",
  },
  {
    path: "/advanced/dashboard",
    labelKo: "진단",
    labelEn: "Diagnostics",
    capabilityKey: "dashboard.overview",
  },
  {
    path: "/advanced/release",
    labelKo: "배포/버전",
    labelEn: "Release / Version",
    capabilityKey: "dashboard.overview",
  },
  {
    path: "/advanced/audit",
    labelKo: "감사 기록",
    labelEn: "Audit",
    capabilityKey: "audit.viewer",
  },
  {
    path: "/advanced/plugins",
    labelKo: "플러그인",
    labelEn: "Plugins",
    capabilityKey: "plugins.runtime",
  },
]

const ADMIN_NAV: UiNavItem[] = [
  {
    path: "/admin",
    labelKo: "Admin",
    labelEn: "Admin",
    descriptionKo: "개발자 진단 도구",
    descriptionEn: "Developer diagnostics",
    adminOnly: true,
  },
]

export function getUiNavigation(mode: UiMode, adminEnabled: boolean): UiNavItem[] {
  if (mode === "advanced" || mode === "admin")
    return adminEnabled ? [...ADVANCED_NAV, ...ADMIN_NAV] : ADVANCED_NAV
  return adminEnabled ? [...BEGINNER_NAV, ...ADMIN_NAV] : BEGINNER_NAV
}

export function isAdvancedRoute(pathname: string): boolean {
  return pathname === "/advanced" || pathname.startsWith("/advanced/")
}

export function isAdminRoute(pathname: string): boolean {
  return pathname === "/admin" || pathname.startsWith("/admin/")
}
