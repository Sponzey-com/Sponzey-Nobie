const MIN_WINDOW_MS = 2_000;
const MAX_WINDOW_MS = 5_000;
const DEFAULT_WINDOW_MS = 3_000;
function clampWindowMs(value) {
    if (!Number.isFinite(value))
        return DEFAULT_WINDOW_MS;
    return Math.max(MIN_WINDOW_MS, Math.min(MAX_WINDOW_MS, Math.floor(value ?? DEFAULT_WINDOW_MS)));
}
export function buildSubSessionProgressSummary(items) {
    const ordered = [...items].sort((a, b) => a.subSessionId.localeCompare(b.subSessionId));
    if (ordered.length === 0)
        return "서브 에이전트 진행 요약: 변경 없음";
    const body = ordered
        .map((item) => {
        const name = item.agentDisplayName?.trim() || item.agentId?.trim() || item.subSessionId;
        return `${name} ${item.status}: ${item.summary.trim()}`;
    })
        .join(" / ");
    return `서브 에이전트 진행 요약: ${body}`;
}
export class SubSessionProgressAggregator {
    now;
    windowMs;
    buckets = new Map();
    constructor(options = {}) {
        this.now = options.now ?? (() => Date.now());
        this.windowMs = clampWindowMs(options.windowMs);
    }
    push(item) {
        const at = item.at || this.now();
        const bucket = this.buckets.get(item.parentRunId) ?? {
            startedAt: at,
            latestBySubSession: new Map(),
        };
        bucket.latestBySubSession.set(item.subSessionId, { ...item, at });
        this.buckets.set(item.parentRunId, bucket);
        if (at - bucket.startedAt < this.windowMs)
            return undefined;
        return this.flush(item.parentRunId, "window_elapsed", at);
    }
    flush(parentRunId, reason = "manual_flush", now = this.now()) {
        const bucket = this.buckets.get(parentRunId);
        if (!bucket || bucket.latestBySubSession.size === 0)
            return undefined;
        this.buckets.delete(parentRunId);
        const items = [...bucket.latestBySubSession.values()];
        return {
            parentRunId,
            windowStartedAt: bucket.startedAt,
            windowClosedAt: now,
            windowMs: Math.max(0, now - bucket.startedAt),
            reason,
            items,
            text: buildSubSessionProgressSummary(items),
        };
    }
    flushAll(reason = "manual_flush", now = this.now()) {
        return [...this.buckets.keys()]
            .map((parentRunId) => this.flush(parentRunId, reason, now))
            .filter((batch) => Boolean(batch));
    }
}
export function createSubSessionProgressAggregator(options = {}) {
    return new SubSessionProgressAggregator(options);
}
//# sourceMappingURL=sub-session-progress-aggregation.js.map