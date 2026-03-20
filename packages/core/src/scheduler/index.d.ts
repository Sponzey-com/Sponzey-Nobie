declare class Scheduler {
    private timer;
    private running;
    start(): void;
    stop(): void;
    /** Re-tick immediately to pick up schedule changes */
    reload(): void;
    getHealth(): {
        running: boolean;
        activeJobs: number;
        activeJobIds: string[];
        nextRuns: Array<{
            scheduleId: string;
            name: string;
            nextRunAt: number;
        }>;
    };
    private tick;
    runNow(scheduleId: string, trigger?: string): Promise<string>;
    private _execute;
}
export declare const scheduler: Scheduler;
export declare function startScheduler(): void;
export declare function stopScheduler(): void;
export declare function runSchedule(scheduleId: string, trigger?: string): Promise<string>;
export {};
//# sourceMappingURL=index.d.ts.map