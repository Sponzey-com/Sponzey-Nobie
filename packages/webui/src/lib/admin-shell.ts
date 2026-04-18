import { uiCatalogText } from "./message-catalog"
import type { UiLanguage } from "../stores/uiLanguage"

export type AdminDangerousActionId = "retry" | "purge" | "replay" | "export"

export interface AdminShellBadgeView {
  label: string
  tone: "danger" | "warning" | "neutral"
}

export interface AdminDangerousActionView {
  id: AdminDangerousActionId
  label: string
  description: string
  requiredConfirmation: string
}

export interface AdminShellView {
  warning: string
  badges: AdminShellBadgeView[]
  actions: AdminDangerousActionView[]
  auditNotice: string
}

const ADMIN_DANGEROUS_ACTION_IDS: AdminDangerousActionId[] = ["retry", "purge", "replay", "export"]

export function adminConfirmationForAction(action: AdminDangerousActionId): string {
  return `CONFIRM ${action.toUpperCase()}`
}

export function buildAdminShellView(input: {
  language: UiLanguage
  adminEnabled: boolean
  subscriptionCount: number
}): AdminShellView {
  const msg = (key: Parameters<typeof uiCatalogText>[1], params?: Record<string, string | number>) => uiCatalogText(input.language, key, params)
  return {
    warning: msg("admin.shell.warning"),
    badges: [
      { label: msg("admin.shell.badge.enabled"), tone: input.adminEnabled ? "danger" : "neutral" },
      { label: msg("admin.shell.badge.audit"), tone: "warning" },
      { label: msg("admin.shell.badge.subscribers", { count: input.subscriptionCount }), tone: "neutral" },
    ],
    actions: ADMIN_DANGEROUS_ACTION_IDS.map((id) => ({
      id,
      label: msg(`admin.shell.action.${id}` as Parameters<typeof uiCatalogText>[1]),
      description: msg(`admin.shell.action.${id}Desc` as Parameters<typeof uiCatalogText>[1]),
      requiredConfirmation: adminConfirmationForAction(id),
    })),
    auditNotice: msg("admin.shell.auditRequired"),
  }
}
