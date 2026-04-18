import { getSchedules, getSchedule, insertAuditLog, insertScheduleRun, isLegacySchedule, updateScheduleRun, } from "../db/index.js";
import { runAgent } from "../agent/index.js";
import { eventBus } from "../events/index.js";
import { createLogger } from "../logger/index.js";
import { getNextRunForTimezone, isValidCron, normalizeScheduleTimezone } from "./cron.js";
import { getConfig } from "../config/index.js";
import { recordLatencyMetric } from "../observability/latency.js";
import { getActiveTelegramChannel } from "../channels/telegram/runtime.js";
import { extractDirectChannelDeliveryText } from "../runs/scheduled.js";
import { enqueueScheduledDelivery } from "./delivery-queue.js";
import { resolveScheduleTickDirective } from "./tick-policy.js";
import { enqueueScheduleExecution, hasScheduleExecutionQueue, listScheduleExecutionQueueIds, } from "./queueing.js";
import { buildScheduleRunCompleteEvent, buildScheduleRunFailedEvent, buildScheduleRunStartEvent, } from "./lifecycle.js";
import { computeScheduleRetryDelayMs, normalizeScheduleMaxRetries } from "./retry.js";
import { executeScheduleContract } from "./contract-executor.js";
const log = createLogger("scheduler");
function recordLegacyScheduleContractMissing(schedule, scheduleRunId, trigger) {
    if (!isLegacySchedule(schedule))
        return;
    try {
        insertAuditLog({
            timestamp: Date.now(),
            session_id: schedule.target_session_id,
            run_id: scheduleRunId,
            request_group_id: schedule.origin_request_group_id,
            channel: schedule.target_channel,
            source: "scheduler",
            tool_name: "legacy_schedule_contract_missing",
            params: JSON.stringify({
                scheduleId: schedule.id,
                scheduleName: schedule.name,
                trigger,
            }),
            output: null,
            result: "success",
            duration_ms: 0,
            approval_required: 0,
            approved_by: null,
        });
    }
    catch (err) {
        log.warn("Failed to record legacy schedule audit event for " + schedule.id + ": " + (err instanceof Error ? err.message : String(err)));
    }
}
class Scheduler {
    timer = null;
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
        const activeJobIds = listScheduleExecutionQueueIds();
        const schedules = getSchedules();
        const nextRuns = [];
        for (const s of schedules) {
            if (!s.enabled || !isValidCron(s.cron_expression))
                continue;
            try {
                const base = s.last_run_at ? new Date(s.last_run_at) : new Date(s.created_at);
                const next = getNextRunForTimezone(s.cron_expression, base, resolveScheduleTimezone(s));
                nextRuns.push({ scheduleId: s.id, name: s.name, nextRunAt: next.getTime() });
            }
            catch { /* skip */ }
        }
        nextRuns.sort((a, b) => a.nextRunAt - b.nextRunAt);
        return {
            running: this.timer !== null,
            activeJobs: activeJobIds.length,
            activeJobIds,
            nextRuns: nextRuns.slice(0, 10),
        };
    }
    async tick() {
        const now = Date.now();
        const schedules = getSchedules();
        for (const s of schedules) {
            const directive = resolveScheduleTickDirective({
                schedule: s,
                nowMs: now,
                queueActive: hasScheduleExecutionQueue(s.id),
                isValidCron,
                getNextRun: getNextRunForTimezone,
            });
            if (directive.kind === "skip") {
                if (directive.reason === "queue_active") {
                    log.info(`Schedule "${s.name}" already queued or running — skipping tick`);
                }
                continue;
            }
            void this.runNow(s.id, directive.trigger);
        }
    }
    async runNow(scheduleId, trigger = "manual") {
        const { runId } = await this.runNowInternal(scheduleId, trigger);
        return runId;
    }
    async runNowAndWait(scheduleId, trigger = "manual") {
        const { runId, finished } = await this.runNowInternal(scheduleId, trigger);
        await finished;
        return runId;
    }
    async runNowInternal(scheduleId, trigger = "manual") {
        const schedule = getSchedule(scheduleId);
        if (!schedule)
            throw new Error(`Schedule ${scheduleId} not found`);
        return enqueueScheduleExecution({
            scheduleId,
            scheduleName: schedule.name,
            trigger,
            task: () => this.executeQueuedRun(scheduleId, trigger),
        }, {
            logInfo: (message, payload) => log.info(message, payload),
            logWarn: (message) => log.warn(message),
            logError: (message, payload) => log.error(message, payload),
        });
    }
    async executeQueuedRun(scheduleId, trigger) {
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
        recordLegacyScheduleContractMissing(schedule, runId, trigger);
        log.info(`Running schedule "${schedule.name}" (${scheduleId}), trigger=${trigger}`);
        eventBus.emit("schedule.run.start", buildScheduleRunStartEvent({
            schedule,
            scheduleRunId: runId,
            trigger,
        }));
        const finished = (async () => {
            const maxRetries = normalizeScheduleMaxRetries(schedule.max_retries);
            let attempt = 0;
            let lastError = null;
            let success = false;
            let summary = null;
            let executionSuccess = null;
            let deliverySuccess = null;
            let deliveryDedupeKey = null;
            let deliveryError = null;
            while (attempt <= maxRetries) {
                if (attempt > 0) {
                    log.info(`Schedule "${schedule.name}" retry ${attempt}/${maxRetries}`);
                    await new Promise((r) => setTimeout(r, computeScheduleRetryDelayMs(attempt)));
                }
                const attemptStartedAt = Date.now();
                const result = await this._execute({
                    schedule,
                    scheduleRunId: runId,
                    trigger,
                    startedAt,
                });
                recordLatencyMetric({
                    name: "execution_latency_ms",
                    durationMs: Date.now() - attemptStartedAt,
                    runId,
                    requestGroupId: schedule.id,
                    source: "scheduler",
                    detail: {
                        scheduleId: schedule.id,
                        attempt,
                        trigger,
                    },
                });
                executionSuccess = result.executionSuccess ?? executionSuccess;
                deliverySuccess = result.deliverySuccess ?? deliverySuccess;
                deliveryDedupeKey = result.deliveryDedupeKey ?? deliveryDedupeKey;
                deliveryError = result.deliveryError ?? deliveryError;
                if (result.success) {
                    success = true;
                    summary = result.summary;
                    lastError = null;
                    break;
                }
                if (result.executionSuccess === true && result.deliverySuccess === false) {
                    summary = result.summary;
                    lastError = result.error;
                    attempt++;
                    break;
                }
                lastError = result.error;
                attempt++;
            }
            const finishedAt = Date.now();
            updateScheduleRun(runId, {
                finished_at: finishedAt,
                success: success ? 1 : 0,
                summary,
                error: lastError,
                execution_success: executionSuccess == null ? null : executionSuccess ? 1 : 0,
                delivery_success: deliverySuccess == null ? null : deliverySuccess ? 1 : 0,
                delivery_dedupe_key: deliveryDedupeKey,
                delivery_error: deliveryError,
            });
            log.info(`Schedule "${schedule.name}" run ${runId} finished (success=${success}) in ${finishedAt - startedAt}ms`);
            eventBus.emit("schedule.run.complete", buildScheduleRunCompleteEvent({
                schedule,
                scheduleRunId: runId,
                trigger,
                success,
                durationMs: finishedAt - startedAt,
                summary,
            }));
            if (!success) {
                eventBus.emit("schedule.run.failed", buildScheduleRunFailedEvent({
                    schedule,
                    scheduleRunId: runId,
                    trigger,
                    error: lastError,
                    attempts: attempt,
                }));
                log.warn(`Schedule "${schedule.name}" failed after ${attempt} attempt(s): ${lastError}`);
            }
        })();
        return { runId, finished };
    }
    async _execute(params) {
        const { schedule, scheduleRunId } = params;
        const contractExecution = await executeScheduleContract({
            schedule,
            scheduleRunId,
            trigger: params.trigger,
            startedAt: params.startedAt,
            dependencies: {
                logInfo: (message, payload) => log.info(message, payload),
                logWarn: (message) => log.warn(message),
                logError: (message, payload) => log.error(message, payload),
            },
        });
        if (contractExecution.handled)
            return contractExecution.result;
        const directDeliveryMessage = extractDirectChannelDeliveryText(schedule.prompt);
        const directTelegramMessage = schedule.target_channel === "telegram" ? directDeliveryMessage : null;
        if (directTelegramMessage) {
            if (!schedule.target_session_id) {
                return {
                    success: false,
                    summary: directTelegramMessage,
                    error: "telegram target session is not configured for this schedule",
                };
            }
            const telegram = getActiveTelegramChannel();
            if (!telegram) {
                return {
                    success: false,
                    summary: directTelegramMessage,
                    error: "telegram channel is not running",
                };
            }
            try {
                await enqueueScheduledDelivery({
                    targetChannel: "telegram",
                    targetSessionId: schedule.target_session_id,
                    scheduleId: schedule.id,
                    scheduleRunId,
                    task: () => telegram.sendTextToSession(schedule.target_session_id, directTelegramMessage),
                }, {
                    logInfo: (message, payload) => log.info(message, payload),
                    logWarn: (message) => log.warn(message),
                    logError: (message, payload) => log.error(message, payload),
                });
                return {
                    success: true,
                    summary: directTelegramMessage.slice(0, 2000) || null,
                    error: null,
                };
            }
            catch (err) {
                return {
                    success: false,
                    summary: directTelegramMessage,
                    error: err instanceof Error ? err.message : String(err),
                };
            }
        }
        if (directDeliveryMessage && schedule.target_channel === "agent") {
            log.info(`Schedule "${schedule.name}" resolved as direct agent notification; skipping AI execution`);
            return {
                success: true,
                summary: directDeliveryMessage.slice(0, 2000) || null,
                error: null,
            };
        }
        const chunks = [];
        let success = false;
        let errorMsg = null;
        try {
            for await (const chunk of runAgent({
                userMessage: schedule.prompt,
                sessionId: `schedule:${schedule.id}:${scheduleRunId}`,
                requestGroupId: scheduleRunId,
                scheduleId: schedule.id,
                includeScheduleMemory: true,
                memorySearchQuery: schedule.prompt,
                contextMode: "isolated",
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
        const summary = chunks.join("").trim();
        if (success && schedule.target_channel === "telegram") {
            if (!schedule.target_session_id) {
                return {
                    success: false,
                    summary: summary || null,
                    error: "telegram target session is not configured for this schedule",
                };
            }
            if (!summary) {
                return {
                    success: false,
                    summary: null,
                    error: "schedule produced no deliverable text for telegram",
                };
            }
            const telegram = getActiveTelegramChannel();
            if (!telegram) {
                return {
                    success: false,
                    summary,
                    error: "telegram channel is not running",
                };
            }
            try {
                await enqueueScheduledDelivery({
                    targetChannel: "telegram",
                    targetSessionId: schedule.target_session_id,
                    scheduleId: schedule.id,
                    scheduleRunId,
                    task: () => telegram.sendTextToSession(schedule.target_session_id, summary),
                }, {
                    logInfo: (message, payload) => log.info(message, payload),
                    logWarn: (message) => log.warn(message),
                    logError: (message, payload) => log.error(message, payload),
                });
            }
            catch (err) {
                return {
                    success: false,
                    summary,
                    error: err instanceof Error ? err.message : String(err),
                };
            }
        }
        return {
            success,
            summary: summary.slice(0, 2000) || null,
            error: errorMsg,
        };
    }
}
function resolveScheduleTimezone(schedule) {
    const config = getConfig();
    return normalizeScheduleTimezone(schedule.timezone, config.scheduler.timezone || config.profile.timezone);
}
export const scheduler = new Scheduler();
export function startScheduler() { scheduler.start(); }
export function stopScheduler() { scheduler.stop(); }
export function runSchedule(scheduleId, trigger = "manual") {
    return scheduler.runNow(scheduleId, trigger);
}
export function runScheduleAndWait(scheduleId, trigger = "manual") {
    return scheduler.runNowAndWait(scheduleId, trigger);
}
//# sourceMappingURL=index.js.map