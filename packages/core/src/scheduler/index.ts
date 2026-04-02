import { getSchedules, getSchedule, insertScheduleRun, updateScheduleRun, type DbSchedule } from "../db/index.js"
import { runAgent } from "../agent/index.js"
import { eventBus } from "../events/index.js"
import { createLogger } from "../logger/index.js"
import { getNextRun, isValidCron } from "./cron.js"
import { getActiveTelegramChannel } from "../channels/telegram/runtime.js"
import { extractDirectChannelDeliveryText } from "../runs/scheduled.js"
import { enqueueScheduledDelivery } from "./delivery-queue.js"
import { resolveScheduleTickDirective } from "./tick-policy.js"
import {
  enqueueScheduleExecution,
  hasScheduleExecutionQueue,
  listScheduleExecutionQueueIds,
} from "./queueing.js"
import {
  buildScheduleRunCompleteEvent,
  buildScheduleRunFailedEvent,
  buildScheduleRunStartEvent,
} from "./lifecycle.js"

const log = createLogger("scheduler")

const RETRY_DELAY_MS = 5_000

class Scheduler {
  private timer: NodeJS.Timeout | null = null

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
    const activeJobIds = listScheduleExecutionQueueIds()
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
      activeJobs: activeJobIds.length,
      activeJobIds,
      nextRuns: nextRuns.slice(0, 10),
    }
  }

  private async tick(): Promise<void> {
    const now = Date.now()
    const schedules = getSchedules()

    for (const s of schedules) {
      const directive = resolveScheduleTickDirective({
        schedule: s,
        nowMs: now,
        queueActive: hasScheduleExecutionQueue(s.id),
        isValidCron,
        getNextRun,
      })

      if (directive.kind === "skip") {
        if (directive.reason === "queue_active") {
          log.info(`Schedule "${s.name}" already queued or running — skipping tick`)
        }
        continue
      }

      void this.runNow(s.id, directive.trigger)
    }
  }

  async runNow(scheduleId: string, trigger = "manual"): Promise<string> {
    const { runId } = await this.runNowInternal(scheduleId, trigger)
    return runId
  }

  async runNowAndWait(scheduleId: string, trigger = "manual"): Promise<string> {
    const { runId, finished } = await this.runNowInternal(scheduleId, trigger)
    await finished
    return runId
  }

  private async runNowInternal(scheduleId: string, trigger = "manual"): Promise<{ runId: string; finished: Promise<void> }> {
    const schedule = getSchedule(scheduleId)
    if (!schedule) throw new Error(`Schedule ${scheduleId} not found`)

    return enqueueScheduleExecution({
      scheduleId,
      scheduleName: schedule.name,
      trigger,
      task: () => this.executeQueuedRun(scheduleId, trigger),
    }, {
      logInfo: (message, payload) => log.info(message, payload),
      logWarn: (message) => log.warn(message),
      logError: (message, payload) => log.error(message, payload),
    })
  }

  private async executeQueuedRun(scheduleId: string, trigger: string): Promise<{ runId: string; finished: Promise<void> }> {
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
    eventBus.emit("schedule.run.start", buildScheduleRunStartEvent({
      schedule,
      scheduleRunId: runId,
      trigger,
    }))

    const finished = (async () => {
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

        const result = await this._execute({
          schedule,
          scheduleRunId: runId,
        })
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
      updateScheduleRun(runId, {
        finished_at: finishedAt,
        success: success ? 1 : 0,
        summary,
        error: lastError,
      })

      log.info(`Schedule "${schedule.name}" run ${runId} finished (success=${success}) in ${finishedAt - startedAt}ms`)
      eventBus.emit("schedule.run.complete", buildScheduleRunCompleteEvent({
        schedule,
        scheduleRunId: runId,
        trigger,
        success,
        durationMs: finishedAt - startedAt,
        summary,
      }))

      if (!success) {
        eventBus.emit("schedule.run.failed", buildScheduleRunFailedEvent({
          schedule,
          scheduleRunId: runId,
          trigger,
          error: lastError,
          attempts: attempt,
        }))
        log.warn(`Schedule "${schedule.name}" failed after ${attempt} attempt(s): ${lastError}`)
      }
    })()

    return { runId, finished }
  }

  private async _execute(params: {
    schedule: DbSchedule
    scheduleRunId: string
  }): Promise<{ success: boolean; summary: string | null; error: string | null }> {
    const { schedule, scheduleRunId } = params
    const directTelegramMessage = schedule.target_channel === "telegram"
      ? extractDirectChannelDeliveryText(schedule.prompt)
      : null

    if (directTelegramMessage) {
      if (!schedule.target_session_id) {
        return {
          success: false,
          summary: directTelegramMessage,
          error: "telegram target session is not configured for this schedule",
        }
      }

      const telegram = getActiveTelegramChannel()
      if (!telegram) {
        return {
          success: false,
          summary: directTelegramMessage,
          error: "telegram channel is not running",
        }
      }

      try {
        await enqueueScheduledDelivery({
          targetChannel: "telegram",
          targetSessionId: schedule.target_session_id,
          scheduleId: schedule.id,
          scheduleRunId,
          task: () => telegram.sendTextToSession(schedule.target_session_id!, directTelegramMessage),
        }, {
          logInfo: (message, payload) => log.info(message, payload),
          logWarn: (message) => log.warn(message),
          logError: (message, payload) => log.error(message, payload),
        })
        return {
          success: true,
          summary: directTelegramMessage.slice(0, 2000) || null,
          error: null,
        }
      } catch (err) {
        return {
          success: false,
          summary: directTelegramMessage,
          error: err instanceof Error ? err.message : String(err),
        }
      }
    }

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

    const summary = chunks.join("").trim()

    if (success && schedule.target_channel === "telegram") {
      if (!schedule.target_session_id) {
        return {
          success: false,
          summary: summary || null,
          error: "telegram target session is not configured for this schedule",
        }
      }

      if (!summary) {
        return {
          success: false,
          summary: null,
          error: "schedule produced no deliverable text for telegram",
        }
      }

      const telegram = getActiveTelegramChannel()
      if (!telegram) {
        return {
          success: false,
          summary,
          error: "telegram channel is not running",
        }
      }

      try {
        await enqueueScheduledDelivery({
          targetChannel: "telegram",
          targetSessionId: schedule.target_session_id,
          scheduleId: schedule.id,
          scheduleRunId,
          task: () => telegram.sendTextToSession(schedule.target_session_id!, summary),
        }, {
          logInfo: (message, payload) => log.info(message, payload),
          logWarn: (message) => log.warn(message),
          logError: (message, payload) => log.error(message, payload),
        })
      } catch (err) {
        return {
          success: false,
          summary,
          error: err instanceof Error ? err.message : String(err),
        }
      }
    }

    return {
      success,
      summary: summary.slice(0, 2000) || null,
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

export function runScheduleAndWait(scheduleId: string, trigger = "manual"): Promise<string> {
  return scheduler.runNowAndWait(scheduleId, trigger)
}
