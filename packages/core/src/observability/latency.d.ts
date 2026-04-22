export type LatencyMetricName = "ingress_ack_latency_ms" | "normalizer_latency_ms" | "registry_lookup_latency_ms" | "orchestration_mode_latency_ms" | "orchestration_planning_latency_ms" | "candidate_search_latency_ms" | "contract_ai_comparison_latency_ms" | "sub_session_queue_wait_ms" | "first_progress_latency_ms" | "approval_aggregation_latency_ms" | "finalization_latency_ms" | "execution_latency_ms" | "delivery_latency_ms" | "webui_live_update_latency_ms" | "resource_lock_wait_ms" | "schedule_tick_direct_execution_latency_ms";
export type LatencyMetricStatus = "ok" | "slow" | "timeout";
export interface LatencyMetricRecord {
    id: string;
    name: LatencyMetricName;
    durationMs: number;
    budgetMs: number;
    status: LatencyMetricStatus;
    createdAt: number;
    runId?: string;
    sessionId?: string;
    requestGroupId?: string;
    source?: string;
    detail?: Record<string, unknown>;
}
export interface LatencyMetricSummary {
    name: LatencyMetricName;
    count: number;
    p95Ms: number | null;
    lastMs: number | null;
    budgetMs: number;
    timeoutCount: number;
    slowCount: number;
    status: LatencyMetricStatus;
    lastAt: number | null;
}
export interface FastResponseHealthSnapshot {
    generatedAt: number;
    status: LatencyMetricStatus;
    reason: string;
    recentWindowMs: number;
    metrics: LatencyMetricSummary[];
    recentTimeouts: LatencyMetricRecord[];
}
export declare const LATENCY_BUDGET_MS: Record<LatencyMetricName, number>;
export declare function recordLatencyMetric(input: {
    name: LatencyMetricName;
    durationMs: number;
    budgetMs?: number;
    timeout?: boolean;
    createdAt?: number;
    runId?: string;
    sessionId?: string;
    requestGroupId?: string;
    source?: string;
    detail?: Record<string, unknown>;
}): LatencyMetricRecord;
export declare function buildLatencyEventLabel(record: Pick<LatencyMetricRecord, "name" | "durationMs" | "status">): string;
export declare function buildLatencyEventLabelForMeasurement(input: {
    name: LatencyMetricName;
    durationMs: number;
    budgetMs?: number;
    timeout?: boolean;
}): string;
export declare function listLatencyMetrics(): LatencyMetricRecord[];
export declare function resetLatencyMetrics(): void;
export declare function getFastResponseHealthSnapshot(input?: {
    now?: number;
    windowMs?: number;
}): FastResponseHealthSnapshot;
//# sourceMappingURL=latency.d.ts.map