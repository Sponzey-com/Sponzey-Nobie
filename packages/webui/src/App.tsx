import { Suspense, lazy, useEffect, useState } from "react"
import { BrowserRouter, Link, Navigate, Route, Routes, useLocation } from "react-router-dom"
import {
  type AdminFixtureReplayResponse,
  type AdminLiveResponse,
  type AdminPlatformInspectorsResponse,
  type AdminRuntimeInspectorsResponse,
  type AdminShellResponse,
  type AdminToolLabResponse,
  api,
} from "./api/client"
import { connectWs, onWsConnect, onWsMessage } from "./api/ws"
import { Layout } from "./components/Layout"
import { buildAdminShellView } from "./lib/admin-shell"
import { uiCatalogText } from "./lib/message-catalog"
import { useUiI18n } from "./lib/ui-i18n"
import { resolveLegacyAdvancedRoute } from "./lib/ui-mode"
import { ChatPage } from "./pages/ChatPage"
import { LoginPage } from "./pages/LoginPage"
import { SetupPage } from "./pages/SetupPage"
import { useCapabilitiesStore } from "./stores/capabilities"
import { handleWsMessage, useChatStore } from "./stores/chat"
import { useConnectionStore } from "./stores/connection"
import { useRunsStore } from "./stores/runs"
import { useSetupStore } from "./stores/setup"
import { useUiModeStore } from "./stores/uiMode"

const DashboardPage = lazy(() =>
  import("./pages/DashboardPage").then((module) => ({ default: module.DashboardPage })),
)
const RunsPage = lazy(() =>
  import("./pages/RunsPage").then((module) => ({ default: module.RunsPage })),
)
const AuditPage = lazy(() =>
  import("./pages/AuditPage").then((module) => ({ default: module.AuditPage })),
)
const SchedulePage = lazy(() =>
  import("./pages/SchedulePage").then((module) => ({ default: module.SchedulePage })),
)
const SettingsPage = lazy(() =>
  import("./pages/SettingsPage").then((module) => ({ default: module.SettingsPage })),
)
const PluginsPage = lazy(() => import("./pages/PluginsPage"))
const TopologyPage = lazy(() =>
  import("./pages/TopologyPage").then((module) => ({ default: module.TopologyPage })),
)

function LegacyAdvancedRedirect({ from }: { from: string }) {
  const location = useLocation()
  const to = resolveLegacyAdvancedRoute(location.pathname) ?? from
  return <Navigate to={`${to}${location.search}${location.hash}`} replace />
}

function AdvancedModeNotice() {
  const { language } = useUiI18n()
  const msg = (
    key: Parameters<typeof uiCatalogText>[1],
    params?: Record<string, string | number>,
  ) => uiCatalogText(language, key, params)
  const setPreferredMode = useUiModeStore((state) => state.setPreferredMode)
  return (
    <div className="h-full overflow-y-auto bg-stone-100 p-6">
      <div className="mx-auto max-w-2xl rounded-[2rem] border border-stone-200 bg-white p-8 shadow-sm">
        <div className="text-xs font-semibold uppercase tracking-[0.18em] text-stone-400">
          {msg("advanced.notice.eyebrow")}
        </div>
        <h1 className="mt-3 text-2xl font-semibold text-stone-900">
          {msg("advanced.notice.title")}
        </h1>
        <p className="mt-3 text-sm leading-6 text-stone-600">
          {msg("advanced.notice.description")}
        </p>
        <div className="mt-6 flex flex-wrap gap-3">
          <button
            type="button"
            onClick={() => void setPreferredMode("advanced")}
            className="rounded-xl bg-stone-900 px-4 py-2.5 text-sm font-semibold text-white"
          >
            {msg("advanced.notice.switch")}
          </button>
          <Link
            to="/chat"
            className="rounded-xl border border-stone-200 px-4 py-2.5 text-sm font-semibold text-stone-700"
          >
            {msg("advanced.notice.backToChat")}
          </Link>
        </div>
      </div>
    </div>
  )
}

function AdvancedOnly({ children }: { children: React.ReactNode }) {
  const mode = useUiModeStore((state) => state.mode)
  if (mode === "beginner") return <AdvancedModeNotice />
  return <>{children}</>
}

function AdminOnly({ children }: { children: React.ReactNode }) {
  const adminEnabled = useUiModeStore((state) => state.adminEnabled)
  if (!adminEnabled) return <Navigate to="/chat" replace />
  return <>{children}</>
}

function RouteLoading() {
  const { text } = useUiI18n()
  return (
    <output
      className="flex h-full min-h-64 items-center justify-center bg-stone-100 p-6 text-sm text-stone-500"
      aria-live="polite"
    >
      {text("화면을 불러오는 중...", "Loading screen...")}
    </output>
  )
}

function LazyPage({ children }: { children: React.ReactNode }) {
  return <Suspense fallback={<RouteLoading />}>{children}</Suspense>
}

function AdminShellPage() {
  const { language } = useUiI18n()
  const msg = (
    key: Parameters<typeof uiCatalogText>[1],
    params?: Record<string, string | number>,
  ) => uiCatalogText(language, key, params)
  const adminEnabled = useUiModeStore((state) => state.adminEnabled)
  const [remoteShell, setRemoteShell] = useState<AdminShellResponse | null>(null)
  const [live, setLive] = useState<AdminLiveResponse | null>(null)
  const [toolLab, setToolLab] = useState<AdminToolLabResponse | null>(null)
  const [runtimeInspectors, setRuntimeInspectors] = useState<AdminRuntimeInspectorsResponse | null>(
    null,
  )
  const [platformInspectors, setPlatformInspectors] =
    useState<AdminPlatformInspectorsResponse | null>(null)
  const [fixtureReplay, setFixtureReplay] = useState<AdminFixtureReplayResponse | null>(null)
  const [fixtureReplayError, setFixtureReplayError] = useState("")
  const [fixtureReplayLoading, setFixtureReplayLoading] = useState(false)
  const [exportError, setExportError] = useState("")
  const [exportLoading, setExportLoading] = useState(false)
  const [loadError, setLoadError] = useState("")

  useEffect(() => {
    let mounted = true
    const load = async () => {
      try {
        const [
          shellResponse,
          liveResponse,
          toolLabResponse,
          runtimeInspectorsResponse,
          platformInspectorsResponse,
        ] = await Promise.all([
          api.adminShell(),
          api.adminLive({ limit: 120 }),
          api.adminToolLab({ limit: 120 }),
          api.adminRuntimeInspectors({ limit: 120 }),
          api.adminPlatformInspectors({ limit: 120 }),
        ])
        if (!mounted) return
        setRemoteShell(shellResponse)
        setLive(liveResponse)
        setToolLab(toolLabResponse)
        setRuntimeInspectors(runtimeInspectorsResponse)
        setPlatformInspectors(platformInspectorsResponse)
        setLoadError("")
      } catch (error) {
        if (!mounted) return
        setLoadError(error instanceof Error ? error.message : String(error))
      }
    }
    void load()
    const interval = window.setInterval(() => void load(), 3_000)
    const unsubscribe = onWsMessage((data) => {
      if (
        data.type === "control.event" ||
        data.type === "run.status" ||
        data.type === "run.progress" ||
        data.type === "run.completed" ||
        data.type === "run.failed"
      ) {
        void load()
      }
    })
    return () => {
      mounted = false
      window.clearInterval(interval)
      unsubscribe()
    }
  }, [])

  const shell = buildAdminShellView({
    language,
    adminEnabled,
    subscriptionCount: remoteShell?.shell.subscriptions.webSocketClients ?? 0,
  })
  const stream = live?.stream
  const recentTimeline = live?.timeline.events.slice(-12).reverse() ?? []
  const inspectedRuns = live?.runsInspector.runs.slice(0, 5) ?? []
  const ledgerEvents = live?.messageLedger.events.slice(-10).reverse() ?? []
  const toolCalls = toolLab?.toolCalls.calls.slice(0, 8) ?? []
  const retrievalSessions = toolLab?.webRetrieval.sessions.slice(0, 3) ?? []
  const memoryDocuments = runtimeInspectors?.memory.documents.items.slice(0, 5) ?? []
  const memoryWritebacks = runtimeInspectors?.memory.writebackQueue.items.slice(0, 5) ?? []
  const schedulerItems = runtimeInspectors?.scheduler.schedules.slice(0, 5) ?? []
  const channelMappings = runtimeInspectors?.channels.mappings.slice(0, 5) ?? []
  const approvalCallbacks = runtimeInspectors?.channels.approvalCallbacks.slice(0, 5) ?? []
  const yeonjangNodes = platformInspectors?.yeonjang.nodes.slice(0, 5) ?? []
  const yeonjangEvents = platformInspectors?.yeonjang.timelineLinks.slice(0, 5) ?? []
  const migrationDiagnostics = platformInspectors?.database.diagnostics.slice(0, 5) ?? []
  const exportJobs = platformInspectors?.exports.jobs.slice(0, 5) ?? []
  const formatClock = (value: number | null | undefined) =>
    value ? new Date(value).toLocaleTimeString() : "-"
  const formatDuration = (value: number | null | undefined) => (value == null ? "-" : `${value}`)
  const formatJson = (value: unknown) => JSON.stringify(value, null, 2)
  const runFixtureReplay = async () => {
    setFixtureReplayLoading(true)
    setFixtureReplayError("")
    try {
      setFixtureReplay(await api.adminFixtureReplay())
    } catch (error) {
      setFixtureReplayError(error instanceof Error ? error.message : String(error))
    } finally {
      setFixtureReplayLoading(false)
    }
  }
  const startDiagnosticExport = async () => {
    setExportLoading(true)
    setExportError("")
    try {
      await api.startAdminDiagnosticExport({
        includeTimeline: true,
        includeReport: true,
        limit: 500,
      })
      setPlatformInspectors(await api.adminPlatformInspectors({ limit: 120 }))
    } catch (error) {
      setExportError(error instanceof Error ? error.message : String(error))
    } finally {
      setExportLoading(false)
    }
  }

  return (
    <div className="h-full overflow-y-auto bg-stone-100 p-6">
      <div className="rounded-[2rem] bg-[#171717] p-8 text-white shadow-xl">
        <div className="text-xs font-semibold uppercase tracking-[0.22em] text-stone-500">
          {msg("admin.placeholder.eyebrow")}
        </div>
        <h1 className="mt-3 text-3xl font-semibold">{msg("admin.placeholder.title")}</h1>
        <p className="mt-3 max-w-3xl text-sm leading-6 text-stone-300">{shell.warning}</p>
        {loadError ? (
          <p className="mt-3 rounded-2xl border border-amber-400/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">
            {loadError}
          </p>
        ) : null}
        <div className="mt-6 flex flex-wrap gap-2">
          {shell.badges.map((badge) => (
            <span
              key={badge.label}
              className={`rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-[0.16em] ${
                badge.tone === "danger"
                  ? "bg-red-500/20 text-red-100 ring-1 ring-red-400/40"
                  : badge.tone === "warning"
                    ? "bg-amber-500/20 text-amber-100 ring-1 ring-amber-400/40"
                    : "bg-white/10 text-stone-200 ring-1 ring-white/10"
              }`}
            >
              {badge.label}
            </span>
          ))}
        </div>
      </div>

      <section className="mt-6 rounded-[2rem] border border-stone-200 bg-white p-8 shadow-sm">
        <div className="text-xs font-semibold uppercase tracking-[0.18em] text-stone-400">
          {msg("admin.live.title")}
        </div>
        <h2 className="mt-3 text-2xl font-semibold text-stone-950">{msg("admin.live.title")}</h2>
        <p className="mt-3 max-w-3xl text-sm leading-6 text-stone-600">
          {msg("admin.live.description")}
        </p>

        <div className="mt-6 grid gap-4 lg:grid-cols-3">
          <article className="rounded-3xl border border-stone-200 bg-stone-50 p-5">
            <div className="text-xs font-semibold uppercase tracking-[0.16em] text-stone-400">
              {msg("admin.live.streamTitle")}
            </div>
            <div className="mt-3 text-xl font-semibold text-stone-950">
              {msg("admin.live.streamStatus", { status: stream?.status ?? "unknown" })}
            </div>
            <p className="mt-2 text-sm text-stone-600">
              {msg("admin.live.reconnect", { eventType: stream?.reconnect.eventType ?? "-" })}
            </p>
            <p className="mt-1 text-sm text-stone-600">
              {msg("admin.live.backpressure", { count: stream?.backpressure.affectedQueues ?? 0 })}
            </p>
          </article>

          <article className="rounded-3xl border border-stone-200 bg-stone-50 p-5">
            <div className="text-xs font-semibold uppercase tracking-[0.16em] text-stone-400">
              {msg("admin.live.timelineTitle")}
            </div>
            <div className="mt-3 text-xl font-semibold text-stone-950">
              {msg("admin.live.eventCount", { count: live?.timeline.summary.total ?? 0 })}
            </div>
            <div className="mt-3 grid grid-cols-4 gap-2 text-center text-xs font-semibold text-stone-600">
              {(["debug", "info", "warning", "error"] as const).map((level) => (
                <div key={level} className="rounded-xl bg-white px-2 py-2 ring-1 ring-stone-200">
                  <div className="uppercase text-stone-400">{level}</div>
                  <div className="mt-1 text-stone-900">
                    {live?.timeline.summary.severityCounts[level] ?? 0}
                  </div>
                </div>
              ))}
            </div>
          </article>

          <article className="rounded-3xl border border-stone-200 bg-stone-50 p-5">
            <div className="text-xs font-semibold uppercase tracking-[0.16em] text-stone-400">
              {msg("admin.live.ledgerTitle")}
            </div>
            <div className="mt-3 text-xl font-semibold text-stone-950">
              {msg("admin.live.duplicates", { count: live?.messageLedger.summary.duplicates ?? 0 })}
            </div>
            <p className="mt-2 text-sm text-stone-600">
              Delivered {live?.messageLedger.summary.delivered ?? 0}
            </p>
            <p className="mt-1 text-sm text-stone-600">
              Failures {live?.messageLedger.summary.deliveryFailures ?? 0}
            </p>
          </article>
        </div>

        <div className="mt-6 grid gap-6 xl:grid-cols-[1fr_1.2fr]">
          <article className="rounded-3xl border border-stone-200 bg-white p-5">
            <div className="text-sm font-semibold text-stone-950">
              {msg("admin.live.timelineTitle")}
            </div>
            <div className="mt-4 space-y-3">
              {recentTimeline.length === 0 ? (
                <p className="text-sm text-stone-500">{msg("admin.live.empty")}</p>
              ) : null}
              {recentTimeline.map((event) => (
                <div key={event.id} className="rounded-2xl border border-stone-200 bg-stone-50 p-3">
                  <div className="flex items-center justify-between gap-3 text-xs text-stone-500">
                    <span>{formatClock(event.at)}</span>
                    <span
                      className={`rounded-full px-2 py-0.5 font-semibold uppercase ${event.severity === "error" ? "bg-red-100 text-red-700" : event.severity === "warning" ? "bg-amber-100 text-amber-700" : "bg-stone-200 text-stone-700"}`}
                    >
                      {event.severity}
                    </span>
                  </div>
                  <div className="mt-2 text-sm font-semibold text-stone-900">
                    {event.component} · {event.eventType}
                  </div>
                  <p className="mt-1 text-sm leading-5 text-stone-600">{event.summary}</p>
                </div>
              ))}
            </div>
          </article>

          <article className="rounded-3xl border border-stone-200 bg-white p-5">
            <div className="text-sm font-semibold text-stone-950">
              {msg("admin.live.runsTitle")}
            </div>
            <div className="mt-4 space-y-4">
              {inspectedRuns.length === 0 ? (
                <p className="text-sm text-stone-500">{msg("admin.live.empty")}</p>
              ) : null}
              {inspectedRuns.map((run) => (
                <div key={run.id} className="rounded-2xl border border-stone-200 bg-stone-50 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <div className="text-sm font-semibold text-stone-950">{run.title}</div>
                      <div className="mt-1 text-xs text-stone-500">
                        {run.source} · {formatClock(run.updatedAt)}
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2 text-xs font-semibold">
                      <span className="rounded-full bg-white px-2 py-1 text-stone-700 ring-1 ring-stone-200">
                        {msg("admin.live.runStatus", { status: run.status })}
                      </span>
                      <span className="rounded-full bg-white px-2 py-1 text-stone-700 ring-1 ring-stone-200">
                        {msg("admin.live.deliveryStatus", { status: run.delivery.status })}
                      </span>
                      {run.failureReversal ? (
                        <span className="rounded-full bg-amber-100 px-2 py-1 text-amber-800">
                          recovered
                        </span>
                      ) : null}
                    </div>
                  </div>
                  <div className="mt-4 grid gap-2 md:grid-cols-4 xl:grid-cols-7">
                    {run.lifecycle.map((stage) => (
                      <div
                        key={stage.key}
                        className="rounded-xl bg-white p-3 ring-1 ring-stone-200"
                      >
                        <div className="text-[11px] font-semibold uppercase text-stone-400">
                          {stage.label}
                        </div>
                        <div
                          className={`mt-1 text-sm font-semibold ${stage.status === "failed" ? "text-red-700" : stage.status === "warning" ? "text-amber-700" : "text-stone-900"}`}
                        >
                          {stage.status}
                        </div>
                        <div className="mt-1 text-[11px] text-stone-500">
                          {msg("admin.live.duration", {
                            duration: formatDuration(stage.durationMs),
                          })}
                        </div>
                      </div>
                    ))}
                  </div>
                  {run.delivery.failureReason ? (
                    <p className="mt-3 rounded-xl bg-red-50 px-3 py-2 text-xs text-red-700">
                      {run.delivery.failureReason}
                    </p>
                  ) : null}
                </div>
              ))}
            </div>
          </article>
        </div>

        <article className="mt-6 rounded-3xl border border-stone-200 bg-white p-5">
          <div className="flex items-center justify-between gap-3">
            <div className="text-sm font-semibold text-stone-950">
              {msg("admin.live.ledgerTitle")}
            </div>
            <div className="text-xs font-semibold text-stone-500">
              {msg("admin.live.eventCount", { count: live?.messageLedger.summary.total ?? 0 })}
            </div>
          </div>
          <div className="mt-4 grid gap-3 lg:grid-cols-2">
            {ledgerEvents.length === 0 ? (
              <p className="text-sm text-stone-500">{msg("admin.live.empty")}</p>
            ) : null}
            {ledgerEvents.map((event) => (
              <div key={event.id} className="rounded-2xl border border-stone-200 bg-stone-50 p-3">
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-stone-500">
                  <span>{formatClock(event.createdAt)}</span>
                  <span className="rounded-full bg-white px-2 py-0.5 font-semibold text-stone-700 ring-1 ring-stone-200">
                    {event.status}
                  </span>
                </div>
                <div className="mt-2 text-sm font-semibold text-stone-900">
                  {event.channel} · {event.eventKind}
                </div>
                <p className="mt-1 text-sm leading-5 text-stone-600">{event.summary}</p>
                <div className="mt-2 space-y-1 text-[11px] text-stone-500">
                  <div className="break-all">delivery: {event.deliveryKey ?? "-"}</div>
                  <div className="break-all">idempotency: {event.idempotencyKey ?? "-"}</div>
                  <div>target: {event.channelTarget ?? "-"}</div>
                </div>
              </div>
            ))}
          </div>
        </article>
      </section>

      <section className="mt-6 rounded-[2rem] border border-stone-200 bg-white p-8 shadow-sm">
        <div className="text-xs font-semibold uppercase tracking-[0.18em] text-stone-400">
          {msg("admin.lab.title")}
        </div>
        <h2 className="mt-3 text-2xl font-semibold text-stone-950">{msg("admin.lab.title")}</h2>
        <p className="mt-3 max-w-3xl text-sm leading-6 text-stone-600">
          {msg("admin.lab.description")}
        </p>

        <div className="mt-6 grid gap-4 lg:grid-cols-4">
          <article className="rounded-3xl border border-stone-200 bg-stone-50 p-5">
            <div className="text-xs font-semibold uppercase tracking-[0.16em] text-stone-400">
              {msg("admin.lab.toolsTitle")}
            </div>
            <div className="mt-3 text-xl font-semibold text-stone-950">
              {toolLab?.toolCalls.summary.total ?? 0}
            </div>
            <p className="mt-2 text-sm text-stone-600">
              failed {toolLab?.toolCalls.summary.failed ?? 0}
            </p>
            <p className="mt-1 text-sm text-stone-600">
              {msg("admin.lab.redacted", { count: toolLab?.toolCalls.summary.redacted ?? 0 })}
            </p>
          </article>
          <article className="rounded-3xl border border-stone-200 bg-stone-50 p-5">
            <div className="text-xs font-semibold uppercase tracking-[0.16em] text-stone-400">
              {msg("admin.lab.webTitle")}
            </div>
            <div className="mt-3 text-xl font-semibold text-stone-950">
              {msg("admin.lab.attempts", { count: toolLab?.webRetrieval.summary.attempts ?? 0 })}
            </div>
            <p className="mt-2 text-sm text-stone-600">
              {msg("admin.lab.degraded", { count: toolLab?.webRetrieval.summary.degraded ?? 0 })}
            </p>
            <p className="mt-1 text-sm text-stone-600">
              {msg("admin.lab.answerable", {
                count: toolLab?.webRetrieval.summary.answerable ?? 0,
              })}
            </p>
          </article>
          <article className="rounded-3xl border border-emerald-200 bg-emerald-50 p-5">
            <div className="text-xs font-semibold uppercase tracking-[0.16em] text-emerald-700">
              {msg("admin.lab.discovery")}
            </div>
            <p className="mt-3 text-sm leading-6 text-emerald-900">
              web_search와 source 후보는 넓게 수집합니다.
            </p>
          </article>
          <article className="rounded-3xl border border-sky-200 bg-sky-50 p-5">
            <div className="text-xs font-semibold uppercase tracking-[0.16em] text-sky-700">
              {msg("admin.lab.completion")}
            </div>
            <p className="mt-3 text-sm leading-6 text-sky-900">
              최종 답변은 target, source, candidate 필드 확인을 통과해야 합니다.
            </p>
          </article>
        </div>

        <div className="mt-6 grid gap-6 xl:grid-cols-[1fr_1.15fr]">
          <article className="rounded-3xl border border-stone-200 bg-white p-5">
            <div className="text-sm font-semibold text-stone-950">
              {msg("admin.lab.toolsTitle")}
            </div>
            <div className="mt-4 space-y-3">
              {toolCalls.length === 0 ? (
                <p className="text-sm text-stone-500">{msg("admin.live.empty")}</p>
              ) : null}
              {toolCalls.map((call) => (
                <details
                  key={call.id}
                  className="rounded-2xl border border-stone-200 bg-stone-50 p-3"
                >
                  <summary className="cursor-pointer list-none">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <div className="text-sm font-semibold text-stone-950">{call.toolName}</div>
                        <div className="mt-1 text-xs text-stone-500">
                          {formatClock(call.finishedAt ?? call.startedAt)} ·{" "}
                          {msg("admin.live.duration", {
                            duration: formatDuration(call.durationMs),
                          })}
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-2 text-xs font-semibold">
                        <span className="rounded-full bg-white px-2 py-1 text-stone-700 ring-1 ring-stone-200">
                          {call.status}
                        </span>
                        <span className="rounded-full bg-white px-2 py-1 text-stone-700 ring-1 ring-stone-200">
                          {call.approvalState}
                        </span>
                        <span className="rounded-full bg-white px-2 py-1 text-stone-700 ring-1 ring-stone-200">
                          retry {call.retryCount}
                        </span>
                      </div>
                    </div>
                  </summary>
                  <div className="mt-3 grid gap-3 lg:grid-cols-2">
                    <pre className="max-h-64 overflow-auto rounded-xl bg-stone-900 p-3 text-xs text-stone-100">
                      {formatJson(call.paramsRedacted)}
                    </pre>
                    <pre className="max-h-64 overflow-auto rounded-xl bg-stone-900 p-3 text-xs text-stone-100">
                      {formatJson(call.outputRedacted)}
                    </pre>
                  </div>
                  {call.resultSummary ? (
                    <p className="mt-3 text-sm text-stone-600">{call.resultSummary}</p>
                  ) : null}
                </details>
              ))}
            </div>
          </article>

          <article className="rounded-3xl border border-stone-200 bg-white p-5">
            <div className="text-sm font-semibold text-stone-950">{msg("admin.lab.webTitle")}</div>
            <div className="mt-4 space-y-4">
              {retrievalSessions.length === 0 ? (
                <p className="text-sm text-stone-500">{msg("admin.live.empty")}</p>
              ) : null}
              {retrievalSessions.map((session) => (
                <div
                  key={session.id}
                  className="rounded-2xl border border-stone-200 bg-stone-50 p-4"
                >
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="text-sm font-semibold text-stone-950">
                      {session.target &&
                      typeof session.target === "object" &&
                      "canonicalName" in session.target
                        ? String(
                            (session.target as { canonicalName?: unknown }).canonicalName ??
                              session.id,
                          )
                        : session.id}
                    </div>
                    <div className="flex flex-wrap gap-2 text-xs font-semibold">
                      <span className="rounded-full bg-white px-2 py-1 text-stone-700 ring-1 ring-stone-200">
                        {msg("admin.lab.attempts", { count: session.fetchAttempts.length })}
                      </span>
                      <span className="rounded-full bg-white px-2 py-1 text-stone-700 ring-1 ring-stone-200">
                        {msg("admin.lab.candidates", {
                          count: session.candidateExtraction.candidateCount,
                        })}
                      </span>
                      <span
                        className={`rounded-full px-2 py-1 ring-1 ${session.degradedState.degraded ? "bg-amber-100 text-amber-800 ring-amber-200" : "bg-emerald-100 text-emerald-800 ring-emerald-200"}`}
                      >
                        {session.degradedState.degraded ? "degraded" : "ok"}
                      </span>
                    </div>
                  </div>
                  <div className="mt-3 grid gap-3 md:grid-cols-2">
                    <div className="rounded-xl bg-white p-3 ring-1 ring-stone-200">
                      <div className="text-xs font-semibold uppercase tracking-[0.16em] text-stone-400">
                        {msg("admin.lab.discovery")}
                      </div>
                      <div className="mt-2 space-y-1 text-xs text-stone-600">
                        {session.queryVariants.slice(0, 4).map((item) => (
                          <div key={item} className="truncate">
                            {item}
                          </div>
                        ))}
                      </div>
                    </div>
                    <div className="rounded-xl bg-white p-3 ring-1 ring-stone-200">
                      <div className="text-xs font-semibold uppercase tracking-[0.16em] text-stone-400">
                        {msg("admin.lab.completion")}
                      </div>
                      <div className="mt-2 text-sm font-semibold text-stone-900">
                        {String(session.verification.canAnswer ?? "unknown")}
                      </div>
                      <div className="mt-1 text-xs text-stone-600">
                        {session.verification.evidenceSufficiency ?? "-"}
                      </div>
                    </div>
                  </div>
                  <div className="mt-3 grid gap-2 md:grid-cols-2">
                    {session.fetchAttempts.slice(0, 4).map((attempt) => (
                      <div
                        key={attempt.id}
                        className="rounded-xl bg-white p-3 text-xs ring-1 ring-stone-200"
                      >
                        <div className="font-semibold text-stone-900">
                          {attempt.toolName} · {attempt.status}
                        </div>
                        <div className="mt-1 text-stone-500">
                          {attempt.sourceDomain ?? attempt.method}
                        </div>
                        <div className="mt-1 text-stone-500">{attempt.freshnessPolicy}</div>
                      </div>
                    ))}
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2 text-xs text-stone-600">
                    <span className="rounded-full bg-white px-2 py-1 ring-1 ring-stone-200">
                      {msg("admin.lab.cache", { status: session.cache.status })}
                    </span>
                    {session.adapterMetadata.map((adapter) => (
                      <span
                        key={adapter.adapterId}
                        className="rounded-full bg-white px-2 py-1 ring-1 ring-stone-200"
                      >
                        {msg("admin.lab.adapter", {
                          name: `${adapter.adapterId}@${adapter.adapterVersion}`,
                        })}
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </article>
        </div>

        <article className="mt-6 rounded-3xl border border-stone-200 bg-white p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="text-sm font-semibold text-stone-950">
                {msg("admin.lab.fixtureTitle")}
              </div>
              <p className="mt-1 text-sm text-stone-600">
                외부 네트워크 없이 저장 fixture로 조회 흐름을 다시 확인합니다.
              </p>
            </div>
            <button
              type="button"
              onClick={() => void runFixtureReplay()}
              disabled={fixtureReplayLoading}
              className="rounded-xl bg-stone-900 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
            >
              {fixtureReplayLoading ? "running" : msg("admin.lab.fixtureRun")}
            </button>
          </div>
          {fixtureReplayError ? (
            <p className="mt-3 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">
              {fixtureReplayError}
            </p>
          ) : null}
          {fixtureReplay ? (
            <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {fixtureReplay.results.map((result) => (
                <div
                  key={result.fixtureId}
                  className="rounded-2xl border border-stone-200 bg-stone-50 p-3"
                >
                  <div className="text-sm font-semibold text-stone-950">{result.fixtureId}</div>
                  <div className="mt-1 text-xs text-stone-500">
                    {result.status} · attempts {result.attempts} · candidates{" "}
                    {result.candidateCount}
                  </div>
                  <div className="mt-2 text-sm text-stone-700">
                    {result.canAnswer
                      ? (result.acceptedValue ?? "answerable")
                      : result.evidenceSufficiency}
                  </div>
                </div>
              ))}
            </div>
          ) : null}
        </article>
      </section>

      <section className="mt-6 rounded-[2rem] border border-stone-200 bg-white p-8 shadow-sm">
        <div className="text-xs font-semibold uppercase tracking-[0.18em] text-stone-400">
          {msg("admin.inspectors.title")}
        </div>
        <h2 className="mt-3 text-2xl font-semibold text-stone-950">
          {msg("admin.inspectors.title")}
        </h2>
        <p className="mt-3 max-w-3xl text-sm leading-6 text-stone-600">
          {msg("admin.inspectors.description")}
        </p>

        <div className="mt-6 grid gap-4 lg:grid-cols-3">
          <article className="rounded-3xl border border-stone-200 bg-stone-50 p-5">
            <div className="text-xs font-semibold uppercase tracking-[0.16em] text-stone-400">
              {msg("admin.inspectors.memoryTitle")}
            </div>
            <div className="mt-3 text-xl font-semibold text-stone-950">
              {msg("admin.inspectors.documents", {
                count: runtimeInspectors?.memory.summary.documents ?? 0,
              })}
            </div>
            <p className="mt-2 text-sm text-stone-600">
              {msg("admin.inspectors.writeback", {
                count: runtimeInspectors?.memory.summary.writebackPending ?? 0,
              })}
            </p>
            <p className="mt-1 text-sm text-stone-600">
              {msg("admin.inspectors.retrieval", {
                count: runtimeInspectors?.memory.summary.retrievalTraces ?? 0,
              })}
            </p>
            <p className="mt-1 text-sm text-stone-600">
              {msg("admin.inspectors.failures", {
                count: runtimeInspectors?.memory.summary.linkedFailures ?? 0,
              })}
            </p>
          </article>

          <article className="rounded-3xl border border-stone-200 bg-stone-50 p-5">
            <div className="text-xs font-semibold uppercase tracking-[0.16em] text-stone-400">
              {msg("admin.inspectors.schedulerTitle")}
            </div>
            <div className="mt-3 text-xl font-semibold text-stone-950">
              {runtimeInspectors?.scheduler.summary.schedules ?? 0}
            </div>
            <p className="mt-2 text-sm text-stone-600">
              enabled {runtimeInspectors?.scheduler.summary.enabled ?? 0}
            </p>
            <p className="mt-1 text-sm text-stone-600">
              missed {runtimeInspectors?.scheduler.summary.missed ?? 0}
            </p>
            <p className="mt-1 text-sm text-stone-600">
              {msg("admin.inspectors.receipts", {
                count: runtimeInspectors?.scheduler.summary.receipts ?? 0,
              })}
            </p>
          </article>

          <article className="rounded-3xl border border-stone-200 bg-stone-50 p-5">
            <div className="text-xs font-semibold uppercase tracking-[0.16em] text-stone-400">
              {msg("admin.inspectors.channelTitle")}
            </div>
            <div className="mt-3 text-xl font-semibold text-stone-950">
              {msg("admin.inspectors.mapping", {
                count: runtimeInspectors?.channels.summary.channels ?? 0,
              })}
            </div>
            <p className="mt-2 text-sm text-stone-600">
              in {runtimeInspectors?.channels.summary.inbound ?? 0} / out{" "}
              {runtimeInspectors?.channels.summary.outbound ?? 0}
            </p>
            <p className="mt-1 text-sm text-stone-600">
              {msg("admin.inspectors.approvals", {
                count: runtimeInspectors?.channels.summary.approvals ?? 0,
              })}
            </p>
            <p className="mt-1 text-sm text-stone-600">
              {msg("admin.inspectors.receipts", {
                count: runtimeInspectors?.channels.summary.receipts ?? 0,
              })}
            </p>
          </article>
        </div>

        <div className="mt-6 grid gap-6 xl:grid-cols-3">
          <article className="rounded-3xl border border-stone-200 bg-white p-5">
            <div className="text-sm font-semibold text-stone-950">
              {msg("admin.inspectors.memoryTitle")}
            </div>
            <div className="mt-4 space-y-3">
              {memoryDocuments.length === 0 && memoryWritebacks.length === 0 ? (
                <p className="text-sm text-stone-500">{msg("admin.live.empty")}</p>
              ) : null}
              {memoryDocuments.map((item) => (
                <div key={item.id} className="rounded-2xl border border-stone-200 bg-stone-50 p-3">
                  <div className="flex items-center justify-between gap-3 text-xs text-stone-500">
                    <span>{formatClock(item.updatedAt)}</span>
                    <span className="rounded-full bg-white px-2 py-0.5 font-semibold text-stone-700 ring-1 ring-stone-200">
                      {item.ownerKind}
                    </span>
                  </div>
                  <div className="mt-2 text-sm font-semibold text-stone-950">
                    {item.title ?? item.sourceType}
                  </div>
                  <p className="mt-1 text-xs text-stone-600">
                    chunks {item.chunkCount} · fts {item.ftsStatus} · vector {item.vectorStatus}
                  </p>
                  {item.indexLastError ? (
                    <p className="mt-2 rounded-xl bg-red-50 px-3 py-2 text-xs text-red-700">
                      {item.indexLastError}
                    </p>
                  ) : null}
                </div>
              ))}
              {memoryWritebacks.map((item) => (
                <div key={item.id} className="rounded-2xl border border-amber-200 bg-amber-50 p-3">
                  <div className="text-xs font-semibold uppercase text-amber-700">
                    {msg("admin.inspectors.writeback", { count: item.retryCount })} · {item.status}
                  </div>
                  <p className="mt-2 text-sm leading-5 text-amber-950">{item.contentPreview}</p>
                  {item.lastError ? (
                    <p className="mt-2 text-xs text-red-700">{item.lastError}</p>
                  ) : null}
                </div>
              ))}
            </div>
          </article>

          <article className="rounded-3xl border border-stone-200 bg-white p-5">
            <div className="flex items-center justify-between gap-3">
              <div className="text-sm font-semibold text-stone-950">
                {msg("admin.inspectors.schedulerTitle")}
              </div>
              <div className="rounded-full bg-sky-50 px-2 py-1 text-xs font-semibold text-sky-700 ring-1 ring-sky-100">
                {msg("admin.inspectors.fieldChecks")}
              </div>
            </div>
            <div className="mt-4 space-y-3">
              {schedulerItems.length === 0 ? (
                <p className="text-sm text-stone-500">{msg("admin.live.empty")}</p>
              ) : null}
              {schedulerItems.map((item) => (
                <div key={item.id} className="rounded-2xl border border-stone-200 bg-stone-50 p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="text-sm font-semibold text-stone-950">{item.name}</div>
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs font-semibold ring-1 ${item.queueState === "missed" || item.queueState === "retrying" ? "bg-amber-100 text-amber-800 ring-amber-200" : "bg-white text-stone-700 ring-stone-200"}`}
                    >
                      {msg("admin.inspectors.queue", { status: item.queueState })}
                    </span>
                  </div>
                  <div className="mt-2 grid gap-2 text-xs text-stone-600">
                    <div>
                      {msg("admin.inspectors.contract", {
                        status: item.contract.hasContract ? "ok" : "missing",
                      })}
                    </div>
                    <div>payload {item.contract.payloadKind ?? "-"}</div>
                    <div>delivery {item.contract.deliveryChannel ?? item.targetChannel}</div>
                    <div>next {formatClock(item.nextRunAt)}</div>
                  </div>
                  {item.latestRun?.error ? (
                    <p className="mt-2 rounded-xl bg-red-50 px-3 py-2 text-xs text-red-700">
                      {item.latestRun.error}
                    </p>
                  ) : null}
                </div>
              ))}
            </div>
          </article>

          <article className="rounded-3xl border border-stone-200 bg-white p-5">
            <div className="text-sm font-semibold text-stone-950">
              {msg("admin.inspectors.channelTitle")}
            </div>
            <div className="mt-4 space-y-3">
              {channelMappings.length === 0 && approvalCallbacks.length === 0 ? (
                <p className="text-sm text-stone-500">{msg("admin.live.empty")}</p>
              ) : null}
              {channelMappings.map((item) => (
                <div
                  key={item.channel}
                  className="rounded-2xl border border-stone-200 bg-stone-50 p-3"
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="text-sm font-semibold text-stone-950">{item.channel}</div>
                    <span className="rounded-full bg-white px-2 py-0.5 text-xs font-semibold text-stone-700 ring-1 ring-stone-200">
                      {formatClock(item.latestAt)}
                    </span>
                  </div>
                  <p className="mt-2 text-xs text-stone-600">
                    in {item.inboundCount} · out {item.outboundCount} · approval{" "}
                    {item.approvalCount}
                  </p>
                  <div className="mt-2 space-y-1 text-[11px] text-stone-500">
                    {item.refs.slice(0, 2).map((ref) => (
                      <div key={ref.id} className="break-all">
                        {ref.role}: {ref.chatId} / {ref.messageId}
                      </div>
                    ))}
                  </div>
                </div>
              ))}
              {approvalCallbacks.map((item) => (
                <div
                  key={item.id}
                  className="rounded-2xl border border-emerald-200 bg-emerald-50 p-3"
                >
                  <div className="text-xs font-semibold uppercase text-emerald-700">
                    {msg("admin.inspectors.approvals", { count: 1 })} · {item.status}
                  </div>
                  <p className="mt-2 text-sm text-emerald-950">{item.summary}</p>
                  <div className="mt-2 text-[11px] text-emerald-800">
                    payload {item.buttonPayload ?? "-"}
                  </div>
                </div>
              ))}
            </div>
          </article>
        </div>
      </section>

      <section className="mt-6 rounded-[2rem] border border-stone-200 bg-white p-8 shadow-sm">
        <div className="text-xs font-semibold uppercase tracking-[0.18em] text-stone-400">
          {msg("admin.platform.title")}
        </div>
        <h2 className="mt-3 text-2xl font-semibold text-stone-950">
          {msg("admin.platform.title")}
        </h2>
        <p className="mt-3 max-w-3xl text-sm leading-6 text-stone-600">
          {msg("admin.platform.description")}
        </p>

        <div className="mt-6 grid gap-4 lg:grid-cols-3">
          <article className="rounded-3xl border border-stone-200 bg-stone-50 p-5">
            <div className="text-xs font-semibold uppercase tracking-[0.16em] text-stone-400">
              {msg("admin.platform.yeonjangTitle")}
            </div>
            <div className="mt-3 text-xl font-semibold text-stone-950">
              {msg("admin.platform.broker", {
                status: platformInspectors?.yeonjang.broker.running ? "running" : "stopped",
              })}
            </div>
            <p className="mt-2 text-sm text-stone-600">
              {msg("admin.platform.nodes", {
                count: platformInspectors?.yeonjang.summary.nodes ?? 0,
              })}
            </p>
            <p className="mt-1 text-sm text-stone-600">
              {msg("admin.platform.heartbeat", {
                count: platformInspectors?.yeonjang.summary.heartbeats ?? 0,
              })}
            </p>
            <p className="mt-1 text-sm text-stone-600">
              {msg("admin.platform.reconnects", {
                count: platformInspectors?.yeonjang.summary.reconnectAttempts ?? 0,
              })}
            </p>
          </article>

          <article className="rounded-3xl border border-stone-200 bg-stone-50 p-5">
            <div className="text-xs font-semibold uppercase tracking-[0.16em] text-stone-400">
              {msg("admin.platform.dbTitle")}
            </div>
            <div className="mt-3 text-xl font-semibold text-stone-950">
              {msg("admin.platform.dbStructure", {
                current: platformInspectors?.database.summary.currentVersion ?? 0,
                latest: platformInspectors?.database.summary.latestVersion ?? 0,
              })}
            </div>
            <p className="mt-2 text-sm text-stone-600">
              {msg("admin.platform.pending", {
                count: platformInspectors?.database.summary.pendingMigrations ?? 0,
              })}
            </p>
            <p className="mt-1 text-sm text-stone-600">
              {msg("admin.platform.integrity", {
                status: platformInspectors?.database.summary.integrityOk ? "ok" : "check",
              })}
            </p>
            <p className="mt-1 text-sm text-stone-600">
              {msg("admin.platform.backups", {
                count: platformInspectors?.database.summary.backupSnapshots ?? 0,
              })}
            </p>
          </article>

          <article className="rounded-3xl border border-stone-200 bg-stone-50 p-5">
            <div className="text-xs font-semibold uppercase tracking-[0.16em] text-stone-400">
              {msg("admin.platform.exportTitle")}
            </div>
            <div className="mt-3 text-xl font-semibold text-stone-950">
              {msg("admin.platform.exportStatus", { status: exportJobs[0]?.status ?? "idle" })}
            </div>
            <p className="mt-2 text-sm text-stone-600">{msg("admin.platform.exportSafe")}</p>
            <button
              type="button"
              onClick={() => void startDiagnosticExport()}
              disabled={exportLoading}
              className="mt-4 rounded-xl bg-stone-900 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
            >
              {exportLoading ? "running" : msg("admin.platform.startExport")}
            </button>
            {exportError ? (
              <p className="mt-3 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">
                {exportError}
              </p>
            ) : null}
          </article>
        </div>

        <div className="mt-6 grid gap-6 xl:grid-cols-3">
          <article className="rounded-3xl border border-stone-200 bg-white p-5">
            <div className="text-sm font-semibold text-stone-950">
              {msg("admin.platform.yeonjangTitle")}
            </div>
            <div className="mt-4 space-y-3">
              {yeonjangNodes.length === 0 && yeonjangEvents.length === 0 ? (
                <p className="text-sm text-stone-500">{msg("admin.live.empty")}</p>
              ) : null}
              {yeonjangNodes.map((node) => (
                <div
                  key={node.extensionId}
                  className="rounded-2xl border border-stone-200 bg-stone-50 p-3"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="text-sm font-semibold text-stone-950">
                      {node.displayName ?? node.extensionId}
                    </div>
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs font-semibold ring-1 ${node.state === "offline" || node.stale ? "bg-amber-100 text-amber-800 ring-amber-200" : "bg-emerald-100 text-emerald-800 ring-emerald-200"}`}
                    >
                      {node.state ?? "unknown"}
                    </span>
                  </div>
                  <div className="mt-2 grid gap-1 text-xs text-stone-600">
                    <div>
                      {msg("admin.platform.protocol", { value: node.protocolVersion ?? "-" })}
                    </div>
                    <div>
                      {msg("admin.platform.fingerprint", { value: node.capabilityHash ?? "-" })}
                    </div>
                    <div>
                      methods {node.methodCount} · {formatClock(node.lastSeenAt)}
                    </div>
                  </div>
                </div>
              ))}
              {yeonjangEvents.slice(0, Math.max(0, 5 - yeonjangNodes.length)).map((event) => (
                <div
                  key={`${event.at}-${event.eventType}-${event.summary}`}
                  className="rounded-2xl border border-sky-200 bg-sky-50 p-3 text-sm text-sky-950"
                >
                  <div className="text-xs font-semibold uppercase text-sky-700">
                    {formatClock(event.at)} · {event.eventType}
                  </div>
                  <p className="mt-2">{event.summary}</p>
                </div>
              ))}
            </div>
          </article>

          <article className="rounded-3xl border border-stone-200 bg-white p-5">
            <div className="text-sm font-semibold text-stone-950">
              {msg("admin.platform.dbTitle")}
            </div>
            <div className="mt-4 space-y-3">
              <div className="rounded-2xl border border-stone-200 bg-stone-50 p-3">
                <div className="text-xs font-semibold uppercase text-stone-400">
                  {msg("admin.platform.integrity", {
                    status: platformInspectors?.database.integrity?.integrityCheck ?? "-",
                  })}
                </div>
                <p className="mt-2 text-sm text-stone-700">
                  {msg("admin.platform.pending", {
                    count: platformInspectors?.database.migrations.pendingVersions.length ?? 0,
                  })}
                </p>
                <p className="mt-1 text-sm text-stone-700">
                  {msg("admin.platform.migrationLock", {
                    status: platformInspectors?.database.summary.migrationLockActive
                      ? "active"
                      : "none",
                  })}
                </p>
              </div>
              {migrationDiagnostics.length === 0 ? (
                <p className="text-sm text-stone-500">{msg("admin.live.empty")}</p>
              ) : null}
              {migrationDiagnostics.map((event) => (
                <div key={event.id} className="rounded-2xl border border-amber-200 bg-amber-50 p-3">
                  <div className="text-xs font-semibold uppercase text-amber-700">
                    {event.kind} · {formatClock(event.createdAt)}
                  </div>
                  <p className="mt-2 text-sm text-amber-950">{event.summary}</p>
                </div>
              ))}
            </div>
          </article>

          <article className="rounded-3xl border border-stone-200 bg-white p-5">
            <div className="text-sm font-semibold text-stone-950">
              {msg("admin.platform.exportTitle")}
            </div>
            <div className="mt-4 space-y-3">
              {exportJobs.length === 0 ? (
                <p className="text-sm text-stone-500">{msg("admin.platform.noJobs")}</p>
              ) : null}
              {exportJobs.map((job) => (
                <div key={job.id} className="rounded-2xl border border-stone-200 bg-stone-50 p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="text-sm font-semibold text-stone-950">
                      {job.bundleFile ?? job.id}
                    </div>
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs font-semibold ring-1 ${job.status === "failed" ? "bg-red-100 text-red-700 ring-red-200" : job.status === "succeeded" ? "bg-emerald-100 text-emerald-800 ring-emerald-200" : "bg-white text-stone-700 ring-stone-200"}`}
                    >
                      {job.status}
                    </span>
                  </div>
                  <div className="mt-2 text-xs text-stone-600">
                    {job.progress}% · {job.bundleBytes ?? 0} bytes · {formatClock(job.updatedAt)}
                  </div>
                  {job.error ? (
                    <p className="mt-2 rounded-xl bg-red-50 px-3 py-2 text-xs text-red-700">
                      {job.error}
                    </p>
                  ) : null}
                </div>
              ))}
            </div>
          </article>
        </div>
      </section>

      <section className="mt-6 rounded-[2rem] border border-stone-200 bg-white p-8 shadow-sm">
        <div className="text-xs font-semibold uppercase tracking-[0.18em] text-red-500">
          {msg("admin.shell.dangerTitle")}
        </div>
        <h2 className="mt-3 text-2xl font-semibold text-stone-950">
          {msg("admin.shell.dangerTitle")}
        </h2>
        <p className="mt-3 max-w-3xl text-sm leading-6 text-stone-600">
          {msg("admin.shell.dangerDescription")}
        </p>
        <div className="mt-6 grid gap-4 xl:grid-cols-4 md:grid-cols-2">
          {shell.actions.map((action) => (
            <article
              key={action.id}
              className="rounded-3xl border border-stone-200 bg-stone-50 p-5"
            >
              <div className="text-base font-semibold text-stone-950">{action.label}</div>
              <p className="mt-2 min-h-12 text-sm leading-5 text-stone-600">{action.description}</p>
              <div className="mt-4 rounded-2xl border border-stone-200 bg-white p-3">
                <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-stone-400">
                  {msg("admin.shell.confirmation")}
                </div>
                <code className="mt-2 block break-all rounded-xl bg-stone-900 px-3 py-2 text-xs text-white">
                  {action.requiredConfirmation}
                </code>
              </div>
            </article>
          ))}
        </div>
        <div className="mt-6 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-medium text-amber-900">
          {shell.auditNotice}
        </div>
      </section>
    </div>
  )
}

function BeginnerTasksPage() {
  const { language } = useUiI18n()
  const msg = (
    key: Parameters<typeof uiCatalogText>[1],
    params?: Record<string, string | number>,
  ) => uiCatalogText(language, key, params)
  const shell = useUiModeStore((state) => state.shell)
  const taskComponent = shell?.viewModel.advanced.components.find(
    (component) => component.key === "tasks",
  )
  const activeRunCount =
    typeof taskComponent?.configSummary.total === "number" ? taskComponent.configSummary.total : 0
  return (
    <div className="h-full overflow-y-auto bg-stone-100 p-6">
      <section className="rounded-[2rem] bg-white p-8 shadow-sm">
        <h1 className="text-2xl font-semibold text-stone-900">{msg("beginner.tasks.title")}</h1>
        <p className="mt-3 text-sm text-stone-600">{msg("beginner.tasks.description")}</p>
        <div className="mt-6 rounded-2xl border border-stone-200 bg-stone-50 p-5">
          <div className="text-sm font-semibold text-stone-900">{msg("beginner.tasks.active")}</div>
          <div className="mt-2 text-3xl font-semibold text-stone-900">{activeRunCount}</div>
        </div>
        <Link
          to="/advanced/runs"
          className="mt-6 inline-flex rounded-xl border border-stone-200 px-4 py-2.5 text-sm font-semibold text-stone-700"
        >
          {msg("beginner.tasks.details")}
        </Link>
      </section>
    </div>
  )
}

function BeginnerStatusPage() {
  const { language } = useUiI18n()
  const msg = (
    key: Parameters<typeof uiCatalogText>[1],
    params?: Record<string, string | number>,
  ) => uiCatalogText(language, key, params)
  const connected = useConnectionStore((state) => state.connected)
  const shell = useUiModeStore((state) => state.shell)
  const components = shell?.viewModel.advanced.components ?? []
  const ai = components.find((component) => component.key === "ai")
  const channels = components.find((component) => component.key === "channels")
  const yeonjang = components.find((component) => component.key === "yeonjang")
  return (
    <div className="h-full overflow-y-auto bg-stone-100 p-6">
      <section className="rounded-[2rem] bg-white p-8 shadow-sm">
        <h1 className="text-2xl font-semibold text-stone-900">{msg("beginner.status.title")}</h1>
        <div className="mt-6 grid gap-3 md:grid-cols-2">
          <StatusCard
            label={msg("beginner.status.gateway")}
            value={connected ? msg("beginner.status.connected") : msg("beginner.status.needsCheck")}
          />
          <StatusCard label="AI" value={ai?.statusLabel ?? msg("beginner.status.setupNeeded")} />
          <StatusCard
            label={msg("beginner.status.channels")}
            value={channels?.summary ?? msg("layout.status.webui")}
          />
          <StatusCard
            label={msg("layout.status.yeonjang")}
            value={yeonjang?.summary ?? msg("beginner.status.needsCheck")}
          />
        </div>
        <Link
          to="/advanced/dashboard"
          className="mt-6 inline-flex rounded-xl border border-stone-200 px-4 py-2.5 text-sm font-semibold text-stone-700"
        >
          {msg("beginner.status.openAdvanced")}
        </Link>
      </section>
    </div>
  )
}

function StatusCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-stone-200 bg-stone-50 p-5">
      <div className="text-xs font-semibold uppercase tracking-[0.16em] text-stone-400">
        {label}
      </div>
      <div className="mt-2 text-lg font-semibold text-stone-900">{value}</div>
    </div>
  )
}

export default function App() {
  const { text } = useUiI18n()
  const setConnected = useChatStore((state) => state.setConnected)
  const initializeConnection = useConnectionStore((state) => state.initialize)
  const initializeCapabilities = useCapabilitiesStore((state) => state.initialize)
  const ensureRunsInitialized = useRunsStore((state) => state.ensureInitialized)
  const initializeUiMode = useUiModeStore((state) => state.initialize)
  const setupCompleted = useSetupStore((state) => state.state.completed)
  const initializeSetup = useSetupStore((state) => state.initialize)
  const setupInitialized = useSetupStore((state) => state.initialized)
  const [authState, setAuthState] = useState<boolean | null>(null)

  useEffect(() => {
    ensureRunsInitialized()
  }, [ensureRunsInitialized])

  useEffect(() => {
    void initializeConnection()
    void initializeCapabilities()
    void initializeSetup()
    void initializeUiMode()
  }, [initializeCapabilities, initializeConnection, initializeSetup, initializeUiMode])

  useEffect(() => {
    void checkAuth()
  }, [])

  async function checkAuth() {
    try {
      const response = await fetch("/api/status")
      if (response.ok) {
        setAuthState(true)
        initWs()
      } else if (response.status === 401) {
        setAuthState(false)
      } else {
        setAuthState(true)
        initWs()
      }
    } catch {
      setAuthState(true)
      initWs()
    }
  }

  function initWs() {
    connectWs()
    onWsMessage(handleWsMessage)
    onWsConnect((connected) => {
      setConnected(connected)
      if (connected) {
        void ensureRunsInitialized(true)
      }
    })
  }

  function handleLogin(token: string) {
    void token
    setAuthState(true)
    initWs()
  }

  if (authState === null) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-stone-100 text-sm text-stone-500">
        {text("연결 중...", "Connecting...")}
      </div>
    )
  }

  if (authState === false) {
    return <LoginPage onLogin={handleLogin} />
  }

  if (!setupInitialized) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-stone-100 text-sm text-stone-500">
        {text("setup 상태를 불러오는 중...", "Loading setup state...")}
      </div>
    )
  }

  return (
    <BrowserRouter>
      <Layout>
        <Routes>
          <Route path="/" element={<Navigate to={setupCompleted ? "/chat" : "/setup"} replace />} />
          <Route path="/setup" element={<SetupPage />} />
          <Route
            path="/chat"
            element={setupCompleted ? <ChatPage /> : <Navigate to="/setup" replace />}
          />
          <Route
            path="/tasks"
            element={setupCompleted ? <BeginnerTasksPage /> : <Navigate to="/setup" replace />}
          />
          <Route
            path="/status"
            element={setupCompleted ? <BeginnerStatusPage /> : <Navigate to="/setup" replace />}
          />
          <Route path="/runs/*" element={<LegacyAdvancedRedirect from="/runs" />} />
          <Route path="/dashboard/*" element={<LegacyAdvancedRedirect from="/dashboard" />} />
          <Route path="/audit/*" element={<LegacyAdvancedRedirect from="/audit" />} />
          <Route path="/schedules/*" element={<LegacyAdvancedRedirect from="/schedules" />} />
          <Route path="/plugins/*" element={<LegacyAdvancedRedirect from="/plugins" />} />
          <Route
            path="/topology/*"
            element={<LegacyAdvancedRedirect from="/advanced/topology" />}
          />
          <Route path="/settings/*" element={<Navigate to="/advanced/ai" replace />} />
          <Route path="/ai/*" element={<LegacyAdvancedRedirect from="/advanced/ai" />} />
          <Route
            path="/channels/*"
            element={<LegacyAdvancedRedirect from="/advanced/channels" />}
          />
          <Route
            path="/extensions/*"
            element={<LegacyAdvancedRedirect from="/advanced/extensions" />}
          />
          <Route path="/memory/*" element={<LegacyAdvancedRedirect from="/advanced/memory" />} />
          <Route path="/tools/*" element={<LegacyAdvancedRedirect from="/advanced/tools" />} />
          <Route path="/release/*" element={<LegacyAdvancedRedirect from="/advanced/release" />} />
          <Route path="/advanced" element={<Navigate to="/advanced/dashboard" replace />} />
          <Route
            path="/advanced/chat"
            element={
              setupCompleted ? (
                <AdvancedOnly>
                  <ChatPage />
                </AdvancedOnly>
              ) : (
                <Navigate to="/setup" replace />
              )
            }
          />
          <Route
            path="/advanced/runs"
            element={
              setupCompleted ? (
                <AdvancedOnly>
                  <LazyPage>
                    <RunsPage />
                  </LazyPage>
                </AdvancedOnly>
              ) : (
                <Navigate to="/setup" replace />
              )
            }
          />
          <Route
            path="/advanced/runs/*"
            element={
              setupCompleted ? (
                <AdvancedOnly>
                  <LazyPage>
                    <RunsPage />
                  </LazyPage>
                </AdvancedOnly>
              ) : (
                <Navigate to="/setup" replace />
              )
            }
          />
          <Route
            path="/advanced/ai"
            element={
              <AdvancedOnly>
                <LazyPage>
                  <SettingsPage />
                </LazyPage>
              </AdvancedOnly>
            }
          />
          <Route
            path="/advanced/ai/*"
            element={
              <AdvancedOnly>
                <LazyPage>
                  <SettingsPage />
                </LazyPage>
              </AdvancedOnly>
            }
          />
          <Route
            path="/advanced/channels"
            element={
              <AdvancedOnly>
                <LazyPage>
                  <SettingsPage />
                </LazyPage>
              </AdvancedOnly>
            }
          />
          <Route
            path="/advanced/channels/*"
            element={
              <AdvancedOnly>
                <LazyPage>
                  <SettingsPage />
                </LazyPage>
              </AdvancedOnly>
            }
          />
          <Route
            path="/advanced/extensions"
            element={
              <AdvancedOnly>
                <LazyPage>
                  <SettingsPage />
                </LazyPage>
              </AdvancedOnly>
            }
          />
          <Route
            path="/advanced/extensions/*"
            element={
              <AdvancedOnly>
                <LazyPage>
                  <SettingsPage />
                </LazyPage>
              </AdvancedOnly>
            }
          />
          <Route
            path="/advanced/dashboard"
            element={
              setupCompleted ? (
                <AdvancedOnly>
                  <LazyPage>
                    <DashboardPage />
                  </LazyPage>
                </AdvancedOnly>
              ) : (
                <Navigate to="/setup" replace />
              )
            }
          />
          <Route
            path="/advanced/dashboard/*"
            element={
              setupCompleted ? (
                <AdvancedOnly>
                  <LazyPage>
                    <DashboardPage />
                  </LazyPage>
                </AdvancedOnly>
              ) : (
                <Navigate to="/setup" replace />
              )
            }
          />
          <Route
            path="/advanced/audit"
            element={
              setupCompleted ? (
                <AdvancedOnly>
                  <LazyPage>
                    <AuditPage />
                  </LazyPage>
                </AdvancedOnly>
              ) : (
                <Navigate to="/setup" replace />
              )
            }
          />
          <Route
            path="/advanced/audit/*"
            element={
              setupCompleted ? (
                <AdvancedOnly>
                  <LazyPage>
                    <AuditPage />
                  </LazyPage>
                </AdvancedOnly>
              ) : (
                <Navigate to="/setup" replace />
              )
            }
          />
          <Route
            path="/advanced/schedules"
            element={
              setupCompleted ? (
                <AdvancedOnly>
                  <LazyPage>
                    <SchedulePage />
                  </LazyPage>
                </AdvancedOnly>
              ) : (
                <Navigate to="/setup" replace />
              )
            }
          />
          <Route
            path="/advanced/schedules/*"
            element={
              setupCompleted ? (
                <AdvancedOnly>
                  <LazyPage>
                    <SchedulePage />
                  </LazyPage>
                </AdvancedOnly>
              ) : (
                <Navigate to="/setup" replace />
              )
            }
          />
          <Route
            path="/advanced/topology"
            element={
              setupCompleted ? (
                <AdvancedOnly>
                  <LazyPage>
                    <TopologyPage />
                  </LazyPage>
                </AdvancedOnly>
              ) : (
                <Navigate to="/setup" replace />
              )
            }
          />
          <Route
            path="/advanced/topology/*"
            element={
              setupCompleted ? (
                <AdvancedOnly>
                  <LazyPage>
                    <TopologyPage />
                  </LazyPage>
                </AdvancedOnly>
              ) : (
                <Navigate to="/setup" replace />
              )
            }
          />
          <Route
            path="/advanced/orchestration"
            element={
              <AdvancedOnly>
                <LazyPage>
                  <SettingsPage />
                </LazyPage>
              </AdvancedOnly>
            }
          />
          <Route
            path="/advanced/orchestration/*"
            element={
              <AdvancedOnly>
                <LazyPage>
                  <SettingsPage />
                </LazyPage>
              </AdvancedOnly>
            }
          />
          <Route
            path="/advanced/memory"
            element={
              <AdvancedOnly>
                <LazyPage>
                  <SettingsPage />
                </LazyPage>
              </AdvancedOnly>
            }
          />
          <Route
            path="/advanced/memory/*"
            element={
              <AdvancedOnly>
                <LazyPage>
                  <SettingsPage />
                </LazyPage>
              </AdvancedOnly>
            }
          />
          <Route
            path="/advanced/tools"
            element={
              <AdvancedOnly>
                <LazyPage>
                  <SettingsPage />
                </LazyPage>
              </AdvancedOnly>
            }
          />
          <Route
            path="/advanced/tools/*"
            element={
              <AdvancedOnly>
                <LazyPage>
                  <SettingsPage />
                </LazyPage>
              </AdvancedOnly>
            }
          />
          <Route
            path="/advanced/release"
            element={
              <AdvancedOnly>
                <LazyPage>
                  <SettingsPage />
                </LazyPage>
              </AdvancedOnly>
            }
          />
          <Route
            path="/advanced/release/*"
            element={
              <AdvancedOnly>
                <LazyPage>
                  <SettingsPage />
                </LazyPage>
              </AdvancedOnly>
            }
          />
          <Route
            path="/advanced/plugins"
            element={
              setupCompleted ? (
                <AdvancedOnly>
                  <LazyPage>
                    <PluginsPage />
                  </LazyPage>
                </AdvancedOnly>
              ) : (
                <Navigate to="/setup" replace />
              )
            }
          />
          <Route
            path="/advanced/plugins/*"
            element={
              setupCompleted ? (
                <AdvancedOnly>
                  <LazyPage>
                    <PluginsPage />
                  </LazyPage>
                </AdvancedOnly>
              ) : (
                <Navigate to="/setup" replace />
              )
            }
          />
          <Route path="/advanced/settings" element={<Navigate to="/advanced/ai" replace />} />
          <Route path="/advanced/settings/*" element={<Navigate to="/advanced/ai" replace />} />
          <Route
            path="/admin/*"
            element={
              <AdminOnly>
                <AdminShellPage />
              </AdminOnly>
            }
          />
          <Route path="/login" element={<LoginPage onLogin={handleLogin} />} />
          <Route path="*" element={<Navigate to={setupCompleted ? "/chat" : "/setup"} replace />} />
        </Routes>
      </Layout>
    </BrowserRouter>
  )
}
