import { useEffect, useMemo, useState } from "react"
import { Link } from "react-router-dom"
import { api } from "../api/client"
import { ActiveInstructionsPanel } from "../components/ActiveInstructionsPanel"
import { CapabilityBadge } from "../components/CapabilityBadge"
import type { DoctorReport, DoctorStatus } from "../contracts/doctor"
import {
  buildAdvancedDashboardCards,
  loadAdvancedDashboardSources,
  type AdvancedDashboardCardStatus,
  type AdvancedDashboardLoadErrors,
  type AdvancedDashboardSources,
} from "../lib/advanced-dashboard"
import { getAIProviderDisplayLabel, getBackendDisplayLabel } from "../lib/ai-display"
import { useUiI18n } from "../lib/ui-i18n"
import { useCapabilitiesStore } from "../stores/capabilities"
import { useConnectionStore } from "../stores/connection"
import { useSetupStore } from "../stores/setup"

export function DashboardPage() {
  const { text, displayText, language } = useUiI18n()
  const connected = useConnectionStore((state) => state.connected)
  const adapter = useConnectionStore((state) => state.adapter)
  const status = useConnectionStore((state) => state.status)
  const lastError = useConnectionStore((state) => state.lastError)
  const refreshConnection = useConnectionStore((state) => state.refresh)
  const { items, counts } = useCapabilitiesStore()
  const setupState = useSetupStore((state) => state.state)
  const draft = useSetupStore((state) => state.draft)
  const checks = useSetupStore((state) => state.checks)
  const [doctorReport, setDoctorReport] = useState<DoctorReport | null>(null)
  const [doctorError, setDoctorError] = useState<string | null>(null)
  const [doctorLoading, setDoctorLoading] = useState(false)
  const [advancedSources, setAdvancedSources] = useState<AdvancedDashboardSources>({})
  const [advancedLoadErrors, setAdvancedLoadErrors] = useState<AdvancedDashboardLoadErrors>({})
  const [advancedCardsLoading, setAdvancedCardsLoading] = useState(false)

  const capabilityCounts = status?.capabilityCounts ?? counts
  const fastResponse = status?.fast_response_health
  const ingressAckMetric = fastResponse?.metrics.find((metric) => metric.name === "ingress_ack_latency_ms")
  const contractComparisonMetric = fastResponse?.metrics.find((metric) => metric.name === "contract_ai_comparison_latency_ms")
  const enabledBackends = draft.aiBackends.filter((backend) => backend.enabled)
  const configuredBackends = draft.aiBackends.filter(
    (backend) =>
      backend.endpoint?.trim() ||
      backend.defaultModel.trim() ||
      backend.credentials.apiKey?.trim() ||
      backend.credentials.username?.trim(),
  )
  const visibleBackends = draft.aiBackends.filter(
    (backend) => backend.enabled || backend.endpoint?.trim() || backend.defaultModel.trim(),
  )
  const advancedDashboardCards = useMemo(() => buildAdvancedDashboardCards({
    draft,
    checks,
    status: advancedSources.status ?? status,
    runs: advancedSources.runs,
    operations: advancedSources.operations,
    doctor: advancedSources.doctor ?? doctorReport,
    errors: advancedLoadErrors,
    loading: advancedCardsLoading,
    language,
  }), [advancedCardsLoading, advancedLoadErrors, advancedSources, checks, doctorReport, draft, language, status])

  const primaryTargetLabel = useMemo(() => {
    const target = status?.primaryAiTarget
    if (!target) return ""
    const backend = draft.aiBackends.find((item) => item.id === target)
    return getBackendDisplayLabel(backend?.id ?? target, backend?.label ?? target, language)
  }, [draft.aiBackends, status?.primaryAiTarget])

  useEffect(() => {
    void loadAdvancedDashboard()
  }, [])

  async function loadAdvancedDashboard() {
    setAdvancedCardsLoading(true)
    setDoctorLoading(true)
    setDoctorError(null)
    const result = await loadAdvancedDashboardSources({
      status: api.status,
      runs: async () => (await api.runs()).runs,
      operations: async () => (await api.runOperationsSummary()).summary,
      doctor: async () => (await api.doctor("quick")).report,
    }, language)
    setAdvancedSources(result.sources)
    setAdvancedLoadErrors(result.errors)
    setDoctorReport(result.sources.doctor ?? null)
    setDoctorError(result.errors.doctor ?? null)
    setDoctorLoading(false)
    setAdvancedCardsLoading(false)
  }

  async function runDoctorQuick() {
    setDoctorLoading(true)
    setDoctorError(null)
    try {
      const result = await loadAdvancedDashboardSources({
        doctor: async () => (await api.doctor("quick")).report,
      }, language)
      if (result.sources.doctor) {
        setDoctorReport(result.sources.doctor)
        setAdvancedSources((current) => ({ ...current, doctor: result.sources.doctor }))
        setAdvancedLoadErrors((current) => {
          const { doctor: _doctor, ...rest } = current
          return rest
        })
      } else if (result.errors.doctor) {
        setDoctorError(result.errors.doctor)
        setAdvancedLoadErrors((current) => ({ ...current, doctor: result.errors.doctor }))
      }
    } finally {
      setDoctorLoading(false)
    }
  }

  return (
    <div className="h-full overflow-y-auto bg-stone-100 p-6">
      <section className="rounded-[2rem] bg-[#171717] px-8 py-8 text-white">
        <div className="flex flex-col gap-6 xl:flex-row xl:items-end xl:justify-between">
          <div>
            <h1 className="text-3xl font-semibold">{text("대시보드", "Dashboard")}</h1>
            <div className="mt-4 grid gap-2 text-sm text-stone-300">
              <InlineStat label={text("Gateway 연결", "Gateway connection")} value={connected ? text("연결됨", "Connected") : text("연결 안 됨", "Disconnected")} />
              <InlineStat label="Adapter" value={adapter} />
              <InlineStat label={text("Setup 완료", "Setup complete")} value={setupState.completed ? text("완료", "Completed") : text("미완료", "Not completed")} />
              <InlineStat label={text("현재 단계", "Current step")} value={setupState.currentStep} />
            </div>
          </div>
          <div className="flex flex-wrap gap-3">
            <Link
              to={setupState.completed ? "/chat" : "/setup"}
              className="rounded-xl bg-white px-4 py-2.5 text-sm font-semibold text-stone-900"
            >
              {setupState.completed ? text("채팅 열기", "Open chat") : text("Setup 열기", "Open setup")}
            </Link>
            <Link
              to="/settings"
              className="rounded-xl border border-white/10 px-4 py-2.5 text-sm font-semibold text-white"
            >
              {text("설정", "Settings")}
            </Link>
            <button
              onClick={() => { void refreshConnection(); void loadAdvancedDashboard() }}
              className="rounded-xl border border-white/10 px-4 py-2.5 text-sm font-semibold text-white"
            >
              {text("새로고침", "Refresh")}
            </button>
          </div>
        </div>
        {lastError ? (
          <div className="mt-5 rounded-2xl bg-red-500/10 px-4 py-3 text-sm text-red-200">{displayText(lastError)}</div>
        ) : null}
      </section>

      <section className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-5">
        {advancedDashboardCards.map((card) => (
          <AdvancedDashboardCard key={card.id} card={card} />
        ))}
      </section>

      <section className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard label={text("준비됨", "Ready")} value={String(capabilityCounts.ready)} />
        <MetricCard label={text("비활성", "Disabled")} value={String(capabilityCounts.disabled)} />
        <MetricCard label={text("활성 AI", "Enabled Backends")} value={String(enabledBackends.length)} />
        <MetricCard label={text("설정된 AI", "Configured Backends")} value={String(configuredBackends.length)} />
      </section>

      <section className="mt-6 grid gap-6 xl:grid-cols-[1.05fr_0.95fr]">
        <div className="space-y-6">
          <div className="rounded-2xl border border-stone-200 bg-white p-5">
            <div className="text-sm font-semibold text-stone-900">{text("기능 상태", "Capabilities")}</div>
            <div className="mt-5 grid gap-3">
              {items.map((item) => (
                <div
                  key={item.key}
                  className="flex items-start justify-between gap-4 rounded-2xl border border-stone-200 bg-stone-50 px-4 py-3"
                >
                  <div className="min-w-0">
                    <div className="text-sm font-semibold text-stone-900">{item.label}</div>
                    <div className="mt-1 text-xs text-stone-500">{item.key}</div>
                    {item.reason ? <div className="mt-2 text-xs leading-5 text-stone-600">{displayText(item.reason)}</div> : null}
                  </div>
                  <CapabilityBadge status={item.status} />
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-2xl border border-stone-200 bg-white p-5">
            <div className="text-sm font-semibold text-stone-900">{text("AI 연결", "AI connection")}</div>
            <div className="mt-5 space-y-3">
              {visibleBackends.map((backend) => (
                <div key={backend.id} className="rounded-2xl border border-stone-200 bg-stone-50 px-4 py-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-sm font-semibold text-stone-900">{getBackendDisplayLabel(backend.id, backend.label, language)}</div>
                      <div className="mt-1 text-xs text-stone-500">{backend.kind}</div>
                    </div>
                    <CapabilityBadge status={backend.status} />
                  </div>
                  <div className="mt-3 grid gap-2 text-sm text-stone-600">
                    {backend.providerType ? <StatusRow label={text("AI 종류", "AI type")} value={getAIProviderDisplayLabel(backend.providerType, language)} /> : null}
                    {backend.endpoint?.trim() ? <StatusRow label={text("엔드포인트", "Endpoint")} value={backend.endpoint} mono /> : null}
                    {backend.defaultModel.trim() ? <StatusRow label={text("기본 모델", "Default model")} value={backend.defaultModel} mono /> : null}
                    <StatusRow label={text("활성화", "Enabled")} value={backend.enabled ? text("예", "Yes") : text("아니오", "No")} />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="space-y-6">
          <ActiveInstructionsPanel />

          <DoctorPanel
            report={doctorReport}
            loading={doctorLoading}
            error={doctorError}
            onRefresh={() => void runDoctorQuick()}
          />

          <div className="rounded-2xl border border-stone-200 bg-white p-5">
            <div className="text-sm font-semibold text-stone-900">{text("Gateway 상태", "Gateway status")}</div>
            <div className="mt-4 space-y-3 text-sm text-stone-600">
              <StatusRow label={text("버전", "Version")} value={status?.version ?? ""} />
              <StatusRow label="Provider" value={status?.provider ?? ""} />
              <StatusRow label="Model" value={status?.model ?? ""} mono />
              <StatusRow label="Uptime" value={status ? `${status.uptime}s` : ""} />
              <StatusRow label={text("도구 수", "Tool count")} value={status ? String(status.toolCount) : ""} />
              <StatusRow label={text("기본 대상", "Primary target")} value={primaryTargetLabel} />
              <StatusRow label="Orchestrator" value={status?.orchestratorStatus.status ?? ""} />
              <StatusRow label={text("동작 모드", "Runtime mode")} value={status?.orchestration?.mode ?? status?.orchestratorStatus.mode ?? ""} />
              {status?.orchestration ? <StatusRow label={text("활성 서브 에이전트", "Active sub-agents")} value={`${status.orchestration.activeSubAgentCount}/${status.orchestration.totalSubAgentCount}`} /> : null}
              {status?.orchestratorStatus.reason ? <StatusRow label={text("오케스트레이터 사유", "Orchestrator reason")} value={displayText(status.orchestratorStatus.reason)} /> : null}
              {fastResponse ? <StatusRow label={text("빠른 응답", "Fast response")} value={`${fastResponse.status} · ${displayText(fastResponse.reason)}`} /> : null}
              {ingressAckMetric?.p95Ms != null ? <StatusRow label={text("접수 응답 p95", "Ack p95")} value={`${ingressAckMetric.p95Ms}ms / ${ingressAckMetric.budgetMs}ms`} /> : null}
              {contractComparisonMetric?.p95Ms != null ? <StatusRow label={text("AI 비교 p95", "AI comparison p95")} value={`${contractComparisonMetric.p95Ms}ms / ${contractComparisonMetric.budgetMs}ms`} /> : null}
              {status?.startupRecovery ? <StatusRow label={text("재시작 복구", "Startup recovery")} value={displayText(status.startupRecovery.userFacingSummary)} /> : null}
              {status?.startupRecovery?.recoveredRunCount ? <StatusRow label={text("복구된 실행", "Recovered runs")} value={String(status.startupRecovery.recoveredRunCount)} /> : null}
              {status?.startupRecovery?.interruptedScheduleRunCount ? <StatusRow label={text("중단된 예약", "Interrupted schedules")} value={String(status.startupRecovery.interruptedScheduleRunCount)} /> : null}
            </div>
          </div>

          <div className="rounded-2xl border border-stone-200 bg-white p-5">
            <div className="text-sm font-semibold text-stone-900">{text("설정 상태", "Setup status")}</div>
            <div className="mt-4 space-y-3 text-sm text-stone-600">
              <StatusRow label={text("Setup 완료", "Setup complete")} value={checks?.setupCompleted ? text("예", "Yes") : text("아니오", "No")} />
              <StatusRow label={text("Telegram 토큰", "Telegram token")} value={checks?.telegramConfigured ? text("설정됨", "Configured") : ""} />
              <StatusRow label={text("Telegram 사용", "Telegram enabled")} value={draft.channels.telegramEnabled ? text("예", "Yes") : text("아니오", "No")} />
              <StatusRow label={text("MQTT 사용", "MQTT enabled")} value={draft.mqtt.enabled ? text("예", "Yes") : text("아니오", "No")} />
              <StatusRow label="MQTT Host" value={draft.mqtt.host} mono />
              <StatusRow label="MQTT Port" value={String(draft.mqtt.port)} />
              <StatusRow label="WebUI Host" value={draft.remoteAccess.host} mono />
              <StatusRow label="WebUI Port" value={String(draft.remoteAccess.port)} />
              <StatusRow label={text("WebUI 인증", "WebUI auth")} value={draft.remoteAccess.authEnabled ? text("예", "Yes") : text("아니오", "No")} />
              <StatusRow label="Scheduler" value={checks?.schedulerEnabled ? text("예", "Yes") : text("아니오", "No")} />
            </div>
          </div>

          <div className="rounded-2xl border border-stone-200 bg-white p-5">
            <div className="text-sm font-semibold text-stone-900">{text("경로", "Paths")}</div>
            <div className="mt-4 space-y-3 text-sm text-stone-600">
              <StatusRow label="State Dir" value={status?.paths.stateDir ?? checks?.stateDir ?? ""} mono />
              <StatusRow label="Config File" value={status?.paths.configFile ?? checks?.configFile ?? ""} mono />
              <StatusRow label="Setup State" value={status?.paths.setupStateFile ?? checks?.setupStateFile ?? ""} mono />
              <StatusRow label="DB File" value={status?.paths.dbFile ?? ""} mono />
            </div>
          </div>
        </div>
      </section>
    </div>
  )
}

function doctorTone(status: DoctorStatus): string {
  switch (status) {
    case "ok":
      return "border-emerald-200 bg-emerald-50 text-emerald-700"
    case "warning":
      return "border-amber-200 bg-amber-50 text-amber-700"
    case "blocked":
      return "border-red-200 bg-red-50 text-red-700"
    case "unknown":
    default:
      return "border-stone-200 bg-stone-100 text-stone-600"
  }
}

function advancedCardTone(status: AdvancedDashboardCardStatus): string {
  switch (status) {
    case "ready":
      return "border-emerald-200 bg-emerald-50 text-emerald-700"
    case "loading":
      return "border-blue-200 bg-blue-50 text-blue-700"
    case "error":
      return "border-red-200 bg-red-50 text-red-700"
    case "idle":
      return "border-stone-200 bg-stone-100 text-stone-700"
  }
}

function AdvancedDashboardCard({ card }: { card: ReturnType<typeof buildAdvancedDashboardCards>[number] }) {
  const { text, displayText } = useUiI18n()
  return (
    <Link to={card.href} className="rounded-2xl border border-stone-200 bg-white p-5 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm font-semibold text-stone-900">{card.title}</div>
          <div className="mt-2 text-3xl font-semibold text-stone-900">{card.value}</div>
        </div>
        <span className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold ${advancedCardTone(card.status)}`}>
          {card.status === "loading" ? text("로딩", "Loading") : card.status === "error" ? text("오류", "Error") : card.status === "idle" ? text("대기", "Idle") : text("정상", "Ready")}
        </span>
      </div>
      <div className="mt-3 line-clamp-2 text-sm leading-6 text-stone-600">{displayText(card.summary)}</div>
      {card.items.length ? (
        <div className="mt-4 space-y-2">
          {card.items.slice(0, 3).map((item) => (
            <div key={item} className="truncate rounded-xl bg-stone-50 px-3 py-2 text-xs text-stone-600" title={displayText(item)}>
              {displayText(item)}
            </div>
          ))}
        </div>
      ) : null}
    </Link>
  )
}

function DoctorPanel({ report, loading, error, onRefresh }: {
  report: DoctorReport | null
  loading: boolean
  error: string | null
  onRefresh: () => void
}) {
  const { text, displayText } = useUiI18n()
  const visibleChecks = report?.checks.filter((check) => check.status !== "ok").slice(0, 6) ?? []
  return (
    <div className="rounded-2xl border border-stone-200 bg-white p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="text-sm font-semibold text-stone-900">{text("운영 진단", "Doctor")}</div>
          <div className="mt-1 text-xs text-stone-500">
            {report ? `${report.mode} · ${new Date(report.createdAt).toLocaleString()}` : text("아직 실행 전", "Not run yet")}
          </div>
        </div>
        <button onClick={onRefresh} disabled={loading} className="rounded-xl border border-stone-200 px-3 py-2 text-xs font-semibold text-stone-700 disabled:opacity-50">
          {loading ? text("확인 중", "Checking") : text("다시 확인", "Run")}
        </button>
      </div>
      {error ? <div className="mt-4 rounded-xl bg-red-50 px-3 py-3 text-sm text-red-700">{displayText(error)}</div> : null}
      {report ? (
        <div className="mt-4 space-y-3">
          <div className="grid gap-2 text-sm text-stone-600">
            <StatusRow label={text("전체 상태", "Overall")} value={report.overallStatus} />
            <StatusRow label="Manifest" value={report.runtimeManifestId} mono />
            <StatusRow label="Checks" value={`ok=${report.summary.ok}, warn=${report.summary.warning}, blocked=${report.summary.blocked}, unknown=${report.summary.unknown}`} />
          </div>
          <div className="space-y-2">
            {(visibleChecks.length > 0 ? visibleChecks : report.checks.slice(0, 3)).map((check) => (
              <div key={check.name} className={`rounded-xl border px-3 py-2 text-xs leading-5 ${doctorTone(check.status)}`}>
                <div className="font-semibold">{check.name} · {check.status}</div>
                <div className="mt-1">{displayText(check.message)}</div>
                {check.guide ? <div className="mt-1 text-[11px] opacity-80">{displayText(check.guide)}</div> : null}
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  )
}

function MetricCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-stone-200 bg-white p-5">
      <div className="text-xs font-semibold uppercase tracking-wide text-stone-500">{label}</div>
      <div className="mt-3 text-3xl font-semibold text-stone-900">{value}</div>
    </div>
  )
}

function InlineStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-stone-500">{label}</span>
      <span className="font-medium text-white">{value}</span>
    </div>
  )
}

function StatusRow({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-3 rounded-xl bg-stone-50 px-3 py-2">
      <span className="text-stone-500">{label}</span>
      <span className={`break-all text-right font-medium text-stone-900 ${mono ? "font-mono text-xs" : ""}`}>{value}</span>
    </div>
  )
}
