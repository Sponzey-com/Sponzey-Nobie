import { getSchedules, getSchedule, insertScheduleRun, updateScheduleRun, type DbSchedule } from "../db/index.js"
import { runAgent } from "../agent/index.js"
import { eventBus } from "../events/index.js"
import { createLogger } from "../logger/index.js"
import { getNextRun, isValidCron } from "./cron.js"

const log = createLogger("scheduler")

const RETRY_DELAY_MS = 5_000

class Scheduler {
  private timer: NodeJS.Timeout | null = null
  private running = new Set<string>()

  start(): void {
    if (this.timer) return
    log.info("Scheduler started — checking every 60s")
    this.timer = setInterval(() => { void this.tick() }, 60_000)
    setTimeout(() => { void this.tick() }, 1_000)
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
      log.info("Scheduler stopped")
    }
  }

  /** Re-tick immediately to pick up schedule changes */
  reload(): void {
    void this.tick()
  }

  getHealth(): {
    running: boolean
    activeJobs: number
    activeJobIds: string[]
    nextRuns: Array<{ scheduleId: string; name: string; nextRunAt: number }>
  } {
    const schedules = getSchedules()
    const nextRuns: Array<{ scheduleId: string; name: string; nextRunAt: number }> = []

    for (const s of schedules) {
      if (!s.enabled || !isValidCron(s.cron_expression)) continue
      try {
        const base = s.last_run_at ? new Date(s.last_run_at) : new Date(s.created_at)
        const next = getNextRun(s.cron_expression, base)
        nextRuns.push({ scheduleId: s.id, name: s.name, nextRunAt: next.getTime() })
      } catch { /* skip */ }
    }

    nextRuns.sort((a, b) => a.nextRunAt - b.nextRunAt)

    return {
      running: this.timer !== null,
      activeJobs: this.running.size,
      activeJobIds: [...this.running],
      nextRuns: nextRuns.slice(0, 10),
    }
  }

  private async tick(): Promise<void> {
    const now = Date.now()
    const schedules = getSchedules()

    for (const s of schedules) {
      if (!s.enabled) continue
      if (!isValidCron(s.cron_expression)) continue

      if (this.running.has(s.id)) {
        log.info(`Schedule "${s.name}" already running — skipping`)
        continue
      }

      let nextRun: Date
      try {
        const base = s.last_run_at ? new Date(s.last_run_at) : new Date(s.created_at)
        nextRun = getNextRun(s.cron_expression, base)
      } catch {
        continue
      }

      if (nextRun.getTime() > now) continue

      void this.runNow(s.id, `scheduler tick (due: ${nextRun.toISOString()})`)
    }
  }

  async runNow(scheduleId: string, trigger = "manual"): Promise<string> {
    const schedule = getSchedule(scheduleId)
    if (!schedule) throw new Error(`Schedule ${scheduleId} not found`)

    const runId = crypto.randomUUID()
    const startedAt = Date.now()

    insertScheduleRun({
      id: runId,
      schedule_id: scheduleId,
      started_at: startedAt,
      finished_at: null,
      success: null,
      summary: null,
      error: null,
    })

    log.info(`Running schedule "${schedule.name}" (${scheduleId}), trigger=${trigger}`)
    eventBus.emit("schedule.run.start" as never, { scheduleId, runId } as never)

    this.running.add(scheduleId)

    void (async () => {
      const maxRetries = schedule.max_retries ?? 3
      let attempt = 0
      let lastError: string | null = null
      let success = false
      let summary: string | null = null

      while (attempt <= maxRetries) {
        if (attempt > 0) {
          log.info(`Schedule "${schedule.name}" retry ${attempt}/${maxRetries}`)
          await new Promise<void>((r) => setTimeout(r, RETRY_DELAY_MS))
        }

        const result = await this._execute(schedule)
        if (result.success) {
          success = true
          summary = result.summary
          lastError = null
          break
        }
        lastError = result.error
        attempt++
      }

      const finishedAt = Date.now()
      this.running.delete(scheduleId)

      updateScheduleRun(runId, {
        finished_at: finishedAt,
        success: success ? 1 : 0,
        summary,
        error: lastError,
      })

      log.info(`Schedule "${schedule.name}" run ${runId} finished (success=${success}) in ${finishedAt - startedAt}ms`)
      eventBus.emit("schedule.run.complete" as never, {
        scheduleId,
        runId,
        success,
        durationMs: finishedAt - startedAt,
      } as never)

      if (!success) {
        eventBus.emit("schedule.run.failed" as never, {
          scheduleId,
          runId,
          name: schedule.name,
          error: lastError,
          attempts: attempt,
        } as never)
        log.warn(`Schedule "${schedule.name}" failed after ${attempt} attempt(s): ${lastError}`)
      }
    })()

    return runId
  }

  private async _execute(schedule: DbSchedule): Promise<{ success: boolean; summary: string | null; error: string | null }> {
    const chunks: string[] = []
    let success = false
    let errorMsg: string | null = null

    try {
      for await (const chunk of runAgent({
        userMessage: schedule.prompt,
        sessionId: crypto.randomUUID(),
        model: schedule.model ?? undefined,
      })) {
        if (chunk.type === "text") chunks.push(chunk.delta)
        if (chunk.type === "done") success = true
        if (chunk.type === "error") { errorMsg = chunk.message; break }
      }
    } catch (err) {
      errorMsg = err instanceof Error ? err.message : String(err)
    }

    return {
      success,
      summary: chunks.join("").slice(0, 2000) || null,
      error: errorMsg,
    }
  }
}

export const scheduler = new Scheduler()

export function startScheduler(): void { scheduler.start() }
export function stopScheduler(): void { scheduler.stop() }
export function runSchedule(scheduleId: string, trigger = "manual"): Promise<string> {
  return scheduler.runNow(scheduleId, trigger)
}
