const MAX_LATENCY_RECORDS = 1_000;
const DEFAULT_RECENT_WINDOW_MS = 15 * 60 * 1000;
export const LATENCY_BUDGET_MS = {
    ingress_ack_latency_ms: 800,
    normalizer_latency_ms: 300,
    registry_lookup_latency_ms: 500,
    orchestration_mode_latency_ms: 500,
    orchestration_planning_latency_ms: 2_000,
    candidate_search_latency_ms: 250,
    contract_ai_comparison_latency_ms: 1_800,
    sub_session_spawn_ack_ms: 300,
    sub_session_queue_wait_ms: 500,
    first_progress_latency_ms: 3_000,
    model_execution_latency_ms: 5_000,
    monitoring_snapshot_latency_ms: 1_000,
    approval_aggregation_latency_ms: 1_000,
    finalization_latency_ms: 1_500,
    execution_latency_ms: 5_000,
    delivery_latency_ms: 1_500,
    webui_live_update_latency_ms: 1_000,
    resource_lock_wait_ms: 500,
    schedule_tick_direct_execution_latency_ms: 150,
};
const latencyRecords = [];
function normalizeDuration(value) {
    return Math.max(0, Math.round(Number.isFinite(value) ? value : 0));
}
function classifyLatency(durationMs, budgetMs, timeout) {
    if (timeout)
        return "timeout";
    if (durationMs > budgetMs)
        return "slow";
    return "ok";
}
function percentile95(values) {
    if (values.length === 0)
        return null;
    const sorted = [...values].sort((a, b) => a - b);
    const index = Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1);
    return sorted[index] ?? null;
}
function worstStatus(statuses) {
    if (statuses.includes("timeout"))
        return "timeout";
    if (statuses.includes("slow"))
        return "slow";
    return "ok";
}
export function recordLatencyMetric(input) {
    const durationMs = normalizeDuration(input.durationMs);
    const budgetMs = normalizeDuration(input.budgetMs ?? LATENCY_BUDGET_MS[input.name]);
    const record = {
        id: crypto.randomUUID(),
        name: input.name,
        durationMs,
        budgetMs,
        status: classifyLatency(durationMs, budgetMs, input.timeout),
        createdAt: input.createdAt ?? Date.now(),
        ...(input.runId ? { runId: input.runId } : {}),
        ...(input.sessionId ? { sessionId: input.sessionId } : {}),
        ...(input.requestGroupId ? { requestGroupId: input.requestGroupId } : {}),
        ...(input.source ? { source: input.source } : {}),
        ...(input.detail ? { detail: input.detail } : {}),
    };
    latencyRecords.push(record);
    if (latencyRecords.length > MAX_LATENCY_RECORDS)
        latencyRecords.splice(0, latencyRecords.length - MAX_LATENCY_RECORDS);
    return record;
}
export function buildLatencyEventLabel(record) {
    return record.status === "ok"
        ? `${record.name}=${record.durationMs}ms`
        : `${record.name}=${record.durationMs}ms status=${record.status}`;
}
export function buildLatencyEventLabelForMeasurement(input) {
    const durationMs = normalizeDuration(input.durationMs);
    const budgetMs = normalizeDuration(input.budgetMs ?? LATENCY_BUDGET_MS[input.name]);
    return buildLatencyEventLabel({
        name: input.name,
        durationMs,
        status: classifyLatency(durationMs, budgetMs, input.timeout),
    });
}
export function listLatencyMetrics() {
    return [...latencyRecords];
}
export function resetLatencyMetrics() {
    latencyRecords.splice(0, latencyRecords.length);
}
export function getFastResponseHealthSnapshot(input = {}) {
    const now = input.now ?? Date.now();
    const recentWindowMs = input.windowMs ?? DEFAULT_RECENT_WINDOW_MS;
    const recent = latencyRecords.filter((record) => now - record.createdAt <= recentWindowMs);
    const metricNames = Object.keys(LATENCY_BUDGET_MS);
    const metrics = metricNames.map((name) => {
        const records = recent.filter((record) => record.name === name);
        const last = records[records.length - 1];
        const status = worstStatus(records.map((record) => record.status));
        return {
            name,
            count: records.length,
            p95Ms: percentile95(records.map((record) => record.durationMs)),
            lastMs: last?.durationMs ?? null,
            budgetMs: LATENCY_BUDGET_MS[name],
            timeoutCount: records.filter((record) => record.status === "timeout").length,
            slowCount: records.filter((record) => record.status === "slow").length,
            status,
            lastAt: last?.createdAt ?? null,
        };
    });
    const status = worstStatus(metrics.map((metric) => metric.status));
    const reason = status === "timeout"
        ? "최근 빠른 응답 경로에서 timeout이 발생했습니다."
        : status === "slow"
            ? "최근 빠른 응답 경로 중 일부가 latency budget을 초과했습니다."
            : "최근 빠른 응답 경로가 budget 안에서 동작했습니다.";
    return {
        generatedAt: now,
        status,
        reason,
        recentWindowMs,
        metrics,
        recentTimeouts: recent.filter((record) => record.status === "timeout").slice(-10),
    };
}
//# sourceMappingURL=latency.js.map