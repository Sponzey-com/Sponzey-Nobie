import { type DbSchedule } from "../db/index.js";
export type ScheduleExecutionDriver = "internal" | "system_crontab" | "system_schtasks";
export declare function reconcileSystemCronSchedule(schedule: DbSchedule): {
    driver: ScheduleExecutionDriver;
    reason?: string;
};
export declare function removeSystemCronSchedule(scheduleId: string): void;
export declare function reconcileScheduleExecution(scheduleId: string): {
    driver: ScheduleExecutionDriver;
    reason?: string;
};
export declare function removeManagedScheduleExecution(scheduleId: string): void;
//# sourceMappingURL=system-cron.d.ts.map