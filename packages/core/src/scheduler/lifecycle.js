export function buildScheduleRunLineage(params) {
    return {
        scheduleId: params.schedule.id,
        scheduleRunId: params.scheduleRunId,
        runId: params.scheduleRunId,
        scheduleName: params.schedule.name,
        targetChannel: params.schedule.target_channel,
        ...(params.schedule.target_session_id ? { targetSessionId: params.schedule.target_session_id } : {}),
        ...(params.schedule.origin_run_id ? { originRunId: params.schedule.origin_run_id } : {}),
        ...(params.schedule.origin_request_group_id ? { originRequestGroupId: params.schedule.origin_request_group_id } : {}),
        trigger: params.trigger,
    };
}
export function buildScheduleRunStartEvent(params) {
    return buildScheduleRunLineage(params);
}
export function buildScheduleRegistrationCreatedEvent(params) {
    return {
        runId: params.runId,
        requestGroupId: params.requestGroupId,
        registrationKind: params.registrationKind,
        title: params.title,
        task: params.task,
        source: params.source,
        scheduleText: params.scheduleText,
        ...(params.scheduleId ? { scheduleId: params.scheduleId } : {}),
        ...(typeof params.runAtMs === "number" ? { runAtMs: params.runAtMs } : {}),
        ...(params.cron ? { cron: params.cron } : {}),
        ...(params.targetSessionId ? { targetSessionId: params.targetSessionId } : {}),
        ...(params.driver ? { driver: params.driver } : {}),
    };
}
export function buildScheduleRegistrationCancelledEvent(params) {
    return {
        runId: params.runId,
        requestGroupId: params.requestGroupId,
        cancelledScheduleIds: [...params.cancelledScheduleIds],
        cancelledNames: [...params.cancelledNames],
    };
}
export function buildScheduleRunCompleteEvent(params) {
    return {
        ...buildScheduleRunLineage(params),
        success: params.success,
        durationMs: params.durationMs,
        ...(params.summary ? { summary: params.summary } : {}),
    };
}
export function buildScheduleRunFailedEvent(params) {
    return {
        ...buildScheduleRunLineage(params),
        ...(params.error ? { error: params.error } : {}),
        attempts: params.attempts,
    };
}
//# sourceMappingURL=lifecycle.js.map