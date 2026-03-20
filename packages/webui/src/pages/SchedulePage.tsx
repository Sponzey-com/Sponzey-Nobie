import { FeatureGate } from "../components/FeatureGate"
import { useUiI18n } from "../lib/ui-i18n"

const MOCK_SCHEDULES = [
  { name: "Morning Brief", cron: "0 9 * * 1-5", summary: "평일 오전 브리핑 생성", status: "planned" },
  { name: "Plugin Health Check", cron: "*/30 * * * *", summary: "플러그인 상태 점검", status: "planned" },
]

export function SchedulePage() {
  const { text, displayText } = useUiI18n()

  return (
    <div className="h-full overflow-y-auto bg-stone-100 p-6">
      <div className="rounded-[1.75rem] border border-stone-200 bg-white p-6">
        <div className="text-xs font-semibold uppercase tracking-[0.2em] text-stone-500">Schedules</div>
        <h1 className="mt-2 text-2xl font-semibold text-stone-900">{text("스케줄 관리", "Schedule management")}</h1>
        <p className="mt-2 max-w-3xl text-sm leading-7 text-stone-600">
          {text("phase0001에서는 스케줄러 동작을 붙이기 전에, 목록 구조와 생성/실행 액션이 어떤 상태로 노출될지 먼저 확정합니다.", "In phase0001, the UI first fixes how schedule lists and create/run actions should appear before the real scheduler is connected.")}
        </p>
      </div>

      <div className="mt-6">
        <FeatureGate capabilityKey="scheduler.core" title="Scheduler">
          <div className="grid gap-4 xl:grid-cols-2">
            {MOCK_SCHEDULES.map((schedule) => (
              <div key={schedule.name} className="rounded-[1.75rem] border border-stone-200 bg-white p-5">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-sm font-semibold text-stone-900">{schedule.name}</div>
                    <div className="mt-1 font-mono text-xs text-stone-500">{schedule.cron}</div>
                  </div>
                  <span className="rounded-full bg-stone-100 px-3 py-1 text-[11px] uppercase tracking-wide text-stone-600">
                    {schedule.status}
                  </span>
                </div>
                <p className="mt-4 text-sm leading-6 text-stone-600">{displayText(schedule.summary)}</p>
                <div className="mt-5 flex gap-3">
                  <button
                    disabled
                    className="rounded-xl border border-stone-200 px-3 py-2 text-xs font-semibold text-stone-400"
                  >
                    {text("지금 실행", "Run now")}
                  </button>
                  <button
                    disabled
                    className="rounded-xl border border-stone-200 px-3 py-2 text-xs font-semibold text-stone-400"
                  >
                    {text("편집", "Edit")}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </FeatureGate>
      </div>
    </div>
  )
}
