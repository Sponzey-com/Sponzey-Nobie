export interface CronFields {
    minutes: Set<number>;
    hours: Set<number>;
    days: Set<number>;
    months: Set<number>;
    weekdays: Set<number>;
}
export declare function parseCron(expr: string): CronFields;
export declare function getNextRun(expr: string, from?: Date): Date;
/** Human-readable description of a cron expression (Korean) */
export declare function describeCron(expr: string): string;
export declare function isValidCron(expr: string): boolean;
//# sourceMappingURL=cron.d.ts.map