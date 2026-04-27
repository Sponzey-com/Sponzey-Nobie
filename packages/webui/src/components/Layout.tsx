import { Link, useLocation, useNavigate } from "react-router-dom"
import { uiCatalogText } from "../lib/message-catalog"
import { useUiI18n } from "../lib/ui-i18n"
import { getUiNavigation, resolveModeSwitchRoute } from "../lib/ui-mode"
import { useCapabilitiesStore } from "../stores/capabilities"
import { useConnectionStore } from "../stores/connection"
import { useRunsStore } from "../stores/runs"
import { useChatStore } from "../stores/chat"
import { useSetupStore } from "../stores/setup"
import { pickUiText, useUiLanguageStore } from "../stores/uiLanguage"
import { useUiModeStore } from "../stores/uiMode"
import { CapabilityBadge } from "./CapabilityBadge"
import { CommandPalette } from "./CommandPalette"
import { UiLanguageSwitcher } from "./UiLanguageSwitcher"

function isActive(pathname: string, itemPath: string) {
  return pathname === itemPath || pathname.startsWith(`${itemPath}/`)
}

export function Layout({ children }: { children: React.ReactNode }) {
  const location = useLocation()
  const navigate = useNavigate()
  const uiLanguage = useUiLanguageStore((state) => state.language)
  const msg = (
    key: Parameters<typeof uiCatalogText>[1],
    params?: Record<string, string | number>,
  ) => uiCatalogText(uiLanguage, key, params)
  const { displayText } = useUiI18n()
  const connected = useConnectionStore((state) => state.connected)
  const adapter = useConnectionStore((state) => state.adapter)
  const connectionError = useConnectionStore((state) => state.lastError)
  const capabilities = useCapabilitiesStore((state) => state.items)
  const setupCompleted = useSetupStore((state) => state.state.completed)
  const mode = useUiModeStore((state) => state.mode)
  const preferredUiMode = useUiModeStore((state) => state.preferredUiMode)
  const adminEnabled = useUiModeStore((state) => state.adminEnabled)
  const shell = useUiModeStore((state) => state.shell)
  const chatSessionId = useChatStore((state) => state.sessionId)
  const setPreferredMode = useUiModeStore((state) => state.setPreferredMode)
  const storeActiveRuns = useRunsStore(
    (state) =>
      state.runs.filter((run) =>
        ["queued", "running", "awaiting_approval", "awaiting_user"].includes(run.status),
      ).length,
  )
  const visibleNav = getUiNavigation(mode, adminEnabled)
  const modeLabel =
    mode === "admin"
      ? msg("layout.mode.admin")
      : preferredUiMode === "advanced"
        ? msg("layout.mode.advanced")
        : msg("layout.mode.beginner")
  const shellComponents = shell?.viewModel.advanced.components ?? []
  const aiComponent = shellComponents.find((component) => component.key === "ai")
  const channelComponent = shellComponents.find((component) => component.key === "channels")
  const yeonjangComponent = shellComponents.find((component) => component.key === "yeonjang")
  const tasksComponent = shellComponents.find((component) => component.key === "tasks")
  const activeRuns =
    typeof tasksComponent?.configSummary.total === "number"
      ? tasksComponent.configSummary.total
      : storeActiveRuns

  async function handlePreferredModeChange(nextMode: "beginner" | "advanced") {
    if (preferredUiMode === nextMode) return
    const nextPath = resolveModeSwitchRoute(location.pathname, nextMode)
    await setPreferredMode(nextMode)
    if (nextPath !== location.pathname) {
      navigate(nextPath, { replace: true })
    }
  }

  return (
    <div className="flex h-screen flex-col bg-stone-100 text-stone-900 lg:flex-row">
      <aside className="relative z-[80] flex max-h-48 w-full shrink-0 flex-col border-b border-stone-200 bg-[#111111] text-stone-100 lg:max-h-none lg:w-72 lg:border-b-0 lg:border-r">
        <div className="border-b border-white/10 px-6 py-5">
          <div className="text-xs font-semibold uppercase tracking-[0.22em] text-stone-500">
            {msg("layout.brand.eyebrow")}
          </div>
          <div className="mt-2 text-lg font-semibold">스폰지 노비 · Sponzey Nobie</div>
          <div className="mt-3 flex items-center gap-2 text-xs text-stone-400">
            <span
              className={`h-2 w-2 rounded-full ${connected ? "bg-emerald-400" : "bg-red-400"}`}
            />
            <span>
              {connected ? msg("layout.gateway.connected") : msg("layout.gateway.disconnected")}
            </span>
          </div>
          <UiLanguageSwitcher className="mt-4 border-white/10 bg-white/5" />
          <CommandPalette threadId={chatSessionId ?? "default"} />
          <div className="mt-3 rounded-2xl border border-white/10 bg-white/5 p-3 text-xs text-stone-400">
            <div className="flex items-center justify-between gap-2">
              <span>{msg("layout.currentMode")}</span>
              <span className="rounded-full bg-stone-800 px-2 py-1 text-stone-100">
                {modeLabel}
              </span>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => void handlePreferredModeChange("beginner")}
                className={`rounded-xl px-3 py-2 font-semibold ${preferredUiMode === "beginner" ? "bg-white text-stone-900" : "bg-white/5 text-stone-300"}`}
              >
                {msg("layout.mode.beginner")}
              </button>
              <button
                type="button"
                onClick={() => void handlePreferredModeChange("advanced")}
                className={`rounded-xl px-3 py-2 font-semibold ${preferredUiMode === "advanced" ? "bg-white text-stone-900" : "bg-white/5 text-stone-300"}`}
              >
                {msg("layout.mode.advanced")}
              </button>
            </div>
          </div>
          {adminEnabled ? (
            <div className="mt-3 rounded-2xl border border-red-400/30 bg-red-500/10 p-3 text-xs leading-5 text-red-100">
              {msg("admin.shell.sidebarWarning")}
            </div>
          ) : null}
          {mode !== "beginner" ? (
            <div className="mt-2 text-xs text-stone-500">adapter: {adapter}</div>
          ) : null}
          <div className="mt-2 grid gap-1 text-xs text-stone-500">
            <div>
              {msg("layout.status.ai")}:{" "}
              {aiComponent?.statusLabel ?? msg("beginner.status.needsCheck")}
            </div>
            <div>
              {msg("layout.status.channel")}:{" "}
              {channelComponent?.statusLabel ?? msg("layout.status.webui")}
            </div>
            <div>
              {msg("layout.status.yeonjang")}:{" "}
              {yeonjangComponent?.statusLabel ?? pickUiText(uiLanguage, "대기 중", "Idle")}
            </div>
          </div>
          {!connected && connectionError ? (
            <div className="mt-2 text-xs leading-5 text-red-300">
              {displayText(connectionError)}
            </div>
          ) : null}
        </div>

        <nav className="flex-1 overflow-y-auto px-3 py-4">
          <div className="mb-3 px-3 text-[11px] font-semibold uppercase tracking-[0.2em] text-stone-500">
            {msg("layout.nav.title")}
          </div>
          <div className="space-y-1">
            {visibleNav.map((item) => {
              const capability = item.capabilityKey
                ? capabilities.find((candidate) => candidate.key === item.capabilityKey)
                : undefined
              const active = isActive(location.pathname, item.path)
              const itemLabel = pickUiText(uiLanguage, item.labelKo, item.labelEn)
              return (
                <Link
                  key={item.path}
                  to={item.path}
                  className={`block rounded-2xl border px-3 py-3 transition ${
                    active
                      ? "border-stone-700 bg-stone-800 text-white"
                      : "border-transparent text-stone-300 hover:border-white/10 hover:bg-white/5"
                  }`}
                >
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-sm font-medium">{itemLabel}</span>
                    {capability ? <CapabilityBadge status={capability.status} /> : null}
                  </div>
                  {item.path.endsWith("/runs") || item.path === "/tasks" ? (
                    <div className="mt-2 text-xs text-stone-500">
                      {msg("layout.activeRuns", { count: activeRuns })}
                    </div>
                  ) : item.descriptionKo || item.descriptionEn ? (
                    <div className="mt-2 text-xs text-stone-500">
                      {pickUiText(uiLanguage, item.descriptionKo ?? "", item.descriptionEn ?? "")}
                    </div>
                  ) : capability?.reason ? (
                    <div className="mt-2 line-clamp-2 text-xs leading-5 text-stone-500">
                      {displayText(capability.reason)}
                    </div>
                  ) : (
                    <div className="mt-2 text-xs text-stone-500">
                      {capability?.label ?? pickUiText(uiLanguage, "준비 중", "Coming soon")}
                    </div>
                  )}
                </Link>
              )
            })}
          </div>
        </nav>

        <div className="border-t border-white/10 px-6 py-4">
          <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-stone-500">
            {msg("layout.status.title")}
          </div>
          <div className="mt-2 text-sm text-stone-300">
            {setupCompleted ? msg("layout.status.ready") : msg("layout.status.setupRequired")}
          </div>
        </div>
      </aside>

      <main className="relative z-0 min-h-0 min-w-0 flex-1 overflow-hidden">{children}</main>
    </div>
  )
}
