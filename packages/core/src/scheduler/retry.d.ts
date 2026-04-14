export interface ScheduleRetryPolicy {
    maxRetries: number;
    baseDelayMs: number;
    maxDelayMs: number;
}
export declare const DEFAULT_SCHEDULE_RETRY_POLICY: ScheduleRetryPolicy;
export declare function normalizeScheduleMaxRetries(value: number | null | undefined): number;
export declare function computeScheduleRetryDelayMs(attempt: number, policy?: Partial<ScheduleRetryPolicy>): number;
//# sourceMappingURL=retry.d.ts.map