import type { DbSchedule } from "../db/index.js";
type ScheduleTickSource = Pick<DbSchedule, "id" | "name" | "enabled" | "execution_driver" | "cron_expression" | "created_at" | "last_run_at">;
export type ScheduleTickDirective = {
    kind: "skip";
    reason: "disabled" | "system_driver" | "invalid_cron" | "queue_active" | "not_due" | "cron_error";
} | {
    kind: "run";
    dueAtMs: number;
    trigger: string;
};
export declare function resolveScheduleTickDirective(params: {
    schedule: ScheduleTickSource;
    nowMs: number;
    queueActive: boolean;
    isValidCron: (cron: string) => boolean;
    getNextRun: (cron: string, base: Date) => Date;
}): ScheduleTickDirective;
export {};
//# sourceMappingURL=tick-policy.d.ts.map