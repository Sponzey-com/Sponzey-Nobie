import { useCallback, useEffect, useMemo, useState } from "react"
import { EmptyState } from "../components/EmptyState"
import { ErrorState } from "../components/ErrorState"
import { FeatureGate } from "../components/FeatureGate"
import { api, type Schedule, type ScheduleRun } from "../api/client"
import { useUiI18n } from "../lib/ui-i18n"

interface SchedulerHealth {
  running: boolean
  activeJobs: number
  activeJobIds: string[]
  nextRuns: Array<{ scheduleId: string; name: string; nextRunAt: number }>
}

function formatDateTime(value: number | null | undefined, fallback: string): string {
  if (!value) return fallback
  return new Date(value).toLocaleString()
}

function describeRunResult(run: ScheduleRun, text: (ko: string, en: string) => string): string {
  if (run.success === true) return text("성공", "Success")
  if (run.success === false) return text("실패", "Failed")
  if (!run.finished_at) return text("실행 중", "Running")
  return text("결과 없음", "No result")
}

export function SchedulePage() {
  const { text, displayText } = useUiI18n()
  const [schedules, setSchedules] = useState<Schedule[]>([])
  const [health, setHealth] = useState<SchedulerHealth | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [runs, setRuns] = useState<ScheduleRun[]>([])
  const [loading, setLoading] = useState(false)
  const [runsLoading, setRunsLoading] = useState(false)
  const [actionId, setActionId] = useState<string | null>(null)
  const [error, setError] = useState("")

  const selectedSchedule = useMemo(
    () => schedules.find((schedule) => schedule.id === selectedId) ?? schedules[0] ?? null,
    [schedules, selectedId],
  )

  const loadSchedules = useCallback(async () => {
    setLoading(true)
    try {
      const [scheduleResponse, schedulerHealth] = await Promise.all([api.schedules(), api.schedulerHealth()])
      setSchedules(scheduleResponse.schedules)
      setHealth(schedulerHealth)
      setSelectedId((current) => current && scheduleResponse.schedules.some((schedule) => schedule.id === current)
        ? current
        : scheduleResponse.schedules[0]?.id ?? null)
      setError("")
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : String(loadError))
    } finally {
      setLoading(false)
    }
  }, [])

  const loadScheduleRuns = useCallback(async (scheduleId: string) => {
    setRunsLoading(true)
    try {
      const response = await api.scheduleRuns(scheduleId, 1, 10)
      setRuns(response.items)
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : String(loadError))
    } finally {
      setRunsLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadSchedules()
  }, [loadSchedules])

  useEffect(() => {
    if (!selectedSchedule) {
      setRuns([])
      return
    }
    void loadScheduleRuns(selectedSchedule.id)
  }, [loadScheduleRuns, selectedSchedule])

  async function handleToggle(schedule: Schedule): Promise<void> {
    setActionId(schedule.id)
    try {
      await api.toggleSchedule(schedule.id)
      await loadSchedules()
      setError("")
    } catch (toggleError) {
      setError(toggleError instanceof Error ? toggleError.message : String(toggleError))
    } finally {
      setActionId(null)
    }
  }

  async function handleRunNow(schedule: Schedule): Promise<void> {
    setActionId(schedule.id)
    try {
      await api.runScheduleNow(schedule.id)
      await loadSchedules()
      await loadScheduleRuns(schedule.id)
      setError("")
    } catch (runError) {
      setError(runError instanceof Error ? runError.message : String(runError))
    } finally {
      setActionId(null)
    }
  }

  return (
    <div className="h-full overflow-y-auto bg-stone-100 p-6">
      <div className="rounded-[1.75rem] border border-stone-200 bg-white p-6">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
          <div>
            <div className="text-xs font-semibold uppercase tracking-[0.2em] text-stone-500">{text("예약 작업", "Schedules")}</div>
            <h1 className="mt-2 text-2xl font-semibold text-stone-900">{text("예약 작업 관리", "Schedule management")}</h1>
            <p className="mt-2 max-w-3xl text-sm leading-7 text-stone-600">
              {text(
                "예약 작업은 일반 실행 현황과 분리해 표시합니다. 예약의 다음 실행, 최근 실행 이력, 스케줄러 상태를 여기서 확인합니다.",
                "Schedules are shown separately from normal activity. Check next runs, recent run history, and scheduler status here.",
              )}
            </p>
          </div>
          <button
            type="button"
            onClick={() => void loadSchedules()}
            disabled={loading}
            className="rounded-xl border border-stone-200 bg-white px-4 py-3 text-sm font-semibold text-stone-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {loading ? text("새로고침 중", "Refreshing") : text("새로고침", "Refresh")}
          </button>
        </div>
      </div>

      <FeatureGate capabilityKey="scheduler.core" title="Scheduler">
        <div className="mt-6 grid gap-6 xl:grid-cols-[22rem_1fr]">
          <aside className="space-y-4">
            <div className="rounded-[1.75rem] border border-stone-200 bg-white p-5">
              <div className="text-sm font-semibold text-stone-900">{text("스케줄러 상태", "Scheduler status")}</div>
              <div className="mt-4 grid gap-3 text-sm text-stone-600">
                <div className="flex items-center justify-between rounded-xl bg-stone-50 px-3 py-2">
                  <span>{text("상태", "Status")}</span>
                  <span className="font-semibold text-stone-900">{health?.running ? text("실행 중", "Running") : text("중지됨", "Stopped")}</span>
                </div>
                <div className="flex items-center justify-between rounded-xl bg-stone-50 px-3 py-2">
                  <span>{text("활성 작업", "Active jobs")}</span>
                  <span className="font-semibold text-stone-900">{health?.activeJobs ?? 0}</span>
                </div>
              </div>
              {health?.nextRuns.length ? (
                <div className="mt-4 space-y-2">
                  <div className="text-xs font-semibold text-stone-500">{text("다음 실행", "Next runs")}</div>
                  {health.nextRuns.slice(0, 5).map((item) => (
                    <div key={`${item.scheduleId}-${item.nextRunAt}`} className="rounded-xl border border-stone-200 px-3 py-2 text-xs text-stone-600">
                      <div className="font-semibold text-stone-900">{displayText(item.name)}</div>
                      <div className="mt-1">{formatDateTime(item.nextRunAt, text("미정", "Not scheduled"))}</div>
                    </div>
                  ))}
                </div>
              ) : null}
            </div>

            <div className="rounded-[1.75rem] border border-stone-200 bg-white p-4">
              <div className="mb-3 px-1 text-sm font-semibold text-stone-900">{text("예약 목록", "Schedule list")}</div>
              {error ? <ErrorState title={text("예약 정보를 불러오지 못했습니다", "Could not load schedules")} description={error} /> : null}
              {!error && schedules.length === 0 ? (
                <EmptyState
                  title={text("표시할 예약 작업이 없습니다", "No schedules to show")}
                  description={text("예약 작업이 등록되면 이 화면에 목록이 나타납니다.", "Registered schedules will appear here.")}
                />
              ) : null}
              <div className="space-y-2">
                {schedules.map((schedule) => (
                  <button
                    key={schedule.id}
                    type="button"
                    onClick={() => setSelectedId(schedule.id)}
                    className={`w-full rounded-2xl border px-4 py-3 text-left transition ${selectedSchedule?.id === schedule.id ? "border-stone-900 bg-stone-900 text-white" : "border-stone-200 bg-stone-50 text-stone-700 hover:bg-white"}`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-semibold">{displayText(schedule.name)}</div>
                        <div className={`mt-1 text-xs ${selectedSchedule?.id === schedule.id ? "text-stone-300" : "text-stone-500"}`}>{schedule.cron_expression}</div>
                      </div>
                      <span className={`shrink-0 rounded-full px-2 py-1 text-[11px] ${schedule.enabled ? "bg-emerald-100 text-emerald-700" : "bg-stone-200 text-stone-600"}`}>
                        {schedule.enabled ? text("활성", "On") : text("중지", "Off")}
                      </span>
                    </div>
                    <div className={`mt-2 text-xs ${selectedSchedule?.id === schedule.id ? "text-stone-300" : "text-stone-500"}`}>
                      {text("다음", "Next")}: {formatDateTime(schedule.next_run_at, text("미정", "Not scheduled"))}
                    </div>
                  </button>
                ))}
              </div>
            </div>
          </aside>

          <section className="rounded-[1.75rem] border border-stone-200 bg-white p-6">
            {selectedSchedule ? (
              <div className="space-y-6">
                <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
                  <div>
                    <div className="text-xs font-semibold uppercase tracking-[0.2em] text-stone-500">{selectedSchedule.id}</div>
                    <h2 className="mt-2 text-xl font-semibold text-stone-900">{displayText(selectedSchedule.name)}</h2>
                    <p className="mt-2 max-w-3xl whitespace-pre-wrap text-sm leading-7 text-stone-600">{displayText(selectedSchedule.prompt)}</p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => void handleToggle(selectedSchedule)}
                      disabled={actionId === selectedSchedule.id}
                      className="rounded-xl border border-stone-200 px-4 py-2.5 text-sm font-semibold text-stone-700 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {selectedSchedule.enabled ? text("중지", "Disable") : text("활성화", "Enable")}
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleRunNow(selectedSchedule)}
                      disabled={actionId === selectedSchedule.id}
                      className="rounded-xl bg-stone-900 px-4 py-2.5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {text("지금 실행", "Run now")}
                    </button>
                  </div>
                </div>

                <div className="grid gap-3 md:grid-cols-4">
                  <div className="rounded-2xl border border-stone-200 bg-stone-50 px-4 py-3">
                    <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-stone-500">Cron</div>
                    <div className="mt-2 break-words text-sm font-medium text-stone-900">{selectedSchedule.cron_expression}</div>
                  </div>
                  <div className="rounded-2xl border border-stone-200 bg-stone-50 px-4 py-3">
                    <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-stone-500">{text("시간대", "Timezone")}</div>
                    <div className="mt-2 break-words text-sm font-medium text-stone-900">{selectedSchedule.timezone || text("기본값", "Default")}</div>
                  </div>
                  <div className="rounded-2xl border border-stone-200 bg-stone-50 px-4 py-3">
                    <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-stone-500">{text("최근 실행", "Last run")}</div>
                    <div className="mt-2 text-sm font-medium text-stone-900">{formatDateTime(selectedSchedule.last_run_at, text("없음", "None"))}</div>
                  </div>
                  <div className="rounded-2xl border border-stone-200 bg-stone-50 px-4 py-3">
                    <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-stone-500">{text("다음 실행", "Next run")}</div>
                    <div className="mt-2 text-sm font-medium text-stone-900">{formatDateTime(selectedSchedule.next_run_at, text("미정", "Not scheduled"))}</div>
                  </div>
                </div>

                <div>
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <div className="text-sm font-semibold text-stone-900">{text("최근 예약 실행 이력", "Recent schedule runs")}</div>
                    {runsLoading ? <span className="text-xs text-stone-500">{text("불러오는 중", "Loading")}</span> : null}
                  </div>
                  {runs.length === 0 ? (
                    <EmptyState
                      title={text("아직 실행 이력이 없습니다", "No run history yet")}
                      description={text("예약이 실행되면 성공/실패 이력이 이 영역에 표시됩니다.", "Successful and failed schedule runs will appear here.")}
                    />
                  ) : (
                    <div className="space-y-2">
                      {runs.map((run) => (
                        <div key={run.id} className="rounded-2xl border border-stone-200 px-4 py-3">
                          <div className="flex flex-wrap items-center justify-between gap-3">
                            <div className="text-sm font-semibold text-stone-900">{describeRunResult(run, text)}</div>
                            <div className="text-xs text-stone-500">{formatDateTime(run.started_at, "")}</div>
                          </div>
                          {run.summary ? <div className="mt-2 text-sm leading-6 text-stone-600">{displayText(run.summary)}</div> : null}
                          {run.error ? <div className="mt-2 rounded-xl bg-red-50 px-3 py-2 text-xs leading-5 text-red-700">{displayText(run.error)}</div> : null}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <EmptyState
                title={text("선택된 예약 작업이 없습니다", "No selected schedule")}
                description={text("예약 작업이 등록되면 상세 정보와 실행 이력을 확인할 수 있습니다.", "Select a registered schedule to inspect details and run history.")}
              />
            )}
          </section>
        </div>
      </FeatureGate>
    </div>
  )
}
