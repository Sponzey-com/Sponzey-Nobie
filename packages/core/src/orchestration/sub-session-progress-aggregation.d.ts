import type { SubSessionStatus } from "../contracts/sub-agent-orchestration.js";
export interface SubSessionProgressAggregationItem {
    parentRunId: string;
    subSessionId: string;
    agentId?: string;
    agentDisplayName?: string;
    agentNickname?: string;
    status: SubSessionStatus;
    summary: string;
    at: number;
}
export interface SubSessionProgressAggregationBatch {
    parentRunId: string;
    windowStartedAt: number;
    windowClosedAt: number;
    windowMs: number;
    reason: "window_elapsed" | "manual_flush" | "terminal_flush";
    items: SubSessionProgressAggregationItem[];
    text: string;
}
export interface SubSessionProgressAggregatorOptions {
    now?: () => number;
    windowMs?: number;
}
export declare function buildSubSessionProgressSummary(items: SubSessionProgressAggregationItem[]): string;
export declare class SubSessionProgressAggregator {
    private readonly now;
    readonly windowMs: number;
    private readonly buckets;
    constructor(options?: SubSessionProgressAggregatorOptions);
    push(item: SubSessionProgressAggregationItem): SubSessionProgressAggregationBatch | undefined;
    flush(parentRunId: string, reason?: SubSessionProgressAggregationBatch["reason"], now?: number): SubSessionProgressAggregationBatch | undefined;
    flushAll(reason?: SubSessionProgressAggregationBatch["reason"], now?: number): SubSessionProgressAggregationBatch[];
}
export declare function createSubSessionProgressAggregator(options?: SubSessionProgressAggregatorOptions): SubSessionProgressAggregator;
//# sourceMappingURL=sub-session-progress-aggregation.d.ts.map
