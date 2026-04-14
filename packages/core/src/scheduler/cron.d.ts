export interface CronFields {
    minutes: Set<number>;
    hours: Set<number>;
    days: Set<number>;
    months: Set<number>;
    weekdays: Set<number>;
}
export declare function isValidTimeZone(timezone: string): boolean;
export declare function normalizeScheduleTimezone(timezone?: string | null, fallback?: string): string;
export declare function parseCron(expr: string): CronFields;
export declare function getNextRun(expr: string, from?: Date): Date;
export declare function getNextRunInTimezone(expr: string, from: Date | undefined, timezone: string): Date;
export declare function getNextRunForTimezone(expr: string, from?: Date, timezone?: string | null): Date;
export declare function formatScheduleTime(valueMs: number, timezone?: string | null, locale?: string): string;
/** Human-readable description of a cron expression (Korean) */
export declare function describeCron(expr: string): string;
export declare function isValidCron(expr: string): boolean;
//# sourceMappingURL=cron.d.ts.map