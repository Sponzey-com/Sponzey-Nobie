import { useMemo } from "react"
import { Link } from "react-router-dom"
import { ActiveInstructionsPanel } from "../components/ActiveInstructionsPanel"
import { CapabilityBadge } from "../components/CapabilityBadge"
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

  const capabilityCounts = status?.capabilityCounts ?? counts
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

  const primaryTargetLabel = useMemo(() => {
    const target = status?.primaryAiTarget
    if (!target) return ""
    const backend = draft.aiBackends.find((item) => item.id === target)
    return getBackendDisplayLabel(backend?.id ?? target, backend?.label ?? target, language)
  }, [draft.aiBackends, status?.primaryAiTarget])

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
              onClick={() => void refreshConnection()}
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
              {status?.orchestratorStatus.reason ? <StatusRow label={text("오케스트레이터 사유", "Orchestrator reason")} value={displayText(status.orchestratorStatus.reason)} /> : null}
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
