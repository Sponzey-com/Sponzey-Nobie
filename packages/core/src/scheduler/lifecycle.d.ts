import type { DbSchedule } from "../db/index.js";
type ScheduleLineageSource = Pick<DbSchedule, "id" | "name" | "target_channel" | "target_session_id" | "origin_run_id" | "origin_request_group_id">;
export interface ScheduleRunLineage {
    scheduleId: string;
    scheduleRunId: string;
    runId: string;
    scheduleName: string;
    targetChannel: string;
    targetSessionId?: string;
    originRunId?: string;
    originRequestGroupId?: string;
    trigger: string;
}
export interface ScheduleRegistrationCreatedEvent {
    runId: string;
    requestGroupId: string;
    registrationKind: "one_time" | "recurring";
    title: string;
    task: string;
    source: "webui" | "cli" | "telegram" | "slack";
    scheduleText: string;
    scheduleId?: string;
    runAtMs?: number;
    cron?: string;
    targetSessionId?: string;
    driver?: string;
}
export interface ScheduleRegistrationCancelledEvent {
    runId: string;
    requestGroupId: string;
    cancelledScheduleIds: string[];
    cancelledNames: string[];
}
export declare function buildScheduleRunLineage(params: {
    schedule: ScheduleLineageSource;
    scheduleRunId: string;
    trigger: string;
}): ScheduleRunLineage;
export declare function buildScheduleRunStartEvent(params: {
    schedule: ScheduleLineageSource;
    scheduleRunId: string;
    trigger: string;
}): ScheduleRunLineage;
export declare function buildScheduleRegistrationCreatedEvent(params: ScheduleRegistrationCreatedEvent): ScheduleRegistrationCreatedEvent;
export declare function buildScheduleRegistrationCancelledEvent(params: ScheduleRegistrationCancelledEvent): ScheduleRegistrationCancelledEvent;
export declare function buildScheduleRunCompleteEvent(params: {
    schedule: ScheduleLineageSource;
    scheduleRunId: string;
    trigger: string;
    success: boolean;
    durationMs: number;
    summary?: string | null;
}): ScheduleRunLineage & {
    success: boolean;
    durationMs: number;
    summary?: string;
};
export declare function buildScheduleRunFailedEvent(params: {
    schedule: ScheduleLineageSource;
    scheduleRunId: string;
    trigger: string;
    error?: string | null;
    attempts: number;
}): ScheduleRunLineage & {
    error?: string;
    attempts: number;
};
export {};
//# sourceMappingURL=lifecycle.d.ts.map