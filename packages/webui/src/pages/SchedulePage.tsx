import { EmptyState } from "../components/EmptyState"
import { FeatureGate } from "../components/FeatureGate"
import { useUiI18n } from "../lib/ui-i18n"

export function SchedulePage() {
  const { text } = useUiI18n()

  return (
    <div className="h-full overflow-y-auto bg-stone-100 p-6">
      <div className="rounded-[1.75rem] border border-stone-200 bg-white p-6">
        <div className="text-xs font-semibold uppercase tracking-[0.2em] text-stone-500">Schedules</div>
        <h1 className="mt-2 text-2xl font-semibold text-stone-900">{text("스케줄 관리", "Schedule management")}</h1>
        <p className="mt-2 max-w-3xl text-sm leading-7 text-stone-600">
          {text("실제 스케줄러가 연결되면 등록된 예약 작업만 이 화면에 표시됩니다.", "Only real schedules will appear here once the scheduler is connected.")}
        </p>
      </div>

      <div className="mt-6">
        <FeatureGate capabilityKey="scheduler.core" title="Scheduler">
          <div className="rounded-[1.75rem] border border-stone-200 bg-white p-6">
            <EmptyState
              title={text("표시할 예약 작업이 없습니다", "No schedules to show")}
              description={text(
                "예약 작업이 실제로 연결되면 이 화면에 목록이 나타납니다.",
                "Scheduled jobs will appear here when they are actually connected.",
              )}
            />
          </div>
        </FeatureGate>
      </div>
    </div>
  )
}
