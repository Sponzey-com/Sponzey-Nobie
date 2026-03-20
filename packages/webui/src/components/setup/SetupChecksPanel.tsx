import type { SetupChecksResponse } from "../../api/adapters/types"
import { useUiI18n } from "../../lib/ui-i18n"

export function SetupChecksPanel({
  checks,
  loading,
  onRefresh,
}: {
  checks: SetupChecksResponse | null
  loading: boolean
  onRefresh: () => void
}) {
  const { text } = useUiI18n()

  return (
    <div className="rounded-3xl border border-stone-200 bg-white p-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="text-sm font-semibold text-stone-900">{text("로컬 제어면 체크", "Local Control Plane Check")}</div>
        </div>
        <button
          onClick={onRefresh}
          disabled={loading}
          className="rounded-xl border border-stone-200 bg-white px-4 py-2 text-sm font-semibold text-stone-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {loading ? text("갱신 중...", "Refreshing...") : text("다시 확인", "Refresh")}
        </button>
      </div>

      {checks ? (
        <div className="mt-5 space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <CheckStat label={text("Setup 완료", "Setup Complete")} value={checks.setupCompleted ? text("예", "Yes") : text("아니오", "No")} tone={checks.setupCompleted ? "ready" : "disabled"} />
            <CheckStat label={text("Telegram 토큰", "Telegram Token")} value={checks.telegramConfigured ? text("설정됨", "Configured") : text("비어 있음", "Empty")} tone={checks.telegramConfigured ? "ready" : "disabled"} />
            <CheckStat label={text("WebUI 인증", "WebUI Authentication")} value={checks.authEnabled ? text("활성", "Enabled") : text("비활성", "Disabled")} tone={checks.authEnabled ? "ready" : "disabled"} />
            <CheckStat label="Scheduler" value={checks.schedulerEnabled ? text("활성", "Enabled") : text("비활성", "Disabled")} tone={checks.schedulerEnabled ? "ready" : "disabled"} />
          </div>
          <div className="space-y-3 rounded-2xl bg-stone-50 p-4 text-sm text-stone-700">
            <PathRow label={text("상태 폴더", "State Dir")} value={checks.stateDir} />
            <PathRow label={text("설정 파일", "Config File")} value={checks.configFile} />
            <PathRow label={text("설정 상태 파일", "Setup State")} value={checks.setupStateFile} />
          </div>
        </div>
      ) : null}
    </div>
  )
}

function CheckStat({
  label,
  value,
  tone,
}: {
  label: string
  value: string
  tone: "ready" | "disabled"
}) {
  return (
    <div className="rounded-2xl border border-stone-200 bg-stone-50 p-4">
      <div className="text-xs font-semibold uppercase tracking-wide text-stone-500">{label}</div>
      <div className="mt-2 flex items-center gap-2">
        <span className={`h-2.5 w-2.5 rounded-full ${tone === "ready" ? "bg-emerald-500" : "bg-stone-300"}`} />
        <span className="text-sm font-semibold text-stone-900">{value}</span>
      </div>
    </div>
  )
}

function PathRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid gap-1 md:grid-cols-[8rem_1fr] md:items-start">
      <div className="text-xs font-semibold uppercase tracking-wide text-stone-500">{label}</div>
      <div className="break-all font-mono text-xs text-stone-700">{value}</div>
    </div>
  )
}
