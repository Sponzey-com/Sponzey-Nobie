export type UiRouteMode = "beginner" | "advanced" | "admin"
export type UiRouteMigrationStatus = "kept" | "redirect" | "compatibility" | "deprecated"

export interface UiRouteInventoryItem {
  path: string
  mode: UiRouteMode
  component: string
  apiCalls: string[]
  status: UiRouteMigrationStatus
  replacementPath: string | null
  notes: string
}

export interface UiRouteMigrationResult {
  from: string
  to: string
  mode: UiRouteMode
  status: UiRouteMigrationStatus
  component: string
}

const UI_ROUTE_INVENTORY: UiRouteInventoryItem[] = [
  { path: "/", mode: "beginner", component: "Navigate", apiCalls: ["/api/setup/state", "/api/ui/shell"], status: "kept", replacementPath: null, notes: "Setup completion decides the landing page." },
  { path: "/setup", mode: "beginner", component: "SetupPage", apiCalls: ["/api/setup", "/api/setup/checks", "/api/ui/shell"], status: "kept", replacementPath: null, notes: "First-run setup remains shared by beginner and advanced users." },
  { path: "/chat", mode: "beginner", component: "ChatPage", apiCalls: ["/api/chat", "/api/runs", "/api/ui/shell"], status: "kept", replacementPath: null, notes: "Beginner chat is the primary entry point." },
  { path: "/tasks", mode: "beginner", component: "BeginnerTasksPage", apiCalls: ["/api/ui/shell"], status: "compatibility", replacementPath: "/advanced/runs", notes: "Compact work summary with an advanced details path." },
  { path: "/status", mode: "beginner", component: "BeginnerStatusPage", apiCalls: ["/api/ui/shell", "/api/status"], status: "kept", replacementPath: null, notes: "Connection summary for non-technical users." },

  { path: "/dashboard", mode: "advanced", component: "DashboardPage", apiCalls: ["/api/status", "/api/doctor"], status: "redirect", replacementPath: "/advanced/dashboard", notes: "Legacy diagnostics URL." },
  { path: "/runs", mode: "advanced", component: "RunsPage", apiCalls: ["/api/runs"], status: "redirect", replacementPath: "/advanced/runs", notes: "Legacy execution monitor URL." },
  { path: "/audit", mode: "advanced", component: "AuditPage", apiCalls: ["/api/audit"], status: "redirect", replacementPath: "/advanced/audit", notes: "Legacy audit URL." },
  { path: "/schedules", mode: "advanced", component: "SchedulePage", apiCalls: ["/api/schedules"], status: "redirect", replacementPath: "/advanced/schedules", notes: "Legacy schedule URL." },
  { path: "/plugins", mode: "advanced", component: "PluginsPage", apiCalls: ["/api/plugins"], status: "redirect", replacementPath: "/advanced/plugins", notes: "Legacy plugin URL." },
  { path: "/settings", mode: "advanced", component: "SettingsPage", apiCalls: ["/api/config", "/api/setup"], status: "redirect", replacementPath: "/advanced/settings", notes: "Legacy all-settings URL." },
  { path: "/ai", mode: "advanced", component: "SettingsPage", apiCalls: ["/api/config", "/api/setup/ai"], status: "deprecated", replacementPath: "/advanced/ai", notes: "Old direct AI setup URL." },
  { path: "/channels", mode: "advanced", component: "SettingsPage", apiCalls: ["/api/config", "/api/channels"], status: "deprecated", replacementPath: "/advanced/channels", notes: "Old direct channel setup URL." },
  { path: "/extensions", mode: "advanced", component: "SettingsPage", apiCalls: ["/api/config", "/api/mqtt"], status: "deprecated", replacementPath: "/advanced/extensions", notes: "Old direct Yeonjang setup URL." },
  { path: "/memory", mode: "advanced", component: "SettingsPage", apiCalls: ["/api/config", "/api/memory"], status: "deprecated", replacementPath: "/advanced/memory", notes: "Old direct memory setup URL." },
  { path: "/tools", mode: "advanced", component: "SettingsPage", apiCalls: ["/api/config", "/api/capabilities"], status: "deprecated", replacementPath: "/advanced/tools", notes: "Old direct tool permission URL." },
  { path: "/release", mode: "advanced", component: "SettingsPage", apiCalls: ["/api/update"], status: "deprecated", replacementPath: "/advanced/release", notes: "Old direct release URL." },

  { path: "/advanced/chat", mode: "advanced", component: "ChatPage", apiCalls: ["/api/chat", "/api/runs"], status: "kept", replacementPath: null, notes: "Advanced chat uses the existing conversation surface." },
  { path: "/advanced/runs", mode: "advanced", component: "RunsPage", apiCalls: ["/api/runs"], status: "kept", replacementPath: null, notes: "Full execution monitor." },
  { path: "/advanced/ai", mode: "advanced", component: "SettingsPage", apiCalls: ["/api/config", "/api/setup/ai"], status: "kept", replacementPath: null, notes: "Advanced AI configuration." },
  { path: "/advanced/channels", mode: "advanced", component: "SettingsPage", apiCalls: ["/api/config", "/api/channels"], status: "kept", replacementPath: null, notes: "Advanced channel configuration." },
  { path: "/advanced/extensions", mode: "advanced", component: "SettingsPage", apiCalls: ["/api/config", "/api/mqtt"], status: "kept", replacementPath: null, notes: "Advanced Yeonjang configuration." },
  { path: "/advanced/schedules", mode: "advanced", component: "SchedulePage", apiCalls: ["/api/schedules"], status: "kept", replacementPath: null, notes: "Advanced schedule management." },
  { path: "/advanced/memory", mode: "advanced", component: "SettingsPage", apiCalls: ["/api/config", "/api/memory"], status: "kept", replacementPath: null, notes: "Advanced memory configuration." },
  { path: "/advanced/tools", mode: "advanced", component: "SettingsPage", apiCalls: ["/api/config", "/api/capabilities"], status: "kept", replacementPath: null, notes: "Advanced tool permission configuration." },
  { path: "/advanced/dashboard", mode: "advanced", component: "DashboardPage", apiCalls: ["/api/status", "/api/doctor"], status: "kept", replacementPath: null, notes: "Advanced diagnostics." },
  { path: "/advanced/release", mode: "advanced", component: "SettingsPage", apiCalls: ["/api/update"], status: "kept", replacementPath: null, notes: "Advanced release and version view." },
  { path: "/advanced/settings", mode: "advanced", component: "SettingsPage", apiCalls: ["/api/config", "/api/setup"], status: "kept", replacementPath: null, notes: "Full settings compatibility page." },
  { path: "/advanced/audit", mode: "advanced", component: "AuditPage", apiCalls: ["/api/audit"], status: "kept", replacementPath: null, notes: "Audit viewer." },
  { path: "/advanced/plugins", mode: "advanced", component: "PluginsPage", apiCalls: ["/api/plugins"], status: "kept", replacementPath: null, notes: "Plugin management." },
  { path: "/admin", mode: "admin", component: "AdminShellPage", apiCalls: ["/api/admin/*"], status: "kept", replacementPath: null, notes: "Available only when the explicit admin runtime flag is enabled." },
]

function normalizePathname(pathname: string): string {
  const trimmed = pathname.trim() || "/"
  if (trimmed === "/") return "/"
  return trimmed.replace(/\/+$/, "")
}

function appendPathSuffix(target: string, source: string, base: string): string {
  const suffix = source.slice(base.length)
  return suffix.startsWith("/") ? `${target}${suffix}` : target
}

export function getUiRouteInventory(): UiRouteInventoryItem[] {
  return UI_ROUTE_INVENTORY.map((item) => ({ ...item, apiCalls: [...item.apiCalls] }))
}

export function getDeprecatedUiRoutes(): UiRouteInventoryItem[] {
  return getUiRouteInventory().filter((item) => item.status === "deprecated")
}

export function resolveRouteMigration(pathname: string): UiRouteMigrationResult | null {
  const normalized = normalizePathname(pathname)
  for (const item of UI_ROUTE_INVENTORY) {
    const base = normalizePathname(item.path)
    if (normalized !== base && !normalized.startsWith(`${base}/`)) continue
    if (item.status !== "redirect" && item.status !== "deprecated") return null
    if (!item.replacementPath) return null
    return {
      from: normalized,
      to: appendPathSuffix(item.replacementPath, normalized, base),
      mode: item.mode,
      status: item.status,
      component: item.component,
    }
  }
  return null
}

export function resolveLegacyAdvancedRoute(pathname: string): string | null {
  return resolveRouteMigration(pathname)?.to ?? null
}

export function resolveRollbackRoute(pathname: string): string {
  const normalized = normalizePathname(pathname)
  const migrated = resolveRouteMigration(normalized)
  if (migrated) return migrated.to
  if (normalized === "/" || normalized === "/chat" || normalized === "/tasks" || normalized === "/status") return "/advanced/dashboard"
  if (normalized === "/setup") return "/advanced/settings"
  return normalized
}
