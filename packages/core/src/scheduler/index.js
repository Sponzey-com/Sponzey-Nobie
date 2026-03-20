import { getSchedules, getSchedule, insertScheduleRun, updateScheduleRun } from "../db/index.js";
import { runAgent } from "../agent/index.js";
import { eventBus } from "../events/index.js";
import { createLogger } from "../logger/index.js";
import { getNextRun, isValidCron } from "./cron.js";
const log = createLogger("scheduler");
const RETRY_DELAY_MS = 5_000;
class Scheduler {
    timer = null;
    running = new Set();
    start() {
        if (this.timer)
            return;
        log.info("Scheduler started — checking every 60s");
        this.timer = setInterval(() => { void this.tick(); }, 60_000);
        setTimeout(() => { void this.tick(); }, 1_000);
    }
    stop() {
        if (this.timer) {
            clearInterval(this.timer);
            this.timer = null;
            log.info("Scheduler stopped");
        }
    }
    /** Re-tick immediately to pick up schedule changes */
    reload() {
        void this.tick();
    }
    getHealth() {
        const schedules = getSchedules();
        const nextRuns = [];
        for (const s of schedules) {
            if (!s.enabled || !isValidCron(s.cron_expression))
                continue;
            try {
                const base = s.last_run_at ? new Date(s.last_run_at) : new Date(s.created_at);
                const next = getNextRun(s.cron_expression, base);
                nextRuns.push({ scheduleId: s.id, name: s.name, nextRunAt: next.getTime() });
            }
            catch { /* skip */ }
        }
        nextRuns.sort((a, b) => a.nextRunAt - b.nextRunAt);
        return {
            running: this.timer !== null,
            activeJobs: this.running.size,
            activeJobIds: [...this.running],
            nextRuns: nextRuns.slice(0, 10),
        };
    }
    async tick() {
        const now = Date.now();
        const schedules = getSchedules();
        for (const s of schedules) {
            if (!s.enabled)
                continue;
            if (!isValidCron(s.cron_expression))
                continue;
            if (this.running.has(s.id)) {
                log.info(`Schedule "${s.name}" already running — skipping`);
                continue;
            }
            let nextRun;
            try {
                const base = s.last_run_at ? new Date(s.last_run_at) : new Date(s.created_at);
                nextRun = getNextRun(s.cron_expression, base);
            }
            catch {
                continue;
            }
            if (nextRun.getTime() > now)
                continue;
            void this.runNow(s.id, `scheduler tick (due: ${nextRun.toISOString()})`);
        }
    }
    async runNow(scheduleId, trigger = "manual") {
        const schedule = getSchedule(scheduleId);
        if (!schedule)
            throw new Error(`Schedule ${scheduleId} not found`);
        const runId = crypto.randomUUID();
        const startedAt = Date.now();
        insertScheduleRun({
            id: runId,
            schedule_id: scheduleId,
            started_at: startedAt,
            finished_at: null,
            success: null,
            summary: null,
            error: null,
        });
        log.info(`Running schedule "${schedule.name}" (${scheduleId}), trigger=${trigger}`);
        eventBus.emit("schedule.run.start", { scheduleId, runId });
        this.running.add(scheduleId);
        void (async () => {
            const maxRetries = schedule.max_retries ?? 3;
            let attempt = 0;
            let lastError = null;
            let success = false;
            let summary = null;
            while (attempt <= maxRetries) {
                if (attempt > 0) {
                    log.info(`Schedule "${schedule.name}" retry ${attempt}/${maxRetries}`);
                    await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
                }
                const result = await this._execute(schedule);
                if (result.success) {
                    success = true;
                    summary = result.summary;
                    lastError = null;
                    break;
                }
                lastError = result.error;
                attempt++;
            }
            const finishedAt = Date.now();
            this.running.delete(scheduleId);
            updateScheduleRun(runId, {
                finished_at: finishedAt,
                success: success ? 1 : 0,
                summary,
                error: lastError,
            });
            log.info(`Schedule "${schedule.name}" run ${runId} finished (success=${success}) in ${finishedAt - startedAt}ms`);
            eventBus.emit("schedule.run.complete", {
                scheduleId,
                runId,
                success,
                durationMs: finishedAt - startedAt,
            });
            if (!success) {
                eventBus.emit("schedule.run.failed", {
                    scheduleId,
                    runId,
                    name: schedule.name,
                    error: lastError,
                    attempts: attempt,
                });
                log.warn(`Schedule "${schedule.name}" failed after ${attempt} attempt(s): ${lastError}`);
            }
        })();
        return runId;
    }
    async _execute(schedule) {
        const chunks = [];
        let success = false;
        let errorMsg = null;
        try {
            for await (const chunk of runAgent({
                userMessage: schedule.prompt,
                sessionId: crypto.randomUUID(),
                model: schedule.model ?? undefined,
            })) {
                if (chunk.type === "text")
                    chunks.push(chunk.delta);
                if (chunk.type === "done")
                    success = true;
                if (chunk.type === "error") {
                    errorMsg = chunk.message;
                    break;
                }
            }
        }
        catch (err) {
            errorMsg = err instanceof Error ? err.message : String(err);
        }
        return {
            success,
            summary: chunks.join("").slice(0, 2000) || null,
            error: errorMsg,
        };
    }
}
export const scheduler = new Scheduler();
export function startScheduler() { scheduler.start(); }
export function stopScheduler() { scheduler.stop(); }
export function runSchedule(scheduleId, trigger = "manual") {
    return scheduler.runNow(scheduleId, trigger);
}
//# sourceMappingURL=index.js.map