import { Link, useLocation } from "react-router-dom"
import { CapabilityBadge } from "./CapabilityBadge"
import { UiLanguageSwitcher } from "./UiLanguageSwitcher"
import { useCapabilitiesStore } from "../stores/capabilities"
import { useConnectionStore } from "../stores/connection"
import { useRunsStore } from "../stores/runs"
import { useSetupStore } from "../stores/setup"
import { pickUiText, useUiLanguageStore } from "../stores/uiLanguage"
import { useUiI18n } from "../lib/ui-i18n"

const NAV = [
  { path: "/setup", labelKo: "설정", labelEn: "Setup", capabilityKey: "setup.wizard" },
  { path: "/dashboard", labelKo: "대시보드", labelEn: "Dashboard", capabilityKey: "dashboard.overview" },
  { path: "/chat", labelKo: "채팅", labelEn: "Chat", capabilityKey: "chat.workspace" },
  { path: "/runs", labelKo: "작업 실행", labelEn: "Runs", capabilityKey: "runs.monitor" },
  { path: "/audit", labelKo: "감사 기록", labelEn: "Audit", capabilityKey: "audit.viewer" },
  { path: "/schedules", labelKo: "예약 작업", labelEn: "Schedules", capabilityKey: "scheduler.core" },
  { path: "/plugins", labelKo: "플러그인", labelEn: "Plugins", capabilityKey: "plugins.runtime" },
  { path: "/settings", labelKo: "설정", labelEn: "Settings", capabilityKey: "settings.control" },
]

function isActive(pathname: string, itemPath: string) {
  return pathname === itemPath || pathname.startsWith(`${itemPath}/`)
}

export function Layout({ children }: { children: React.ReactNode }) {
  const location = useLocation()
  const uiLanguage = useUiLanguageStore((state) => state.language)
  const { displayText } = useUiI18n()
  const connected = useConnectionStore((state) => state.connected)
  const adapter = useConnectionStore((state) => state.adapter)
  const connectionError = useConnectionStore((state) => state.lastError)
  const capabilities = useCapabilitiesStore((state) => state.items)
  const setupCompleted = useSetupStore((state) => state.state.completed)
  const activeRuns = useRunsStore((state) =>
    state.runs.filter((run) => ["queued", "running", "awaiting_approval", "awaiting_user"].includes(run.status)).length,
  )
  const visibleNav = setupCompleted ? NAV.filter((item) => item.path !== "/setup") : NAV

  if (location.pathname.startsWith("/setup")) {
    return <main className="min-h-screen bg-stone-100">{children}</main>
  }

  return (
    <div className="flex h-screen bg-stone-100 text-stone-900">
      <aside className="flex w-72 shrink-0 flex-col border-r border-stone-200 bg-[#111111] text-stone-100">
        <div className="border-b border-white/10 px-6 py-5">
          <div className="text-xs font-semibold uppercase tracking-[0.22em] text-stone-500">WebUI First</div>
          <div className="mt-2 text-lg font-semibold">스폰지 노비 · Sponzey Nobie</div>
          <div className="mt-3 flex items-center gap-2 text-xs text-stone-400">
            <span className={`h-2 w-2 rounded-full ${connected ? "bg-emerald-400" : "bg-red-400"}`} />
            <span>
              {connected
                ? pickUiText(uiLanguage, "Gateway 연결됨", "Gateway connected")
                : pickUiText(uiLanguage, "Gateway 연결 안 됨", "Gateway disconnected")}
            </span>
          </div>
          <UiLanguageSwitcher className="mt-4 border-white/10 bg-white/5" />
          <div className="mt-2 text-xs text-stone-500">adapter: {adapter}</div>
          {!connected && connectionError ? <div className="mt-2 text-xs leading-5 text-red-300">{displayText(connectionError)}</div> : null}
        </div>

        <nav className="flex-1 overflow-y-auto px-3 py-4">
          <div className="mb-3 px-3 text-[11px] font-semibold uppercase tracking-[0.2em] text-stone-500">
            {pickUiText(uiLanguage, "제어 메뉴", "Control Plane")}
          </div>
          <div className="space-y-1">
            {visibleNav.map((item) => {
              const capability = capabilities.find((candidate) => candidate.key === item.capabilityKey)
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
                  {item.path === "/runs" ? (
                    <div className="mt-2 text-xs text-stone-500">
                      {pickUiText(uiLanguage, `활성 작업 ${activeRuns}`, `active runs ${activeRuns}`)}
                    </div>
                  ) : capability?.reason ? (
                    <div className="mt-2 line-clamp-2 text-xs leading-5 text-stone-500">{displayText(capability.reason)}</div>
                  ) : (
                    <div className="mt-2 text-xs text-stone-500">{capability?.label ?? "Phase 0001"}</div>
                  )}
                </Link>
              )
            })}
          </div>
        </nav>

        <div className="border-t border-white/10 px-6 py-4">
          <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-stone-500">Phase</div>
          <div className="mt-2 text-sm text-stone-300">
            {pickUiText(uiLanguage, "0002 · 로컬 제어 패널", "0002 · Local Control Plane")}
          </div>
        </div>
      </aside>

      <main className="min-w-0 flex-1 overflow-hidden">{children}</main>
    </div>
  )
}
